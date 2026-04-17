import { resolve } from 'node:path';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  createEventLog,
  createBuildStateService,
  createRunner,
  createStorageContext,
  initializeMovieStorage,
  type ProduceRequest,
  type ProduceResult,
  type ProduceFn,
} from '@gorenku/core';
import { getDefaultCliConfigPath, readCliConfig } from '../../../src/lib/cli-config.js';
import { formatMovieId, runExecute } from '../../../src/commands/execute.js';
import { generatePlan } from '../../../src/lib/planner.js';
import {
  createLoggerRecorder,
  expectFileExists,
  readPlan,
  setupTempCliConfig,
} from '../helpers.js';
import { CLI_FIXTURES_BLUEPRINTS, CLI_FIXTURES_INPUTS } from '../../test-catalog-paths.js';

describe('end-to-end: failed artifact recovery', () => {
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

  it('re-runs only the failed AudioProducer job in edit flow', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'pipeline-orchestration', 'audio-narration-loop', 'audio-narration-loop.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'audio-narration-loop--default.inputs.yaml');
    const { logger, warnings, errors } = createLoggerRecorder();
    // Create separate logger for recovery phase to avoid seeing the intentional failure error
    const { logger: recoveryLogger, warnings: recoveryWarnings, errors: recoveryErrors } = createLoggerRecorder();
    const movieId = 'e2e-audio-failure';
    const storageMovieId = formatMovieId(movieId);

    // Read CLI config for storage settings
    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // ============================================================
    // PHASE 1: Initial run with AudioProducer[1] failure (Core API)
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

    // Persist the plan to disk (now required after in-memory planning)
    await planResult.persist();

    // Verify initial plan structure
    const initialPlan = await readPlan(planResult.planPath);
    const initialJobs = initialPlan.layers.flat();
    expect(initialJobs.length).toBeGreaterThanOrEqual(4); // 1 script + 3 audio

    const scriptJob = initialJobs.find((j: any) => j.producer === 'ScriptProducer');
    const audioJobs = initialJobs.filter((j: any) => j.producer === 'AudioProducer');
    expect(scriptJob).toBeDefined();
    expect(audioJobs).toHaveLength(3);

    // Identify AudioProducer[1] job for failure
    const audioJob1 = audioJobs.find((j: any) => j.jobId.includes('[1]'));
    expect(audioJob1).toBeDefined();
    const failedArtifactId = audioJob1!.produces.find((id: string) => id.startsWith('Artifact:'));
    expect(failedArtifactId).toBeDefined();

    // Create storage and services for core runner
    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage, storageMovieId);
    const eventLog = createEventLog(storage);
    const buildStateService = createBuildStateService(storage);

    // Create custom produce function that fails AudioProducer[1]
    const firstRunCalls = new Set<string>();
    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      firstRunCalls.add(request.job.jobId);

      // Fail AudioProducer[1]
      if (request.job.jobId === audioJob1!.jobId) {
        throw new Error('Simulated AudioProducer[1] failure');
      }

      // Return success for all other jobs
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artifacts: request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artifactId: string) => ({
            artifactId,
            blob: {
              data: `stub-data-for-${artifactId}`,
              mimeType: 'text/plain',
            },
          })),
      };
    });

    // Execute initial run with core runner
    const runner = createRunner();
    const firstRunResult = await runner.execute(planResult.plan, {
      movieId: storageMovieId,
      buildState: planResult.buildState,
      storage,
      eventLog,
      produce,
      logger,
    });

    // Verify first run status
    expect(firstRunResult.status).toBe('failed');
    const succeededCount = firstRunResult.jobs.filter((j) => j.status === 'succeeded').length;
    const failedCount = firstRunResult.jobs.filter((j) => j.status === 'failed').length;
    expect(succeededCount).toBe(3); // ScriptProducer + 2 successful AudioProducers
    expect(failedCount).toBe(1); // AudioProducer[1]
    expect(firstRunCalls.size).toBe(4); // All 4 jobs attempted

    // ============================================================
    // PHASE 2: Verify event log and build state after first run
    // ============================================================

    // Verify event log contains failed artifact
    let foundFailedEvent = false;
    for await (const event of eventLog.streamArtifacts(storageMovieId)) {
      if (event.artifactId === failedArtifactId) {
        expect(event.status).toBe('failed');
        expect(event.diagnostics?.error).toBeDefined();
        foundFailedEvent = true;
      }
    }
    expect(foundFailedEvent).toBe(true);

    // Recompute derived build state after first run
    const buildState1 = await firstRunResult.buildStateSnapshot();

    // Verify failed artifact is excluded from build state
    expect(buildState1.artifacts[failedArtifactId!]).toBeUndefined();

    // Verify successful artifacts are in build state
    const successfulAudioJobs = audioJobs.filter((j: any) => j.jobId !== audioJob1!.jobId);
    for (const job of successfulAudioJobs) {
      const artifactId = job.produces.find((id: string) => id.startsWith('Artifact:'));
      expect(buildState1.artifacts[artifactId!]).toBeDefined();
    }

    // ============================================================
    // PHASE 3: Edit flow with same inputs (CLI dry-run for planning)
    // ============================================================

    // Run edit with identical inputs (no changes) using dry-run to verify planning
    const editResult = await runExecute({
      storageMovieId,
      isNew: false,
      inputsPath, // Same inputs as initial run
      dryRun: true, // Use dry-run to test planning without needing real providers
      nonInteractive: true,
      logger: recoveryLogger,
    });

    // Verify edit dry-run succeeded
    expect(editResult.build?.status).toBe('succeeded');

    // CRITICAL VERIFICATION: Only 1 job should be planned (AudioProducer[1])
    expect(editResult.build?.jobCount).toBe(1);
    expect(editResult.build?.counts.succeeded).toBe(1);
    expect(editResult.build?.counts.failed).toBe(0);

    // Verify the edit plan contains only the failed job
    const editPlan = await readPlan(editResult.planPath);
    const editJobs = editPlan.layers.flat();
    expect(editJobs).toHaveLength(1);
    expect(editJobs[0].jobId).toBe(audioJob1!.jobId);
    expect(editJobs[0].producer).toBe('AudioProducer');

    // ============================================================
    // PHASE 4: Execute the recovery (core API, re-using custom produce)
    // ============================================================

    // Now execute the recovery job using core APIs
    // Create new produce that succeeds for the failed job
    const recoveryProduce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      // Recover the previously failed job
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artifacts: request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artifactId: string) => ({
            artifactId,
            blob: {
              data: `recovered-${artifactId}`,
              mimeType: 'text/plain',
            },
          })),
      };
    });

    // Execute recovery with core runner
    const recoveryResult = await runner.execute(editPlan, {
      movieId: storageMovieId,
      buildState: buildState1, // Use build state from first run
      storage,
      eventLog,
      produce: recoveryProduce,
      logger: recoveryLogger,
    });

    // Verify recovery succeeded
    expect(recoveryResult.status).toBe('succeeded');
    expect(recoveryResult.jobs).toHaveLength(1);
    expect(recoveryResult.jobs[0].status).toBe('succeeded');

    // ============================================================
    // PHASE 5: Verify final build state includes recovered artifact
    // ============================================================

    // Recompute derived build state after recovery
    const finalBuildState = await recoveryResult.buildStateSnapshot();

    // Verify recovered artifact is now in build state
    expect(finalBuildState.artifacts[failedArtifactId!]).toBeDefined();
    expect(finalBuildState.artifacts[failedArtifactId!].status).toBe('succeeded');

    // Verify all 3 audio artifacts are present (2 from first run + 1 recovered)
    for (const job of audioJobs) {
      const artifactId = job.produces.find((id: string) => id.startsWith('Artifact:'));
      expect(finalBuildState.artifacts[artifactId!]).toBeDefined();
    }

    // ============================================================
    // Final verification: No warnings or errors during recovery
    // ============================================================
    // Note: The initial run intentionally failed one job, so we expect an error there
    // But the recovery phase should have no errors
    expect(recoveryWarnings).toHaveLength(0);
    expect(recoveryErrors).toHaveLength(0);
  });
});
