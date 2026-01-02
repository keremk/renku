import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  createEventLog,
  createManifestService,
  createRunner,
  createStorageContext,
  initializeMovieStorage,
  prepareJobContext,
  readBlobFromStorage,
  type ProduceRequest,
  type ProduceResult,
  type ProduceFn,
} from '@gorenku/core';
import { createProviderRegistry, loadModelCatalog } from '@gorenku/providers';
import { getDefaultCliConfigPath, readCliConfig } from '../../src/lib/cli-config.js';
import { formatMovieId } from '../../src/commands/execute.js';
import { generatePlan } from '../../src/lib/planner.js';
import {
  createLoggerRecorder,
  setupTempCliConfig,
} from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const CATALOG_BLUEPRINTS_ROOT = resolve(PROJECT_ROOT, 'catalog', 'blueprints');
const CATALOG_MODELS_ROOT = resolve(PROJECT_ROOT, 'catalog', 'models');

/**
 * Mock VideoScript data with controlled NarrationType values per segment.
 *
 * Test scenario (3 segments):
 * | Segment | NarrationType    | UseNarrationAudio | Audio | Video | Image |
 * |---------|------------------|-------------------|-------|-------|-------|
 * | 0       | "ImageNarration" | false             | -     | -     | 2 imgs|
 * | 1       | "TalkingHead"    | false             | 10s   | 10s   | -     |
 * | 2       | "ImageNarration" | true              | 10s   | -     | 2 imgs|
 */
const mockVideoScript = {
  Title: 'Test Documentary',
  Summary: 'Test summary for timeline composer testing',
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
      UseNarrationAudio: true,
      ImagePrompts: ['prompt 2-0', 'prompt 2-1'],
      VideoPrompt: 'video prompt 2',
    },
  ],
};

