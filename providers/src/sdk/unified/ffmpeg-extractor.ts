import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProducedArtefact } from '@gorenku/core';
import type { ProviderMode } from '../../types.js';
import { generateMockPng } from './png-generator.js';
import { generateWavWithDuration } from './wav-generator.js';

/**
 * Known derived artifact names that can be extracted from video.
 */
const DERIVED_ARTIFACT_NAMES = {
  FIRST_FRAME: 'FirstFrame',
  LAST_FRAME: 'LastFrame',
  AUDIO_TRACK: 'AudioTrack',
} as const;

export interface FfmpegExtractionOptions {
  /** The downloaded video buffer */
  videoBuffer: Buffer;
  /** The artifact ID of the primary video artifact */
  primaryArtifactId: string;
  /** All artifact IDs this job produces */
  produces: string[];
  /** Provider mode (live or simulated) */
  mode?: ProviderMode;
  /** Duration for mock audio in simulated mode (seconds) */
  mockDurationSeconds?: number;
}

export interface RequiredExtractions {
  /** Artifact ID for first frame, or null if not needed */
  firstFrameId: string | null;
  /** Artifact ID for last frame, or null if not needed */
  lastFrameId: string | null;
  /** Artifact ID for audio track, or null if not needed */
  audioTrackId: string | null;
}

export interface ExtractionResult {
  firstFrame?: ProducedArtefact;
  lastFrame?: ProducedArtefact;
  audioTrack?: ProducedArtefact;
}

// Cache for ffmpeg availability check
let ffmpegAvailabilityCache: boolean | null = null;
let ffmpegWarningLogged = false;

/**
 * Check if ffmpeg is available on the system.
 * Result is cached for the lifetime of the process.
 */
export async function checkFfmpegAvailability(): Promise<boolean> {
  if (ffmpegAvailabilityCache !== null) {
    return ffmpegAvailabilityCache;
  }

  try {
    await runFfmpegCommand(['-version']);
    ffmpegAvailabilityCache = true;
  } catch {
    ffmpegAvailabilityCache = false;
  }

  return ffmpegAvailabilityCache;
}

/**
 * Log a warning about missing ffmpeg (only once per process).
 */
function logFfmpegMissingWarning(): void {
  if (ffmpegWarningLogged) {
    return;
  }
  ffmpegWarningLogged = true;
  console.warn(
    'Warning: ffmpeg not found. FirstFrame, LastFrame, and AudioTrack extraction ' +
      'will be skipped. Install ffmpeg to enable video artifact extraction. ' +
      'See: https://ffmpeg.org/download.html',
  );
}

/**
 * Detect which derived artifacts need to be extracted based on the produces array.
 * Returns artifact IDs for each extraction type, or null if not needed.
 */
export function detectRequiredExtractions(produces: string[]): RequiredExtractions {
  const result: RequiredExtractions = {
    firstFrameId: null,
    lastFrameId: null,
    audioTrackId: null,
  };

  for (const artifactId of produces) {
    const baseName = extractArtifactBaseName(artifactId);

    if (baseName === DERIVED_ARTIFACT_NAMES.FIRST_FRAME) {
      result.firstFrameId = artifactId;
    } else if (baseName === DERIVED_ARTIFACT_NAMES.LAST_FRAME) {
      result.lastFrameId = artifactId;
    } else if (baseName === DERIVED_ARTIFACT_NAMES.AUDIO_TRACK) {
      result.audioTrackId = artifactId;
    }
  }

  return result;
}

/**
 * Extract the base artifact name from a canonical artifact ID.
 * Example: "Artifact:TextToVideoProducer.GeneratedVideo" -> "GeneratedVideo"
 * Example: "Artifact:FirstFrame[0]" -> "FirstFrame"
 */
function extractArtifactBaseName(artifactId: string): string {
  // Remove "Artifact:" prefix if present
  const withoutPrefix = artifactId.startsWith('Artifact:') ? artifactId.slice('Artifact:'.length) : artifactId;

  // Remove any bracket indices
  const withoutBrackets = withoutPrefix.replace(/\[[^\]]+\]/g, '');

  // Get the last segment after dots
  const segments = withoutBrackets.split('.');
  return segments[segments.length - 1] || withoutBrackets;
}

/**
 * Check if any extractions are needed.
 */
export function needsExtraction(extractions: RequiredExtractions): boolean {
  return extractions.firstFrameId !== null || extractions.lastFrameId !== null || extractions.audioTrackId !== null;
}

/**
 * Extract derived artifacts from a video buffer.
 * In simulated mode, generates mock data instead of calling ffmpeg.
 */
export async function extractDerivedArtefacts(options: FfmpegExtractionOptions): Promise<ExtractionResult> {
  const { videoBuffer, produces, mode, mockDurationSeconds = 5 } = options;
  const extractions = detectRequiredExtractions(produces);
  const result: ExtractionResult = {};

  // In simulated mode, generate mock data
  if (mode === 'simulated') {
    return generateMockExtractionResult(extractions, mockDurationSeconds);
  }

  // Check ffmpeg availability
  const ffmpegAvailable = await checkFfmpegAvailability();
  if (!ffmpegAvailable) {
    logFfmpegMissingWarning();
    return generateSkippedExtractionResult(extractions, 'ffmpeg_not_available');
  }

  // Create temp directory and write video to temp file
  const tempDir = join(tmpdir(), `renku-ffmpeg-${randomUUID()}`);
  const tempVideoPath = join(tempDir, 'input.mp4');

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(tempVideoPath, videoBuffer);

    // Extract each requested artifact
    if (extractions.firstFrameId) {
      result.firstFrame = await extractFirstFrame(tempVideoPath, extractions.firstFrameId);
    }

    if (extractions.lastFrameId) {
      result.lastFrame = await extractLastFrame(tempVideoPath, extractions.lastFrameId);
    }

    if (extractions.audioTrackId) {
      result.audioTrack = await extractAudioTrack(tempVideoPath, extractions.audioTrackId);
    }
  } finally {
    // Clean up temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  return result;
}

