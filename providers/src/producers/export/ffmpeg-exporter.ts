import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import { createProviderError, SdkErrorCode } from '../../sdk/errors.js';
import { validatePayload } from '../../sdk/schema-validator.js';
import { parseSchemaFile, resolveSchemaRefs } from '../../sdk/unified/schema-file.js';
import type { HandlerFactory, HandlerFactoryInit } from '../../types.js';
import type { ResolvedInputsAccessor } from '../../sdk/types.js';
import { createStorageContext } from '@gorenku/core';
import type { TimelineDocument } from '@gorenku/compositions';
import { buildFfmpegCommand } from './ffmpeg/command-builder.js';
import { generateAssFile } from './ffmpeg/ass-renderer.js';
import type { FfmpegExporterConfig, AssetPathMap } from './ffmpeg/types.js';
import { FFMPEG_DEFAULTS } from './ffmpeg/types.js';
import type { TranscriptionArtifact } from '../transcription/types.js';

const execFileAsync = promisify(execFile);

const TIMELINE_ARTEFACT_ID = 'Artifact:TimelineComposer.Timeline';
const TRANSCRIPTION_ARTEFACT_ID = 'Artifact:TranscriptionProducer.Transcription';

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
        const notify = (type: 'progress' | 'success' | 'error', message: string) => {
          runtime.notifications?.publish({
            type,
            message,
            timestamp: new Date().toISOString(),
          });
        };

        notify('progress', `Exporting via FFmpeg for job ${request.jobId}`);

        // Load schema via catalog infrastructure (async, cached by registry)
        const schemaRaw = await getModelSchema?.('renku', 'ffmpeg/native-render');

        // Validate config before any processing (fail-fast)
        // Treat undefined/null config as empty object (all fields are optional)
        const rawConfig = runtime.config.raw ?? {};
        if (schemaRaw) {
          const schemaFile = parseSchemaFile(schemaRaw);
          const resolvedSchema = resolveSchemaRefs(schemaFile.inputSchema, schemaFile.definitions);
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
          { kind: 'user_input', causedByUser: true },
        );
      }

      const movieId = resolveMovieId(runtime.inputs);
      const { storageRoot, storageBasePath } = resolveStoragePaths(config, runtime.inputs);

      const storage = createStorageContext({
        kind: 'local',
        rootDir: storageRoot,
        basePath: storageBasePath,
      });

      // Try to get inline timeline first
      const inlineTimeline = runtime.inputs.getByNodeId<unknown>(TIMELINE_ARTEFACT_ID);

      // Load timeline from manifest
      let timeline: TimelineDocument;
      try {
        timeline = await loadTimeline(storage, movieId);
      } catch (error) {
        if (inlineTimeline && typeof inlineTimeline === 'object') {
          timeline = inlineTimeline as TimelineDocument;
        } else {
          throw error;
        }
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

      // Build asset path map from manifest
      const moviePath = storage.resolve(movieId, '');
      const assetPaths = await buildAssetPaths(storage, movieId, timeline);

      // Try to load transcription for subtitles (optional)
      const transcription = await loadTranscription(storage, movieId);

      // Determine output path
      const outputName = detectOutputFormat(timeline) === 'video' ? 'FinalVideo.mp4' : 'FinalAudio.mp3';
      const outputPath = path.join(moviePath, outputName);

      // Generate ASS file for subtitles if transcription is available
      let assFilePath: string | undefined;
      if (transcription && transcription.words.length > 0) {
        notify('progress', 'Generating subtitles...');
        assFilePath = path.join(moviePath, 'subtitles.ass');
        await generateAssFile(transcription, {
          width: config.width ?? FFMPEG_DEFAULTS.width,
          height: config.height ?? FFMPEG_DEFAULTS.height,
          font: config.subtitles?.font,
          fontSize: config.subtitles?.fontSize,
          fontBaseColor: config.subtitles?.fontBaseColor,
          fontHighlightColor: config.subtitles?.fontHighlightColor,
          backgroundColor: config.subtitles?.backgroundColor,
          backgroundOpacity: config.subtitles?.backgroundOpacity,
          bottomMarginPercent: config.subtitles?.bottomMarginPercent,
          maxWordsPerLine: config.subtitles?.maxWordsPerLine,
          highlightEffect: config.subtitles?.highlightEffect,
        }, path.resolve(storageRoot, assFilePath));
      }

      // Build FFmpeg command
      notify('progress', 'Building FFmpeg command...');
      const ffmpegCommand = buildFfmpegCommand(timeline, assetPaths, {
        width: config.width ?? FFMPEG_DEFAULTS.width,
        height: config.height ?? FFMPEG_DEFAULTS.height,
        fps: config.fps ?? FFMPEG_DEFAULTS.fps,
        preset: config.preset ?? FFMPEG_DEFAULTS.preset,
        crf: config.crf ?? FFMPEG_DEFAULTS.crf,
        audioBitrate: config.audioBitrate ?? FFMPEG_DEFAULTS.audioBitrate,
        outputPath: path.resolve(storageRoot, outputPath),
        ffmpegPath: config.ffmpegPath ?? FFMPEG_DEFAULTS.ffmpegPath,
        subtitles: config.subtitles,
      }, transcription, assFilePath ? path.resolve(storageRoot, assFilePath) : undefined);

      // Ensure output directory exists
      await mkdir(path.dirname(ffmpegCommand.outputPath), { recursive: true });

      // Log the FFmpeg command for debugging
      const debugCommand = [ffmpegCommand.ffmpegPath, ...ffmpegCommand.args].join(' ');
      notify('progress', `FFmpeg command: ${debugCommand}`);

      // Run FFmpeg
      notify('progress', 'Running FFmpeg...');
      await runFfmpeg(ffmpegCommand.ffmpegPath, ffmpegCommand.args);

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
    { kind: 'user_input', causedByUser: true },
  );
}

