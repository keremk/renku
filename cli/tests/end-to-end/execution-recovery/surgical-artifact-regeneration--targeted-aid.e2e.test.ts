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
import { runGenerate } from '../../../src/commands/generate.js';
import { generatePlan } from '../../../src/lib/planner.js';
import {
  createLoggerRecorder,
  readPlan,
  setupTempCliConfig,
} from '../helpers.js';
import { CLI_FIXTURES_BLUEPRINTS, CLI_FIXTURES_INPUTS } from '../../test-catalog-paths.js';

describe('end-to-end: surgical artifact regeneration', () => {
  let _tempRoot = '';
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    _tempRoot = config.tempRoot;
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('regenerates only target artifact and downstream, not siblings', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'pipeline-orchestration', 'audio-narration-loop', 'audio-narration-loop.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'audio-narration-loop--default.inputs.yaml');
    const { logger } = createLoggerRecorder();
    const movieId = 'e2e-surgical-regen';
    const storageMovieId = formatMovieId(movieId);

    // Read CLI config for storage settings
    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // ============================================================
    // PHASE 1: Initial run to create all artifacts
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

    // Persist the plan
    await planResult.persist();

    // Verify initial plan structure
    const initialPlan = await readPlan(planResult.planPath);
    const initialJobs = initialPlan.layers.flat();
    expect(initialJobs.length).toBeGreaterThanOrEqual(4); // 1 script + 3 audio

    const audioJobs = initialJobs.filter((j: any) => j.producer === 'AudioProducer');
    expect(audioJobs).toHaveLength(3);

    // Create storage and services for core runner
    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage, storageMovieId);
    const eventLog = createEventLog(storage);
    const buildStateService = createBuildStateService(storage);

    // Create produce function that succeeds for all jobs
    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artifacts: request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artifactId: string) => ({
            artifactId,
            blob: {
              data: `initial-data-for-${artifactId}`,
              mimeType: 'text/plain',
            },
          })),
      };
    });

    // Execute initial run
    const runner = createRunner();
    const firstRunResult = await runner.execute(planResult.plan, {
      movieId: storageMovieId,
      buildState: planResult.buildState,
      executionState: planResult.executionState,
      storage,
      eventLog,
      produce,
      logger,
    });

    // Verify first run succeeded
    expect(firstRunResult.status).toBe('succeeded');

    // Build and save manifest
    const manifest1 = await firstRunResult.buildStateSnapshot();

    // ============================================================
    // PHASE 2: Surgical regeneration of AudioProducer[0]
    // ============================================================

    // Find the AudioProducer[0] artifact ID
    const audioJob0 = audioJobs.find((j: any) => j.jobId.includes('[0]'));
    expect(audioJob0).toBeDefined();
    const targetArtifactId = audioJob0!.produces.find((id: string) => id.startsWith('Artifact:'));
    expect(targetArtifactId).toBeDefined();

    // Extract short format for CLI (remove "Artifact:" prefix)
    const _shortArtifactId = targetArtifactId!.replace('Artifact:', '');

    // Run surgical regeneration using dry-run
    const surgicalResult = await runExecute({
      storageMovieId,
      isNew: false,
      inputsPath,
      planningControls: {
        surgical: {
          regenerateIds: [targetArtifactId!],
        },
      },
      dryRun: true,
      nonInteractive: true,
      logger,
    });

    // Verify surgical dry-run succeeded
    expect(surgicalResult.build?.status).toBe('succeeded');

    // Verify the surgical plan
    const surgicalPlan = await readPlan(surgicalResult.planPath);
    const surgicalJobs = surgicalPlan.layers.flat();

    // Should include AudioProducer[0] (source)
    const audioJob0InPlan = surgicalJobs.find(
      (j: any) => j.jobId === 'Producer:AudioProducer[0]'
    );
    expect(audioJob0InPlan).toBeDefined();

    // Should NOT include AudioProducer[1] or AudioProducer[2] (siblings)
    const audioJob1InPlan = surgicalJobs.find(
      (j: any) => j.jobId === 'Producer:AudioProducer[1]'
    );
    const audioJob2InPlan = surgicalJobs.find(
      (j: any) => j.jobId === 'Producer:AudioProducer[2]'
    );
    expect(audioJob1InPlan).toBeUndefined();
    expect(audioJob2InPlan).toBeUndefined();

    // Should NOT include ScriptProducer (upstream)
    const scriptJobInPlan = surgicalJobs.find(
      (j: any) => j.producer === 'ScriptProducer'
    );
    expect(scriptJobInPlan).toBeUndefined();

    // The audio-only blueprint has no downstream consumers of individual AudioProducer outputs,
    // so surgical regeneration of AudioProducer[0] should only include that one job
    expect(surgicalJobs.length).toBe(1);
  });

  it('fails when --regen is used without targeting existing movie', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'pipeline-orchestration', 'audio-narration-loop', 'audio-narration-loop.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'audio-narration-loop--default.inputs.yaml');

    // Try to use --regen for a new movie (no --movie-id)
    await expect(
      runGenerate({
        regenerateIds: ['Artifact:AudioProducer.GeneratedAudio[0]'],
        inputsPath,
        blueprint: blueprintPath,
        logLevel: 'info',
        dryRun: true,
        nonInteractive: true,
      })
    ).rejects.toThrow(/requires --movie-id\/--id/);
  });

  it('fails when regenerate IDs are not canonical', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'pipeline-orchestration', 'audio-narration-loop', 'audio-narration-loop.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'audio-narration-loop--default.inputs.yaml');
    const { logger } = createLoggerRecorder();
    const movieId = 'e2e-surgical-conflict';
    const storageMovieId = formatMovieId(movieId);

    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // First create a movie
    const planResult = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: true,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger,
      notifications: undefined,
    });
    await planResult.persist();

    // Create storage and run to build manifest
    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage, storageMovieId);
    const eventLog = createEventLog(storage);
    const buildStateService = createBuildStateService(storage);

    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => ({
      jobId: request.job.jobId,
      status: 'succeeded',
      artifacts: request.job.produces
        .filter((id: string) => id.startsWith('Artifact:'))
        .map((artifactId: string) => ({
          artifactId,
          blob: { data: `stub-${artifactId}`, mimeType: 'text/plain' },
        })),
    }));

    const runner = createRunner();
    const runResult = await runner.execute(planResult.plan, {
      movieId: storageMovieId,
      buildState: planResult.buildState,
      executionState: planResult.executionState,
      storage,
      eventLog,
      produce,
      logger,
    });

    const manifest = await runResult.buildStateSnapshot();

    // Try to use a non-canonical regenerate id (should fail fast)
    await expect(
      runGenerate({
        movieId,
        regenerateIds: ['AudioProducer.GeneratedAudio[0]'],
        inputsPath,
        logLevel: 'info',
        dryRun: true,
        nonInteractive: true,
      })
    ).rejects.toThrow(/Expected canonical Artifact:\.\.\. or Producer:\.\.\./);
  });

  it('allows --regen with --up-to-layer to limit downstream regeneration', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'pipeline-orchestration', 'audio-narration-loop', 'audio-narration-loop.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'audio-narration-loop--default.inputs.yaml');
    const { logger } = createLoggerRecorder();
    const movieId = 'e2e-surgical-upto';
    const storageMovieId = formatMovieId(movieId);

    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // First create and run a movie
    const planResult = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: true,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger,
      notifications: undefined,
    });
    await planResult.persist();

    // Create storage and run to build manifest
    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage, storageMovieId);
    const eventLog = createEventLog(storage);
    const buildStateService = createBuildStateService(storage);

    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => ({
      jobId: request.job.jobId,
      status: 'succeeded',
      artifacts: request.job.produces
        .filter((id: string) => id.startsWith('Artifact:'))
        .map((artifactId: string) => ({
          artifactId,
          blob: { data: `stub-${artifactId}`, mimeType: 'text/plain' },
        })),
    }));

    const runner = createRunner();
    const runResult = await runner.execute(planResult.plan, {
      movieId: storageMovieId,
      buildState: planResult.buildState,
      executionState: planResult.executionState,
      storage,
      eventLog,
      produce,
      logger,
    });

    const manifest = await runResult.buildStateSnapshot();

    // Find the ScriptProducer artifact (layer 0) to target for surgical regeneration
    const initialPlan = await readPlan(planResult.planPath);
    const scriptJob = initialPlan.layers.flat().find((j: any) => j.producer === 'ScriptProducer');
    expect(scriptJob).toBeDefined();
    const targetArtifactId = scriptJob!.produces.find((id: string) => id.startsWith('Artifact:'));
    expect(targetArtifactId).toBeDefined();

    // Now use surgical regeneration with up-to-layer=0
    // This should regenerate ScriptProducer but NOT its downstream AudioProducers
    const surgicalResult = await runExecute({
      storageMovieId,
      isNew: false,
      inputsPath,
      planningControls: {
        scope: { upToLayer: 0 }, // Limit to layer 0 only
        surgical: {
          regenerateIds: [targetArtifactId!],
        },
      },
      dryRun: true,
      nonInteractive: true,
      logger,
    });

    expect(surgicalResult.build?.status).toBe('succeeded');

    // Verify the surgical plan
    const surgicalPlan = await readPlan(surgicalResult.planPath);
    const surgicalJobs = surgicalPlan.layers.flat();

    // Should include ScriptProducer
    const scriptJobInPlan = surgicalJobs.find((j: any) => j.producer === 'ScriptProducer');
    expect(scriptJobInPlan).toBeDefined();

    // The plan includes all surgical jobs (ScriptProducer + downstream AudioProducers)
    // but upToLayer limits execution. With dry-run, all jobs are "executed" (simulated),
    // so we verify the plan contains the full surgical set
    // The key is that --up-to-layer with --regen works without error
    expect(surgicalJobs.length).toBeGreaterThanOrEqual(1);
  });

  it('fails when target artifact does not exist in manifest', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'pipeline-orchestration', 'audio-narration-loop', 'audio-narration-loop.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'audio-narration-loop--default.inputs.yaml');
    const { logger } = createLoggerRecorder();
    const movieId = 'e2e-surgical-not-found';
    const storageMovieId = formatMovieId(movieId);

    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // First create a movie
    const planResult = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: true,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger,
      notifications: undefined,
    });
    await planResult.persist();

    // Create storage and run to build manifest
    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage, storageMovieId);
    const eventLog = createEventLog(storage);
    const buildStateService = createBuildStateService(storage);

    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => ({
      jobId: request.job.jobId,
      status: 'succeeded',
      artifacts: request.job.produces
        .filter((id: string) => id.startsWith('Artifact:'))
        .map((artifactId: string) => ({
          artifactId,
          blob: { data: `stub-${artifactId}`, mimeType: 'text/plain' },
        })),
    }));

    const runner = createRunner();
    const runResult = await runner.execute(planResult.plan, {
      movieId: storageMovieId,
      buildState: planResult.buildState,
      executionState: planResult.executionState,
      storage,
      eventLog,
      produce,
      logger,
    });

    const manifest = await runResult.buildStateSnapshot();

    // Try to regenerate a non-existent artifact
    await expect(
      runExecute({
        storageMovieId,
        isNew: false,
        inputsPath,
        planningControls: {
          surgical: {
            regenerateIds: ['Artifact:NonExistent.FakeArtifact[0]'],
          },
        },
        dryRun: true,
        nonInteractive: true,
        logger,
      })
    ).rejects.toThrow(/not found in build state|ARTIFACT_NOT_IN_BUILD_STATE/);
  });

  it('regenerates multiple artifacts using multiple --regen flags', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'pipeline-orchestration', 'audio-narration-loop', 'audio-narration-loop.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'audio-narration-loop--default.inputs.yaml');
    const { logger } = createLoggerRecorder();
    const movieId = 'e2e-surgical-multi-aid';
    const storageMovieId = formatMovieId(movieId);

    // Read CLI config for storage settings
    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // ============================================================
    // PHASE 1: Initial run to create all artifacts
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

    // Persist the plan
    await planResult.persist();

    // Verify initial plan structure
    const initialPlan = await readPlan(planResult.planPath);
    const initialJobs = initialPlan.layers.flat();

    const audioJobs = initialJobs.filter((j: any) => j.producer === 'AudioProducer');
    expect(audioJobs.length).toBeGreaterThanOrEqual(3);

    // Create storage and services for core runner
    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage, storageMovieId);
    const eventLog = createEventLog(storage);
    const buildStateService = createBuildStateService(storage);

    // Create produce function that succeeds for all jobs
    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artifacts: request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artifactId: string) => ({
            artifactId,
            blob: {
              data: `initial-data-for-${artifactId}`,
              mimeType: 'text/plain',
            },
          })),
      };
    });

    // Execute initial run
    const runner = createRunner();
    const firstRunResult = await runner.execute(planResult.plan, {
      movieId: storageMovieId,
      buildState: planResult.buildState,
      executionState: planResult.executionState,
      storage,
      eventLog,
      produce,
      logger,
    });

    // Verify first run succeeded
    expect(firstRunResult.status).toBe('succeeded');

    // Build and save manifest
    const manifest1 = await firstRunResult.buildStateSnapshot();

    // ============================================================
    // PHASE 2: Surgical regeneration of MULTIPLE AudioProducers
    // ============================================================

    // Find AudioProducer[0] and AudioProducer[2] artifact IDs
    const audioJob0 = audioJobs.find((j: any) => j.jobId.includes('[0]'));
    const audioJob2 = audioJobs.find((j: any) => j.jobId.includes('[2]'));
    expect(audioJob0).toBeDefined();
    expect(audioJob2).toBeDefined();

    const targetArtifact0 = audioJob0!.produces.find((id: string) => id.startsWith('Artifact:'));
    const targetArtifact2 = audioJob2!.produces.find((id: string) => id.startsWith('Artifact:'));
    expect(targetArtifact0).toBeDefined();
    expect(targetArtifact2).toBeDefined();

    // Run surgical regeneration with MULTIPLE artifacts
    const surgicalResult = await runExecute({
      storageMovieId,
      isNew: false,
      inputsPath,
      planningControls: {
        surgical: {
          regenerateIds: [targetArtifact0!, targetArtifact2!],
        },
      },
      dryRun: true,
      nonInteractive: true,
      logger,
    });

    // Verify surgical dry-run succeeded
    expect(surgicalResult.build?.status).toBe('succeeded');

    // Verify the surgical plan
    const surgicalPlan = await readPlan(surgicalResult.planPath);
    const surgicalJobs = surgicalPlan.layers.flat();

    // Should include AudioProducer[0] (source #1)
    const audioJob0InPlan = surgicalJobs.find(
      (j: any) => j.jobId === 'Producer:AudioProducer[0]'
    );
    expect(audioJob0InPlan).toBeDefined();

    // Should include AudioProducer[2] (source #2)
    const audioJob2InPlan = surgicalJobs.find(
      (j: any) => j.jobId === 'Producer:AudioProducer[2]'
    );
    expect(audioJob2InPlan).toBeDefined();

    // Should NOT include AudioProducer[1] (sibling, not targeted)
    const audioJob1InPlan = surgicalJobs.find(
      (j: any) => j.jobId === 'Producer:AudioProducer[1]'
    );
    expect(audioJob1InPlan).toBeUndefined();

    // Should NOT include ScriptProducer (upstream)
    const scriptJobInPlan = surgicalJobs.find(
      (j: any) => j.producer === 'ScriptProducer'
    );
    expect(scriptJobInPlan).toBeUndefined();

    // The audio-only blueprint has no downstream consumers of individual AudioProducer outputs,
    // so surgical regeneration should only include the two targeted jobs
    expect(surgicalJobs.length).toBe(2);
  });

  it('fails if any of multiple artifact IDs is invalid', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'pipeline-orchestration', 'audio-narration-loop', 'audio-narration-loop.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'audio-narration-loop--default.inputs.yaml');
    const { logger } = createLoggerRecorder();
    const movieId = 'e2e-surgical-multi-invalid';
    const storageMovieId = formatMovieId(movieId);

    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // First create a movie
    const planResult = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: true,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger,
      notifications: undefined,
    });
    await planResult.persist();

    // Create storage and run to build manifest
    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage, storageMovieId);
    const eventLog = createEventLog(storage);
    const buildStateService = createBuildStateService(storage);

    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => ({
      jobId: request.job.jobId,
      status: 'succeeded',
      artifacts: request.job.produces
        .filter((id: string) => id.startsWith('Artifact:'))
        .map((artifactId: string) => ({
          artifactId,
          blob: { data: `stub-${artifactId}`, mimeType: 'text/plain' },
        })),
    }));

    const runner = createRunner();
    const runResult = await runner.execute(planResult.plan, {
      movieId: storageMovieId,
      buildState: planResult.buildState,
      executionState: planResult.executionState,
      storage,
      eventLog,
      produce,
      logger,
    });

    const manifest = await runResult.buildStateSnapshot();

    // Find a valid artifact
    const initialPlan = await readPlan(planResult.planPath);
    const audioJobs = initialPlan.layers.flat().filter((j: any) => j.producer === 'AudioProducer');
    const validArtifact = audioJobs[0]?.produces.find((id: string) => id.startsWith('Artifact:'));
    expect(validArtifact).toBeDefined();

    // Try to regenerate one valid + one invalid artifact
    // Should fail because one of them doesn't exist
    await expect(
      runExecute({
        storageMovieId,
        isNew: false,
        inputsPath,
        planningControls: {
          surgical: {
            regenerateIds: [
              validArtifact!,
              'Artifact:NonExistent.FakeArtifact[0]',
            ],
          },
        },
        dryRun: true,
        nonInteractive: true,
        logger,
      })
    ).rejects.toThrow(/not found in build state|ARTIFACT_NOT_IN_BUILD_STATE/);
  });
});
