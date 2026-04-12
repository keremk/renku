import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createProviderError, SdkErrorCode } from '../errors.js';

type AudioContainer = 'mp3' | 'wav';

/**
 * Generates a tiny valid audio file with the requested duration.
 * Used by simulated provider mode so audio dry-runs produce real media bytes
 * that downstream duration readers can parse.
 */
export async function generateAudioWithDuration(args: {
  durationSeconds: number;
  mimeType: string;
}): Promise<Buffer> {
  const duration = Math.max(0.1, args.durationSeconds);
  const container = resolveAudioContainer(args.mimeType);

  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const ffmpeg = spawn('ffmpeg', [
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=stereo',
      '-t',
      String(duration),
      '-vn',
      ...(container === 'mp3'
        ? ['-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3']
        : ['-c:a', 'pcm_s16le', '-f', 'wav']),
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
          `Simulated audio generation failed: ffmpeg exited with code ${code}: ${stderr}`,
          {
            kind: 'unknown',
            metadata: {
              mimeType: args.mimeType,
              durationSeconds: args.durationSeconds,
            },
          }
        )
      );
    });

    ffmpeg.on('error', (error) => {
      reject(
        createProviderError(
          SdkErrorCode.FFMPEG_NOT_FOUND,
          `Simulated audio generation could not start ffmpeg: ${error.message}`,
          {
            kind: 'unknown',
            metadata: {
              mimeType: args.mimeType,
              durationSeconds: args.durationSeconds,
            },
            raw: error,
          }
        )
      );
    });
  });
}

function resolveAudioContainer(mimeType: string): AudioContainer {
  switch (mimeType) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    default:
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Unsupported simulated audio mime type "${mimeType}". Expected audio/mpeg, audio/mp3, audio/wav, or audio/x-wav.`,
        {
          kind: 'user_input',
          causedByUser: true,
          metadata: { mimeType },
        }
      );
  }
}
