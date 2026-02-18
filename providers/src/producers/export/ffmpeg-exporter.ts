import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import { createProviderError, SdkErrorCode } from '../../sdk/errors.js';
import { validatePayload } from '../../sdk/schema-validator.js';
import {
  parseSchemaFile,
  resolveSchemaRefs,
} from '../../sdk/unified/schema-file.js';
import type { HandlerFactory, HandlerFactoryInit } from '../../types.js';
import type { ResolvedInputsAccessor } from '../../sdk/types.js';
import { createStorageContext } from '@gorenku/core';
import type { TimelineDocument } from '@gorenku/compositions';
import { buildFfmpegCommand } from './ffmpeg/command-builder.js';
import { generateAssFile } from './ffmpeg/ass-renderer.js';
import type { FfmpegExporterConfig, AssetPathMap } from './ffmpeg/types.js';
import { FFMPEG_DEFAULTS } from './ffmpeg/types.js';
import type { TranscriptionArtifact } from '../transcription/types.js';

const MAX_FFMPEG_STDIO_BUFFER_BYTES = 100 * 1024 * 1024;
const FFMPEG_PROGRESS_PERCENT_STEP = 5;

const TIMELINE_ARTEFACT_ID = 'Artifact:TimelineComposer.Timeline';
const TRANSCRIPTION_ARTEFACT_ID =
  'Artifact:TranscriptionProducer.Transcription';

interface FfmpegProgressSnapshot {
  timeSeconds: number;
  fps: number | null;
  speed: number | null;
}

