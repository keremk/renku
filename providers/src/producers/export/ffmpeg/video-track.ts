import type { VideoClipInfo } from './types.js';

/**
 * Video processing options.
 */
export interface VideoProcessingOptions {
  /** Output width in pixels */
  width: number;
  /** Output height in pixels */
  height: number;
  /** Frames per second */
  fps: number;
}

/**
 * Build an FFmpeg filter chain for a video clip.
 *
 * Handles two fit strategies:
 * - stretch: Adjust playback speed to match target duration
 * - freeze-fade: Play at original speed, freeze last frame, fade to black
 *
 * @param clip - Video clip information
 * @param options - Processing options
 * @param outputLabel - Label for the output stream
 * @returns FFmpeg filter expression string
 */
export function buildVideoFilterChain(
  clip: VideoClipInfo,
  options: VideoProcessingOptions,
  outputLabel: string
): string {
  const { width, height, fps } = options;
  const inputRef = `[${clip.inputIndex}:v]`;

  const filters: string[] = [];

  // Calculate speed factor if using stretch strategy
  if (clip.fitStrategy === 'stretch' && clip.originalDuration) {
    const speedFactor = clip.originalDuration / clip.targetDuration;

    // setpts changes video speed (lower = faster, higher = slower)
    // PTS/speed means: if speed > 1, video plays faster; if speed < 1, slower
    if (Math.abs(speedFactor - 1) > 0.01) {
      filters.push(`setpts=PTS/${speedFactor}`);
    }
  }

  // Scale to output dimensions while maintaining aspect ratio
  filters.push(buildScaleFilter(width, height));

  // Pad to exact dimensions with black bars if needed
  filters.push(buildPadFilter(width, height));

  // Set frame rate
  filters.push(`fps=${fps}`);

  // Reset timestamps
  filters.push('setpts=PTS-STARTPTS');

  // Format conversion for compatibility
  filters.push('format=yuv420p');

  return `${inputRef}${filters.join(',')}[${outputLabel}]`;
}

/**
 * Build a freeze-fade filter chain for a video clip.
 *
 * This is used when the video is shorter than the target duration.
 * It plays the video at original speed, then freezes the last frame
 * and fades to black.
 *
 * @param clip - Video clip information
 * @param options - Processing options
 * @param outputLabel - Label for the output stream
 * @returns FFmpeg filter expression string
 */
export function buildFreezeFadeFilterChain(
  clip: VideoClipInfo,
  options: VideoProcessingOptions,
  outputLabel: string
): string {
  const { width, height, fps } = options;
  const inputRef = `[${clip.inputIndex}:v]`;

  // Calculate durations
  const originalDuration = clip.originalDuration ?? clip.targetDuration;
  const freezeDuration = Math.max(0, clip.targetDuration - originalDuration);

  if (freezeDuration <= 0) {
    // Video is long enough, no freeze needed
    return buildVideoFilterChain(clip, options, outputLabel);
  }

  // Calculate fade duration (last 1 second of freeze or half of freeze if shorter)
  const fadeDuration = Math.min(1, freezeDuration / 2);
  const fadeStart = clip.targetDuration - fadeDuration;

  const filters: string[] = [];

  // Scale and pad first
  filters.push(buildScaleFilter(width, height));
  filters.push(buildPadFilter(width, height));
  filters.push(`fps=${fps}`);

  // Trim to original duration, then use tpad to extend with last frame
  filters.push(`trim=0:${originalDuration}`);
  filters.push(`tpad=stop_mode=clone:stop_duration=${freezeDuration}`);

  // Apply fade to black at the end
  filters.push(`fade=t=out:st=${fadeStart}:d=${fadeDuration}:color=black`);

  // Reset timestamps and format
  filters.push('setpts=PTS-STARTPTS');
  filters.push('format=yuv420p');

  return `${inputRef}${filters.join(',')}[${outputLabel}]`;
}

/**
 * Build the appropriate filter chain based on the fit strategy.
 *
 * @param clip - Video clip information
 * @param options - Processing options
 * @param outputLabel - Label for the output stream
 * @returns FFmpeg filter expression string
 */
export function buildVideoFilter(
  clip: VideoClipInfo,
  options: VideoProcessingOptions,
  outputLabel: string
): string {
  if (clip.fitStrategy === 'freeze-fade') {
    return buildFreezeFadeFilterChain(clip, options, outputLabel);
  }
  return buildVideoFilterChain(clip, options, outputLabel);
}

