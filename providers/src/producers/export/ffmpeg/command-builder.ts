import type {
  TimelineDocument,
  TimelineTrack,
  ImageTrack,
  AudioTrack,
  MusicTrack,
  VideoTrack,
  CaptionsTrack,
  ImageClip,
  AudioClip,
  MusicClip,
  VideoClip,
  CaptionsClip,
} from '@gorenku/compositions';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  FfmpegCommand,
  FfmpegBuildOptions,
  AssetPathMap,
  AudioTrackInfo,
  VideoClipInfo,
  CaptionEntry,
  OutputFormat,
} from './types.js';
import { FFMPEG_DEFAULTS } from './types.js';
import {
  buildImageFilterChain,
  buildImageInputArgs,
  type SourceDimensions,
} from './kenburns-filter.js';
import {
  buildAudioMixFilter,
  buildAudioInputArgs,
  buildLoopedAudioInputArgs,
} from './audio-mixer.js';
import { buildVideoFilter, buildVideoInputArgs } from './video-track.js';
import {
  buildCaptionFilterChain,
  parseCaptionsFromArray,
} from './caption-renderer.js';
import type { TranscriptionArtifact } from '../../transcription/types.js';
import { createProviderError, SdkErrorCode } from '../../../sdk/errors.js';

const execFileAsync = promisify(execFile);

// Type guards for timeline tracks
function isImageTrack(track: TimelineTrack): track is ImageTrack {
  return track.kind === 'Image';
}

function isAudioTrack(track: TimelineTrack): track is AudioTrack {
  return track.kind === 'Audio';
}

function isMusicTrack(track: TimelineTrack): track is MusicTrack {
  return track.kind === 'Music';
}

function isVideoTrack(track: TimelineTrack): track is VideoTrack {
  return track.kind === 'Video';
}

/**
 * Input tracking for FFmpeg command building.
 */
interface InputTracker {
  /** Next available input index */
  nextIndex: number;
  /** Input arguments array */
  inputArgs: string[];
  /** Mapping of asset ID to input index */
  assetToIndex: Map<string, number>;
}

interface VideoAudioProbeRequest {
  assetId: string;
  assetPath: string;
}

interface ImageDimensionsProbeRequest {
  assetId: string;
  assetPath: string;
}

interface BuildFfmpegCommandRuntimeOptions {
  probeVideoAudioStream?: (request: VideoAudioProbeRequest) => Promise<boolean>;
  probeImageDimensions?: (
    request: ImageDimensionsProbeRequest
  ) => Promise<SourceDimensions>;
}

interface VideoAudioProbeState {
  cache: Map<string, boolean>;
  probe: (request: VideoAudioProbeRequest) => Promise<boolean>;
}

interface ImageDimensionsProbeState {
  cache: Map<string, SourceDimensions>;
  probe: (request: ImageDimensionsProbeRequest) => Promise<SourceDimensions>;
}

/**
 * Build a complete FFmpeg command from a timeline.
 *
 * @param timeline - The timeline document to render
 * @param assetPaths - Mapping of asset IDs to file paths
 * @param options - Build options
 * @param transcription - Optional word-level transcription for karaoke subtitles
 * @param assFilePath - Optional path to ASS subtitle file for karaoke rendering
 * @returns Complete FFmpeg command ready for execution
 */
