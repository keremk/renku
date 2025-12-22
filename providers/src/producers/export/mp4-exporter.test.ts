import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createMp4ExporterHandler, __test__ } from './mp4-exporter.js';
import type { ProviderJobContext } from '../../types.js';

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const callback = args.find((arg) => typeof arg === 'function') as
      | ((err: Error | null, stdout?: unknown, stderr?: unknown) => void)
      | undefined;
    callback?.(null, { stdout: '', stderr: '' });
  },
}));

vi.mock('@gorenku/compositions', () => {
  return {
    renderDocumentaryMp4: vi.fn(async (options: { outputFile: string }) => {
      await writeFile(options.outputFile, Buffer.from('mock-mp4'));
      return options.outputFile;
    }),
  };
});

describe('mp4-exporter', () => {
  it('validates required config', () => {
    expect(() => __test__.parseExporterConfig({})).not.toThrow();
  });

  it('resolves movieId from resolved inputs', () => {
    const accessor = createInputAccessor({ 'Input:MovieId': 'movie-xyz' });
    expect(__test__.resolveMovieId(accessor)).toBe('movie-xyz');
    expect(() => __test__.resolveMovieId(createInputAccessor({ MovieId: 'movie-abc' }))).toThrowError(/movieId/);
    expect(() => __test__.resolveMovieId(createInputAccessor({}))).toThrowError(/movieId/);
  });

  it('resolves storage paths from config or inputs', () => {
    const accessor = createInputAccessor({ 'Input:StorageRoot': '/tmp/root', 'Input:StorageBasePath': 'custom' });
    expect(__test__.resolveStoragePaths({}, accessor)).toEqual({
      storageRoot: '/tmp/root',
      storageBasePath: 'custom',
    });
    expect(__test__.resolveStoragePaths({ rootFolder: '/cfg' }, accessor)).toEqual({
      storageRoot: '/cfg',
      storageBasePath: 'custom',
    });
    expect(() => __test__.resolveStoragePaths({}, createInputAccessor({ 'Input:StorageRoot': '/tmp/root' }))).toThrowError(
      /StorageBasePath/,
    );
  });

  it('exports mp4 using timeline + manifest blobs', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'mp4-exporter-'));
    const builds = path.join(tempRoot, 'builds');
    const movieId = 'movie-123';
    const movieDir = path.join(builds, movieId);
    const manifestsDir = path.join(movieDir, 'manifests');
    const audioBlobsDir = path.join(movieDir, 'blobs', 'ab');

    await mkdir(manifestsDir, { recursive: true });
    await mkdir(audioBlobsDir, { recursive: true });

    const manifestPath = path.join(manifestsDir, 'manifest.json');
    const timeline = {
      id: 'timeline-1',
      duration: 1,
      tracks: [
        {
          id: 'track-1',
          kind: 'Audio',
          clips: [
            {
              id: 'clip-1',
              kind: 'Audio',
              startTime: 0,
              duration: 1,
              properties: {
                assetId: 'Artifact:Audio[0]',
                volume: 1,
              },
            },
          ],
        },
      ],
    };

    const manifest = {
      artefacts: {
        'Artifact:TimelineComposer.Timeline': {
          blob: {
            hash: 'cd999',
            size: JSON.stringify(timeline).length,
            mimeType: 'application/json',
          },
        },
        'Artifact:Audio[0]': {
          blob: {
            hash: 'ab123',
            size: 3,
            mimeType: 'audio/mpeg',
          },
        },
      },
    };

    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(path.join(movieDir, 'current.json'), JSON.stringify({ revision: '1', manifestPath: 'manifests/manifest.json' }));
    await writeFile(path.join(audioBlobsDir, 'ab123.mp3'), Buffer.from('mp3'));
    const timelinePrefixDir = path.join(movieDir, 'blobs', 'cd');
    await mkdir(timelinePrefixDir, { recursive: true });
    await writeFile(path.join(timelinePrefixDir, 'cd999.json'), JSON.stringify(timeline));
    const expectedOutput = path.join(movieDir, 'FinalVideo.mp4');
    await writeFile(expectedOutput, Buffer.from('mp4'));

    const handler = createMp4ExporterHandler()({
      descriptor: { provider: 'renku', model: 'Mp4Exporter', environment: 'local' },
      mode: 'live',
      secretResolver: { async getSecret() { return null; } },
    });

    const response = await handler.invoke(createRequest({
      providerConfig: {},
      produces: ['Artifact:FinalVideo'],
      resolvedInputs: {
        'Input:MovieId': movieId,
        'Input:StorageRoot': tempRoot,
        'Input:StorageBasePath': 'builds',
      },
    }));

    expect(response.status).toBe('succeeded');
    const artefact = response.artefacts[0];
    expect(artefact?.artefactId).toBe('Artifact:FinalVideo');
    expect(artefact?.blob?.mimeType).toBe('video/mp4');
    expect(Buffer.isBuffer(artefact?.blob?.data)).toBe(true);
  });
});

function createRequest(opts: { providerConfig: Record<string, unknown>; produces: string[]; resolvedInputs?: Record<string, unknown> }): ProviderJobContext {
  return {
    jobId: 'job-1',
    provider: 'renku',
    model: 'Mp4Exporter',
    revision: 'rev-1',
    layerIndex: 0,
    attempt: 1,
    inputs: [],
    produces: opts.produces,
    context: {
      providerConfig: opts.providerConfig,
      rawAttachments: [],
      environment: 'local',
      extras: opts.resolvedInputs ? { resolvedInputs: opts.resolvedInputs } : {},
    },
  };
}

function createInputAccessor(map: Record<string, unknown>) {
  return {
    all() {
      return map;
    },
    get<T = unknown>(key: string) {
      return map[key] as T | undefined;
    },
    getByNodeId<T = unknown>(canonicalId: string) {
      return map[canonicalId] as T | undefined;
    },
  };
}