/**
 * Build a scale filter that maintains aspect ratio.
 *
 * Uses force_original_aspect_ratio=decrease to fit within bounds
 * while preserving the original aspect ratio.
 *
 * @param width - Target width
 * @param height - Target height
 * @returns FFmpeg scale filter string
 */
function buildScaleFilter(width: number, height: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease`;
}

/**
 * Build a pad filter to add black bars for letterboxing/pillarboxing.
 *
 * Centers the video within the target dimensions.
 *
 * @param width - Target width
 * @param height - Target height
 * @returns FFmpeg pad filter string
 */
function buildPadFilter(width: number, height: number): string {
  return `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
}

/**
 * Build input arguments for a video file.
 *
 * @param videoPath - Path to the video file
 * @returns Array of FFmpeg input arguments
 */
export function buildVideoInputArgs(videoPath: string): string[] {
  return ['-i', videoPath];
}

/**
 * Calculate the speed factor needed to fit a video into a target duration.
 *
 * @param originalDuration - Original video duration in seconds
 * @param targetDuration - Target duration in seconds
 * @returns Speed factor (> 1 = faster, < 1 = slower)
 */
export function calculateSpeedFactor(
  originalDuration: number,
  targetDuration: number
): number {
  if (targetDuration <= 0 || originalDuration <= 0) {
    return 1;
  }
  return originalDuration / targetDuration;
}

/**
 * Determine the best fit strategy based on duration difference.
 *
 * Uses the same logic as the timeline composer:
 * - If the difference is within 20%, use stretch
 * - Otherwise, use freeze-fade
 *
 * @param originalDuration - Original video duration in seconds
 * @param targetDuration - Target duration in seconds
 * @returns Recommended fit strategy
 */
export function determineFitStrategy(
  originalDuration: number,
  targetDuration: number
): 'stretch' | 'freeze-fade' {
  if (originalDuration <= 0 || targetDuration <= 0) {
    return 'stretch';
  }

  const ratio = originalDuration / targetDuration;
  const difference = Math.abs(ratio - 1);

  // If within 20% of target, stretching is acceptable
  if (difference <= 0.2) {
    return 'stretch';
  }

  return 'freeze-fade';
}

/**
 * Build an audio filter chain for video audio.
 *
 * Handles volume adjustment and speed changes to match video speed.
 *
 * @param clip - Video clip information
 * @param outputLabel - Label for the output stream
 * @returns FFmpeg filter expression string or null if no audio
 */
export function buildVideoAudioFilter(
  clip: VideoClipInfo,
  outputLabel: string
): string | null {
  if (clip.volume === 0) {
    return null; // No audio needed
  }

  const inputRef = `[${clip.inputIndex}:a]`;
  const filters: string[] = [];

  // Apply speed change if using stretch strategy
  if (clip.fitStrategy === 'stretch' && clip.originalDuration) {
    const speedFactor = clip.originalDuration / clip.targetDuration;

    if (Math.abs(speedFactor - 1) > 0.01) {
      // atempo only supports 0.5 to 2.0 range, chain for extreme values
      const tempoFilters = buildTempoFilters(speedFactor);
      filters.push(...tempoFilters);
    }
  }

  // Apply volume
  if (clip.volume !== undefined && clip.volume !== 1) {
    filters.push(`volume=${clip.volume}`);
  }

  // Trim to target duration
  filters.push(`atrim=0:${clip.targetDuration}`);

  // Reset timestamps
  filters.push('asetpts=PTS-STARTPTS');

  if (filters.length === 0) {
    return `${inputRef}anull[${outputLabel}]`;
  }

  return `${inputRef}${filters.join(',')}[${outputLabel}]`;
}

/**
 * Build atempo filters for speed changes.
 *
 * atempo filter only supports 0.5 to 2.0 range, so we need to chain
 * multiple filters for extreme speed changes.
 *
 * @param speedFactor - Target speed factor
 * @returns Array of atempo filter strings
 */
function buildTempoFilters(speedFactor: number): string[] {
  const filters: string[] = [];
  let remaining = speedFactor;

  // Chain atempo filters for values outside 0.5-2.0 range
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }

  // Final adjustment
  if (Math.abs(remaining - 1) > 0.01) {
    filters.push(`atempo=${remaining}`);
  }

  return filters;
}
