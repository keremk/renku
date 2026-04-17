import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMp4ExporterHandler, __test__ } from './mp4-exporter.js';
import type { ProviderJobContext } from '../../types.js';

const { mockedExecFile } = vi.hoisted(() => ({
  mockedExecFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mockedExecFile,
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
  beforeEach(() => {
    mockedExecFile.mockReset();
    mockedExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args.find((arg) => typeof arg === 'function') as
        | ((err: Error | null, stdout?: unknown, stderr?: unknown) => void)
        | undefined;
      callback?.(null, { stdout: '', stderr: '' });
    });
  });

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

  it('exports mp4 using event-log artifacts and writes an explicit render payload', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'mp4-exporter-'));
    const builds = path.join(tempRoot, 'builds');
    const movieId = 'movie-123';
    const movieDir = path.join(builds, movieId);
    const eventsDir = path.join(movieDir, 'events');
    const audioBlobsDir = path.join(movieDir, 'blobs', 'ab');
    const timelineBlobsDir = path.join(movieDir, 'blobs', 'cd');

    await mkdir(eventsDir, { recursive: true });
    await mkdir(audioBlobsDir, { recursive: true });
    await mkdir(timelineBlobsDir, { recursive: true });
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

    const artifactEvents = [
      {
        artifactId: 'Artifact:TimelineComposer.Timeline',
        revision: 'rev-0001',
        inputsHash: 'timeline-inputs-hash',
        output: {
          blob: {
            hash: 'cd999',
            size: JSON.stringify(timeline).length,
            mimeType: 'application/json',
          },
        },
        status: 'succeeded',
        producedBy: 'Producer:TimelineComposer[0]',
        producerId: 'Producer:TimelineComposer',
        createdAt: new Date('2025-01-01T00:00:00Z').toISOString(),
      },
      {
        artifactId: 'Artifact:Audio[0]',
        revision: 'rev-0001',
        inputsHash: 'audio-inputs-hash',
        output: {
          blob: {
            hash: 'ab123',
            size: 3,
            mimeType: 'audio/mpeg',
          },
        },
        status: 'succeeded',
        producedBy: 'Producer:AudioProducer[0]',
        producerId: 'Producer:AudioProducer',
        createdAt: new Date('2025-01-01T00:00:00Z').toISOString(),
      },
    ];
    await writeFile(
      path.join(eventsDir, 'artifacts.log'),
      `${artifactEvents.map((event) => JSON.stringify(event)).join('\n')}\n`
    );
    await writeFile(path.join(audioBlobsDir, 'ab123.mp3'), Buffer.from('mp3'));
    await writeFile(path.join(timelineBlobsDir, 'cd999.json'), JSON.stringify(timeline));
    const expectedOutput = path.join(movieDir, 'FinalVideo.mp4');
    await writeFile(expectedOutput, Buffer.from('mp4'));

    let renderPayload: Record<string, unknown> | null = null;
    mockedExecFile.mockImplementationOnce(async (...args: unknown[]) => {
      const dockerArgs = args[1] as string[];
      const payloadIndex = dockerArgs.indexOf('--payload');
      const payloadPath = dockerArgs[payloadIndex + 1]?.replace('/data', tempRoot);
      renderPayload = JSON.parse(await readFile(payloadPath!, 'utf8')) as Record<
        string,
        unknown
      >;

      const callback = args.find((arg) => typeof arg === 'function') as
        | ((err: Error | null, stdout?: unknown, stderr?: unknown) => void)
        | undefined;
      callback?.(null, { stdout: '', stderr: '' });
    });

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
    const artifact = response.artifacts[0];
    expect(artifact?.artifactId).toBe('Artifact:FinalVideo');
    expect(artifact?.blob?.mimeType).toBe('video/mp4');
    expect(Buffer.isBuffer(artifact?.blob?.data)).toBe(true);
    expect(renderPayload).toMatchObject({
      movieId,
      timeline,
      assetPaths: {
        'Artifact:Audio[0]': path.join('builds', movieId, 'blobs', 'ab', 'ab123.mp3'),
      },
    });
  });
});

function createRequest(opts: {
  providerConfig: Record<string, unknown>;
  produces: string[];
  resolvedInputs?: Record<string, unknown>;
  inputs?: string[];
}): ProviderJobContext {
  return {
    jobId: 'job-1',
    provider: 'renku',
    model: 'Mp4Exporter',
    revision: 'rev-1',
    layerIndex: 0,
    attempt: 1,
    inputs: opts.inputs ?? [],
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
