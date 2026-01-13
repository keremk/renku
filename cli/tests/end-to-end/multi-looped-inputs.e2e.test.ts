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
 * Mock Script data for the ContentGenerator.
 * Contains segments with sibling fields (VideoPrompt, VideoDescription, ImagePrompt)
 * that will be accessed by different producers.
 */
const mockScript = {
  Title: 'Test Multi-Looped Inputs',
  Segments: [
    {
      ImagePrompt: 'Image prompt for segment 0',
      VideoPrompt: 'Video prompt for segment 0',
      VideoDescription: 'Video description for segment 0',
    },
    {
      ImagePrompt: 'Image prompt for segment 1',
      VideoPrompt: 'Video prompt for segment 1',
      VideoDescription: 'Video description for segment 1',
    },
    {
      ImagePrompt: 'Image prompt for segment 2',
      VideoPrompt: 'Video prompt for segment 2',
      VideoDescription: 'Video description for segment 2',
    },
  ],
};

describe('end-to-end: multi-looped inputs dimension unification', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('generates plan for blueprint with multi-looped inputs from sibling fields', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'multi-looped-inputs.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'multi-looped-inputs-inputs.yaml');
    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-multi-looped-inputs';
    const storageMovieId = formatMovieId(movieId);

    // Read CLI config for storage settings
    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // ============================================================
    // PHASE 1: Generate plan
    // This is the critical test - the graph building should succeed
    // without "conflicting parents" error for sibling fields
    // ============================================================

    const planResult = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: true,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger,
      notifications: undefined,
    });

    expect(planResult).toBeDefined();
    expect(planResult.plan).toBeDefined();

    // Persist the plan to disk
    await planResult.persist();

    // Verify plan structure
    const plan = await readPlan(planResult.planPath);
    const allJobs = plan.layers.flat();

    // Should have:
    // - 1 ContentGenerator
    // - 3 ImageGenerator (one per segment)
    // - 3 VideoGenerator (one per segment)
    const contentJobs = allJobs.filter((j: any) => j.producer === 'ContentGenerator');
    const imageJobs = allJobs.filter((j: any) => j.producer === 'ImageGenerator');
    const videoJobs = allJobs.filter((j: any) => j.producer === 'VideoGenerator');

    expect(contentJobs).toHaveLength(1);
    expect(imageJobs).toHaveLength(3);
    expect(videoJobs).toHaveLength(3);

    // Verify VideoGenerator jobs exist with the correct indices
    const videoJobIds = videoJobs.map((j: any) => j.jobId);
    expect(videoJobIds.some((id: string) => id.includes('[0]'))).toBe(true);
    expect(videoJobIds.some((id: string) => id.includes('[1]'))).toBe(true);
    expect(videoJobIds.some((id: string) => id.includes('[2]'))).toBe(true);

    // Verify layering: VideoGenerator should be in a LATER layer than ImageGenerator
    // because VideoGenerator depends on GeneratedImage which is produced by ImageGenerator.
    // The exact number of layers depends on schema decomposition configuration.
    expect(plan.layers.length).toBeGreaterThanOrEqual(2);

    // Find which layer each producer type is in
    const producerLayers = new Map<string, number>();
    for (let i = 0; i < plan.layers.length; i++) {
      for (const job of plan.layers[i]) {
        const producer = (job as any).producer;
        // Track the earliest layer for each producer type
        if (!producerLayers.has(producer)) {
          producerLayers.set(producer, i);
        }
      }
    }

    // CRITICAL: VideoGenerator must be in a later layer than ImageGenerator
    // because it depends on GeneratedImage[segment] which is produced by ImageGenerator
    const imageLayer = producerLayers.get('ImageGenerator') ?? -1;
    const videoLayer = producerLayers.get('VideoGenerator') ?? -1;
    expect(videoLayer).toBeGreaterThan(imageLayer);

    // No errors should have occurred during plan generation
    // This is the key assertion - if we get here without errors,
    // the multi-looped inputs dimension unification is working
    expect(errors).toHaveLength(0);
  });

  it('executes plan with multi-looped inputs successfully', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'multi-looped-inputs.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'multi-looped-inputs-inputs.yaml');
    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-multi-looped-inputs-exec';
    const storageMovieId = formatMovieId(movieId);

    // Read CLI config for storage settings
    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // Generate plan
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

    // ============================================================
    // PHASE 2: Execute with mocked producers
    // ============================================================

    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage, storageMovieId);
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    // Custom produce function that returns controlled data
    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      // ContentGenerator returns the mock Script as JSON
      if (request.job.producer === 'ContentGenerator') {
        return {
          jobId: request.job.jobId,
          status: 'succeeded',
          artefacts: [
            {
              artefactId: 'Artifact:ContentGenerator.Script',
              blob: {
                data: JSON.stringify(mockScript),
                mimeType: 'application/json',
              },
            },
          ],
        };
      }

      // ImageGenerator returns stub image data
      if (request.job.producer === 'ImageGenerator') {
        const artefactId = request.job.produces.find((id: string) =>
          id.startsWith('Artifact:') && id.includes('GeneratedImage')
        );
        return {
          jobId: request.job.jobId,
          status: 'succeeded',
          artefacts: artefactId
            ? [
                {
                  artefactId,
                  blob: {
                    data: `stub-image-${request.job.jobId}`,
                    mimeType: 'image/png',
                  },
                },
              ]
            : [],
        };
      }

      // VideoGenerator returns stub video data
      if (request.job.producer === 'VideoGenerator') {
        const artefactId = request.job.produces.find((id: string) =>
          id.startsWith('Artifact:') && id.includes('GeneratedVideo')
        );
        return {
          jobId: request.job.jobId,
          status: 'succeeded',
          artefacts: artefactId
            ? [
                {
                  artefactId,
                  blob: {
                    data: new Uint8Array([10]), // 10 second duration
                    mimeType: 'video/mp4',
                  },
                },
              ]
            : [],
        };
      }

      // Default fallback
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artefacts: [],
      };
    });

    // Execute with core runner
    const runner = createRunner();
    const result = await runner.execute(planResult.plan, {
      movieId: storageMovieId,
      manifest: planResult.manifest,
      storage,
      eventLog,
      manifestService,
      produce,
      logger,
    });

    // ============================================================
    // PHASE 3: Verify execution results
    // ============================================================

    expect(result.status).toBe('succeeded');

    const succeededJobs = result.jobs.filter((j) => j.status === 'succeeded');

    // All jobs should succeed
    expect(succeededJobs.filter((j) => j.producer === 'ContentGenerator')).toHaveLength(1);
    expect(succeededJobs.filter((j) => j.producer === 'ImageGenerator')).toHaveLength(3);
    expect(succeededJobs.filter((j) => j.producer === 'VideoGenerator')).toHaveLength(3);

    // Verify produce was called for each job
    expect(produce).toHaveBeenCalledTimes(7); // 1 + 3 + 3

    // ============================================================
    // PHASE 4: Verify artifacts in manifest
    // ============================================================

    const manifest = await result.buildManifest();
    const artifactIds = Object.keys(manifest.artefacts);

    // Verify we have the expected number of artifacts
    // ContentGenerator.Script + 3 GeneratedImage + 3 FinalVideo
    // (artifacts may use different naming conventions)
    const imageArtifacts = artifactIds.filter((id) => id.includes('GeneratedImage') || id.includes('Image'));
    const videoArtifacts = artifactIds.filter((id) => id.includes('FinalVideo') || id.includes('Video'));

    // Should have at least 3 image and 3 video artifacts (one per segment)
    expect(imageArtifacts.length).toBeGreaterThanOrEqual(3);
    expect(videoArtifacts.length).toBeGreaterThanOrEqual(3);

    // No errors
    expect(errors).toHaveLength(0);
  });
});
