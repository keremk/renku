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
} from '@gorenku/core';
import { getDefaultCliConfigPath, readCliConfig } from '../../src/lib/cli-config.js';
import { formatMovieId } from '../../src/commands/execute.js';
import { generatePlan } from '../../src/lib/planner.js';
import {
  createLoggerRecorder,
  readPlan,
  setupTempCliConfig,
} from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Path to the main catalog (not cli/catalog)
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const CATALOG_BLUEPRINTS_ROOT = resolve(PROJECT_ROOT, 'catalog', 'blueprints');

/**
 * Mock VideoScript data with controlled NarrationType values per segment.
 *
 * Test scenario (3 segments):
 * | Segment | NarrationType    | UseNarrationAudio | Expected Producers                    |
 * |---------|------------------|-------------------|---------------------------------------|
 * | 0       | "ImageNarration" | false             | ImageProducer[0][*] only              |
 * | 1       | "TalkingHead"    | false             | AudioProducer[1], VideoProducer[1]    |
 * | 2       | "ImageNarration" | true              | ImageProducer[2][*], AudioProducer[2] |
 */
const mockVideoScript = {
  Title: 'Test Documentary',
  Summary: 'Test summary for conditional edge testing',
  CharacterPrompt: 'Test character prompt',
  MusicPrompt: 'Test music prompt',
  Segments: [
    {
      Script: 'Segment 0 script - ImageNarration without audio',
      NarrationType: 'ImageNarration',
      UseNarrationAudio: false,
      ImagePrompts: ['prompt 0-0', 'prompt 0-1'],
      VideoPrompt: 'video prompt 0',
    },
    {
      Script: 'Segment 1 script - TalkingHead',
      NarrationType: 'TalkingHead',
      UseNarrationAudio: false,
      ImagePrompts: ['prompt 1-0', 'prompt 1-1'],
      VideoPrompt: 'video prompt 1',
    },
    {
      Script: 'Segment 2 script - ImageNarration with audio',
      NarrationType: 'ImageNarration',
      UseNarrationAudio: true, // triggers isAudioNeeded via any[]
      ImagePrompts: ['prompt 2-0', 'prompt 2-1'],
      VideoPrompt: 'video prompt 2',
    },
  ],
};

