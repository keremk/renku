import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import { createProviderError } from '../../sdk/errors.js';
import type { HandlerFactory } from '../../types.js';
import type { ResolvedInputsAccessor } from '../../sdk/types.js';
import { createStorageContext } from '@renku/core';

const execFileAsync = promisify(execFile);
const DEFAULT_DOCKER_IMAGE = process.env.REMOTION_DOCKER_IMAGE ?? 'renku-remotion-export:latest';

interface Mp4ExporterConfig {
  rootFolder?: string;
  width?: number;
  height?: number;
  fps?: number;
}

interface ManifestPointer {
  revision: string | null;
  manifestPath: string | null;
}

interface ManifestFile {
  artefacts?: Record<
    string,
    {
      blob: {
        hash: string;
        size: number;
        mimeType?: string;
      };
    }
  >;
}

const TIMELINE_ARTEFACT_ID = 'Artifact:TimelineComposer.Timeline';

export function createMp4ExporterHandler(): HandlerFactory {
  return createProducerHandlerFactory({
    domain: 'media',
    configValidator: parseExporterConfig,
    invoke: async ({ request, runtime }) => {
      const notify = (type: 'progress' | 'success' | 'error', message: string) => {
        runtime.notifications?.publish({
          type,
          message,
          timestamp: new Date().toISOString(),
        });
      };
      notify('progress', `Exporting MP4 for job ${request.jobId}`);
      const config = runtime.config.parse<Mp4ExporterConfig>(parseExporterConfig);
      const produceId = request.produces[0];
      if (!produceId) {
        throw createProviderError('MP4 exporter requires at least one declared artefact output.', {
          code: 'invalid_config',
          kind: 'user_input',
          causedByUser: true,
        });
      }

      const movieId = resolveMovieId(runtime.inputs);
      const { storageRoot, storageBasePath } = resolveStoragePaths(config, runtime.inputs);

      const storage = createStorageContext({
        kind: 'local',
        rootDir: storageRoot,
        basePath: storageBasePath,
      });

      const inlineTimeline = runtime.inputs.getByNodeId<unknown>(TIMELINE_ARTEFACT_ID);

      // Ensure timeline exists; if manifest pointer is missing but an inline artefact is present,
      // return it directly (useful for simulated/dry-run flows).
      try {
        await loadTimeline(storage, movieId);
      } catch (error) {
        if (inlineTimeline) {
          const buffer = normalizeToBuffer(inlineTimeline);
          return {
            status: 'succeeded',
            artefacts: [
              {
                artefactId: runtime.artefacts.expectBlob(produceId),
                status: 'succeeded',
                blob: {
                  data: buffer,
                  mimeType: 'video/mp4',
                },
              },
            ],
          };
        }
        throw error;
      }

      if (runtime.mode === 'simulated') {
        const buffer = inlineTimeline ? normalizeToBuffer(inlineTimeline) : Buffer.from('simulated-video');
        return {
          status: 'succeeded',
          artefacts: [
            {
              artefactId: runtime.artefacts.expectBlob(produceId),
              status: 'succeeded',
              blob: {
                data: buffer,
                mimeType: 'video/mp4',
              },
            },
          ],
        };
      }

      const outputPath = storage.resolve(movieId, 'FinalVideo.mp4');

      await runDockerExport({
        storageRoot,
        storageBasePath,
        movieId,
        width: config.width,
        height: config.height,
        fps: config.fps,
        outputName: 'FinalVideo.mp4',
      });

      const buffer = await readFile(path.resolve(storageRoot, outputPath));

      const result = {
        status: 'succeeded' as const,
        artefacts: [
          {
            artefactId: runtime.artefacts.expectBlob(produceId),
            status: 'succeeded' as const,
            blob: {
              data: buffer,
              mimeType: 'video/mp4',
            },
          },
        ],
      };
      notify('success', `MP4 export completed for job ${request.jobId}`);
      return result;
    },
  });
}

function parseExporterConfig(raw: unknown): Mp4ExporterConfig {
  const config = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const rootFolder = typeof config.rootFolder === 'string' ? config.rootFolder : undefined;
  const width = typeof config.width === 'number' ? config.width : undefined;
  const height = typeof config.height === 'number' ? config.height : undefined;
  const fps = typeof config.fps === 'number' ? config.fps : undefined;
  return { rootFolder, width, height, fps };
}

