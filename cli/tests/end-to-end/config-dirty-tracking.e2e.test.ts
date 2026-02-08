import { resolve, join } from 'node:path';
import { cp } from 'node:fs/promises';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  createEventLog,
  createManifestService,
  createRunner,
  createStorageContext,
  initializeMovieStorage,
  savePromptFile,
  type ProduceRequest,
  type ProduceResult,
  type ProduceFn,
} from '@gorenku/core';
import { getDefaultCliConfigPath, readCliConfig } from '../../src/lib/cli-config.js';
import { formatMovieId } from '../../src/commands/execute.js';
import { generatePlan } from '../../src/lib/planner.js';
import {
  createLoggerRecorder,
  readPlan,
  setupTempCliConfig,
  writeInputsFile,
} from './helpers.js';
import { CLI_FIXTURES_BLUEPRINTS, CLI_FIXTURES_INPUTS } from '../test-catalog-paths.js';

/**
 * E2E tests for dirty tracking of TOML prompt configs and YAML config values.
 *
 * Uses the audio-only blueprint fixture:
 *   ScriptProducer (with script.toml → LLM) → 3x AudioProducer (text-to-speech)
 *
 * Verifies that changing TOML prompts or YAML config values causes the planner
 * to schedule re-runs for affected producers and their downstream dependents.
 */
