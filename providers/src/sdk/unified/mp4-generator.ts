import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createProviderError, SdkErrorCode } from '../errors.js';

/**
 * Generates a tiny valid MP4 with the requested duration.
 * Used by simulated provider mode so video dry-runs exercise the same
 * duration-reading path as live media.
 */
export async function generateMp4WithDuration(durationSeconds: number): Promise<Buffer> {
  const duration = Math.max(0.1, durationSeconds);

  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const ffmpeg = spawn('ffmpeg', [
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=16x16:r=1:d=${duration}`,
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'ultrafast',
      '-movflags',
      'frag_keyframe+empty_moov',
      '-f',
      'mp4',
      'pipe:1',
    ]);

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
        return;
      }

      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      reject(
        createProviderError(
          SdkErrorCode.RENDER_FAILED,
          `Simulated video generation failed: ffmpeg exited with code ${code}: ${stderr}`,
          {
            kind: 'unknown',
            metadata: { durationSeconds },
          }
        )
      );
    });

    ffmpeg.on('error', (error) => {
      reject(
        createProviderError(
          SdkErrorCode.FFMPEG_NOT_FOUND,
          `Simulated video generation could not start ffmpeg: ${error.message}`,
          {
            kind: 'unknown',
            metadata: { durationSeconds },
            raw: error,
          }
        )
      );
    });
  });
}
