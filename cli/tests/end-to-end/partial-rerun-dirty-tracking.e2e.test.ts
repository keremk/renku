import { resolve } from 'node:path';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  createEventLog,
  createManifestService,
  createRunner,
  createStorageContext,
  initializeMovieStorage,
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
} from './helpers.js';
import { CLI_FIXTURES_BLUEPRINTS, CLI_FIXTURES_INPUTS } from '../test-catalog-paths.js';

/**
 * E2E tests for dirty tracking after partial re-runs (upToLayer / reRunFrom).
 *
 * Uses the ken-burns blueprint fixture (image-audio):
 *   Layer 0: ScriptProducer (LLM)
 *   Layer 1: ImagePromptProducer[segment] (LLM) + AudioProducer[segment] (TTS)
 *   Layer 2: ImageProducer[segment][image] (image gen)
 *   Layer 3: TimelineComposer
 *
 * Reproduces the real-world scenario:
 *   1. Full run (all layers complete, manifest saved)
 *   2. Re-run layer 0 only (ScriptProducer produces NEW artifacts with different content)
 *   3. Request a plan → layer 1 jobs should be dirty because their upstream
 *      artifact content changed (inputsHash mismatch)
 *
 * This is the exact scenario that fails with animated-edu-characters:
 * after upToLayer:0 partial re-run, the planner should detect that downstream
 * jobs need re-running because the content of their inputs has changed.
 */
