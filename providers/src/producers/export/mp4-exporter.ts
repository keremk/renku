import path from 'node:path';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import { createProviderError, SdkErrorCode } from '../../sdk/errors.js';
import type { HandlerFactory } from '../../types.js';
import type { ResolvedInputsAccessor } from '../../sdk/types.js';
import {
  createEventLog,
  createStorageContext,
  resolveArtifactBlobPaths,
  resolveArtifactsFromEventLog,
} from '@gorenku/core';
import type { TimelineDocument } from '@gorenku/compositions';

const execFileAsync = promisify(execFile);
const DEFAULT_DOCKER_IMAGE =
  process.env.REMOTION_DOCKER_IMAGE ?? 'renku-remotion-export:latest';

interface Mp4ExporterConfig {
  rootFolder?: string;
  width?: number;
  height?: number;
  fps?: number;
}

interface Mp4RenderInput {
  movieId: string;
  timeline: TimelineDocument;
  assetPaths: Record<string, string>;
}

const TIMELINE_ARTIFACT_ID = 'Artifact:TimelineComposer.Timeline';

export function createMp4ExporterHandler(): HandlerFactory {
  return createProducerHandlerFactory({
    domain: 'media',
    configValidator: parseExporterConfig,
    invoke: async ({ request, runtime }) => {
      const notify = (
        type: 'progress' | 'success' | 'error',
        message: string
      ) => {
        runtime.notifications?.publish({
          type,
          message,
          timestamp: new Date().toISOString(),
        });
      };
      notify('progress', `Exporting MP4 for job ${request.jobId}`);
      const config =
        runtime.config.parse<Mp4ExporterConfig>(parseExporterConfig);
      const produceId = request.produces[0];
      if (!produceId) {
        throw createProviderError(
          SdkErrorCode.INVALID_CONFIG,
          'MP4 exporter requires at least one declared artifact output.',
          { kind: 'user_input', causedByUser: true }
        );
      }

      const movieId = resolveMovieId(runtime.inputs);
      const { storageRoot, storageBasePath } = resolveStoragePaths(
        config,
        runtime.inputs
      );

      const storage = createStorageContext({
        kind: 'local',
        rootDir: storageRoot,
        basePath: storageBasePath,
      });

      const timeline = await resolveTimelineDocument({
        requestInputIds: request.inputs,
        runtimeInputs: runtime.inputs,
        storage,
        movieId,
      });

      if (runtime.mode === 'simulated') {
        const buffer = Buffer.from('simulated-video');
        return {
          status: 'succeeded',
          artifacts: [
            {
              artifactId: runtime.artifacts.expectBlob(produceId),
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
      const renderInputPath = await writeRenderInputFile({
        storageRoot,
        storageBasePath,
        movieId,
        timeline,
        storage,
      });

      try {
        await runDockerExport({
          storageRoot,
          storageBasePath,
          movieId,
          renderInputPath,
          width: config.width,
          height: config.height,
          fps: config.fps,
          outputName: 'FinalVideo.mp4',
          signal: request.signal,
        });
      } finally {
        await rm(renderInputPath, { force: true }).catch(() => {});
      }

      const buffer = await readFile(path.resolve(storageRoot, outputPath));

      const result = {
        status: 'succeeded' as const,
        artifacts: [
          {
            artifactId: runtime.artifacts.expectBlob(produceId),
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
  const config =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const rootFolder =
    typeof config.rootFolder === 'string' ? config.rootFolder : undefined;
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
  throw createProviderError(
    SdkErrorCode.INVALID_CONFIG,
    'MP4 exporter is missing movieId (Input:MovieId).',
    { kind: 'user_input', causedByUser: true }
  );
}

function resolveStoragePaths(
  config: Mp4ExporterConfig,
  inputs: ResolvedInputsAccessor
): {
  storageRoot: string;
  storageBasePath: string;
} {
  const root =
    config.rootFolder ?? inputs.getByNodeId<string>('Input:StorageRoot');
  const basePath = inputs.getByNodeId<string>('Input:StorageBasePath');
  if (!root || typeof root !== 'string') {
    throw createProviderError(
      SdkErrorCode.MISSING_STORAGE_ROOT,
      'MP4 exporter is missing storage root (Input:StorageRoot).',
      { kind: 'user_input', causedByUser: true }
    );
  }
  if (!basePath || typeof basePath !== 'string' || !basePath.trim()) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'MP4 exporter is missing storage base path (Input:StorageBasePath).',
      { kind: 'user_input', causedByUser: true }
    );
  }
  return { storageRoot: root, storageBasePath: basePath };
}

async function loadTimeline(
  storage: ReturnType<typeof createStorageContext>,
  movieId: string
): Promise<TimelineDocument> {
  const artifacts = await resolveArtifactsFromEventLog({
    artifactIds: [TIMELINE_ARTIFACT_ID],
    eventLog: createEventLog(storage),
    storage,
    movieId,
  });
  const artifact = artifacts[TIMELINE_ARTIFACT_ID];
  if (!isTimelineDocument(artifact)) {
    throw createProviderError(
      SdkErrorCode.MISSING_TIMELINE,
      `Timeline artifact not found for movie ${movieId}.`,
      { kind: 'user_input', causedByUser: true }
    );
  }
  return artifact;
}

function isTimelineDocument(value: unknown): value is TimelineDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as {
    id?: unknown;
    duration?: unknown;
    tracks?: unknown;
  };

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.duration === 'number' &&
    Array.isArray(candidate.tracks)
  );
}

async function resolveTimelineDocument(args: {
  requestInputIds: string[];
  runtimeInputs: ResolvedInputsAccessor;
  storage: ReturnType<typeof createStorageContext>;
  movieId: string;
}): Promise<TimelineDocument> {
  const inlineTimeline = args.runtimeInputs.getByNodeId<unknown>(
    TIMELINE_ARTIFACT_ID
  );
  const expectsInlineTimeline = args.requestInputIds.includes(TIMELINE_ARTIFACT_ID);

  if (isTimelineDocument(inlineTimeline)) {
    return inlineTimeline;
  }
  if (expectsInlineTimeline) {
    throw createProviderError(
      SdkErrorCode.INVALID_TIMELINE_PAYLOAD,
      `MP4 exporter requires a valid Timeline payload for "${TIMELINE_ARTIFACT_ID}".`,
      {
        kind: 'user_input',
        causedByUser: true,
        metadata: {
          timelineInputPresent: inlineTimeline !== undefined,
        },
      }
    );
  }
  return loadTimeline(args.storage, args.movieId);
}

async function writeRenderInputFile(args: {
  storageRoot: string;
  storageBasePath: string;
  movieId: string;
  timeline: TimelineDocument;
  storage: ReturnType<typeof createStorageContext>;
}): Promise<string> {
  const assetIds = Array.from(collectAssetIds(args.timeline));
  const assetPaths = await resolveArtifactBlobPaths({
    artifactIds: assetIds,
    eventLog: createEventLog(args.storage),
    storage: args.storage,
    movieId: args.movieId,
  });
  const missingAssetIds = assetIds.filter((artifactId) => !assetPaths[artifactId]);
  if (missingAssetIds.length > 0) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `MP4 exporter could not resolve asset blobs for: ${missingAssetIds.join(', ')}.`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  const renderInput: Mp4RenderInput = {
    movieId: args.movieId,
    timeline: args.timeline,
    assetPaths,
  };
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const renderInputPath = path.resolve(
    args.storageRoot,
    args.storageBasePath,
    args.movieId,
    `render-input-${uniqueSuffix}.json`
  );
  await writeFile(renderInputPath, JSON.stringify(renderInput), 'utf8');
  return renderInputPath;
}

function collectAssetIds(timeline: TimelineDocument): Set<string> {
  const assetIds = new Set<string>();

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const properties =
        clip && typeof clip === 'object' && 'properties' in clip
          ? (clip.properties as Record<string, unknown>)
          : null;
      if (!properties) {
        continue;
      }

      if (typeof properties.assetId === 'string') {
        assetIds.add(properties.assetId);
      }
      if (Array.isArray(properties.effects)) {
        for (const effect of properties.effects) {
          if (
            effect &&
            typeof effect === 'object' &&
            'assetId' in effect &&
            typeof effect.assetId === 'string'
          ) {
            assetIds.add(effect.assetId);
          }
        }
      }
    }
  }

  return assetIds;
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
  renderInputPath: string;
  width?: number;
  height?: number;
  fps?: number;
  outputName: string;
  signal?: AbortSignal;
}

async function runDockerExport(options: DockerRunOptions): Promise<void> {
  const {
    storageRoot,
    storageBasePath,
    movieId,
    renderInputPath,
    width,
    height,
    fps,
    outputName,
    signal,
  } = options;

  const args = [
    'run',
    '--rm',
    '-v',
    `${storageRoot}:/data`,
    DEFAULT_DOCKER_IMAGE,
    'node',
    '/app/compositions/src/render.mjs',
    '--payload',
    path.posix.join('/data', path.relative(storageRoot, renderInputPath)),
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
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw createProviderError(
        SdkErrorCode.RENDER_FAILED,
        'Docker render was cancelled by user request.',
        { kind: 'user_input', causedByUser: true, raw: error }
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw createProviderError(
      SdkErrorCode.RENDER_FAILED,
      `Docker render failed: ${message}`,
      { kind: 'user_input', causedByUser: true, raw: error }
    );
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === 'AbortError' ||
    String((error as { code?: unknown }).code) === 'ABORT_ERR'
  );
}
