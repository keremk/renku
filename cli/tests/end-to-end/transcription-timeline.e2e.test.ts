import { resolve } from 'node:path';
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
import { CATALOG_MODELS_ROOT, CLI_FIXTURES_BLUEPRINTS } from '../test-catalog-paths.js';

/**
 * Mock VideoScript data with controlled NarrationType values per segment.
 *
 * Test scenario (4 segments):
 * | Seg | NarrationType    | UseNarrationAudio | Audio | Video | Image | Transcription |
 * |-----|------------------|-------------------|-------|-------|-------|---------------|
 * | 0   | "ImageNarration" | false             | -     | -     | 2 imgs| No            |
 * | 1   | "TalkingHead"    | false             | 10s   | 10s   | -     | Yes           |
 * | 2   | "ImageNarration" | true              | 10s   | -     | 2 imgs| Yes           |
 * | 3   | "TalkingHead"    | false             | 10s   | 10s   | -     | Yes           |
 */
const mockVideoScript = {
  Title: 'Test Documentary',
  Summary: 'Test summary for transcription timeline testing',
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
    {
      Script: 'Segment 3 script - TalkingHead',
      NarrationType: 'TalkingHead',
      UseNarrationAudio: false,
      ImagePrompts: ['prompt 3-0', 'prompt 3-1'],
      VideoPrompt: 'video prompt 3',
    },
  ],
};