describe('end-to-end: partial re-run dirty tracking', () => {
  let _tempRoot = '';
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    globalInvocationCounter = 0;
    const config = await setupTempCliConfig();
    _tempRoot = config.tempRoot;
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  /**
   * Global invocation counter shared across all produce calls.
   * Each call increments it, ensuring every blob has a unique hash —
   * even across separate produce instances (Phase 1 vs Phase 2).
   */
  let globalInvocationCounter = 0;

  /**
   * Stub produce function that returns UNIQUE data per invocation.
   * This simulates real LLM behavior where re-running a producer
   * yields different output (different blob hashes).
   */
  function createCountingStubProduce(): ProduceFn {
    return vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      globalInvocationCounter += 1;
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artefacts: request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artefactId: string) => ({
            artefactId,
            blob: {
              data: `data-invocation-${globalInvocationCounter}-${artefactId}`,
              mimeType: 'text/plain',
            },
          })),
      };
    });
  }

  it('detects dirty layer-1 jobs after upToLayer=0 partial re-run', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'ken-burns', 'image-audio.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'image-audio-inputs.yaml');
    const movieId = 'e2e-partial-rerun-dirty';
    const storageMovieId = formatMovieId(movieId);

    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // ============================================================
    // PHASE 1: Full fresh run — all layers complete
    // ============================================================
    const { logger: logger1 } = createLoggerRecorder();

    const planResult1 = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: true,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger: logger1,
      collectExplanation: true,
    });
    await planResult1.persist();

    const plan1 = await readPlan(planResult1.planPath);
    const allJobs1 = plan1.layers.flat();

    // Verify initial plan has all producers:
    // 1 ScriptProducer + 2 ImagePromptProducer + 6 ImageProducer + 2 AudioProducer + 1 TimelineComposer = 12
    expect(allJobs1.length).toBeGreaterThanOrEqual(10);

    const scriptJobs1 = allJobs1.filter((j: { producer: string }) => j.producer === 'ScriptProducer');
    const imagePromptJobs1 = allJobs1.filter((j: { producer: string }) => j.producer === 'ImagePromptProducer');
    const audioJobs1 = allJobs1.filter((j: { producer: string }) => j.producer === 'AudioProducer');
    expect(scriptJobs1).toHaveLength(1);
    expect(imagePromptJobs1).toHaveLength(2); // 2 segments
    expect(audioJobs1).toHaveLength(2); // 2 segments

    // Execute Phase 1 with a counting produce (unique data per call)
    const storage1 = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage1, storageMovieId);
    const eventLog1 = createEventLog(storage1);
    const manifestService1 = createManifestService(storage1);

    const runner1 = createRunner();
    const result1 = await runner1.execute(planResult1.plan, {
      movieId: storageMovieId,
      manifest: planResult1.manifest,
      storage: storage1,
      eventLog: eventLog1,
      manifestService: manifestService1,
      produce: createCountingStubProduce(),
      logger: logger1,
    });

    expect(result1.status).toBe('succeeded');

    // Build and save manifest after Phase 1
    const manifest1 = await result1.buildManifest();
    await manifestService1.saveManifest(manifest1, {
      movieId: storageMovieId,
      previousHash: planResult1.manifestHash,
      clock: { now: () => new Date().toISOString() },
    });

    // Verify manifest has artifacts from all layers
    const layer1ArtifactKeys = Object.keys(manifest1.artefacts).filter(
      (id) => id.includes('ImagePromptProducer') || id.includes('AudioProducer'),
    );
    expect(layer1ArtifactKeys.length).toBeGreaterThan(0);

    // Record inputsHash values for layer-1 artifacts (before re-run)
    const inputsHashBefore: Record<string, string | undefined> = {};
    for (const key of layer1ArtifactKeys) {
      inputsHashBefore[key] = manifest1.artefacts[key]?.inputsHash;
    }

    // ============================================================
    // PHASE 2: Re-run with reRunFrom=0 — only layer 0 executes
    // ============================================================
    const { logger: logger2 } = createLoggerRecorder();

    // Generate plan with reRunFrom=0 (forces all jobs to be included)
    const planResult2 = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: false,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger: logger2,
      reRunFrom: 0,
      collectExplanation: true,
    });
    await planResult2.persist();

    // Truncate the plan to layer 0 only — simulates --up-to-layer 0
    // The plan has all layers because reRunFrom=0 marks everything dirty,
    // but we only want to execute layer 0.
    const truncatedPlan = {
      ...planResult2.plan,
      layers: [planResult2.plan.layers[0] ?? []],
    };

    // Verify truncated plan has only ScriptProducer
    const truncatedJobs = truncatedPlan.layers.flat();
    expect(truncatedJobs).toHaveLength(1);
    expect(truncatedJobs[0].producer).toBe('ScriptProducer');

    // Execute ONLY layer 0 with a NEW counting produce (different data!)
    const storage2 = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    const eventLog2 = createEventLog(storage2);
    const manifestService2 = createManifestService(storage2);

    const runner2 = createRunner();
    const result2 = await runner2.execute(truncatedPlan, {
      movieId: storageMovieId,
      manifest: planResult2.manifest,
      storage: storage2,
      eventLog: eventLog2,
      manifestService: manifestService2,
      produce: createCountingStubProduce(),
      logger: logger2,
    });

    expect(result2.status).toBe('succeeded');

    // Build manifest from ALL events (Phase 1 + Phase 2)
    // Layer 0 artifacts will have NEW hashes (from Phase 2)
    // Layer 1+ artifacts will have OLD hashes (from Phase 1, still latest)
    const manifest2 = await result2.buildManifest();

    // Save the updated manifest
    // Load current manifest hash to use as previousHash
    const { hash: currentManifestHash } = await manifestService2.loadCurrent(storageMovieId);
    await manifestService2.saveManifest(manifest2, {
      movieId: storageMovieId,
      previousHash: currentManifestHash,
      clock: { now: () => new Date().toISOString() },
    });

    // Verify layer 0 artifacts have CHANGED hashes
    const scriptArtifactKeys = Object.keys(manifest2.artefacts).filter(
      (id) => id.includes('ScriptProducer'),
    );
    for (const key of scriptArtifactKeys) {
      const oldHash = manifest1.artefacts[key]?.hash;
      const newHash = manifest2.artefacts[key]?.hash;
      expect(newHash).toBeDefined();
      expect(newHash).not.toBe(oldHash); // Phase 2 produced different data
    }

    // Verify layer 1 artifacts still have OLD hashes
    for (const key of layer1ArtifactKeys) {
      const oldHash = manifest1.artefacts[key]?.hash;
      const newHash = manifest2.artefacts[key]?.hash;
      expect(newHash).toBe(oldHash); // Layer 1 was not re-run
    }

    // Verify inputsHash on layer-1 artifacts is still the OLD value
    for (const key of layer1ArtifactKeys) {
      expect(manifest2.artefacts[key]?.inputsHash).toBe(inputsHashBefore[key]);
    }

    // ============================================================
    // PHASE 3: Request plan — should detect layer 1 jobs as dirty
    // ============================================================
    const { logger: logger3 } = createLoggerRecorder();

    const planResult3 = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: false,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger: logger3,
      collectExplanation: true,
    });

    // THE CRITICAL ASSERTION:
    // Layer 1 jobs must be in the plan because their upstream artifact content changed.
    const plan3Jobs = planResult3.plan.layers.flat();
    expect(plan3Jobs.length).toBeGreaterThan(0);

    const imagePromptJobs3 = plan3Jobs.filter(
      (j) => j.producer === 'ImagePromptProducer',
    );
    const audioJobs3 = plan3Jobs.filter(
      (j) => j.producer === 'AudioProducer',
    );

    // ImagePromptProducer consumes NarrationScript[segment] which changed
    expect(imagePromptJobs3.length).toBeGreaterThanOrEqual(1);

    // AudioProducer also consumes NarrationScript[segment] which changed
    expect(audioJobs3.length).toBeGreaterThanOrEqual(1);

    // Downstream of dirty layer-1 jobs should also be dirty (propagation):
    // ImageProducer (layer 2) and TimelineComposer (layer 3)
    const imageProducerJobs3 = plan3Jobs.filter(
      (j) => j.producer === 'ImageProducer',
    );
    const timelineJobs3 = plan3Jobs.filter(
      (j) => j.producer === 'TimelineComposer',
    );
    expect(imageProducerJobs3.length).toBeGreaterThanOrEqual(1);
    expect(timelineJobs3.length).toBeGreaterThanOrEqual(1);

    // Verify explanation shows inputsHashChanged for layer 1 jobs
    if (planResult3.explanation) {
      const imagePromptReasons = planResult3.explanation.jobReasons.filter(
        (r) => r.producer === 'ImagePromptProducer',
      );
      const audioReasons = planResult3.explanation.jobReasons.filter(
        (r) => r.producer === 'AudioProducer',
      );

      // At least one ImagePromptProducer should be dirty due to inputsHashChanged
      expect(
        imagePromptReasons.some((r) => r.reason === 'inputsHashChanged'),
      ).toBe(true);

      // At least one AudioProducer should be dirty due to inputsHashChanged
      expect(
        audioReasons.some((r) => r.reason === 'inputsHashChanged'),
      ).toBe(true);

      // Downstream jobs should be dirty due to propagation
      const imageProducerReasons = planResult3.explanation.jobReasons.filter(
        (r) => r.producer === 'ImageProducer',
      );
      expect(
        imageProducerReasons.some((r) => r.reason === 'propagated'),
      ).toBe(true);
    }
  });

  it('no re-run → empty plan (no false positives)', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'ken-burns', 'image-audio.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'image-audio-inputs.yaml');
    const movieId = 'e2e-no-false-positive';
    const storageMovieId = formatMovieId(movieId);

    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // Phase 1: Full fresh run
    const { logger: logger1 } = createLoggerRecorder();
    const planResult1 = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: true,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger: logger1,
    });
    await planResult1.persist();

    const storage1 = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage1, storageMovieId);
    const eventLog1 = createEventLog(storage1);
    const manifestService1 = createManifestService(storage1);

    const runner1 = createRunner();
    const result1 = await runner1.execute(planResult1.plan, {
      movieId: storageMovieId,
      manifest: planResult1.manifest,
      storage: storage1,
      eventLog: eventLog1,
      manifestService: manifestService1,
      produce: createCountingStubProduce(),
      logger: logger1,
    });
    expect(result1.status).toBe('succeeded');

    const manifest1 = await result1.buildManifest();
    await manifestService1.saveManifest(manifest1, {
      movieId: storageMovieId,
      previousHash: planResult1.manifestHash,
      clock: { now: () => new Date().toISOString() },
    });

    // Phase 2: Request plan WITHOUT any changes — should be empty
    const { logger: logger2 } = createLoggerRecorder();
    const planResult2 = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: false,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger: logger2,
      collectExplanation: true,
    });

    const allJobs2 = planResult2.plan.layers.flat();
    expect(allJobs2).toHaveLength(0);
  });
});