function resolveStoragePaths(config: FfmpegExporterConfig, inputs: ResolvedInputsAccessor): {
  storageRoot: string;
  storageBasePath: string;
} {
  const root = config.rootFolder ?? inputs.getByNodeId<string>('Input:StorageRoot');
  const basePath = inputs.getByNodeId<string>('Input:StorageBasePath');
  if (!root || typeof root !== 'string') {
    throw createProviderError(
      SdkErrorCode.MISSING_STORAGE_ROOT,
      'FFmpeg exporter is missing storage root (Input:StorageRoot).',
      { kind: 'user_input', causedByUser: true },
    );
  }
  if (!basePath || typeof basePath !== 'string' || !basePath.trim()) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'FFmpeg exporter is missing storage base path (Input:StorageBasePath).',
      { kind: 'user_input', causedByUser: true },
    );
  }
  return { storageRoot: root, storageBasePath: basePath };
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
      { kind: 'user_input', causedByUser: true },
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
      { kind: 'user_input', causedByUser: true },
    );
  }

  // Load the actual timeline blob
  const blobPath = buildBlobPath(storage, movieId, timelineArtefact.blob.hash, 'json');
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

    const transcriptionArtefact = manifest.artefacts?.[TRANSCRIPTION_ARTEFACT_ID];
    if (!transcriptionArtefact?.blob?.hash) {
      return undefined;
    }

    // Load the actual transcription blob
    const blobPath = buildBlobPath(storage, movieId, transcriptionArtefact.blob.hash, 'json');
    const transcriptionRaw = await storage.storage.readToString(blobPath);
    return JSON.parse(transcriptionRaw) as TranscriptionArtifact;
  } catch {
    // Transcription is optional, return undefined if loading fails
    return undefined;
  }
}

async function buildAssetPaths(
  storage: ReturnType<typeof createStorageContext>,
  movieId: string,
  timeline: TimelineDocument
): Promise<AssetPathMap> {
  const assetPaths: AssetPathMap = {};

  // Note: assetFolder.rootPath indicates where assets are stored, but we still
  // need to load the actual file paths from the manifest's content-addressed storage.
  // The buildAssetPathsFromFolder function is not implemented, so we always use manifest.

  // Load from manifest
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

  // Collect all asset IDs from timeline
  const assetIds = collectAssetIds(timeline);

  // Build paths for each asset
  for (const assetId of assetIds) {
    const artefact = manifest.artefacts[assetId];
    if (artefact?.blob) {
      const ext = mimeToExtension(artefact.blob.mimeType);
      const blobPath = buildBlobPath(storage, movieId, artefact.blob.hash, ext);
      assetPaths[assetId] = blobPath;
    }
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
        if (Array.isArray(props.effects)) {
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
    (track) => track.kind === 'Image' || track.kind === 'Video'
  );
  return hasVisualTrack ? 'video' : 'audio';
}

async function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(ffmpegPath, args, {
      maxBuffer: 100 * 1024 * 1024, // 100MB for large outputs
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = (error as { stderr?: string }).stderr ?? '';
    const exitCode = (error as { code?: number }).code;
    const signal = (error as { signal?: string }).signal;

    // Check for common FFmpeg errors
    if (stderr.includes('No such file or directory') || message.includes('No such file')) {
      throw createProviderError(
        SdkErrorCode.MISSING_ASSET,
        `FFmpeg input file not found: ${message}${stderr ? `\nFFmpeg stderr: ${stderr}` : ''}`,
        { kind: 'user_input', causedByUser: true, raw: error },
      );
    }

    if (message.includes('ENOENT')) {
      throw createProviderError(
        SdkErrorCode.FFMPEG_NOT_FOUND,
        `FFmpeg not found at '${ffmpegPath}'. Ensure FFmpeg is installed and in your PATH.`,
        { kind: 'user_input', causedByUser: true, raw: error },
      );
    }

    // Build detailed error message
    const exitInfo = signal
      ? `Process killed by signal: ${signal}`
      : exitCode !== undefined
        ? `Exit code: ${exitCode}`
        : 'Unknown exit reason';

    const errorDetails = stderr
      ? `FFmpeg render failed. ${exitInfo}\nFFmpeg stderr:\n${stderr}`
      : `FFmpeg render failed. ${exitInfo}\n${message}`;

    throw createProviderError(
      SdkErrorCode.RENDER_FAILED,
      errorDetails,
      { kind: 'unknown', causedByUser: false, raw: error },
    );
  }
}

export const __test__ = {
  resolveMovieId,
  resolveStoragePaths,
  mimeToExtension,
  collectAssetIds,
  detectOutputFormat,
};
