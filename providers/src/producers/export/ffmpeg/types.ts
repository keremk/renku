import type { KenBurnsEffect } from '@gorenku/compositions';

/**
 * Configuration for the FFmpeg exporter producer.
 */
export interface FfmpegExporterConfig {
  /** Root folder for storage (can also come from Input:StorageRoot) */
  rootFolder?: string;
  /** Output video width in pixels (default: 1920) */
  width?: number;
  /** Output video height in pixels (default: 1080) */
  height?: number;
  /** Frames per second (default: 30) */
  fps?: number;
  /** x264 encoding preset: ultrafast, fast, medium, slow (default: medium) */
  preset?: string;
  /** Constant Rate Factor for quality, 0-51 (default: 23) */
  crf?: number;
  /** Audio bitrate, e.g., "192k" (default: 192k) */
  audioBitrate?: string;
  /** Custom FFmpeg binary path (default: "ffmpeg" from PATH) */
  ffmpegPath?: string;
}

/**
 * Output format detection result.
 */
export type OutputFormat = 'video' | 'audio';

/**
 * Represents a complete FFmpeg command ready for execution.
 */
export interface FfmpegCommand {
  /** FFmpeg binary path */
  ffmpegPath: string;
  /** Command-line arguments */
  args: string[];
  /** List of input files in order */
  inputFiles: string[];
  /** Output file path */
  outputPath: string;
  /** Output MIME type */
  mimeType: string;
}

/**
 * Options for building an FFmpeg command.
 */
export interface FfmpegBuildOptions {
  /** Output video width */
  width: number;
  /** Output video height */
  height: number;
  /** Frames per second */
  fps: number;
  /** x264 encoding preset */
  preset: string;
  /** Constant Rate Factor for quality */
  crf: number;
  /** Audio bitrate */
  audioBitrate: string;
  /** Output file path */
  outputPath: string;
  /** FFmpeg binary path */
  ffmpegPath: string;
}

/**
 * Mapping of asset IDs to their resolved file paths.
 */
export interface AssetPathMap {
  [assetId: string]: string;
}

/**
 * Information about a processed audio track for mixing.
 */
export interface AudioTrackInfo {
  /** FFmpeg input stream index (0-based) */
  inputIndex: number;
  /** Volume level (0.0 to 1.0) */
  volume: number;
  /** Start time in seconds */
  startTime: number;
  /** Duration in seconds */
  duration: number;
  /** Fade in duration in seconds (optional) */
  fadeInDuration?: number;
  /** Fade out duration in seconds (optional) */
  fadeOutDuration?: number;
  /** Whether to loop the audio */
  loop?: boolean;
}

/**
 * Information about a processed video clip.
 */
export interface VideoClipInfo {
  /** FFmpeg input stream index (0-based) */
  inputIndex: number;
  /** Start time in seconds */
  startTime: number;
  /** Target duration in seconds */
  targetDuration: number;
  /** Original duration of the video */
  originalDuration?: number;
  /** Fit strategy: stretch or freeze-fade */
  fitStrategy: 'stretch' | 'freeze-fade';
  /** Volume level for video audio (0.0 to 1.0) */
  volume?: number;
}

/**
 * Information about a processed image with KenBurns effect.
 */
export interface ImageEffectInfo {
  /** FFmpeg input stream index (0-based) */
  inputIndex: number;
  /** KenBurns effect parameters */
  effect: KenBurnsEffect;
  /** Duration in seconds */
  duration: number;
  /** Start time in the output (seconds) */
  startTime: number;
}

/**
 * Caption entry for rendering.
 */
export interface CaptionEntry {
  /** Caption text */
  text: string;
  /** Start time in seconds */
  startTime: number;
  /** End time in seconds */
  endTime: number;
}

/**
 * Result of processing a single track type.
 */
export interface TrackProcessingResult {
  /** FFmpeg filter expression for this track */
  filterExpr: string;
  /** Output stream label (e.g., "[v0]", "[a0]") */
  outputLabel: string;
}

/**
 * Default configuration values.
 */
export const FFMPEG_DEFAULTS = {
  width: 1920,
  height: 1080,
  fps: 30,
  preset: 'medium',
  crf: 23,
  audioBitrate: '192k',
  ffmpegPath: 'ffmpeg',
} as const;