/**
 * Generate mock extraction results for simulated mode.
 */
function generateMockExtractionResult(extractions: RequiredExtractions, durationSeconds: number): ExtractionResult {
  const result: ExtractionResult = {};

  if (extractions.firstFrameId) {
    result.firstFrame = {
      artefactId: extractions.firstFrameId,
      status: 'succeeded',
      blob: {
        data: generateMockPng(),
        mimeType: 'image/png',
      },
      diagnostics: {
        source: 'simulated',
        extraction: 'first_frame',
      },
    };
  }

  if (extractions.lastFrameId) {
    result.lastFrame = {
      artefactId: extractions.lastFrameId,
      status: 'succeeded',
      blob: {
        data: generateMockPng(),
        mimeType: 'image/png',
      },
      diagnostics: {
        source: 'simulated',
        extraction: 'last_frame',
      },
    };
  }

  if (extractions.audioTrackId) {
    result.audioTrack = {
      artefactId: extractions.audioTrackId,
      status: 'succeeded',
      blob: {
        data: generateWavWithDuration(durationSeconds),
        mimeType: 'audio/wav',
      },
      diagnostics: {
        source: 'simulated',
        extraction: 'audio_track',
        durationSeconds,
      },
    };
  }

  return result;
}

/**
 * Generate skipped extraction results when ffmpeg is not available.
 */
function generateSkippedExtractionResult(extractions: RequiredExtractions, reason: string): ExtractionResult {
  const result: ExtractionResult = {};

  if (extractions.firstFrameId) {
    result.firstFrame = {
      artefactId: extractions.firstFrameId,
      status: 'skipped',
      diagnostics: {
        reason,
        extraction: 'first_frame',
      },
    };
  }

  if (extractions.lastFrameId) {
    result.lastFrame = {
      artefactId: extractions.lastFrameId,
      status: 'skipped',
      diagnostics: {
        reason,
        extraction: 'last_frame',
      },
    };
  }

  if (extractions.audioTrackId) {
    result.audioTrack = {
      artefactId: extractions.audioTrackId,
      status: 'skipped',
      diagnostics: {
        reason,
        extraction: 'audio_track',
      },
    };
  }

  return result;
}

/**
 * Extract the first frame from a video file.
 */
async function extractFirstFrame(videoPath: string, artifactId: string): Promise<ProducedArtefact> {
  try {
    const buffer = await runFfmpegCommand([
      '-i',
      videoPath,
      '-vframes',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      '-',
    ]);

    return {
      artefactId: artifactId,
      status: 'succeeded',
      blob: {
        data: buffer,
        mimeType: 'image/png',
      },
      diagnostics: {
        extraction: 'first_frame',
        size: buffer.length,
      },
    };
  } catch (error) {
    return {
      artefactId: artifactId,
      status: 'failed',
      diagnostics: {
        extraction: 'first_frame',
        reason: 'extraction_failed',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Extract the last frame from a video file.
 * Uses -sseof to seek from the end of the file.
 */
async function extractLastFrame(videoPath: string, artifactId: string): Promise<ProducedArtefact> {
  try {
    const buffer = await runFfmpegCommand([
      '-sseof',
      '-0.1', // Seek to 0.1 seconds before end
      '-i',
      videoPath,
      '-vframes',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      '-',
    ]);

    return {
      artefactId: artifactId,
      status: 'succeeded',
      blob: {
        data: buffer,
        mimeType: 'image/png',
      },
      diagnostics: {
        extraction: 'last_frame',
        size: buffer.length,
      },
    };
  } catch (error) {
    return {
      artefactId: artifactId,
      status: 'failed',
      diagnostics: {
        extraction: 'last_frame',
        reason: 'extraction_failed',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Extract the audio track from a video file.
 */
async function extractAudioTrack(videoPath: string, artifactId: string): Promise<ProducedArtefact> {
  try {
    const buffer = await runFfmpegCommand([
      '-i',
      videoPath,
      '-vn', // No video
      '-acodec',
      'pcm_s16le', // 16-bit PCM
      '-f',
      'wav',
      '-',
    ]);

    return {
      artefactId: artifactId,
      status: 'succeeded',
      blob: {
        data: buffer,
        mimeType: 'audio/wav',
      },
      diagnostics: {
        extraction: 'audio_track',
        size: buffer.length,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if the error is due to missing audio stream
    if (errorMessage.includes('does not contain any audio')) {
      return {
        artefactId: artifactId,
        status: 'skipped',
        diagnostics: {
          extraction: 'audio_track',
          reason: 'no_audio_stream',
        },
      };
    }

    return {
      artefactId: artifactId,
      status: 'failed',
      diagnostics: {
        extraction: 'audio_track',
        reason: 'extraction_failed',
        error: errorMessage,
      },
    };
  }
}

/**
 * Run an ffmpeg command and return the stdout as a Buffer.
 */
function runFfmpegCommand(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];

    const ffmpeg = spawn('ffmpeg', args);

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      errorChunks.push(chunk);
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const stderr = Buffer.concat(errorChunks).toString('utf8');
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });

    ffmpeg.on('error', (error) => {
      reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
    });
  });
}

/**
 * Reset the ffmpeg availability cache.
 * Mainly useful for testing.
 */
export function resetFfmpegCache(): void {
  ffmpegAvailabilityCache = null;
  ffmpegWarningLogged = false;
}
