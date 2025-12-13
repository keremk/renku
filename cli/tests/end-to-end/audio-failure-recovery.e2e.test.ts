import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
} from '@renku/core';
import { getDefaultCliConfigPath, readCliConfig } from '../../src/lib/cli-config.js';
import { formatMovieId } from '../../src/commands/query.js';
import { runEdit } from '../../src/commands/edit.js';
import { getBundledBlueprintsRoot } from '../../src/lib/config-assets.js';
import { generatePlan } from '../../src/lib/planner.js';
import {
  createLoggerRecorder,
  expectFileExists,
  readPlan,
  setupTempCliConfig,
} from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    const blueprintRoot = getBundledBlueprintsRoot();
    const blueprintPath = resolve(blueprintRoot, 'audio-only', 'audio-only.yaml');
    const inputsPath = resolve(__dirname, 'fixtures', 'audio-only-inputs.yaml');
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
    const manifestService = createManifestService(storage);

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

    // Verify first run status
    expect(firstRunResult.status).toBe('failed');
    const succeededCount = firstRunResult.jobs.filter((j) => j.status === 'succeeded').length;
    const failedCount = firstRunResult.jobs.filter((j) => j.status === 'failed').length;
    expect(succeededCount).toBe(3); // ScriptProducer + 2 successful AudioProducers
    expect(failedCount).toBe(1); // AudioProducer[1]
    expect(firstRunCalls.size).toBe(4); // All 4 jobs attempted

    // ============================================================
    // PHASE 2: Verify event log and manifest after first run
    // ============================================================

    // Verify event log contains failed artifact
    let foundFailedEvent = false;
    for await (const event of eventLog.streamArtefacts(storageMovieId)) {
      if (event.artefactId === failedArtifactId) {
        expect(event.status).toBe('failed');
        expect(event.diagnostics?.error).toBeDefined();
        foundFailedEvent = true;
      }
    }
    expect(foundFailedEvent).toBe(true);

    // Build manifest after first run
    const manifest1 = await firstRunResult.buildManifest();
    await manifestService.saveManifest(manifest1, {
      movieId: storageMovieId,
      previousHash: planResult.manifestHash,
      clock: { now: () => new Date().toISOString() },
    });

    // Verify failed artifact is excluded from manifest
    expect(manifest1.artefacts[failedArtifactId!]).toBeUndefined();

    // Verify successful artifacts are in manifest
    const successfulAudioJobs = audioJobs.filter((j: any) => j.jobId !== audioJob1!.jobId);
    for (const job of successfulAudioJobs) {
      const artifactId = job.produces.find((id: string) => id.startsWith('Artifact:'));
      expect(manifest1.artefacts[artifactId!]).toBeDefined();
    }

    // ============================================================
    // PHASE 3: Edit flow with same inputs (CLI dry-run for planning)
    // ============================================================

    // Run edit with identical inputs (no changes) using dry-run to verify planning
    const editResult = await runEdit({
      movieId: storageMovieId,
      inputsPath, // Same inputs as initial run
      dryRun: true, // Use dry-run to test planning without needing real providers
      nonInteractive: true,
      usingBlueprint: blueprintPath,
      logger: recoveryLogger,
    });

    // Verify edit dry-run succeeded
    expect(editResult.dryRun?.status).toBe('succeeded');

    // CRITICAL VERIFICATION: Only 1 job should be planned (AudioProducer[1])
    expect(editResult.dryRun?.jobCount).toBe(1);
    expect(editResult.dryRun?.statusCounts.succeeded).toBe(1);
    expect(editResult.dryRun?.statusCounts.failed).toBe(0);

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
        artefacts: request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artefactId: string) => ({
            artefactId,
            blob: {
              data: `recovered-${artefactId}`,
              mimeType: 'text/plain',
            },
          })),
      };
    });

    // Execute recovery with core runner
    const recoveryResult = await runner.execute(editPlan, {
      movieId: storageMovieId,
      manifest: manifest1, // Use manifest from first run
      storage,
      eventLog,
      manifestService,
      produce: recoveryProduce,
      logger: recoveryLogger,
    });

    // Verify recovery succeeded
    expect(recoveryResult.status).toBe('succeeded');
    expect(recoveryResult.jobs).toHaveLength(1);
    expect(recoveryResult.jobs[0].status).toBe('succeeded');

    // ============================================================
    // PHASE 5: Verify final manifest includes recovered artifact
    // ============================================================

    // Build final manifest after recovery
    const finalManifest = await recoveryResult.buildManifest();

    // Verify recovered artifact is now in manifest
    expect(finalManifest.artefacts[failedArtifactId!]).toBeDefined();
    expect(finalManifest.artefacts[failedArtifactId!].status).toBe('succeeded');

    // Verify all 3 audio artifacts are present (2 from first run + 1 recovered)
    for (const job of audioJobs) {
      const artifactId = job.produces.find((id: string) => id.startsWith('Artifact:'));
      expect(finalManifest.artefacts[artifactId!]).toBeDefined();
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