export async function buildFfmpegCommand(
  timeline: TimelineDocument,
  assetPaths: AssetPathMap,
  options: Partial<FfmpegBuildOptions>,
  transcription?: TranscriptionArtifact,
  assFilePath?: string,
  runtimeOptions: BuildFfmpegCommandRuntimeOptions = {}
): Promise<FfmpegCommand> {
  const fullOptions = resolveOptions(options);
  const outputFormat = detectOutputFormat(timeline);
  const videoAudioProbeState: VideoAudioProbeState = {
    cache: new Map(),
    probe:
      runtimeOptions.probeVideoAudioStream ?? probeVideoAudioStreamWithFfprobe,
  };
  const imageDimensionsProbeState: ImageDimensionsProbeState = {
    cache: new Map(),
    probe:
      runtimeOptions.probeImageDimensions ?? probeImageDimensionsWithFfprobe,
  };

  const tracker: InputTracker = {
    nextIndex: 0,
    inputArgs: [],
    assetToIndex: new Map(),
  };

  const filterParts: string[] = [];
  const videoLabels: string[] = [];
  const audioInfos: AudioTrackInfo[] = [];

  // Process each track type
  for (const track of timeline.tracks) {
    if (isImageTrack(track)) {
      await processImageTrack(
        track,
        assetPaths,
        fullOptions,
        tracker,
        filterParts,
        videoLabels,
        imageDimensionsProbeState
      );
    } else if (isAudioTrack(track)) {
      processAudioTrack(track, assetPaths, tracker, audioInfos);
    } else if (isMusicTrack(track)) {
      processMusicTrack(
        track,
        assetPaths,
        timeline.duration,
        tracker,
        audioInfos
      );
    } else if (isVideoTrack(track)) {
      await processVideoTrack(
        track,
        assetPaths,
        fullOptions,
        tracker,
        filterParts,
        videoLabels,
        audioInfos,
        videoAudioProbeState
      );
    }
    // Captions are processed after video concatenation
  }

  // Build video concatenation if we have visual elements
  let videoOutputLabel = '';
  if (videoLabels.length > 0) {
    const concatFilter = buildVideoConcat(
      videoLabels,
      timeline.duration,
      fullOptions
    );
    filterParts.push(concatFilter.filter);
    videoOutputLabel = concatFilter.outputLabel;

    // Process captions (overlay on concatenated video)
    const captionsTrack = timeline.tracks.find(
      (t): t is CaptionsTrack => t.kind === 'Captions'
    );
    if (captionsTrack) {
      const captionResult = processCaptionsTrack(
        captionsTrack,
        videoOutputLabel,
        fullOptions
      );
      if (captionResult) {
        filterParts.push(captionResult.filter);
        videoOutputLabel = captionResult.outputLabel;
      }
    }

    // Process karaoke subtitles using ASS file if provided
    if (assFilePath && transcription && transcription.words.length > 0) {
      const karaokeOutputLabel = 'vkaraoke';
      // Use ASS filter with alpha support for semi-transparent backgrounds
      // The 'ass' filter is specifically designed for ASS/SSA subtitles
      const escapedPath = escapeFilterPath(assFilePath);
      const assFilter = `[${videoOutputLabel}]ass='${escapedPath}':alpha=1[${karaokeOutputLabel}]`;
      filterParts.push(assFilter);
      videoOutputLabel = karaokeOutputLabel;
    }
  }

  // Build audio mix (always add - generates silence if no audio tracks)
  const audioResult = buildAudioMixFilter(audioInfos, {
    totalDuration: timeline.duration,
  });
  filterParts.push(audioResult.filterExpr);

  // Build the complete command
  return buildCommand(
    tracker.inputArgs,
    filterParts,
    videoOutputLabel,
    audioResult.outputLabel,
    outputFormat,
    fullOptions
  );
}

/**
 * Detect whether the output should be video or audio-only.
 */
export function detectOutputFormat(timeline: TimelineDocument): OutputFormat {
  const hasVisualTrack = timeline.tracks.some(
    (track) => track.kind === 'Image' || track.kind === 'Video'
  );
  return hasVisualTrack ? 'video' : 'audio';
}

/**
 * Resolve partial options with defaults.
 */
function resolveOptions(
  options: Partial<FfmpegBuildOptions>
): FfmpegBuildOptions {
  return {
    width: options.width ?? FFMPEG_DEFAULTS.width,
    height: options.height ?? FFMPEG_DEFAULTS.height,
    fps: options.fps ?? FFMPEG_DEFAULTS.fps,
    preset: options.preset ?? FFMPEG_DEFAULTS.preset,
    crf: options.crf ?? FFMPEG_DEFAULTS.crf,
    audioBitrate: options.audioBitrate ?? FFMPEG_DEFAULTS.audioBitrate,
    outputPath: options.outputPath ?? 'output.mp4',
    ffmpegPath: options.ffmpegPath ?? FFMPEG_DEFAULTS.ffmpegPath,
    subtitles: options.subtitles,
  };
}

