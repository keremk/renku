import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createProviderError, SdkErrorCode } from '../../sdk/errors.js';
import type { CustomFfmpegConfig } from './types.js';

const execFileAsync = promisify(execFile);
const COMMAND_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

export interface VideoProbeResult {
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export function readProducerAlias(
  extras: Record<string, unknown> | undefined
): string | undefined {
  if (!extras || typeof extras !== 'object') {
    return undefined;
  }
  const jobContext = extras.jobContext;
  if (!jobContext || typeof jobContext !== 'object') {
    return undefined;
  }
  const producerAlias = (jobContext as Record<string, unknown>).producerAlias;
  return typeof producerAlias === 'string' ? producerAlias : undefined;
}

export function readInputBinding(
  extras: Record<string, unknown> | undefined,
  inputName: string
): string | undefined {
  if (!extras || typeof extras !== 'object') {
    return undefined;
  }
  const jobContext = extras.jobContext;
  if (!jobContext || typeof jobContext !== 'object') {
    return undefined;
  }
  const inputBindings = (jobContext as Record<string, unknown>).inputBindings;
  if (
    !inputBindings ||
    typeof inputBindings !== 'object' ||
    Array.isArray(inputBindings)
  ) {
    return undefined;
  }
  const binding = (inputBindings as Record<string, unknown>)[inputName];
  return typeof binding === 'string' ? binding : undefined;
}

export function getRequiredCanonicalInputId(
  producerAlias: string,
  inputName: string
): string {
  return `Input:${producerAlias}.${inputName}`;
}

export function readPositiveDuration(
  resolvedInputs: Record<string, unknown>,
  canonicalInputId: string
): number {
  const value = resolvedInputs[canonicalInputId];
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  throw createProviderError(
    SdkErrorCode.MISSING_DURATION,
    `Custom FFmpeg producer requires a positive numeric Duration at "${canonicalInputId}".`,
    {
      kind: 'user_input',
      causedByUser: true,
      metadata: {
        canonicalInputId,
        value,
      },
    }
  );
}

export function getFfmpegPath(config: CustomFfmpegConfig): string {
  return config.ffmpegPath ?? 'ffmpeg';
}

export function getFfprobePath(ffmpegPath: string): string {
  const parsed = path.parse(ffmpegPath);
  const normalizedBase = parsed.base.toLowerCase();
  if (normalizedBase === 'ffmpeg' || normalizedBase === 'ffmpeg.exe') {
    return path.join(parsed.dir, `${parsed.name.replace(/ffmpeg/i, 'ffprobe')}${parsed.ext}`);
  }
  return 'ffprobe';
}

export async function runCommand(args: {
  command: string;
  commandArgs: string[];
  signal?: AbortSignal;
}): Promise<{ stdout: string; stderr: string }> {
  const { command, commandArgs, signal } = args;
  try {
    return await execFileAsync(command, commandArgs, {
      encoding: 'utf8',
      maxBuffer: COMMAND_MAX_BUFFER_BYTES,
      signal,
    });
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };
    if (commandError.code === 'ENOENT') {
      throw createProviderError(
        SdkErrorCode.FFMPEG_NOT_FOUND,
        `Command "${command}" was not found. Install FFmpeg/FFprobe or configure ffmpegPath explicitly.`,
        {
          kind: 'user_input',
          causedByUser: true,
          metadata: {
            command,
          },
        }
      );
    }
    const stderr = commandError.stderr?.trim();
    throw createProviderError(
      SdkErrorCode.RENDER_FAILED,
      stderr && stderr.length > 0
        ? stderr
        : `Command "${command}" failed.`,
      {
        kind: 'unknown',
        metadata: {
          command,
          commandArgs,
          stdout: commandError.stdout,
          stderr: commandError.stderr,
        },
        raw: error,
      }
    );
  }
}

export async function ensureReadableFile(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch (error) {
    throw createProviderError(
      SdkErrorCode.MISSING_ASSET,
      `Expected readable asset file at "${filePath}".`,
      {
        kind: 'user_input',
        causedByUser: true,
        metadata: {
          filePath,
        },
        raw: error,
      }
    );
  }
}

export async function probeVideoAsset(args: {
  ffprobePath: string;
  filePath: string;
  signal?: AbortSignal;
}): Promise<VideoProbeResult> {
  const { stdout } = await runCommand({
    command: args.ffprobePath,
    commandArgs: [
      '-v',
      'error',
      '-show_streams',
      '-of',
      'json',
      args.filePath,
    ],
    signal: args.signal,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `FFprobe returned invalid JSON for "${args.filePath}".`,
      {
        kind: 'unknown',
        metadata: {
          filePath: args.filePath,
          stdout,
        },
        raw: error,
      }
    );
  }

  const streams =
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { streams?: unknown[] }).streams)
      ? (parsed as { streams: Array<Record<string, unknown>> }).streams
      : [];
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  if (!videoStream) {
    throw createProviderError(
      SdkErrorCode.MISSING_ASSET,
      `Video asset "${args.filePath}" does not contain a video stream.`,
      {
        kind: 'user_input',
        causedByUser: true,
        metadata: {
          filePath: args.filePath,
        },
      }
    );
  }

  const width = asPositiveInteger(videoStream.width, 'width', args.filePath);
  const height = asPositiveInteger(videoStream.height, 'height', args.filePath);
  const fps = parseFps(
    videoStream.avg_frame_rate ?? videoStream.r_frame_rate,
    args.filePath
  );
  const hasAudio = streams.some((stream) => stream.codec_type === 'audio');

  return {
    width,
    height,
    fps,
    hasAudio,
  };
}

function asPositiveInteger(
  value: unknown,
  field: string,
  filePath: string
): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw createProviderError(
    SdkErrorCode.INVALID_CONFIG,
    `FFprobe did not report a positive integer ${field} for "${filePath}".`,
    {
      kind: 'unknown',
      metadata: {
        filePath,
        field,
        value,
      },
    }
  );
}

function parseFps(value: unknown, filePath: string): number {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `FFprobe did not report a frame rate for "${filePath}".`,
      {
        kind: 'unknown',
        metadata: {
          filePath,
          value,
        },
      }
    );
  }
  const [numeratorRaw, denominatorRaw] = value.split('/');
  const numerator = Number(numeratorRaw);
  const denominator =
    denominatorRaw === undefined ? 1 : Number(denominatorRaw);
  const fps = numerator / denominator;
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0 ||
    !Number.isFinite(fps) ||
    fps <= 0
  ) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `FFprobe reported an invalid frame rate "${value}" for "${filePath}".`,
      {
        kind: 'unknown',
        metadata: {
          filePath,
          value,
        },
      }
    );
  }
  return fps;
}