describe('end-to-end: config dirty tracking', () => {
  let tempRoot = '';
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    tempRoot = config.tempRoot;
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  /** Stub produce function that always succeeds with test data. */
  function createStubProduce(): ProduceFn {
    return vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artefacts: request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artefactId: string) => ({
            artefactId,
            blob: {
              data: `stub-data-for-${artefactId}`,
              mimeType: 'text/plain',
            },
          })),
      };
    });
  }

  /** Run a full plan + execute cycle and persist manifest. */
  async function runPhase(opts: {
    movieId: string;
    storageMovieId: string;
    blueprintPath: string;
    inputsPath: string;
    isNew: boolean;
  }) {
    const { logger } = createLoggerRecorder();
    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    const planResult = await generatePlan({
      cliConfig,
      movieId: opts.storageMovieId,
      isNew: opts.isNew,
      inputsPath: opts.inputsPath,
      usingBlueprint: opts.blueprintPath,
      logger,
      collectExplanation: true,
    });
    await planResult.persist();

    const plan = await readPlan(planResult.planPath);
    const allJobs = plan.layers.flat();

    // Execute the plan
    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage, opts.storageMovieId);
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    const runner = createRunner();
    const result = await runner.execute(planResult.plan, {
      movieId: opts.storageMovieId,
      manifest: planResult.manifest,
      storage,
      eventLog,
      manifestService,
      produce: createStubProduce(),
      logger,
    });

    // Build and save manifest
    const manifest = await result.buildManifest();
    await manifestService.saveManifest(manifest, {
      movieId: opts.storageMovieId,
      previousHash: planResult.manifestHash,
      clock: { now: () => new Date().toISOString() },
    });

    return { planResult, plan, allJobs, manifest, cliConfig };
  }

  it('TOML systemPrompt change triggers re-run + downstream propagation', async () => {
    // Copy blueprint to temp directory so we can safely modify TOML
    const sourceBlueprint = resolve(CLI_FIXTURES_BLUEPRINTS, 'audio-only');
    const tempBlueprintDir = join(tempRoot, 'audio-only');
    await cp(sourceBlueprint, tempBlueprintDir, { recursive: true });

    const blueprintPath = resolve(tempBlueprintDir, 'audio-only.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'audio-only-inputs.yaml');
    const movieId = 'e2e-toml-dirty';
    const storageMovieId = formatMovieId(movieId);

    // Phase 1: fresh run
    const phase1 = await runPhase({
      movieId,
      storageMovieId,
      blueprintPath,
      inputsPath,
      isNew: true,
    });
    expect(phase1.allJobs.length).toBeGreaterThanOrEqual(4); // 1 script + 3 audio

    // Modify the script.toml in the temp copy (simulates user editing the TOML)
    const scriptTomlPath = resolve(tempBlueprintDir, 'script', 'script.toml');
    const { loadPromptFile } = await import('@gorenku/core');
    const originalPrompts = await loadPromptFile(scriptTomlPath);

    // Save modified TOML to temp copy
    const modifiedPrompts = { ...originalPrompts, systemPrompt: 'MODIFIED: You are a different writer now.' };
    await savePromptFile(scriptTomlPath, modifiedPrompts);

    // Phase 2: edit run — should detect TOML change
    const phase2 = await runPhase({
      movieId,
      storageMovieId,
      blueprintPath,
      inputsPath,
      isNew: false,
    });

    // ScriptProducer should be re-run (dirty systemPrompt) + all 3 AudioProducers (downstream)
    const phase2Jobs = phase2.allJobs;
    expect(phase2Jobs.length).toBe(4);

    const scriptJobs = phase2Jobs.filter((j: { producer: string }) => j.producer === 'ScriptProducer');
    const audioJobs = phase2Jobs.filter((j: { producer: string }) => j.producer === 'AudioProducer');
    expect(scriptJobs).toHaveLength(1);
    expect(audioJobs).toHaveLength(3);

    // Check explanation mentions systemPrompt dirty
    if (phase2.planResult.explanation) {
      const scriptExplanation = phase2.planResult.explanation.jobReasons.find(
        (j: { producer: string }) => j.producer === 'ScriptProducer',
      );
      expect(scriptExplanation).toBeDefined();
      expect(scriptExplanation?.dirtyInputs ?? []).toContain('Input:ScriptProducer.systemPrompt');
    }
  });

  it('config change in input YAML triggers re-run', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'audio-only', 'audio-only.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'audio-only-inputs.yaml');
    const movieId = 'e2e-yaml-config-dirty';
    const storageMovieId = formatMovieId(movieId);

    // Phase 1: fresh run with text_format: json_schema
    const phase1 = await runPhase({
      movieId,
      storageMovieId,
      blueprintPath,
      inputsPath,
      isNew: true,
    });
    expect(phase1.allJobs.length).toBeGreaterThanOrEqual(4);

    // Phase 2: change text_format to "text" in inputs
    const modifiedInputsPath = join(tempRoot, 'modified-inputs.yaml');
    await writeInputsFile(inputsPath, modifiedInputsPath, {
      models: [
        { model: 'gpt-5.2', provider: 'openai', producerId: 'ScriptProducer', config: { text_format: 'text' } },
        { model: 'minimax/speech-2.6-hd', provider: 'replicate', producerId: 'AudioProducer' },
      ],
    });

    const phase2 = await runPhase({
      movieId,
      storageMovieId,
      blueprintPath,
      inputsPath: modifiedInputsPath,
      isNew: false,
    });

    // ScriptProducer + downstream AudioProducers should be in plan
    const scriptJobs = phase2.allJobs.filter((j: { producer: string }) => j.producer === 'ScriptProducer');
    const audioJobs = phase2.allJobs.filter((j: { producer: string }) => j.producer === 'AudioProducer');
    expect(scriptJobs.length).toBeGreaterThanOrEqual(1);
    expect(audioJobs.length).toBeGreaterThanOrEqual(1);
  });

  it('no change → empty plan', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'audio-only', 'audio-only.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'audio-only-inputs.yaml');
    const movieId = 'e2e-no-change';
    const storageMovieId = formatMovieId(movieId);

    // Phase 1: fresh run
    await runPhase({
      movieId,
      storageMovieId,
      blueprintPath,
      inputsPath,
      isNew: true,
    });

    // Phase 2: identical run
    const { logger } = createLoggerRecorder();
    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    const planResult = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: false,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger,
    });

    // Use the in-memory plan directly (no need to persist for this check)
    const allJobs = planResult.plan.layers.flat();
    expect(allJobs).toHaveLength(0);
  });

  it('builds folder TOML overrides blueprint template', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'audio-only', 'audio-only.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'audio-only-inputs.yaml');
    const movieId = 'e2e-builds-toml-override';
    const storageMovieId = formatMovieId(movieId);

    // Phase 1: fresh run (uses blueprint template TOML)
    const phase1 = await runPhase({
      movieId,
      storageMovieId,
      blueprintPath,
      inputsPath,
      isNew: true,
    });
    expect(phase1.allJobs.length).toBeGreaterThanOrEqual(4);

    // Save edited TOML to builds/{movieId}/prompts/ScriptProducer.toml
    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    const buildsDir = resolve(cliConfig.storage.root, cliConfig.storage.basePath, storageMovieId);
    const { saveProducerPrompts, loadPromptFile } = await import('@gorenku/core');

    // Load original prompts
    const originalTomlPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'audio-only', 'script', 'script.toml');
    const originalPrompts = await loadPromptFile(originalTomlPath);

    // Save modified version to builds folder
    await saveProducerPrompts(buildsDir, 'ScriptProducer', {
      ...originalPrompts,
      systemPrompt: 'BUILDS OVERRIDE: Different system prompt from builds folder.',
    });

    // Phase 2: should detect that builds TOML differs from template used in Phase 1
    const phase2 = await runPhase({
      movieId,
      storageMovieId,
      blueprintPath,
      inputsPath,
      isNew: false,
    });

    const scriptJobs = phase2.allJobs.filter((j: { producer: string }) => j.producer === 'ScriptProducer');
    expect(scriptJobs).toHaveLength(1); // ScriptProducer should be re-run
  });

  it('provider change triggers re-run', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'audio-only', 'audio-only.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'audio-only-inputs.yaml');
    const movieId = 'e2e-provider-change';
    const storageMovieId = formatMovieId(movieId);

    // Phase 1: fresh run with openai
    const phase1 = await runPhase({
      movieId,
      storageMovieId,
      blueprintPath,
      inputsPath,
      isNew: true,
    });
    expect(phase1.allJobs.length).toBeGreaterThanOrEqual(4);

    // Phase 2: change ScriptProducer provider to anthropic
    const modifiedInputsPath = join(tempRoot, 'provider-change-inputs.yaml');
    await writeInputsFile(inputsPath, modifiedInputsPath, {
      models: [
        { model: 'claude-sonnet-4-5-20250929', provider: 'anthropic', producerId: 'ScriptProducer', config: { text_format: 'json_schema' } },
        { model: 'minimax/speech-2.6-hd', provider: 'replicate', producerId: 'AudioProducer' },
      ],
    });

    const phase2 = await runPhase({
      movieId,
      storageMovieId,
      blueprintPath,
      inputsPath: modifiedInputsPath,
      isNew: false,
    });

    // ScriptProducer + downstream AudioProducers should be in plan
    const scriptJobs = phase2.allJobs.filter((j: { producer: string }) => j.producer === 'ScriptProducer');
    const audioJobs = phase2.allJobs.filter((j: { producer: string }) => j.producer === 'AudioProducer');
    expect(scriptJobs).toHaveLength(1);
    expect(audioJobs).toHaveLength(3);
  });
});