/**
 * Process an image track.
 */
async function processImageTrack(
  track: ImageTrack,
  assetPaths: AssetPathMap,
  options: FfmpegBuildOptions,
  tracker: InputTracker,
  filterParts: string[],
  videoLabels: string[],
  imageDimensionsProbeState: ImageDimensionsProbeState
): Promise<void> {
  for (const clip of track.clips) {
    await processImageClip(
      clip,
      assetPaths,
      options,
      tracker,
      filterParts,
      videoLabels,
      imageDimensionsProbeState
    );
  }
}

/**
 * Process a single image clip with its KenBurns effects.
 */
async function processImageClip(
  clip: ImageClip,
  assetPaths: AssetPathMap,
  options: FfmpegBuildOptions,
  tracker: InputTracker,
  filterParts: string[],
  videoLabels: string[],
  imageDimensionsProbeState: ImageDimensionsProbeState
): Promise<void> {
  const effects = clip.properties.effects;
  if (effects.length === 0) {
    return;
  }

  // Calculate duration per effect (each image in the clip)
  const durationPerEffect = clip.duration / effects.length;

  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i]!;
    const assetPath = assetPaths[effect.assetId];

    if (!assetPath) {
      continue; // Skip missing assets
    }

    // Add input for this image
    const inputIndex = tracker.nextIndex++;
    tracker.inputArgs.push(
      ...buildImageInputArgs(assetPath, durationPerEffect, options.fps)
    );
    tracker.assetToIndex.set(effect.assetId, inputIndex);

    const sourceDimensions = await resolveImageDimensions(
      effect.assetId,
      assetPath,
      imageDimensionsProbeState
    );

    // Build filter chain
    const label = `img${inputIndex}`;
    const filterChain = buildImageFilterChain(
      inputIndex,
      effect,
      {
        width: options.width,
        height: options.height,
        fps: options.fps,
        duration: durationPerEffect,
      },
      sourceDimensions,
      label
    );

    filterParts.push(filterChain);
    videoLabels.push(`[${label}]`);
  }
}

/**
 * Process an audio track.
 */
function processAudioTrack(
  track: AudioTrack,
  assetPaths: AssetPathMap,
  tracker: InputTracker,
  audioInfos: AudioTrackInfo[]
): void {
  for (const clip of track.clips) {
    processAudioClip(clip, assetPaths, tracker, audioInfos);
  }
}

/**
 * Process a single audio clip.
 */
function processAudioClip(
  clip: AudioClip,
  assetPaths: AssetPathMap,
  tracker: InputTracker,
  audioInfos: AudioTrackInfo[]
): void {
  const assetPath = assetPaths[clip.properties.assetId];
  if (!assetPath) {
    return;
  }

  const inputIndex = tracker.nextIndex++;
  tracker.inputArgs.push(...buildAudioInputArgs(assetPath));
  tracker.assetToIndex.set(clip.properties.assetId, inputIndex);

  audioInfos.push({
    inputIndex,
    volume: clip.properties.volume ?? 1,
    startTime: clip.startTime,
    duration: clip.duration,
    fadeInDuration: clip.properties.fadeInDuration,
    fadeOutDuration: clip.properties.fadeOutDuration,
  });
}

/**
 * Process a music track.
 */
function processMusicTrack(
  track: MusicTrack,
  assetPaths: AssetPathMap,
  totalDuration: number,
  tracker: InputTracker,
  audioInfos: AudioTrackInfo[]
): void {
  for (const clip of track.clips) {
    processMusicClip(clip, assetPaths, totalDuration, tracker, audioInfos);
  }
}