describe('end-to-end: conditional edge execution', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('executes only matching conditional branches based on NarrationType', async () => {
    const blueprintPath = resolve(CATALOG_BLUEPRINTS_ROOT, 'condition-example', 'condition-example.yaml');
    const inputsPath = resolve(CATALOG_BLUEPRINTS_ROOT, 'condition-example', 'input-template.yaml');
    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-conditional-edges';
    const storageMovieId = formatMovieId(movieId);

    // Read CLI config for storage settings
    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // ============================================================
    // PHASE 1: Generate plan
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

    // Persist the plan to disk
    await planResult.persist();

    // Verify initial plan structure
    const initialPlan = await readPlan(planResult.planPath);
    const initialJobs = initialPlan.layers.flat();

    // Should have:
    // - 1 DocProducer
    // - 6 ImageProducer (3 segments × 2 images)
    // - 3 AudioProducer (3 segments)
    // - 3 VideoProducer (3 segments)
    // - 1 TimelineComposer
    const docJobs = initialJobs.filter((j: any) => j.producer === 'DocProducer');
    const imageJobs = initialJobs.filter((j: any) => j.producer === 'ImageProducer');
    const audioJobs = initialJobs.filter((j: any) => j.producer === 'AudioProducer');
    const videoJobs = initialJobs.filter((j: any) => j.producer === 'VideoProducer');
    const timelineJobs = initialJobs.filter((j: any) => j.producer === 'TimelineComposer');

    expect(docJobs).toHaveLength(1);
    expect(imageJobs).toHaveLength(6);
    expect(audioJobs).toHaveLength(3);
    expect(videoJobs).toHaveLength(3);
    expect(timelineJobs).toHaveLength(1);

    // Verify inputConditions are attached to ImageProducer jobs
    const imageJob = imageJobs[0];
    expect(imageJob.context?.inputConditions).toBeDefined();
    expect(Object.keys(imageJob.context?.inputConditions ?? {}).length).toBeGreaterThan(0);

    // ============================================================
    // PHASE 2: Execute with mocked DocProducer returning controlled VideoScript
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
      // DocProducer returns the mock VideoScript as JSON
      if (request.job.producer === 'DocProducer') {
        return {
          jobId: request.job.jobId,
          status: 'succeeded',
          artefacts: [
            {
              artefactId: 'Artifact:DocProducer.VideoScript',
              blob: {
                data: JSON.stringify(mockVideoScript),
                mimeType: 'application/json',
              },
            },
          ],
        };
      }

      // TimelineComposer returns stub data (tested separately in timeline-composer.e2e.test.ts)
      if (request.job.producer === 'TimelineComposer') {
        return {
          jobId: request.job.jobId,
          status: 'succeeded',
          artefacts: [{
            artefactId: 'Artifact:TimelineComposer.Timeline',
            blob: { data: '{}', mimeType: 'application/json' },
          }],
        };
      }

      // Other producers return stub data for their artifacts
      // Audio/Video need duration bytes (first byte = duration in seconds) for mediabunny mock
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artefacts: request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artefactId: string) => {
            const isAudio = artefactId.includes('Audio');
            const isVideo = artefactId.includes('Video');
            // Duration byte: 10 seconds for audio/video so mediabunny mock can read it
            const data = isAudio || isVideo
              ? new Uint8Array([10]) // 10 second duration
              : `stub-data-for-${artefactId}`;
            return {
              artefactId,
              blob: {
                data,
                mimeType: artefactId.includes('Image')
                  ? 'image/png'
                  : isAudio
                    ? 'audio/mp3'
                    : isVideo
                      ? 'video/mp4'
                      : 'text/plain',
              },
            };
          }),
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
    // PHASE 3: Verify correct jobs were executed/skipped
    // ============================================================

    const succeededJobs = result.jobs.filter((j) => j.status === 'succeeded');
    const skippedJobs = result.jobs.filter((j) => j.status === 'skipped');

    // DocProducer always runs
    expect(succeededJobs.filter((j) => j.producer === 'DocProducer')).toHaveLength(1);

    // TimelineComposer always runs
    expect(succeededJobs.filter((j) => j.producer === 'TimelineComposer')).toHaveLength(1);

    // ImageProducer: [0][0], [0][1], [2][0], [2][1] succeed (ImageNarration)
    // ImageProducer: [1][0], [1][1] skipped (TalkingHead, not ImageNarration)
    expect(succeededJobs.filter((j) => j.producer === 'ImageProducer')).toHaveLength(4);
    expect(skippedJobs.filter((j) => j.producer === 'ImageProducer')).toHaveLength(2);

    // AudioProducer: [1], [2] succeed (TalkingHead or UseNarrationAudio=true)
    // AudioProducer: [0] skipped (ImageNarration with UseNarrationAudio=false)
    expect(succeededJobs.filter((j) => j.producer === 'AudioProducer')).toHaveLength(2);
    expect(skippedJobs.filter((j) => j.producer === 'AudioProducer')).toHaveLength(1);

    // VideoProducer: [1] succeeds (TalkingHead)
    // VideoProducer: [0], [2] skipped (ImageNarration, not TalkingHead)
    expect(succeededJobs.filter((j) => j.producer === 'VideoProducer')).toHaveLength(1);
    expect(skippedJobs.filter((j) => j.producer === 'VideoProducer')).toHaveLength(2);

    // Verify specific job indices
    const succeededImageJobIds = succeededJobs
      .filter((j) => j.producer === 'ImageProducer')
      .map((j) => j.jobId);
    expect(succeededImageJobIds.some((id) => id.includes('[0][0]'))).toBe(true);
    expect(succeededImageJobIds.some((id) => id.includes('[0][1]'))).toBe(true);
    expect(succeededImageJobIds.some((id) => id.includes('[2][0]'))).toBe(true);
    expect(succeededImageJobIds.some((id) => id.includes('[2][1]'))).toBe(true);

    const skippedImageJobIds = skippedJobs
      .filter((j) => j.producer === 'ImageProducer')
      .map((j) => j.jobId);
    expect(skippedImageJobIds.some((id) => id.includes('[1][0]'))).toBe(true);
    expect(skippedImageJobIds.some((id) => id.includes('[1][1]'))).toBe(true);

    // ============================================================
    // PHASE 4: Verify artifact presence/absence in manifest
    // ============================================================

    // Build and verify manifest
    const manifest = await result.buildManifest();
    const artifactIds = Object.keys(manifest.artefacts);

    // SegmentImage: [0][0], [0][1], [2][0], [2][1] EXIST; [1][*] DO NOT EXIST
    expect(artifactIds.some((id) => id.includes('SegmentImage[0][0]'))).toBe(true);
    expect(artifactIds.some((id) => id.includes('SegmentImage[0][1]'))).toBe(true);
    expect(artifactIds.some((id) => id.includes('SegmentImage[2][0]'))).toBe(true);
    expect(artifactIds.some((id) => id.includes('SegmentImage[2][1]'))).toBe(true);
    expect(artifactIds.some((id) => id.includes('SegmentImage[1][0]'))).toBe(false); // SKIPPED
    expect(artifactIds.some((id) => id.includes('SegmentImage[1][1]'))).toBe(false); // SKIPPED

    // SegmentAudio: [1], [2] EXIST; [0] DOES NOT EXIST
    expect(artifactIds.some((id) => id.includes('SegmentAudio[1]'))).toBe(true);
    expect(artifactIds.some((id) => id.includes('SegmentAudio[2]'))).toBe(true);
    expect(artifactIds.some((id) => id.includes('SegmentAudio[0]'))).toBe(false); // SKIPPED

    // SegmentVideo: [1] EXISTS; [0], [2] DO NOT EXIST
    expect(artifactIds.some((id) => id.includes('SegmentVideo[1]'))).toBe(true);
    expect(artifactIds.some((id) => id.includes('SegmentVideo[0]'))).toBe(false); // SKIPPED
    expect(artifactIds.some((id) => id.includes('SegmentVideo[2]'))).toBe(false); // SKIPPED

    // ============================================================
    // PHASE 5: Verify no unexpected errors
    // ============================================================

    expect(errors).toHaveLength(0);
    expect(result.status).toBe('succeeded');
  });
});
