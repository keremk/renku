import type { AudioTrackInfo } from './types.js';

/**
 * Options for building an audio mix filter.
 */
export interface AudioMixOptions {
  /** Total duration of the output in seconds */
  totalDuration: number;
  /** Whether to normalize the final output (default: false) */
  normalize?: boolean;
}

/**
 * Build an FFmpeg filter expression for mixing multiple audio tracks.
 *
 * This handles:
 * - Positioning audio clips with delays (adelay)
 * - Volume adjustment per clip
 * - Fade in/out effects (afade)
 * - Audio looping for music tracks
 * - Mixing all tracks together (amix)
 *
 * @param tracks - Array of audio track information
 * @param options - Mixing options
 * @returns Object with filter expression and output label
 */
export function buildAudioMixFilter(
  tracks: AudioTrackInfo[],
  options: AudioMixOptions
): { filterExpr: string; outputLabel: string } {
  if (tracks.length === 0) {
    // No audio tracks - generate silence
    return buildSilenceFilter(options.totalDuration);
  }

  const filterParts: string[] = [];
  const trackLabels: string[] = [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]!;
    const label = `aud${i}`;
    const filterChain = buildSingleAudioFilter(track, i, label);
    filterParts.push(filterChain);
    trackLabels.push(`[${label}]`);
  }

  // Mix all audio tracks together
  const normalize = options.normalize ? '1' : '0';
  const mixFilter = `${trackLabels.join('')}amix=inputs=${tracks.length}:duration=longest:normalize=${normalize}[aout]`;
  filterParts.push(mixFilter);

  return {
    filterExpr: filterParts.join(';'),
    outputLabel: 'aout',
  };
}

/**
 * Build a filter chain for a single audio track.
 *
 * @param track - Audio track information
 * @param trackIndex - Index used for labeling
 * @param outputLabel - Label for the output stream
 * @returns FFmpeg filter expression string
 */
function buildSingleAudioFilter(
  track: AudioTrackInfo,
  trackIndex: number,
  outputLabel: string
): string {
  const filters: string[] = [];
  const inputRef = `[${track.inputIndex}:a]`;

  // Trim audio to scheduled duration
  if (track.loop) {
    // Looped tracks: loop infinitely then trim to duration
    filters.push(`aloop=loop=-1:size=2e+09`);
    filters.push(`atrim=0:${track.duration}`);
  } else {
    // Non-looped tracks: trim to scheduled duration
    // This ensures clips play for exactly their scheduled time, even if the
    // source file is longer (e.g., music clips reusing the same file to fill timeline)
    filters.push(`atrim=0:${track.duration}`);
  }

  // Apply delay to position the audio in the timeline
  if (track.startTime > 0) {
    const delayMs = Math.round(track.startTime * 1000);
    // adelay format: delay_left|delay_right (in milliseconds)
    filters.push(`adelay=${delayMs}|${delayMs}`);
  }

  // Apply volume adjustment
  if (track.volume !== undefined && track.volume !== 1) {
    filters.push(`volume=${track.volume}`);
  }

  // Apply fade in
  if (track.fadeInDuration && track.fadeInDuration > 0) {
    filters.push(`afade=t=in:st=${track.startTime}:d=${track.fadeInDuration}`);
  }

  // Apply fade out
  if (track.fadeOutDuration && track.fadeOutDuration > 0) {
    const fadeOutStart = track.startTime + track.duration - track.fadeOutDuration;
    filters.push(`afade=t=out:st=${fadeOutStart}:d=${track.fadeOutDuration}`);
  }

  // Reset timestamps
  filters.push('asetpts=PTS-STARTPTS');

  // Build the complete filter chain
  if (filters.length === 0) {
    return `${inputRef}anull[${outputLabel}]`;
  }

  return `${inputRef}${filters.join(',')}[${outputLabel}]`;
}

/**
 * Build a filter that generates silence.
 *
 * Used when there are no audio tracks.
 *
 * @param duration - Duration of silence in seconds
 * @returns Object with filter expression and output label
 */
function buildSilenceFilter(duration: number): { filterExpr: string; outputLabel: string } {
  // anullsrc generates silence with the specified parameters
  // We use standard CD quality: 44100 Hz, stereo
  return {
    filterExpr: `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${duration}[aout]`,
    outputLabel: 'aout',
  };
}

/**
 * Build input arguments for an audio file.
 *
 * @param audioPath - Path to the audio file
 * @returns Array of FFmpeg input arguments
 */
export function buildAudioInputArgs(audioPath: string): string[] {
  return ['-i', audioPath];
}

/**
 * Build input arguments for a looped audio file (music).
 *
 * For music that needs to loop to fill the duration, we use stream_loop.
 *
 * @param audioPath - Path to the audio file
 * @param loops - Number of times to loop (-1 for infinite, but we'll trim)
 * @returns Array of FFmpeg input arguments
 */
export function buildLoopedAudioInputArgs(audioPath: string, loops: number = -1): string[] {
  return ['-stream_loop', String(loops), '-i', audioPath];
}

/**
 * Calculate the number of loops needed for a music track.
 *
 * @param musicDuration - Duration of the music file in seconds
 * @param targetDuration - Target duration to fill
 * @returns Number of loops needed
 */
export function calculateLoopsNeeded(musicDuration: number, targetDuration: number): number {
  if (musicDuration <= 0) {
    return 0;
  }
  return Math.ceil(targetDuration / musicDuration);
}