/**
 * Process a single music clip.
 */
function processMusicClip(
  clip: MusicClip,
  assetPaths: AssetPathMap,
  totalDuration: number,
  tracker: InputTracker,
  audioInfos: AudioTrackInfo[]
): void {
  const assetPath = assetPaths[clip.properties.assetId];
  if (!assetPath) {
    return;
  }

  const shouldLoop = clip.properties.play === 'loop';
  const inputIndex = tracker.nextIndex++;

  // Use looped input for music that should loop
  if (shouldLoop) {
    tracker.inputArgs.push(...buildLoopedAudioInputArgs(assetPath));
  } else {
    tracker.inputArgs.push(...buildAudioInputArgs(assetPath));
  }
  tracker.assetToIndex.set(clip.properties.assetId, inputIndex);

  // Determine duration based on settings
  const duration =
    clip.properties.duration === 'full' ? totalDuration : clip.duration;

  audioInfos.push({
    inputIndex,
    volume: clip.properties.volume ?? 0.3, // Music default volume is lower
    startTime: clip.startTime,
    duration,
    loop: shouldLoop,
  });
}

/**
 * Process a video track.
 */
async function processVideoTrack(
  track: VideoTrack,
  assetPaths: AssetPathMap,
  options: FfmpegBuildOptions,
  tracker: InputTracker,
  filterParts: string[],
  videoLabels: string[],
  audioInfos: AudioTrackInfo[],
  videoAudioProbeState: VideoAudioProbeState
): Promise<void> {
  for (const clip of track.clips) {
    await processVideoClip(
      clip,
      assetPaths,
      options,
      tracker,
      filterParts,
      videoLabels,
      audioInfos,
      videoAudioProbeState
    );
  }
}

/**
 * Process a single video clip.
 */
async function processVideoClip(
  clip: VideoClip,
  assetPaths: AssetPathMap,
  options: FfmpegBuildOptions,
  tracker: InputTracker,
  filterParts: string[],
  videoLabels: string[],
  audioInfos: AudioTrackInfo[],
  videoAudioProbeState: VideoAudioProbeState
): Promise<void> {
  const assetPath = assetPaths[clip.properties.assetId];
  if (!assetPath) {
    return;
  }

  const inputIndex = tracker.nextIndex++;
  tracker.inputArgs.push(...buildVideoInputArgs(assetPath));
  tracker.assetToIndex.set(clip.properties.assetId, inputIndex);

  // Determine fit strategy
  // Always use stretch to match master track (audio) duration
  const fitStrategy = 'stretch' as const;

  const clipInfo: VideoClipInfo = {
    inputIndex,
    startTime: clip.startTime,
    targetDuration: clip.duration,
    originalDuration: clip.properties.originalDuration,
    fitStrategy,
    volume: clip.properties.volume,
  };

  // Build video filter
  const videoLabel = `vid${inputIndex}`;
  const videoFilter = buildVideoFilter(
    clipInfo,
    {
      width: options.width,
      height: options.height,
      fps: options.fps,
    },
    videoLabel
  );

  filterParts.push(videoFilter);
  videoLabels.push(`[${videoLabel}]`);

  // Handle video audio - extract by default (volume defaults to 1)
  // Users can explicitly set volume: 0 to strip audio from video clips
  const effectiveVolume = clipInfo.volume ?? 1;
  if (effectiveVolume <= 0) {
    return;
  }

  const hasAudioStream = await resolveVideoAudioAvailability(
    clip.properties.assetId,
    assetPath,
    videoAudioProbeState
  );

  if (hasAudioStream) {
    audioInfos.push({
      inputIndex,
      volume: effectiveVolume,
      startTime: clip.startTime,
      duration: clip.duration,
    });
  }
}

async function resolveVideoAudioAvailability(
  assetId: string,
  assetPath: string,
  probeState: VideoAudioProbeState
): Promise<boolean> {
  const cached = probeState.cache.get(assetPath);
  if (cached !== undefined) {
    return cached;
  }

  const hasAudioStream = await probeState.probe({ assetId, assetPath });
  probeState.cache.set(assetPath, hasAudioStream);
  return hasAudioStream;
}