describe('end-to-end: TimelineComposer with conditional segments', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('generates correct timeline with sparse fan-in data from skipped segments', async () => {
    const blueprintPath = resolve(CATALOG_BLUEPRINTS_ROOT, 'condition-example', 'condition-example.yaml');
    const inputsPath = resolve(CATALOG_BLUEPRINTS_ROOT, 'condition-example', 'input-template.yaml');
    const { logger, errors } = createLoggerRecorder();
    const movieId = 'e2e-timeline-composer';
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

    await planResult.persist();

    // ============================================================
    // PHASE 2: Setup storage and registry
    // ============================================================

    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage, storageMovieId);
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    // Load model catalog and create provider registry with live mode for real TimelineComposer execution
    const catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);
    const registry = createProviderRegistry({
      mode: 'live',
      logger,
      catalog,
    });

    // Build resolvedInputs map that will be populated as mocked producers run
    // System inputs are seeded here, artifact inputs will be added during execution
    // Duration and SegmentDuration from input-template.yaml are needed for TimelineComposer
    const resolvedInputs: Record<string, unknown> = {
      'Input:StorageRoot': cliConfig.storage.root,
      'Input:StorageBasePath': cliConfig.storage.basePath,
      'Input:MovieId': storageMovieId,
      'Input:Duration': 30, // Total duration from input-template.yaml
      'Input:SegmentDuration': 10, // Per-segment duration from input-template.yaml
      'Input:TimelineComposer.Duration': 30,
      'Input:TimelineComposer.SegmentDuration': 10,
    };

    // ============================================================
    // PHASE 3: Create custom produce function
    // ============================================================

    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      const producerName = request.job.producer;

      // DocProducer returns the mock VideoScript as JSON
      if (producerName === 'DocProducer') {
        const result: ProduceResult = {
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
        // Store VideoScript in resolvedInputs
        resolvedInputs['Artifact:DocProducer.VideoScript'] = {
          data: JSON.stringify(mockVideoScript),
          mimeType: 'application/json',
        };
        return result;
      }

      // Image/Audio/Video producers return mock data and store artifacts in resolvedInputs
      if (['ImageProducer', 'AudioProducer', 'VideoProducer'].includes(producerName)) {
        const artefacts = request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artefactId: string) => {
            const isAudio = artefactId.includes('Audio');
            const isVideo = artefactId.includes('Video');
            // Create mock blob data with simulated-output: prefix for audio/video
            // This allows TimelineComposer to use SegmentDuration input for duration
            const SIMULATED_OUTPUT_PREFIX = 'simulated-output:';
            const data = isAudio || isVideo
              ? new TextEncoder().encode(SIMULATED_OUTPUT_PREFIX + artefactId)
              : new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
            const mimeType = artefactId.includes('Image')
              ? 'image/png'
              : isAudio
                ? 'audio/mp3'
                : 'video/mp4';

            // Store artifact in resolvedInputs for TimelineComposer to read
            resolvedInputs[artefactId] = data;

            return {
              artefactId,
              blob: { data, mimeType },
            };
          });

        return {
          jobId: request.job.jobId,
          status: 'succeeded',
          artefacts,
        };
      }

      // REAL TimelineComposer execution
      if (producerName === 'TimelineComposer') {
        // Resolve the handler from registry
        const handler = registry.resolve({
          provider: 'renku',
          model: 'timeline/ordered',
          environment: 'local',
        });

        // Prepare job context with all resolved inputs
        const prepared = prepareJobContext(request.job, resolvedInputs);

        // Build config matching the condition-example input-template.yaml
        // The config has tracks: ["Image", "Audio"], masterTracks: ["Audio", "Video"]
        const timelineConfig = {
          clips: [
            { kind: 'Image', inputs: 'ImageSegments' },
            { kind: 'Audio', inputs: 'AudioSegments', volume: 0.9 },
            { kind: 'Video', inputs: 'VideoSegments' },
          ],
          tracks: ['Image', 'Audio', 'Video'],
          masterTracks: ['Audio', 'Video'],
          numTracks: 2,
        };

        // Build provider context with the constructed config
        const context = {
          providerConfig: timelineConfig,
          environment: 'local' as const,
          extras: {
            resolvedInputs: prepared.resolvedInputs,
            plannerContext: request.job.context ? {
              index: request.job.context.indices,
              namespacePath: request.job.context.namespacePath,
              producerAlias: request.job.context.producerAlias,
            } : undefined,
            jobContext: request.job.context,
          },
        };

        // Invoke the real handler
        const response = await handler.invoke({
          jobId: request.job.jobId,
          provider: 'renku',
          model: 'timeline/ordered',
          revision: request.revision,
          layerIndex: request.layerIndex,
          attempt: request.attempt,
          inputs: request.job.inputs,
          produces: request.job.produces,
          context,
        });

        return {
          jobId: request.job.jobId,
          status: response.status ?? 'succeeded',
          artefacts: response.artefacts,
          diagnostics: response.diagnostics,
        };
      }

      // Fallback for any other producer
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artefacts: [],
      };
    });

    // ============================================================
    // PHASE 4: Execute
    // ============================================================

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
    // PHASE 5: Read and verify REAL timeline JSON
    // ============================================================

    const manifest = await result.buildManifest();
    const artifactIds = Object.keys(manifest.artefacts);

    // Find timeline artifact
    const timelineArtifactId = artifactIds.find((id) => id.includes('Timeline'));
    expect(timelineArtifactId).toBeDefined();
    const timelineArtifact = manifest.artefacts[timelineArtifactId!];
    expect(timelineArtifact).toBeDefined();
    expect(timelineArtifact.blob).toBeDefined();

    // Read timeline JSON from storage
    const timelineBlob = await readBlobFromStorage(storage, storageMovieId, timelineArtifact.blob!);
    const timeline = JSON.parse(
      typeof timelineBlob.data === 'string'
        ? timelineBlob.data
        : new TextDecoder().decode(timelineBlob.data),
    ) as {
      id: string;
      duration: number;
      tracks: Array<{
        id: string;
        kind: string;
        clips: Array<{
          id: string;
          kind: string;
          startTime: number;
          duration: number;
          properties: { assetId?: string; [key: string]: unknown };
        }>;
      }>;
    };

    // ============================================================
    // PHASE 6: THOROUGH Assertions on real output structure
    // ============================================================

    // Overall timeline
    expect(timeline.duration).toBe(30); // 3 segments x 10s each
    expect(timeline.id).toBeDefined();
    expect(timeline.tracks.length).toBeGreaterThanOrEqual(1);

    // =====================================================
    // AUDIO TRACK - segments [1] and [2] only (segment [0] skipped)
    // =====================================================
    const audioTrack = timeline.tracks.find((t) => t.kind === 'Audio');
    expect(audioTrack).toBeDefined();
    expect(audioTrack!.id).toBeDefined();
    expect(audioTrack!.clips).toHaveLength(2);

    // Audio clip for segment 1 (TalkingHead)
    const audioClip1 = audioTrack!.clips[0];
    expect(audioClip1.id).toBeDefined();
    expect(audioClip1.kind).toBe('Audio');
    expect(audioClip1.startTime).toBe(10); // After segment 0 (10s)
    expect(audioClip1.duration).toBe(10);
    expect(audioClip1.properties.assetId).toContain('AudioProducer.GeneratedAudio[1]');

    // Audio clip for segment 2 (ImageNarration with UseNarrationAudio=true)
    const audioClip2 = audioTrack!.clips[1];
    expect(audioClip2.id).toBeDefined();
    expect(audioClip2.kind).toBe('Audio');
    expect(audioClip2.startTime).toBe(20); // After segments 0+1 (20s)
    expect(audioClip2.duration).toBe(10);
    expect(audioClip2.properties.assetId).toContain('AudioProducer.GeneratedAudio[2]');

    // =====================================================
    // VIDEO TRACK - segment [1] only (segments [0] and [2] skipped)
    // =====================================================
    const videoTrack = timeline.tracks.find((t) => t.kind === 'Video');
    expect(videoTrack).toBeDefined();
    expect(videoTrack!.id).toBeDefined();
    expect(videoTrack!.clips).toHaveLength(1);

    // Video clip for segment 1 (TalkingHead only)
    const videoClip1 = videoTrack!.clips[0];
    expect(videoClip1.id).toBeDefined();
    expect(videoClip1.kind).toBe('Video');
    expect(videoClip1.startTime).toBe(10); // After segment 0 (10s)
    expect(videoClip1.duration).toBe(10);
    expect(videoClip1.properties.assetId).toContain('VideoProducer.GeneratedVideo[1]');

    // =====================================================
    // IMAGE TRACK - segments [0] and [2] only (segment [1] skipped)
    // Each clip has effects array with multiple images
    // =====================================================
    const imageTrack = timeline.tracks.find((t) => t.kind === 'Image');
    expect(imageTrack).toBeDefined();
    expect(imageTrack!.id).toBeDefined();
    // 2 clips (1 per segment with images: segment 0 and segment 2)
    expect(imageTrack!.clips).toHaveLength(2);

    // Segment 0 clip (duration: 10s, contains 2 images as effects)
    const imgClipSeg0 = imageTrack!.clips[0];
    expect(imgClipSeg0.kind).toBe('Image');
    expect(imgClipSeg0.startTime).toBe(0);
    expect(imgClipSeg0.duration).toBe(10); // Full segment duration
    const effects0 = imgClipSeg0.properties.effects as Array<{ assetId: string }>;
    expect(effects0).toHaveLength(2);
    expect(effects0[0].assetId).toContain('ImageProducer.GeneratedImage[0][0]');
    expect(effects0[1].assetId).toContain('ImageProducer.GeneratedImage[0][1]');

    // Segment 2 clip (starting at 20s, duration: 10s, contains 2 images as effects)
    const imgClipSeg2 = imageTrack!.clips[1];
    expect(imgClipSeg2.kind).toBe('Image');
    expect(imgClipSeg2.startTime).toBe(20); // After segments 0+1 (20s)
    expect(imgClipSeg2.duration).toBe(10); // Full segment duration
    const effects2 = imgClipSeg2.properties.effects as Array<{ assetId: string }>;
    expect(effects2).toHaveLength(2);
    expect(effects2[0].assetId).toContain('ImageProducer.GeneratedImage[2][0]');
    expect(effects2[1].assetId).toContain('ImageProducer.GeneratedImage[2][1]');

    // =====================================================
    // Verify NO clips exist for skipped segments
    // =====================================================
    // No audio clip at startTime=0 (segment 0 audio was skipped)
    expect(audioTrack!.clips.every((c) => c.startTime >= 10)).toBe(true);

    // No video clip at startTime=0 or startTime=20 (segments 0,2 video skipped)
    expect(videoTrack!.clips.every((c) => c.startTime === 10)).toBe(true);

    // No image clips in segment 1 range (10-20s)
    expect(imageTrack!.clips.every((c) => c.startTime < 10 || c.startTime >= 20)).toBe(true);

    // ============================================================
    // PHASE 7: Verify no unexpected errors
    // ============================================================

    expect(errors).toHaveLength(0);
    expect(result.status).toBe('succeeded');
  });
});