describe('end-to-end: TimelineComposer with Transcription track', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('generates correct Transcription track alongside Audio, Video, and Image tracks', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'transcription-timeline', 'transcription-timeline.yaml');
    const inputsPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'transcription-timeline', 'input-template.yaml');
    const { logger, errors } = createLoggerRecorder();
    const movieId = 'e2e-transcription-timeline';
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
    const resolvedInputs: Record<string, unknown> = {
      'Input:StorageRoot': cliConfig.storage.root,
      'Input:StorageBasePath': cliConfig.storage.basePath,
      'Input:MovieId': storageMovieId,
      'Input:Duration': 40,
      'Input:SegmentDuration': 10,
      'Input:TimelineComposer.Duration': 40,
      'Input:TimelineComposer.SegmentDuration': 10,
    };

    // ============================================================
    // PHASE 3: Create custom produce function
    // ============================================================

    const SIMULATED_OUTPUT_PREFIX = 'simulated-output:';

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
            const data = isAudio || isVideo
              ? new TextEncoder().encode(SIMULATED_OUTPUT_PREFIX + artefactId)
              : new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
            const mimeType = artefactId.includes('Image')
              ? 'image/png'
              : isAudio
                ? 'audio/mp3'
                : 'video/mp4';

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
        const handler = registry.resolve({
          provider: 'renku',
          model: 'timeline/ordered',
          environment: 'local',
        });

        const prepared = prepareJobContext(request.job, resolvedInputs);

        const timelineConfig = {
          timeline: {
            clips: [
              { kind: 'Image', inputs: 'ImageSegments' },
              { kind: 'Audio', inputs: 'AudioSegments', volume: 0.9 },
              { kind: 'Video', inputs: 'VideoSegments' },
              { kind: 'Transcription', inputs: 'TranscriptionAudio' },
            ],
            tracks: ['Image', 'Audio', 'Video', 'Transcription'],
            masterTracks: ['Audio', 'Video'],
            numTracks: 4,
          },
        };

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

    const timelineArtifactId = artifactIds.find((id) => id.includes('Timeline'));
    expect(timelineArtifactId).toBeDefined();
    const timelineArtifact = manifest.artefacts[timelineArtifactId!];
    expect(timelineArtifact).toBeDefined();
    expect(timelineArtifact.blob).toBeDefined();

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
    expect(timeline.duration).toBe(40); // 4 segments x 10s each
    expect(timeline.id).toBeDefined();
    expect(timeline.tracks.length).toBeGreaterThanOrEqual(1);

    // =====================================================
    // TRANSCRIPTION TRACK - segments [1], [2], [3] only (segment [0] skipped — no audio)
    // =====================================================
    const transcriptionTrack = timeline.tracks.find((t) => t.kind === 'Transcription');
    expect(transcriptionTrack).toBeDefined();
    expect(transcriptionTrack!.id).toBeDefined();
    // 3 clips (segments 1, 2, 3 have audio; segment 0 has no audio)
    expect(transcriptionTrack!.clips).toHaveLength(3);

    // Clip 0: segment 1 (TalkingHead) — startTime=10, duration=10
    const tClip0 = transcriptionTrack!.clips[0];
    expect(tClip0.kind).toBe('Transcription');
    expect(tClip0.startTime).toBe(10);
    expect(tClip0.duration).toBe(10);
    expect(tClip0.properties.assetId).toContain('AudioProducer.GeneratedAudio[1]');

    // Clip 1: segment 2 (ImageNarration with UseNarrationAudio=true) — startTime=20, duration=10
    const tClip1 = transcriptionTrack!.clips[1];
    expect(tClip1.kind).toBe('Transcription');
    expect(tClip1.startTime).toBe(20);
    expect(tClip1.duration).toBe(10);
    expect(tClip1.properties.assetId).toContain('AudioProducer.GeneratedAudio[2]');

    // Clip 2: segment 3 (TalkingHead) — startTime=30, duration=10
    const tClip2 = transcriptionTrack!.clips[2];
    expect(tClip2.kind).toBe('Transcription');
    expect(tClip2.startTime).toBe(30);
    expect(tClip2.duration).toBe(10);
    expect(tClip2.properties.assetId).toContain('AudioProducer.GeneratedAudio[3]');

    // No clip at startTime=0 (segment 0 has no audio)
    expect(transcriptionTrack!.clips.every((c) => c.startTime >= 10)).toBe(true);

    // =====================================================
    // AUDIO TRACK - segments [1], [2], [3] only (segment [0] skipped)
    // =====================================================
    const audioTrack = timeline.tracks.find((t) => t.kind === 'Audio');
    expect(audioTrack).toBeDefined();
    expect(audioTrack!.clips).toHaveLength(3);

    expect(audioTrack!.clips[0].startTime).toBe(10);
    expect(audioTrack!.clips[0].duration).toBe(10);
    expect(audioTrack!.clips[0].properties.assetId).toContain('AudioProducer.GeneratedAudio[1]');

    expect(audioTrack!.clips[1].startTime).toBe(20);
    expect(audioTrack!.clips[1].duration).toBe(10);
    expect(audioTrack!.clips[1].properties.assetId).toContain('AudioProducer.GeneratedAudio[2]');

    expect(audioTrack!.clips[2].startTime).toBe(30);
    expect(audioTrack!.clips[2].duration).toBe(10);
    expect(audioTrack!.clips[2].properties.assetId).toContain('AudioProducer.GeneratedAudio[3]');

    // =====================================================
    // VIDEO TRACK - segments [1] and [3] only (TalkingHead)
    // =====================================================
    const videoTrack = timeline.tracks.find((t) => t.kind === 'Video');
    expect(videoTrack).toBeDefined();
    expect(videoTrack!.clips).toHaveLength(2);

    expect(videoTrack!.clips[0].startTime).toBe(10);
    expect(videoTrack!.clips[0].duration).toBe(10);
    expect(videoTrack!.clips[0].properties.assetId).toContain('VideoProducer.GeneratedVideo[1]');

    expect(videoTrack!.clips[1].startTime).toBe(30);
    expect(videoTrack!.clips[1].duration).toBe(10);
    expect(videoTrack!.clips[1].properties.assetId).toContain('VideoProducer.GeneratedVideo[3]');

    // =====================================================
    // IMAGE TRACK - segments [0] and [2] only (ImageNarration)
    // =====================================================
    const imageTrack = timeline.tracks.find((t) => t.kind === 'Image');
    expect(imageTrack).toBeDefined();
    expect(imageTrack!.clips).toHaveLength(2);

    // Segment 0 clip (duration: 10s, contains 2 images as effects)
    const imgClipSeg0 = imageTrack!.clips[0];
    expect(imgClipSeg0.kind).toBe('Image');
    expect(imgClipSeg0.startTime).toBe(0);
    expect(imgClipSeg0.duration).toBe(10);
    const effects0 = imgClipSeg0.properties.effects as Array<{ assetId: string }>;
    expect(effects0).toHaveLength(2);
    expect(effects0[0].assetId).toContain('ImageProducer.GeneratedImage[0][0]');
    expect(effects0[1].assetId).toContain('ImageProducer.GeneratedImage[0][1]');

    // Segment 2 clip (starting at 20s, duration: 10s, contains 2 images as effects)
    const imgClipSeg2 = imageTrack!.clips[1];
    expect(imgClipSeg2.kind).toBe('Image');
    expect(imgClipSeg2.startTime).toBe(20);
    expect(imgClipSeg2.duration).toBe(10);
    const effects2 = imgClipSeg2.properties.effects as Array<{ assetId: string }>;
    expect(effects2).toHaveLength(2);
    expect(effects2[0].assetId).toContain('ImageProducer.GeneratedImage[2][0]');
    expect(effects2[1].assetId).toContain('ImageProducer.GeneratedImage[2][1]');

    // =====================================================
    // Cross-track verification
    // =====================================================
    // Total duration = 40s (4 segments x 10s)
    expect(timeline.duration).toBe(40);

    // No audio clip at startTime=0
    expect(audioTrack!.clips.every((c) => c.startTime >= 10)).toBe(true);

    // No video clip at startTime=0 or startTime=20
    expect(videoTrack!.clips.every((c) => c.startTime === 10 || c.startTime === 30)).toBe(true);

    // No image clips in segment 1 or 3 ranges
    expect(imageTrack!.clips.every((c) => c.startTime === 0 || c.startTime === 20)).toBe(true);

    // ============================================================
    // PHASE 7: Verify no unexpected errors
    // ============================================================

    expect(errors).toHaveLength(0);
    expect(result.status).toBe('succeeded');
  });
});
