import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AudioSegment } from './types.js';

/**
 * Concatenate audio segments with silence gaps to create a single audio file
 * that matches the video timeline.
 *
 * This function:
 * 1. Creates a silent base track for the total duration
 * 2. Overlays each audio segment at its timeline position
 * 3. Returns a WAV buffer with the combined audio
 */
export async function concatenateWithSilence(
  segments: AudioSegment[],
  totalDuration: number
): Promise<Buffer> {
  if (segments.length === 0) {
    // Return empty/silent audio
    return generateSilence(totalDuration);
  }

  // If only one segment and it starts at 0, just return it with format conversion
  if (segments.length === 1 && segments[0].startTime === 0) {
    return convertToWav(segments[0].buffer);
  }

  const tempDir = join(tmpdir(), `renku-transcription-${randomUUID()}`);

  try {
    await mkdir(tempDir, { recursive: true });

    // Write each segment to a temp file
    const segmentFiles: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const segmentPath = join(tempDir, `segment-${i}.mp3`);
      await writeFile(segmentPath, segments[i].buffer);
      segmentFiles.push(segmentPath);
    }

    // Build the ffmpeg command to mix all segments
    const args = buildMixCommand(segmentFiles, segments, totalDuration, tempDir);
    const outputPath = join(tempDir, 'output.wav');

    await runFfmpegCommand(args);

    // Read the output file
    const outputBuffer = await readFile(outputPath);
    return Buffer.from(outputBuffer);
  } finally {
    // Clean up temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Build ffmpeg command to mix audio segments with silence.
 *
 * Strategy:
 * 1. Generate a silent audio track for the total duration
 * 2. For each segment, delay it to its startTime position
 * 3. Mix all delayed segments together
 */
export function buildMixCommand(
  segmentFiles: string[],
  segments: AudioSegment[],
  totalDuration: number,
  tempDir: string
): string[] {
  const outputPath = join(tempDir, 'output.wav');

  // Build input arguments
  const inputArgs: string[] = [];

  // First input: silence track with duration specified in the source
  // Note: duration (d) must be specified in the lavfi source, not with -t option
  // because -t would apply to the next input in the command
  inputArgs.push(
    '-f', 'lavfi',
    '-i', `anullsrc=r=16000:cl=mono:d=${totalDuration}`
  );

  // Add each segment file as input
  for (const file of segmentFiles) {
    inputArgs.push('-i', file);
  }

  // Build filter complex
  // Each segment gets delayed to its start position, then all are mixed
  const filterParts: string[] = [];
  const mixInputs: string[] = ['[silence]'];

  // Silence base (input 0)
  filterParts.push('[0]aformat=sample_rates=16000:channel_layouts=mono[silence]');

  // Delay each segment
  for (let i = 0; i < segments.length; i++) {
    const inputIndex = i + 1; // +1 because input 0 is silence
    const delayMs = Math.round(segments[i].startTime * 1000);
    filterParts.push(
      `[${inputIndex}]aformat=sample_rates=16000:channel_layouts=mono,adelay=${delayMs}|${delayMs}[delayed${i}]`
    );
    mixInputs.push(`[delayed${i}]`);
  }

  // Mix all inputs together
  const mixFilter = `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0[out]`;
  filterParts.push(mixFilter);

  const filterComplex = filterParts.join(';');

  return [
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-acodec', 'pcm_s16le',
    '-f', 'wav',
    '-y',
    outputPath,
  ];
}

/**
 * Generate silent WAV audio for a given duration.
 * Exported for testing.
 */
export async function generateSilence(durationSeconds: number): Promise<Buffer> {
  const tempDir = join(tmpdir(), `renku-silence-${randomUUID()}`);

  try {
    await mkdir(tempDir, { recursive: true });
    const outputPath = join(tempDir, 'silence.wav');

    const args = [
      '-f', 'lavfi',
      '-i', `anullsrc=r=16000:cl=mono:d=${durationSeconds}`,
      '-acodec', 'pcm_s16le',
      '-f', 'wav',
      '-y',
      outputPath,
    ];

    await runFfmpegCommand(args);
    const buffer = await readFile(outputPath);
    return Buffer.from(buffer);
  } finally {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Convert audio buffer to WAV format.
 * Exported for testing.
 */
export async function convertToWav(inputBuffer: Buffer): Promise<Buffer> {
  const tempDir = join(tmpdir(), `renku-convert-${randomUUID()}`);

  try {
    await mkdir(tempDir, { recursive: true });
    const inputPath = join(tempDir, 'input.mp3');
    const outputPath = join(tempDir, 'output.wav');

    await writeFile(inputPath, inputBuffer);

    const args = [
      '-i', inputPath,
      '-af', 'aformat=sample_rates=16000:channel_layouts=mono',
      '-acodec', 'pcm_s16le',
      '-f', 'wav',
      '-y',
      outputPath,
    ];

    await runFfmpegCommand(args);
    const buffer = await readFile(outputPath);
    return Buffer.from(buffer);
  } finally {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Run an ffmpeg command.
 */
function runFfmpegCommand(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const errorChunks: Buffer[] = [];

    const ffmpeg = spawn('ffmpeg', args);

    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      errorChunks.push(chunk);
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
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