interface RunFfmpegOptions {
  signal?: AbortSignal;
  onProgress?: (snapshot: FfmpegProgressSnapshot) => void;
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

export function createFfmpegExporterHandler(): HandlerFactory {
  // Return outer function that captures init (following transcription handler pattern)
  return (init: HandlerFactoryInit) => {
    const { getModelSchema } = init; // Capture schema loader from init

    return createProducerHandlerFactory({
      domain: 'media',
      // No configValidator - we validate inside invoke with loaded schema
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

        notify('progress', `Exporting via FFmpeg for job ${request.jobId}`);

        // Load schema via catalog infrastructure (async, cached by registry)
        const schemaRaw = await getModelSchema?.(
          'renku',
          'ffmpeg/native-render'
        );

        // Validate config before any processing (fail-fast)
        // Treat undefined/null config as empty object (all fields are optional)
        const rawConfig = runtime.config.raw ?? {};
        if (schemaRaw) {
          const schemaFile = parseSchemaFile(schemaRaw);
          const resolvedSchema = resolveSchemaRefs(
            schemaFile.inputSchema,
            schemaFile.definitions
          );
          const schemaString = JSON.stringify(resolvedSchema);
          validatePayload(schemaString, rawConfig, 'FFmpeg exporter config');
        }

        // Config is now validated, safe to use
        const config = rawConfig as FfmpegExporterConfig;
        const produceId = request.produces[0];

        if (!produceId) {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            'FFmpeg exporter requires at least one declared artefact output.',
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

        const inlineTimeline =
          runtime.inputs.getByNodeId<unknown>(TIMELINE_ARTEFACT_ID);
        const expectsInlineTimeline =
          request.inputs.includes(TIMELINE_ARTEFACT_ID);

        // Prefer inline runtime timeline. During multi-producer runs,
        // current.json can point to an older revision while VideoExporter runs.
        // If this job declares Timeline as an input, fail fast when payload is
        // missing/invalid instead of falling back to a stale manifest snapshot.
        let timeline: TimelineDocument;
        if (isTimelineDocument(inlineTimeline)) {
          timeline = inlineTimeline;
        } else if (expectsInlineTimeline) {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            `FFmpeg exporter requires a valid Timeline payload for "${TIMELINE_ARTEFACT_ID}".`,
            {
              kind: 'user_input',
              causedByUser: true,
              metadata: {
                timelineInputPresent: inlineTimeline !== undefined,
              },
            }
          );
        } else {
          timeline = await loadTimeline(storage, movieId);
        }

        // Handle simulated mode
        if (runtime.mode === 'simulated') {
          const buffer = Buffer.from('simulated-ffmpeg-output');
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

        // Build asset path map - prefer paths from event log (via context.extras.assetBlobPaths)
        // over manifest-based resolution to ensure fresh paths during execution.
        const moviePath = storage.resolve(movieId, '');
        const eventLogPaths = request.context.extras?.assetBlobPaths as
          | Record<string, string>
          | undefined;
        const relativeAssetPaths = await buildAssetPaths(
          storage,
          movieId,
          timeline,
          eventLogPaths
        );

        // Resolve relative asset paths to absolute paths for FFmpeg execution.
        // storage.resolve() returns storage-relative paths, but FFmpeg runs in the
        // process CWD, so paths must be absolute.
        const assetPaths: AssetPathMap = {};
        for (const [assetId, assetPath] of Object.entries(relativeAssetPaths)) {
          assetPaths[assetId] = path.isAbsolute(assetPath)
            ? assetPath
            : path.resolve(storageRoot, assetPath);
        }

        // Try to load transcription for subtitles (optional)
        // First try to get it from runtime inputs (during execution), then fall back to manifest
        let transcription: TranscriptionArtifact | undefined;
        const inlineTranscription = runtime.inputs.getByNodeId<unknown>(
          TRANSCRIPTION_ARTEFACT_ID
        );
        if (
          inlineTranscription &&
          typeof inlineTranscription === 'object' &&
          'words' in inlineTranscription
        ) {
          transcription = inlineTranscription as TranscriptionArtifact;
        } else {
          transcription = await loadTranscription(storage, movieId);
        }

        // Determine output path
        const outputName =
          detectOutputFormat(timeline) === 'video'
            ? 'FinalVideo.mp4'
            : 'FinalAudio.mp3';
        const outputPath = path.join(moviePath, outputName);

        // Generate ASS file for subtitles if transcription is available
        let assFilePath: string | undefined;
        if (transcription && transcription.words.length > 0) {
          notify('progress', 'Generating subtitles...');
          assFilePath = path.join(moviePath, 'subtitles.ass');
          await generateAssFile(
            transcription,
            {
              width: config.width ?? FFMPEG_DEFAULTS.width,
              height: config.height ?? FFMPEG_DEFAULTS.height,
              font: config.subtitles?.font,
              fontSize: config.subtitles?.fontSize,
              fontBaseColor: config.subtitles?.fontBaseColor,
              fontHighlightColor: config.subtitles?.fontHighlightColor,
              backgroundColor: config.subtitles?.backgroundColor,
              backgroundOpacity: config.subtitles?.backgroundOpacity,
              position: config.subtitles?.position,
              edgePaddingPercent: config.subtitles?.edgePaddingPercent,
              maxWordsPerLine: config.subtitles?.maxWordsPerLine,
              highlightEffect: config.subtitles?.highlightEffect,
            },
            path.resolve(storageRoot, assFilePath)
          );
        }

        // Build FFmpeg command
        notify('progress', 'Building FFmpeg command...');
        const ffmpegCommand = await buildFfmpegCommand(
          timeline,
          assetPaths,
          {
            width: config.width ?? FFMPEG_DEFAULTS.width,
            height: config.height ?? FFMPEG_DEFAULTS.height,
            fps: config.fps ?? FFMPEG_DEFAULTS.fps,
            preset: config.preset ?? FFMPEG_DEFAULTS.preset,
            crf: config.crf ?? FFMPEG_DEFAULTS.crf,
            audioBitrate: config.audioBitrate ?? FFMPEG_DEFAULTS.audioBitrate,
            outputPath: path.resolve(storageRoot, outputPath),
            ffmpegPath: config.ffmpegPath ?? FFMPEG_DEFAULTS.ffmpegPath,
            subtitles: config.subtitles,
            text: config.text,
          },
          transcription,
          assFilePath ? path.resolve(storageRoot, assFilePath) : undefined
        );

        // Ensure output directory exists
        await mkdir(path.dirname(ffmpegCommand.outputPath), {
          recursive: true,
        });

        // Run FFmpeg
        notify('progress', 'Running FFmpeg render...');
        const renderStartedAt = Date.now();
        let lastReportedProgressBucket = -1;
        const totalDurationSeconds = timeline.duration;

        try {
          await runFfmpeg(ffmpegCommand.ffmpegPath, ffmpegCommand.args, {
            signal: request.signal,
            onProgress: (snapshot) => {
              if (totalDurationSeconds <= 0) {
                return;
              }

              const renderedSeconds = Math.min(
                snapshot.timeSeconds,
                totalDurationSeconds
              );
              const progressPercent = Math.min(
                100,
                Math.floor((renderedSeconds / totalDurationSeconds) * 100)
              );
              const progressBucket = Math.floor(
                progressPercent / FFMPEG_PROGRESS_PERCENT_STEP
              );

              if (progressBucket <= lastReportedProgressBucket) {
                return;
              }

              lastReportedProgressBucket = progressBucket;
              notify(
                'progress',
                formatFfmpegProgressMessage(
                  progressPercent,
                  renderedSeconds,
                  totalDurationSeconds,
                  snapshot
                )
              );
            },
          });
        } finally {
          const elapsedSeconds = Math.max(
            1,
            Math.floor((Date.now() - renderStartedAt) / 1000)
          );
          notify('progress', `FFmpeg render finished in ${elapsedSeconds}s.`);
        }

        // Read output file
        const buffer = await readFile(ffmpegCommand.outputPath);

        const result = {
          status: 'succeeded' as const,
          artefacts: [
            {
              artefactId: runtime.artefacts.expectBlob(produceId),
              status: 'succeeded' as const,
              blob: {
                data: buffer,
                mimeType: ffmpegCommand.mimeType,
              },
            },
          ],
        };

        notify('success', `FFmpeg export completed for job ${request.jobId}`);
        return result;
      },
    })(init); // Pass init to inner factory
  };
}

function resolveMovieId(inputs: ResolvedInputsAccessor): string {
  const movieId = inputs.getByNodeId<string>('Input:MovieId');
  if (typeof movieId === 'string' && movieId.trim()) {
    return movieId;
  }
  throw createProviderError(
    SdkErrorCode.INVALID_CONFIG,
    'FFmpeg exporter is missing movieId (Input:MovieId).',
    { kind: 'user_input', causedByUser: true }
  );
}

function resolveStoragePaths(
  config: FfmpegExporterConfig,
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
      'FFmpeg exporter is missing storage root (Input:StorageRoot).',
      { kind: 'user_input', causedByUser: true }
    );
  }
  if (!basePath || typeof basePath !== 'string' || !basePath.trim()) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'FFmpeg exporter is missing storage base path (Input:StorageBasePath).',
      { kind: 'user_input', causedByUser: true }
    );
  }
  return { storageRoot: root, storageBasePath: basePath };
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