async function resolveImageDimensions(
  assetId: string,
  assetPath: string,
  probeState: ImageDimensionsProbeState
): Promise<SourceDimensions> {
  const cached = probeState.cache.get(assetPath);
  if (cached !== undefined) {
    return cached;
  }

  const dimensions = await probeState.probe({ assetId, assetPath });
  probeState.cache.set(assetPath, dimensions);
  return dimensions;
}

async function probeVideoAudioStreamWithFfprobe(
  request: VideoAudioProbeRequest
): Promise<boolean> {
  const { assetId, assetPath } = request;
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=index',
        '-of',
        'csv=p=0',
        assetPath,
      ],
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    return stdout.trim().length > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
    const details = stderr || message;

    if (message.includes('ENOENT')) {
      throw createProviderError(
        SdkErrorCode.FFMPEG_NOT_FOUND,
        `ffprobe was not found while probing audio stream for video asset '${assetId}' at '${assetPath}'. Ensure FFmpeg tools are installed and ffprobe is available in PATH.`,
        { kind: 'user_input', causedByUser: true, raw: error }
      );
    }

    if (details.includes('No such file or directory')) {
      throw createProviderError(
        SdkErrorCode.MISSING_ASSET,
        `Failed to probe audio stream for video asset '${assetId}' at '${assetPath}': source file was not found. ${details}`,
        { kind: 'user_input', causedByUser: true, raw: error }
      );
    }

    throw createProviderError(
      SdkErrorCode.RENDER_FAILED,
      `Failed to probe audio stream for video asset '${assetId}' at '${assetPath}'. ${details}`,
      { kind: 'unknown', causedByUser: false, raw: error }
    );
  }
}

async function probeImageDimensionsWithFfprobe(
  request: ImageDimensionsProbeRequest
): Promise<SourceDimensions> {
  const { assetId, assetPath } = request;

  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0:s=x',
        assetPath,
      ],
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const [widthRaw, heightRaw] = stdout.trim().split('x');
    const width = Number(widthRaw);
    const height = Number(heightRaw);

    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw createProviderError(
        SdkErrorCode.RENDER_FAILED,
        `Failed to parse image dimensions for asset '${assetId}' at '${assetPath}'. ffprobe output: '${stdout.trim()}'`,
        { kind: 'unknown', causedByUser: false }
      );
    }

    return { width, height };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
    const details = stderr || message;

    if (message.includes('ENOENT')) {
      throw createProviderError(
        SdkErrorCode.FFMPEG_NOT_FOUND,
        `ffprobe was not found while probing image dimensions for asset '${assetId}' at '${assetPath}'. Ensure FFmpeg tools are installed and ffprobe is available in PATH.`,
        { kind: 'user_input', causedByUser: true, raw: error }
      );
    }

    if (details.includes('No such file or directory')) {
      throw createProviderError(
        SdkErrorCode.MISSING_ASSET,
        `Failed to probe image dimensions for asset '${assetId}' at '${assetPath}': source file was not found. ${details}`,
        { kind: 'user_input', causedByUser: true, raw: error }
      );
    }

    throw createProviderError(
      SdkErrorCode.RENDER_FAILED,
      `Failed to probe image dimensions for asset '${assetId}' at '${assetPath}'. ${details}`,
      { kind: 'unknown', causedByUser: false, raw: error }
    );
  }
}

/**
 * Process a captions track.
 */
function processCaptionsTrack(
  track: CaptionsTrack,
  videoInputLabel: string,
  options: FfmpegBuildOptions
): { filter: string; outputLabel: string } | null {
  const allCaptions: CaptionEntry[] = [];

  for (const clip of track.clips) {
    const clipCaptions = extractCaptionsFromClip(clip);
    allCaptions.push(...clipCaptions);
  }

  if (allCaptions.length === 0) {
    return null;
  }

  const outputLabel = 'vcap';
  const filter = buildCaptionFilterChain(
    `[${videoInputLabel}]`,
    allCaptions,
    {
      width: options.width,
      height: options.height,
    },
    outputLabel
  );

  return { filter, outputLabel };
}

