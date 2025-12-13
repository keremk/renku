import { dirname, resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import {
  createEventLog,
  createManifestService,
  createRunner,
  createStorageContext,
  initializeMovieStorage,
  type ProduceRequest,
  type ProduceResult,
  type ProduceFn,
} from '@renku/core';
import { getDefaultCliConfigPath, readCliConfig } from '../../src/lib/cli-config.js';
import { formatMovieId } from '../../src/commands/query.js';
import { runEdit } from '../../src/commands/edit.js';
import { getBundledBlueprintsRoot } from '../../src/lib/config-assets.js';
import { generatePlan } from '../../src/lib/planner.js';
import {
  createLoggerRecorder,
  readPlan,
  setupTempCliConfig,
} from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('end-to-end: artifact override via inputs.yaml', () => {
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

  it('re-runs downstream producers when artifact is overridden via file: prefix', async () => {
    const blueprintRoot = getBundledBlueprintsRoot();
    const blueprintPath = resolve(blueprintRoot, 'audio-only', 'audio-only.yaml');
    const inputsPath = resolve(__dirname, 'fixtures', 'audio-only-inputs.yaml');
    const { logger, warnings, errors } = createLoggerRecorder();
    const { logger: editLogger, warnings: editWarnings, errors: editErrors } = createLoggerRecorder();
    const movieId = 'e2e-artifact-override';
    const storageMovieId = formatMovieId(movieId);

    // Read CLI config for storage settings
    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // ============================================================
    // PHASE 1: Initial run to produce all artifacts (Core API)
    // ============================================================

    // Generate initial plan
    const planResult = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: true,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger,
      notifications: undefined,
    });

    // Persist the plan to disk
    await planResult.persist();

    // Verify initial plan structure
    const initialPlan = await readPlan(planResult.planPath);
    const initialJobs = initialPlan.layers.flat();
    expect(initialJobs.length).toBeGreaterThanOrEqual(4); // 1 script + 3 audio

    const scriptJob = initialJobs.find((j: any) => j.producer === 'ScriptProducer');
    const audioJobs = initialJobs.filter((j: any) => j.producer === 'AudioProducer');
    expect(scriptJob).toBeDefined();
    expect(audioJobs).toHaveLength(3);

    // Create storage and services for core runner
    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage, storageMovieId);
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    // Create custom produce function that returns stub data
    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artefacts: request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artefactId: string) => ({
            artefactId,
            blob: {
              data: `original-data-for-${artefactId}`,
              mimeType: 'text/plain',
            },
          })),
      };
    });

    // Execute initial run with core runner
    const runner = createRunner();
    const firstRunResult = await runner.execute(planResult.plan, {
      movieId: storageMovieId,
      manifest: planResult.manifest,
      storage,
      eventLog,
      manifestService,
      produce,
      logger,
    });

    // Verify first run succeeded
    expect(firstRunResult.status).toBe('succeeded');
    expect(firstRunResult.jobs).toHaveLength(4); // 1 script + 3 audio

    // Build and save manifest after first run
    const manifest1 = await firstRunResult.buildManifest();
    await manifestService.saveManifest(manifest1, {
      movieId: storageMovieId,
      previousHash: planResult.manifestHash,
      clock: { now: () => new Date().toISOString() },
    });

    // Verify all artifacts are in manifest
    expect(Object.keys(manifest1.artefacts).length).toBeGreaterThanOrEqual(4);

    // ============================================================
    // PHASE 2: Create override inputs.yaml with artifact override
    // ============================================================

    // Create a test narration script file that will replace NarrationScript[0]
    const overrideScriptContent = 'This is the overridden narration script for segment 0.';
    const overrideScriptPath = join(tempRoot, 'override-script.txt');
    await writeFile(overrideScriptPath, overrideScriptContent, 'utf8');

    // Create inputs with artifact override
    // The key "ScriptProducer.NarrationScript[0]" targets an artifact, not an input
    const overrideInputsPath = join(tempRoot, 'override-inputs.yaml');
    await writeFile(
      overrideInputsPath,
      stringifyYaml({
        inputs: {
          InquiryPrompt: 'Explain the water cycle',
          Duration: 15,
          NumOfSegments: 3,
          VoiceId: 'Wise_Woman',
          Audience: 'Adult',
          Emotion: 'neutral',
          Language: 'en',
          // Override NarrationScript[0] artifact with a user-provided file
          'ScriptProducer.NarrationScript[0]': `file:${overrideScriptPath}`,
        },
        models: [
          { model: 'gpt-5-mini', provider: 'openai', producerId: 'ScriptProducer' },
          { model: 'minimax/speech-2.6-hd', provider: 'replicate', producerId: 'AudioProducer' },
        ],
      }),
      'utf8',
    );

    // ============================================================
    // PHASE 3: Run edit with override inputs (dry-run to test planning)
    // ============================================================

    const editResult = await runEdit({
      movieId: storageMovieId,
      inputsPath: overrideInputsPath,
      dryRun: true,
      nonInteractive: true,
      usingBlueprint: blueprintPath,
      logger: editLogger,
    });

    // Verify edit dry-run succeeded
    expect(editResult.dryRun?.status).toBe('succeeded');

    // Read the edit plan
    const editPlan = await readPlan(editResult.planPath);
    const editJobs = editPlan.layers.flat();

    // CRITICAL VERIFICATION:
    // - AudioProducer[0] should be in the plan (consumes overridden NarrationScript[0])
    // - ScriptProducer should NOT be in the plan (it originally produced the artifact)
    // - AudioProducer[1] and AudioProducer[2] should NOT be in the plan (not affected)

    const editScriptJobs = editJobs.filter((j: any) => j.producer === 'ScriptProducer');
    const editAudioJobs = editJobs.filter((j: any) => j.producer === 'AudioProducer');

    expect(editScriptJobs).toHaveLength(0); // ScriptProducer should NOT re-run
    expect(editAudioJobs).toHaveLength(1); // Only AudioProducer[0] should re-run

    // Verify the only audio job is for segment 0
    const audioJob0 = editAudioJobs[0];
    expect(audioJob0.jobId).toContain('[0]');

    // Verify correct job count
    expect(editResult.dryRun?.jobCount).toBe(1);

    // ============================================================
    // PHASE 4: Verify no warnings/errors during edit planning
    // ============================================================
    expect(editWarnings).toHaveLength(0);
    expect(editErrors).toHaveLength(0);
  });
});