async function loadTimeline(
  storage: ReturnType<typeof createStorageContext>,
  movieId: string
): Promise<TimelineDocument> {
  const pointerPath = storage.resolve(movieId, 'current.json');
  const pointerRaw = await storage.storage.readToString(pointerPath);
  const pointer = JSON.parse(pointerRaw) as ManifestPointer;

  if (!pointer.manifestPath) {
    throw createProviderError(
      SdkErrorCode.MISSING_MANIFEST,
      `Manifest pointer missing path for movie ${movieId}.`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  const manifestPath = storage.resolve(movieId, pointer.manifestPath);
  const manifestRaw = await storage.storage.readToString(manifestPath);
  const manifest = JSON.parse(manifestRaw) as ManifestFile;

  const timelineArtefact = manifest.artefacts?.[TIMELINE_ARTEFACT_ID];
  if (!timelineArtefact) {
    throw createProviderError(
      SdkErrorCode.MISSING_TIMELINE,
      `Timeline artefact not found for movie ${movieId}.`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  // Load the actual timeline blob
  const blobPath = buildBlobPath(
    storage,
    movieId,
    timelineArtefact.blob.hash,
    'json'
  );
  const timelineRaw = await storage.storage.readToString(blobPath);
  return JSON.parse(timelineRaw) as TimelineDocument;
}

/**
 * Load transcription artifact from storage (optional, for karaoke subtitles).
 * Returns undefined if transcription doesn't exist.
 */
async function loadTranscription(
  storage: ReturnType<typeof createStorageContext>,
  movieId: string
): Promise<TranscriptionArtifact | undefined> {
  try {
    const pointerPath = storage.resolve(movieId, 'current.json');
    const pointerRaw = await storage.storage.readToString(pointerPath);
    const pointer = JSON.parse(pointerRaw) as ManifestPointer;

    if (!pointer.manifestPath) {
      return undefined;
    }

    const manifestPath = storage.resolve(movieId, pointer.manifestPath);
    const manifestRaw = await storage.storage.readToString(manifestPath);
    const manifest = JSON.parse(manifestRaw) as ManifestFile;

    const transcriptionArtefact =
      manifest.artefacts?.[TRANSCRIPTION_ARTEFACT_ID];
    if (!transcriptionArtefact?.blob?.hash) {
      return undefined;
    }

    // Load the actual transcription blob
    const blobPath = buildBlobPath(
      storage,
      movieId,
      transcriptionArtefact.blob.hash,
      'json'
    );
    const transcriptionRaw = await storage.storage.readToString(blobPath);
    return JSON.parse(transcriptionRaw) as TranscriptionArtifact;
  } catch {
    // Transcription is optional, return undefined if loading fails
    return undefined;
  }
}

/**
 * Build asset path map for FFmpeg rendering.
 *
 * @param storage - Storage context for resolving paths
 * @param movieId - Movie identifier
 * @param timeline - Timeline document containing asset references
 * @param eventLogPaths - Optional pre-resolved paths from event log (preferred source)
 *
 * If eventLogPaths is provided, uses those paths for assets (resolved from event log).
 * Falls back to manifest-based resolution for any assets not in eventLogPaths.
 * This ensures fresh paths are used during execution when manifest may be stale.
 */
async function buildAssetPaths(
  storage: ReturnType<typeof createStorageContext>,
  movieId: string,
  timeline: TimelineDocument,
  eventLogPaths?: Record<string, string>
): Promise<AssetPathMap> {
  const assetPaths: AssetPathMap = {};

  // Collect all asset IDs from timeline
  const assetIds = collectAssetIds(timeline);

  // First, use event log paths if available (these are always fresh)
  if (eventLogPaths) {
    for (const assetId of assetIds) {
      if (eventLogPaths[assetId]) {
        assetPaths[assetId] = eventLogPaths[assetId];
      }
    }
  }

  // Check if we have all assets resolved from event log
  const missingAssets = Array.from(assetIds).filter((id) => !assetPaths[id]);
  if (missingAssets.length === 0) {
    return assetPaths;
  }

  // Fall back to manifest for any missing assets (backward compatibility)
  try {
    const pointerPath = storage.resolve(movieId, 'current.json');
    const pointerRaw = await storage.storage.readToString(pointerPath);
    const pointer = JSON.parse(pointerRaw) as ManifestPointer;

    if (!pointer.manifestPath) {
      return assetPaths;
    }

    const manifestPath = storage.resolve(movieId, pointer.manifestPath);
    const manifestRaw = await storage.storage.readToString(manifestPath);
    const manifest = JSON.parse(manifestRaw) as ManifestFile;

    if (!manifest.artefacts) {
      return assetPaths;
    }

    // Build paths for missing assets from manifest
    for (const assetId of missingAssets) {
      const artefact = manifest.artefacts[assetId];
      if (artefact?.blob) {
        const ext = mimeToExtension(artefact.blob.mimeType);
        const blobPath = buildBlobPath(
          storage,
          movieId,
          artefact.blob.hash,
          ext
        );
        assetPaths[assetId] = blobPath;
      }
    }
  } catch {
    // If manifest reading fails and we have no event log paths, this will cause issues
    // downstream when FFmpeg tries to access missing assets
  }

  return assetPaths;
}

function collectAssetIds(timeline: TimelineDocument): Set<string> {
  const assetIds = new Set<string>();

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if ('properties' in clip) {
        const props = clip.properties as Record<string, unknown>;

        // Direct assetId
        if (typeof props.assetId === 'string') {
          assetIds.add(props.assetId);
        }

        // KenBurns effects with assetIds
        if (track.kind === 'Image' && Array.isArray(props.effects)) {
          for (const effect of props.effects) {
            if (effect && typeof effect === 'object' && 'assetId' in effect) {
              assetIds.add(String(effect.assetId));
            }
          }
        }
      }
    }
  }

  return assetIds;
}

function buildBlobPath(
  storage: ReturnType<typeof createStorageContext>,
  movieId: string,
  hash: string,
  extension: string
): string {
  // Content-addressed storage: blobs/{prefix}/{hash}.{ext}
  const prefix = hash.substring(0, 2);
  return storage.resolve(movieId, `blobs/${prefix}/${hash}.${extension}`);
}

function mimeToExtension(mime?: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'application/json':
      return 'json';
    default:
      return 'bin';
  }
}

function detectOutputFormat(timeline: TimelineDocument): 'video' | 'audio' {
  const hasVisualTrack = timeline.tracks.some(
    (track) =>
      track.kind === 'Image' || track.kind === 'Video' || track.kind === 'Text'
  );
  return hasVisualTrack ? 'video' : 'audio';
}

async function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  options: RunFfmpegOptions
): Promise<void> {
  const { signal, onProgress } = options;
  let streamedStderr = '';
  let stderrLineBuffer = '';

  const consumeStderrChunk = (chunk: string): void => {
    streamedStderr += chunk;
    stderrLineBuffer += chunk;

    const lines = stderrLineBuffer.split(/\r?\n|\r/g);
    stderrLineBuffer = lines.pop() ?? '';

    if (!onProgress) {
      return;
    }

    for (const rawLine of lines) {
      const parsed = parseFfmpegProgressLine(rawLine);
      if (parsed) {
        onProgress(parsed);
      }
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        ffmpegPath,
        args,
        {
          maxBuffer: MAX_FFMPEG_STDIO_BUFFER_BYTES,
          signal,
        },
        (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }
      );

      child.stderr?.on('data', (chunk) => {
        consumeStderrChunk(String(chunk));
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr =
      streamedStderr || (error as { stderr?: string }).stderr || '';
    const exitCode = (error as { code?: number }).code;
    const terminationSignal = (error as { signal?: string }).signal;

    if (isAbortError(error)) {
      throw createProviderError(
        SdkErrorCode.RENDER_FAILED,
        'FFmpeg render was cancelled by user request.',
        {
          kind: 'user_input',
          causedByUser: true,
          raw: error,
        }
      );
    }

    // Check for common FFmpeg errors
    if (
      stderr.includes('No such file or directory') ||
      message.includes('No such file')
    ) {
      throw createProviderError(
        SdkErrorCode.MISSING_ASSET,
        `FFmpeg input file not found: ${message}${stderr ? `\nFFmpeg stderr: ${stderr}` : ''}`,
        { kind: 'user_input', causedByUser: true, raw: error }
      );
    }

    if (message.includes('ENOENT')) {
      throw createProviderError(
        SdkErrorCode.FFMPEG_NOT_FOUND,
        `FFmpeg not found at '${ffmpegPath}'. Ensure FFmpeg is installed and in your PATH.`,
        { kind: 'user_input', causedByUser: true, raw: error }
      );
    }

    // Build detailed error message
    const exitInfo = terminationSignal
      ? `Process killed by signal: ${terminationSignal}`
      : exitCode !== undefined
        ? `Exit code: ${exitCode}`
        : 'Unknown exit reason';

    const errorDetails = stderr
      ? `FFmpeg render failed. ${exitInfo}\nFFmpeg stderr:\n${stderr}`
      : `FFmpeg render failed. ${exitInfo}\n${message}`;

    throw createProviderError(SdkErrorCode.RENDER_FAILED, errorDetails, {
      kind: 'unknown',
      causedByUser: false,
      raw: error,
    });
  }
}

function parseFfmpegProgressLine(line: string): FfmpegProgressSnapshot | null {
  const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!timeMatch) {
    return null;
  }

  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3]);
  const timeSeconds = hours * 3600 + minutes * 60 + seconds;

  const fpsMatch = line.match(/fps=\s*([0-9.]+)/);
  const speedMatch = line.match(/speed=\s*([0-9.]+)x/);

  return {
    timeSeconds,
    fps: fpsMatch ? Number(fpsMatch[1]) : null,
    speed: speedMatch ? Number(speedMatch[1]) : null,
  };
}

function formatFfmpegProgressMessage(
  progressPercent: number,
  renderedSeconds: number,
  totalDurationSeconds: number,
  snapshot: FfmpegProgressSnapshot
): string {
  const renderedLabel = formatDuration(renderedSeconds);
  const totalLabel = formatDuration(totalDurationSeconds);
  const speedLabel =
    snapshot.speed !== null ? `${snapshot.speed.toFixed(2)}x` : 'n/a';
  const fpsLabel = snapshot.fps !== null ? snapshot.fps.toFixed(1) : 'n/a';

  return `FFmpeg progress ${progressPercent}% (${renderedLabel} / ${totalLabel}, speed ${speedLabel}, fps ${fpsLabel})`;
}

function formatDuration(valueSeconds: number): string {
  const roundedSeconds = Math.max(0, Math.floor(valueSeconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const seconds = roundedSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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

export const __test__ = {
  resolveMovieId,
  resolveStoragePaths,
  mimeToExtension,
  collectAssetIds,
  detectOutputFormat,
  parseFfmpegProgressLine,
  formatFfmpegProgressMessage,
  formatDuration,
};
