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
import { buildImageFilterChain, buildImageInputArgs } from './kenburns-filter.js';
import { buildAudioMixFilter, buildAudioInputArgs, buildLoopedAudioInputArgs } from './audio-mixer.js';
import { buildVideoFilter, buildVideoInputArgs, determineFitStrategy } from './video-track.js';
import { buildCaptionFilterChain, parseCaptionsFromArray } from './caption-renderer.js';

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

/**
 * Build a complete FFmpeg command from a timeline.
 *
 * @param timeline - The timeline document to render
 * @param assetPaths - Mapping of asset IDs to file paths
 * @param options - Build options
 * @returns Complete FFmpeg command ready for execution
 */
export function buildFfmpegCommand(
  timeline: TimelineDocument,
  assetPaths: AssetPathMap,
  options: Partial<FfmpegBuildOptions>
): FfmpegCommand {
  const fullOptions = resolveOptions(options);
  const outputFormat = detectOutputFormat(timeline);

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
      processImageTrack(track, assetPaths, fullOptions, tracker, filterParts, videoLabels);
    } else if (isAudioTrack(track)) {
      processAudioTrack(track, assetPaths, tracker, audioInfos);
    } else if (isMusicTrack(track)) {
      processMusicTrack(track, assetPaths, timeline.duration, tracker, audioInfos);
    } else if (isVideoTrack(track)) {
      processVideoTrack(track, assetPaths, fullOptions, tracker, filterParts, videoLabels, audioInfos);
    }
    // Captions are processed after video concatenation
  }

  // Build video concatenation if we have visual elements
  let videoOutputLabel = '';
  if (videoLabels.length > 0) {
    const concatFilter = buildVideoConcat(videoLabels, timeline.duration, fullOptions);
    filterParts.push(concatFilter.filter);
    videoOutputLabel = concatFilter.outputLabel;

    // Process captions (overlay on concatenated video)
    const captionsTrack = timeline.tracks.find((t): t is CaptionsTrack => t.kind === 'Captions');
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
  }

  // Build audio mix
  const audioResult = buildAudioMixFilter(audioInfos, { totalDuration: timeline.duration });
  if (audioInfos.length > 0) {
    filterParts.push(audioResult.filterExpr);
  }

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
function resolveOptions(options: Partial<FfmpegBuildOptions>): FfmpegBuildOptions {
  return {
    width: options.width ?? FFMPEG_DEFAULTS.width,
    height: options.height ?? FFMPEG_DEFAULTS.height,
    fps: options.fps ?? FFMPEG_DEFAULTS.fps,
    preset: options.preset ?? FFMPEG_DEFAULTS.preset,
    crf: options.crf ?? FFMPEG_DEFAULTS.crf,
    audioBitrate: options.audioBitrate ?? FFMPEG_DEFAULTS.audioBitrate,
    outputPath: options.outputPath ?? 'output.mp4',
    ffmpegPath: options.ffmpegPath ?? FFMPEG_DEFAULTS.ffmpegPath,
  };
}

/**
 * Process an image track.
 */
function processImageTrack(
  track: ImageTrack,
  assetPaths: AssetPathMap,
  options: FfmpegBuildOptions,
  tracker: InputTracker,
  filterParts: string[],
  videoLabels: string[]
): void {
  for (const clip of track.clips) {
    processImageClip(clip, assetPaths, options, tracker, filterParts, videoLabels);
  }
}

/**
 * Process a single image clip with its KenBurns effects.
 */
function processImageClip(
  clip: ImageClip,
  assetPaths: AssetPathMap,
  options: FfmpegBuildOptions,
  tracker: InputTracker,
  filterParts: string[],
  videoLabels: string[]
): void {
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
    tracker.inputArgs.push(...buildImageInputArgs(assetPath, durationPerEffect));
    tracker.assetToIndex.set(effect.assetId, inputIndex);

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
  const duration = clip.properties.duration === 'full' ? totalDuration : clip.duration;

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
function processVideoTrack(
  track: VideoTrack,
  assetPaths: AssetPathMap,
  options: FfmpegBuildOptions,
  tracker: InputTracker,
  filterParts: string[],
  videoLabels: string[],
  audioInfos: AudioTrackInfo[]
): void {
  for (const clip of track.clips) {
    processVideoClip(clip, assetPaths, options, tracker, filterParts, videoLabels, audioInfos);
  }
}

/**
 * Process a single video clip.
 */
function processVideoClip(
  clip: VideoClip,
  assetPaths: AssetPathMap,
  options: FfmpegBuildOptions,
  tracker: InputTracker,
  filterParts: string[],
  videoLabels: string[],
  audioInfos: AudioTrackInfo[]
): void {
  const assetPath = assetPaths[clip.properties.assetId];
  if (!assetPath) {
    return;
  }

  const inputIndex = tracker.nextIndex++;
  tracker.inputArgs.push(...buildVideoInputArgs(assetPath));
  tracker.assetToIndex.set(clip.properties.assetId, inputIndex);

  // Determine fit strategy
  const fitStrategy = clip.properties.fitStrategy === 'stretch' || clip.properties.fitStrategy === 'freeze-fade'
    ? clip.properties.fitStrategy
    : determineFitStrategy(clip.properties.originalDuration ?? clip.duration, clip.duration);

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

  // Handle video audio if volume > 0
  if (clipInfo.volume !== 0) {
    audioInfos.push({
      inputIndex,
      volume: clipInfo.volume ?? 1,
      startTime: clip.startTime,
      duration: clip.duration,
    });
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
  const args: string[] = ['-y']; // Overwrite output

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
      '-c:v', 'libx264',
      '-preset', options.preset,
      '-crf', String(options.crf),
      '-c:a', 'aac',
      '-b:a', options.audioBitrate
    );
  } else {
    // Audio only (MP3)
    args.push(
      '-c:a', 'libmp3lame',
      '-b:a', options.audioBitrate
    );
  }

  // Output path
  const outputPath = outputFormat === 'video'
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
