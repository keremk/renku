import { dirname, resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
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
  type ExecutionPlan,
  type Manifest,
  type RevisionId,
} from '@gorenku/core';
import {
  createLoggerRecorder,
  setupTempCliConfig,
} from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('end-to-end: ffmpeg exporter uses fresh artifact paths from event log', () => {
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

  it('passes assetBlobPaths to handler via context.extras when timeline contains asset references', async () => {
    const { logger } = createLoggerRecorder();
    const movieId = 'e2e-fresh-artifacts';

    // Create storage context
    const storage = createStorageContext({
      kind: 'local',
      rootDir: tempRoot,
      basePath: 'builds',
    });
    await initializeMovieStorage(storage, movieId);

    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    // Create mock video blobs (use valid hex hashes for testing)
    const videoHash1 = 'fe001234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';
    const videoHash2 = 'fe021234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';

    // Create blob directories and files
    const blobDir1 = storage.resolve(movieId, 'blobs', videoHash1.slice(0, 2));
    const blobDir2 = storage.resolve(movieId, 'blobs', videoHash2.slice(0, 2));
    await mkdir(resolve(tempRoot, blobDir1), { recursive: true });
    await mkdir(resolve(tempRoot, blobDir2), { recursive: true });
    await writeFile(resolve(tempRoot, blobDir1, `${videoHash1}.mp4`), 'mock-video-1');
    await writeFile(resolve(tempRoot, blobDir2, `${videoHash2}.mp4`), 'mock-video-2');

    // Write artifact events to event log (simulating fresh artifacts)
    await eventLog.appendArtefact(movieId, {
      artefactId: 'Artifact:VideoProducer.GeneratedVideo[0]',
      revision: 'rev-0001' as RevisionId,
      inputsHash: 'input-hash-1',
      output: {
        blob: {
          hash: videoHash1,
          size: 1000,
          mimeType: 'video/mp4',
        },
      },
      status: 'succeeded',
      producedBy: 'job-video-0',
      createdAt: new Date().toISOString(),
    });

    await eventLog.appendArtefact(movieId, {
      artefactId: 'Artifact:VideoProducer.GeneratedVideo[1]',
      revision: 'rev-0001' as RevisionId,
      inputsHash: 'input-hash-2',
      output: {
        blob: {
          hash: videoHash2,
          size: 2000,
          mimeType: 'video/mp4',
        },
      },
      status: 'succeeded',
      producedBy: 'job-video-1',
      createdAt: new Date().toISOString(),
    });

    // Create a timeline that references these assets
    const timelineHash = 'aa00123456789abcdef1234567890abcdef1234567890abcdef123456789012ab';
    const timelineContent = JSON.stringify({
      id: 'timeline-rev-0001',
      duration: 20,
      assetFolder: {
        source: 'local',
        rootPath: resolve(tempRoot, 'builds', movieId),
      },
      tracks: [
        {
          id: 'track-0',
          kind: 'Video',
          clips: [
            {
              id: 'clip-0-0',
              kind: 'Video',
              startTime: 0,
              duration: 10,
              properties: {
                assetId: 'Artifact:VideoProducer.GeneratedVideo[0]',
              },
            },
            {
              id: 'clip-0-1',
              kind: 'Video',
              startTime: 10,
              duration: 10,
              properties: {
                assetId: 'Artifact:VideoProducer.GeneratedVideo[1]',
              },
            },
          ],
        },
      ],
    });

    // Write timeline blob
    const timelineBlobDir = storage.resolve(movieId, 'blobs', timelineHash.slice(0, 2));
    await mkdir(resolve(tempRoot, timelineBlobDir), { recursive: true });
    await writeFile(resolve(tempRoot, timelineBlobDir, `${timelineHash}.json`), timelineContent);

    // Write timeline artifact event
    await eventLog.appendArtefact(movieId, {
      artefactId: 'Artifact:TimelineComposer.Timeline',
      revision: 'rev-0001' as RevisionId,
      inputsHash: 'timeline-input-hash',
      output: {
        blob: {
          hash: timelineHash,
          size: timelineContent.length,
          mimeType: 'application/json',
        },
      },
      status: 'succeeded',
      producedBy: 'job-timeline',
      createdAt: new Date().toISOString(),
    });

    // Create a stale manifest with DIFFERENT (old) video hashes
    // This simulates the bug scenario where manifest is stale during execution
    const staleVideoHash1 = '0001234567890abcdef1234567890abcdef1234567890abcdef12345678901234';
    const staleVideoHash2 = '0002234567890abcdef1234567890abcdef1234567890abcdef12345678901234';

    const staleManifest: Manifest = {
      revision: 'rev-0000' as RevisionId,
      baseRevision: null,
      createdAt: new Date().toISOString(),
      inputs: {},
      artefacts: {
        'Artifact:VideoProducer.GeneratedVideo[0]': {
          hash: staleVideoHash1, // STALE - different from event log
          blob: {
            hash: staleVideoHash1,
            size: 500,
            mimeType: 'video/mp4',
          },
          producedBy: 'job-video-0',
          status: 'succeeded',
          createdAt: new Date().toISOString(),
        },
        'Artifact:VideoProducer.GeneratedVideo[1]': {
          hash: staleVideoHash2, // STALE - different from event log
          blob: {
            hash: staleVideoHash2,
            size: 600,
            mimeType: 'video/mp4',
          },
          producedBy: 'job-video-1',
          status: 'succeeded',
          createdAt: new Date().toISOString(),
        },
        'Artifact:TimelineComposer.Timeline': {
          hash: timelineHash, // Same for timeline
          blob: {
            hash: timelineHash,
            size: timelineContent.length,
            mimeType: 'application/json',
          },
          producedBy: 'job-timeline',
          status: 'succeeded',
          createdAt: new Date().toISOString(),
        },
      },
    };

    // Save stale manifest and create current.json pointer
    await manifestService.saveManifest(staleManifest, {
      movieId,
      previousHash: null,
      clock: { now: () => new Date().toISOString() },
    });

    // Track what assetBlobPaths are passed to the handler
    let capturedAssetBlobPaths: Record<string, string> | undefined;

    // Create produce function that captures assetBlobPaths from context
    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      // Capture the assetBlobPaths from context for verification
      capturedAssetBlobPaths = request.job.context?.extras?.assetBlobPaths as Record<string, string>;

      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artefacts: request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artefactId: string) => ({
            artefactId,
            blob: {
              data: 'mock-output',
              mimeType: 'video/mp4',
            },
          })),
      };
    });

    // Create execution plan with a job that receives Timeline as input
    const plan: ExecutionPlan = {
      revision: 'rev-0002' as RevisionId,
      manifestBaseHash: 'base-hash',
      createdAt: new Date().toISOString(),
      layers: [
        [
          {
            jobId: 'job-exporter',
            producer: 'VideoExporter',
            inputs: ['Artifact:TimelineComposer.Timeline'],
            produces: ['Artifact:VideoExporter.FinalVideo'],
            provider: 'test-provider',
            providerModel: 'test-model',
            rateKey: 'test-rate-key',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'VideoExporter',
              inputs: ['Artifact:TimelineComposer.Timeline'],
              produces: ['Artifact:VideoExporter.FinalVideo'],
            },
          },
        ],
      ],
      blueprintLayerCount: 1,
    };

    // Execute the plan
    const runner = createRunner();
    const runResult = await runner.execute(plan, {
      movieId,
      manifest: staleManifest, // Using stale manifest
      storage,
      eventLog,
      manifestService,
      produce,
      logger,
    });

    expect(runResult.status).toBe('succeeded');
    expect(produce).toHaveBeenCalled();

    // CRITICAL VERIFICATION:
    // The handler should receive assetBlobPaths with FRESH hashes from event log,
    // NOT the stale hashes from the manifest
    expect(capturedAssetBlobPaths).toBeDefined();
    expect(capturedAssetBlobPaths).toHaveProperty('Artifact:VideoProducer.GeneratedVideo[0]');
    expect(capturedAssetBlobPaths).toHaveProperty('Artifact:VideoProducer.GeneratedVideo[1]');

    // Verify paths contain FRESH hashes, not STALE hashes
    const path0 = capturedAssetBlobPaths!['Artifact:VideoProducer.GeneratedVideo[0]'];
    const path1 = capturedAssetBlobPaths!['Artifact:VideoProducer.GeneratedVideo[1]'];

    // Paths should contain fresh hashes
    expect(path0).toContain(videoHash1);
    expect(path1).toContain(videoHash2);

    // Paths should NOT contain stale hashes
    expect(path0).not.toContain(staleVideoHash1);
    expect(path1).not.toContain(staleVideoHash2);

    // Verify path format is correct (ends with blobs/{prefix}/{hash}.{ext})
    expect(path0).toMatch(/blobs\/[a-f0-9]{2}\/[a-f0-9]+\.mp4/);
    expect(path1).toMatch(/blobs\/[a-f0-9]{2}\/[a-f0-9]+\.mp4/);
  });

  it('extracts asset IDs from nested timeline structures', async () => {
    const { logger } = createLoggerRecorder();
    const movieId = 'e2e-nested-assets';

    const storage = createStorageContext({
      kind: 'local',
      rootDir: tempRoot,
      basePath: 'builds',
    });
    await initializeMovieStorage(storage, movieId);

    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    // Create hashes for video, audio, and music assets (use valid hex hashes)
    const videoHash = 'b1de0123456789abcdef1234567890abcdef1234567890abcdef1234567890ab';
    const audioHash = 'a0d10123456789abcdef1234567890abcdef1234567890abcdef1234567890ab';
    const musicHash = 'c0c10123456789abcdef1234567890abcdef1234567890abcdef1234567890ab';

    // Write artifact events for all assets
    for (const [artefactId, hash, mimeType] of [
      ['Artifact:VideoProducer.GeneratedVideo[0]', videoHash, 'video/mp4'],
      ['Artifact:AudioProducer.GeneratedAudio[0]', audioHash, 'audio/mpeg'],
      ['Artifact:MusicProducer.GeneratedMusic', musicHash, 'audio/mpeg'],
    ] as const) {
      const blobDir = storage.resolve(movieId, 'blobs', hash.slice(0, 2));
      await mkdir(resolve(tempRoot, blobDir), { recursive: true });
      await writeFile(resolve(tempRoot, blobDir, `${hash}.${mimeType.split('/')[1] === 'mpeg' ? 'mp3' : 'mp4'}`), 'mock');

      await eventLog.appendArtefact(movieId, {
        artefactId,
        revision: 'rev-0001' as RevisionId,
        inputsHash: `hash-${hash.slice(0, 8)}`,
        output: {
          blob: { hash, size: 100, mimeType },
        },
        status: 'succeeded',
        producedBy: `job-${artefactId}`,
        createdAt: new Date().toISOString(),
      });
    }

    // Create timeline with multiple track types (video, audio, music)
    const timelineHash = 'd0d0000000000abcdef1234567890abcdef1234567890abcdef1234567890ab';
    const timelineContent = JSON.stringify({
      id: 'timeline-nested',
      duration: 10,
      assetFolder: { source: 'local', rootPath: resolve(tempRoot, 'builds', movieId) },
      tracks: [
        {
          id: 'track-video',
          kind: 'Video',
          clips: [{ id: 'clip-v', kind: 'Video', startTime: 0, duration: 10, properties: { assetId: 'Artifact:VideoProducer.GeneratedVideo[0]' } }],
        },
        {
          id: 'track-audio',
          kind: 'Audio',
          clips: [{ id: 'clip-a', kind: 'Audio', startTime: 0, duration: 10, properties: { assetId: 'Artifact:AudioProducer.GeneratedAudio[0]' } }],
        },
        {
          id: 'track-music',
          kind: 'Music',
          clips: [{ id: 'clip-m', kind: 'Music', startTime: 0, duration: 10, properties: { assetId: 'Artifact:MusicProducer.GeneratedMusic' } }],
        },
      ],
    });

    const timelineBlobDir = storage.resolve(movieId, 'blobs', timelineHash.slice(0, 2));
    await mkdir(resolve(tempRoot, timelineBlobDir), { recursive: true });
    await writeFile(resolve(tempRoot, timelineBlobDir, `${timelineHash}.json`), timelineContent);

    await eventLog.appendArtefact(movieId, {
      artefactId: 'Artifact:TimelineComposer.Timeline',
      revision: 'rev-0001' as RevisionId,
      inputsHash: 'timeline-hash',
      output: { blob: { hash: timelineHash, size: timelineContent.length, mimeType: 'application/json' } },
      status: 'succeeded',
      producedBy: 'job-timeline',
      createdAt: new Date().toISOString(),
    });

    // Create empty manifest
    const manifest: Manifest = {
      revision: 'rev-0000' as RevisionId,
      baseRevision: null,
      createdAt: new Date().toISOString(),
      inputs: {},
      artefacts: {},
    };

    await manifestService.saveManifest(manifest, {
      movieId,
      previousHash: null,
      clock: { now: () => new Date().toISOString() },
    });

    let capturedAssetBlobPaths: Record<string, string> | undefined;

    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      capturedAssetBlobPaths = request.job.context?.extras?.assetBlobPaths as Record<string, string>;
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artefacts: request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artefactId: string) => ({
            artefactId,
            blob: { data: 'mock', mimeType: 'video/mp4' },
          })),
      };
    });

    const plan: ExecutionPlan = {
      revision: 'rev-0002' as RevisionId,
      manifestBaseHash: 'base-hash',
      createdAt: new Date().toISOString(),
      layers: [[{
        jobId: 'job-exporter',
        producer: 'VideoExporter',
        inputs: ['Artifact:TimelineComposer.Timeline'],
        produces: ['Artifact:VideoExporter.FinalVideo'],
        provider: 'test-provider',
        providerModel: 'test-model',
        rateKey: 'test-rate-key',
        context: {
          namespacePath: [],
          indices: {},
          producerAlias: 'VideoExporter',
          inputs: ['Artifact:TimelineComposer.Timeline'],
          produces: ['Artifact:VideoExporter.FinalVideo'],
        },
      }]],
      blueprintLayerCount: 1,
    };

    const runner = createRunner();
    await runner.execute(plan, {
      movieId,
      manifest,
      storage,
      eventLog,
      manifestService,
      produce,
      logger,
    });

    // Verify all asset types are extracted and resolved
    expect(capturedAssetBlobPaths).toBeDefined();
    expect(capturedAssetBlobPaths).toHaveProperty('Artifact:VideoProducer.GeneratedVideo[0]');
    expect(capturedAssetBlobPaths).toHaveProperty('Artifact:AudioProducer.GeneratedAudio[0]');
    expect(capturedAssetBlobPaths).toHaveProperty('Artifact:MusicProducer.GeneratedMusic');

    // Verify correct hashes in paths
    expect(capturedAssetBlobPaths!['Artifact:VideoProducer.GeneratedVideo[0]']).toContain(videoHash);
    expect(capturedAssetBlobPaths!['Artifact:AudioProducer.GeneratedAudio[0]']).toContain(audioHash);
    expect(capturedAssetBlobPaths!['Artifact:MusicProducer.GeneratedMusic']).toContain(musicHash);
  });
});