/**
 * Extract caption entries from a captions clip.
 */
function extractCaptionsFromClip(clip: CaptionsClip): CaptionEntry[] {
  const captions = clip.properties.captions ?? [];
  return parseCaptionsFromArray(
    captions,
    clip.startTime,
    clip.duration,
    clip.properties.partitionBy
  );
}

/**
 * Build video concatenation filter.
 */
function buildVideoConcat(
  videoLabels: string[],
  _totalDuration: number,
  _options: FfmpegBuildOptions
): { filter: string; outputLabel: string } {
  if (videoLabels.length === 0) {
    return { filter: '', outputLabel: '' };
  }

  if (videoLabels.length === 1) {
    // Single video, just rename the label
    const inputLabel = videoLabels[0]!.slice(1, -1); // Remove brackets
    return {
      filter: `[${inputLabel}]null[vconcat]`,
      outputLabel: 'vconcat',
    };
  }

  // Concatenate multiple videos
  const concat = `${videoLabels.join('')}concat=n=${videoLabels.length}:v=1:a=0[vconcat]`;
  return {
    filter: concat,
    outputLabel: 'vconcat',
  };
}

/**
 * Build the final FFmpeg command.
 */
function buildCommand(
  inputArgs: string[],
  filterParts: string[],
  videoOutputLabel: string,
  audioOutputLabel: string,
  outputFormat: OutputFormat,
  options: FfmpegBuildOptions
): FfmpegCommand {
  // -y: Overwrite output, -nostdin: Don't read stdin (prevents issues in non-interactive mode)
  const args: string[] = ['-y', '-nostdin'];

  // Add all inputs
  args.push(...inputArgs);

  // Build filter_complex if we have filters
  if (filterParts.length > 0) {
    args.push('-filter_complex', filterParts.join(';'));
  }

  // Map output streams
  if (videoOutputLabel) {
    args.push('-map', `[${videoOutputLabel}]`);
  }
  if (audioOutputLabel) {
    args.push('-map', `[${audioOutputLabel}]`);
  }

  // Add encoding options based on output format
  if (outputFormat === 'video') {
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      options.preset,
      '-crf',
      String(options.crf),
      '-c:a',
      'aac',
      '-b:a',
      options.audioBitrate
    );
  } else {
    // Audio only (MP3)
    args.push('-c:a', 'libmp3lame', '-b:a', options.audioBitrate);
  }

  // Output path
  const outputPath =
    outputFormat === 'video'
      ? options.outputPath.replace(/\.\w+$/, '.mp4')
      : options.outputPath.replace(/\.\w+$/, '.mp3');

  args.push(outputPath);

  return {
    ffmpegPath: options.ffmpegPath,
    args,
    inputFiles: extractInputFiles(inputArgs),
    outputPath,
    mimeType: outputFormat === 'video' ? 'video/mp4' : 'audio/mpeg',
  };
}

/**
 * Escape a file path for use in FFmpeg filter_complex.
 * Handles special characters that need escaping in filter strings.
 */
function escapeFilterPath(filePath: string): string {
  return (
    filePath
      // Escape backslashes first
      .replace(/\\/g, '\\\\\\\\')
      // Escape single quotes
      .replace(/'/g, "'\\''")
      // Escape colons (common in Windows paths)
      .replace(/:/g, '\\:')
  );
}

/**
 * Extract input file paths from input arguments.
 */
function extractInputFiles(inputArgs: string[]): string[] {
  const files: string[] = [];
  for (let i = 0; i < inputArgs.length; i++) {
    if (inputArgs[i] === '-i' && inputArgs[i + 1]) {
      files.push(inputArgs[i + 1]);
    }
  }
  return files;
}
