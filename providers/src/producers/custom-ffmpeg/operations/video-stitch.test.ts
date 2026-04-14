import { Buffer } from 'node:buffer';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkFfmpegAvailability } from '../../../sdk/unified/ffmpeg-extractor.js';
import type { ProviderJobContext } from '../../../types.js';
import { REPO_ROOT } from '../../../../tests/test-catalog-paths.js';
import { createCustomFfmpegHandler } from '../handler.js';
import { __test__ } from './video-stitch.js';

const { flattenFanInGroups, ensureCompatibleClipSet } = __test__;

function createInvokeRequest(args: {
  storageRoot: string;
  mode?: 'live' | 'simulated';
  producerAlias?: string;
  clipArtefactIds?: string[];
  assetBlobPaths?: Record<string, string>;
  duration?: number;
}): ProviderJobContext {
  const producerAlias = args.producerAlias ?? 'VideoStitcher';
  const clipArtefactIds = args.clipArtefactIds ?? [
    'Artifact:ClipProducerA.GeneratedVideo',
    'Artifact:ClipProducerB.GeneratedVideo',
  ];
  return {
    jobId: 'video-stitch-job',
    provider: 'renku',
    model: 'ffmpeg/video-stitch',
    revision: 'rev-1',
    layerIndex: 1,
    attempt: 1,
    inputs: [
      `Input:${producerAlias}.VideoSegments`,
      `Input:${producerAlias}.Duration`,
    ],
    produces: ['Artifact:VideoStitcher.StitchedVideo'],
    context: {
      providerConfig: {},
      extras: {
        resolvedInputs: {
          [`Input:${producerAlias}.VideoSegments`]: {
            groupBy: 'singleton',
            groups: [clipArtefactIds],
          },
          [`Input:${producerAlias}.Duration`]: args.duration ?? 8,
          'Input:Duration': args.duration ?? 8,
          'Input:StorageRoot': args.storageRoot,
        },
        assetBlobPaths:
          args.assetBlobPaths ??
          Object.fromEntries(
            clipArtefactIds.map((artefactId, index) => [
              artefactId,
              `builds/movie/blobs/video-${index + 1}.mp4`,
            ])
          ),
        jobContext: {
          producerAlias,
          inputBindings: {
            Duration: 'Input:Duration',
          },
        },
      },
    },
  };
}

async function createHandler(mode: 'live' | 'simulated' = 'simulated') {
  return createCustomFfmpegHandler()({
    descriptor: {
      provider: 'renku',
      model: 'ffmpeg/video-stitch',
      environment: 'local',
    },
    mode,
    secretResolver: {
      async getSecret() {
        return null;
      },
    },
    getModelSchema: async () =>
      JSON.stringify({
        input_schema: {
          type: 'object',
          properties: {
            ffmpegPath: { type: 'string' },
            preset: { type: 'string' },
            crf: { type: 'integer' },
            audioBitrate: { type: 'string' },
          },
          additionalProperties: false,
        },
      }),
  });
}

describe('video stitch operation helpers', () => {
  it('flattens fan-in groups in declared order', () => {
    expect(
      flattenFanInGroups({
        groupBy: 'segment',
        groups: [['Artifact:A', 'Artifact:B'], ['Artifact:C']],
      })
    ).toEqual(['Artifact:A', 'Artifact:B', 'Artifact:C']);
  });

  it('rejects clip sets with mixed audio presence', () => {
    expect(() =>
      ensureCompatibleClipSet([
        {
          artefactId: 'Artifact:A',
          filePath: '/tmp/a.mp4',
          probe: { width: 1280, height: 720, fps: 24, hasAudio: true },
        },
        {
          artefactId: 'Artifact:B',
          filePath: '/tmp/b.mp4',
          probe: { width: 1280, height: 720, fps: 24, hasAudio: false },
        },
      ])
    ).toThrow('same audio');
  });
});

describe('createCustomFfmpegHandler video stitch invoke', () => {
  let storageRoot = '';

  beforeEach(async () => {
    storageRoot = await mkdtemp(path.join(tmpdir(), 'renku-video-stitch-'));
    await mkdir(path.join(storageRoot, 'builds', 'movie', 'blobs'), {
      recursive: true,
    });
  });

  afterEach(async () => {
    if (storageRoot) {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it('returns a simulated MP4 using the exact canonical Duration input', async () => {
    const handler = await createHandler('simulated');
    const result = await handler.invoke(
      createInvokeRequest({
        storageRoot,
        duration: 9,
      })
    );

    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(1);
    expect(result.artefacts[0]?.blob?.mimeType).toBe('video/mp4');
    expect((result.artefacts[0]?.blob?.data as Buffer).length).toBeGreaterThan(0);
  });

  it('fails fast when the exact canonical fan-in input is missing', async () => {
    const handler = await createHandler('simulated');
    const request = createInvokeRequest({ storageRoot });
    delete (request.context.extras as { resolvedInputs: Record<string, unknown> })
      .resolvedInputs['Input:VideoStitcher.VideoSegments'];

    await expect(handler.invoke(request)).rejects.toThrow(
      'requires fan-in data'
    );
  });

  it('stitches two real clips when ffmpeg is available', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      return;
    }

    const sourceFixture = path.resolve(
      REPO_ROOT,
      'cli/tests/fixtures/media/derived-video-frames-audio--source.mp4'
    );
    const clip1 = path.join(storageRoot, 'builds', 'movie', 'blobs', 'video-1.mp4');
    const clip2 = path.join(storageRoot, 'builds', 'movie', 'blobs', 'video-2.mp4');
    const sourceBuffer = await import('node:fs/promises').then(({ readFile }) =>
      readFile(sourceFixture)
    );
    await writeFile(clip1, sourceBuffer);
    await writeFile(clip2, sourceBuffer);

    const handler = await createHandler('live');
    const result = await handler.invoke(createInvokeRequest({ storageRoot }));

    expect(result.status).toBe('succeeded');
    expect(result.artefacts[0]?.blob?.mimeType).toBe('video/mp4');
    expect((result.artefacts[0]?.blob?.data as Buffer).length).toBeGreaterThan(1000);
  }, 15000);
});