function resolveMovieId(inputs: ResolvedInputsAccessor): string {
  const movieId = inputs.getByNodeId<string>('Input:MovieId');
  if (typeof movieId === 'string' && movieId.trim()) {
    return movieId;
  }
  throw createProviderError('MP4 exporter is missing movieId (Input:MovieId).', {
    code: 'invalid_config',
    kind: 'user_input',
    causedByUser: true,
  });
}

function resolveStoragePaths(config: Mp4ExporterConfig, inputs: ResolvedInputsAccessor): {
  storageRoot: string;
  storageBasePath: string;
} {
  const root = config.rootFolder ?? inputs.getByNodeId<string>('Input:StorageRoot');
  const basePath = inputs.getByNodeId<string>('Input:StorageBasePath');
  if (!root || typeof root !== 'string') {
    throw createProviderError('MP4 exporter is missing storage root (Input:StorageRoot).', {
      code: 'invalid_config',
      kind: 'user_input',
      causedByUser: true,
    });
  }
  if (!basePath || typeof basePath !== 'string' || !basePath.trim()) {
    throw createProviderError('MP4 exporter is missing storage base path (Input:StorageBasePath).', {
      code: 'invalid_config',
      kind: 'user_input',
      causedByUser: true,
    });
  }
  return { storageRoot: root, storageBasePath: basePath };
}

async function loadTimeline(storage: ReturnType<typeof createStorageContext>, movieId: string): Promise<void> {
  const pointerPath = storage.resolve(movieId, 'current.json');
  const pointerRaw = await storage.storage.readToString(pointerPath);
  const pointer = JSON.parse(pointerRaw) as ManifestPointer;
  if (!pointer.manifestPath) {
    throw createProviderError(`Manifest pointer missing path for movie ${movieId}.`, {
      code: 'missing_manifest',
      kind: 'user_input',
      causedByUser: true,
    });
  }
  const manifestPath = storage.resolve(movieId, pointer.manifestPath);
  const manifestRaw = await storage.storage.readToString(manifestPath);
  const manifest = JSON.parse(manifestRaw) as ManifestFile;
  const artefact = manifest.artefacts?.[TIMELINE_ARTEFACT_ID];
  if (!artefact) {
    throw createProviderError(`Timeline artefact not found for movie ${movieId}.`, {
      code: 'missing_timeline',
      kind: 'user_input',
      causedByUser: true,
    });
  }
  if (!artefact.blob) {
    throw createProviderError(`Timeline artefact for movie ${movieId} is missing blob metadata.`, {
      code: 'missing_timeline_blob',
      kind: 'user_input',
      causedByUser: true,
    });
  }
}

function normalizeToBuffer(value: unknown): Buffer {
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (typeof value === 'string') {
    return Buffer.from(value, 'utf8');
  }
  if (value && typeof value === 'object') {
    return Buffer.from(JSON.stringify(value), 'utf8');
  }
  throw createProviderError('Timeline artefact payload is not readable as a buffer.', {
    code: 'invalid_timeline',
    kind: 'user_input',
    causedByUser: true,
  });
}

export const __test__ = {
  parseExporterConfig,
  resolveMovieId,
  resolveStoragePaths,
};

interface DockerRunOptions {
  storageRoot: string;
  storageBasePath: string;
  movieId: string;
  width?: number;
  height?: number;
  fps?: number;
  outputName: string;
}

async function runDockerExport(options: DockerRunOptions): Promise<void> {
  const {
    storageRoot,
    storageBasePath,
    movieId,
    width,
    height,
    fps,
    outputName,
  } = options;

  const args = [
    'run',
    '--rm',
    '-v',
    `${storageRoot}:/data`,
    DEFAULT_DOCKER_IMAGE,
    'node',
    '/app/compositions/src/render.mjs',
    '--movieId',
    movieId,
    '--root',
    '/data',
    '--basePath',
    storageBasePath,
    '--output',
    outputName,
  ];
  if (typeof width === 'number') {
    args.push('--width', String(width));
  }
  if (typeof height === 'number') {
    args.push('--height', String(height));
  }
  if (typeof fps === 'number') {
    args.push('--fps', String(fps));
  }

  try {
    await execFileAsync('docker', args, {
      env: {
        ...process.env,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createProviderError(`Docker render failed: ${message}`, {
      code: 'render_failed',
      kind: 'user_input',
      causedByUser: true,
      raw: error,
    });
  }
}
