import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveExistingBlobPath } from '../../shared/stream-utils.js';
import { readLatestArtifactEvent } from '../artifact-edit-handler.js';
import { readTempPreview } from './temp-preview-store.js';
import type {
  ArtifactPreviewEstimateRequest,
  ArtifactPreviewGenerateRequest,
  GenerationCostEstimate,
  PreviewGenerationResult,
} from './contracts.js';

const FFMPEG_TIMEOUT_MS = 120_000;
const FFPROBE_TIMEOUT_MS = 30_000;

const LOCAL_CLIP_COST_ESTIMATE: GenerationCostEstimate = {
  cost: 0,
  minCost: 0,
  maxCost: 0,
  isPlaceholder: false,
  note: 'Local ffmpeg clip trim (no provider cost).',
};

export async function estimateClipPreview(
  body: ArtifactPreviewEstimateRequest
): Promise<GenerationCostEstimate> {
  const source = await loadSourceMediaContext(body);
  assertClipRangeWithinDuration(body, source.durationSeconds);
  return LOCAL_CLIP_COST_ESTIMATE;
}

export async function generateClipPreview(
  body: ArtifactPreviewGenerateRequest
): Promise<PreviewGenerationResult> {
  const source = await loadSourceMediaContext(body);
  assertClipRangeWithinDuration(body, source.durationSeconds);

  const clipParams = body.clipParams;
  if (!clipParams) {
    throw new Error('Clip preview mode requires clipParams.');
  }

  const tempDir = path.join(tmpdir(), `renku-clip-preview-${randomUUID()}`);
  const outputPath = path.join(
    tempDir,
    source.mediaKind === 'video' ? 'preview.mp4' : 'preview.mp3'
  );

  await fs.mkdir(tempDir, { recursive: true });

  try {
    if (source.mediaKind === 'video') {
      await runCommand(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-ss',
          toFfmpegTimestamp(clipParams.startTimeSeconds),
          '-to',
          toFfmpegTimestamp(clipParams.endTimeSeconds),
          '-i',
          source.filePath,
          '-map',
          '0',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          outputPath,
        ],
        FFMPEG_TIMEOUT_MS
      );
    } else {
      await runCommand(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-ss',
          toFfmpegTimestamp(clipParams.startTimeSeconds),
          '-to',
          toFfmpegTimestamp(clipParams.endTimeSeconds),
          '-i',
          source.filePath,
          '-map',
          '0:a:0',
          '-vn',
          '-c:a',
          'libmp3lame',
          '-b:a',
          '192k',
          outputPath,
        ],
        FFMPEG_TIMEOUT_MS
      );
    }

    const previewData = await fs.readFile(outputPath);

    return {
      previewData,
      mimeType: source.mediaKind === 'video' ? 'video/mp4' : 'audio/mpeg',
      estimatedCost: LOCAL_CLIP_COST_ESTIMATE,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function loadSourceMediaContext(
  body: ArtifactPreviewGenerateRequest | ArtifactPreviewEstimateRequest
): Promise<{
  filePath: string;
  durationSeconds: number;
  mediaKind: 'video' | 'audio';
}> {
  if (body.sourceTempId) {
    const temp = await readTempPreview(
      body.blueprintFolder,
      body.movieId,
      body.sourceTempId
    );

    if (temp.metadata.artifactId !== body.artifactId) {
      throw new Error(
        `Preview ${body.sourceTempId} does not belong to artifact ${body.artifactId}.`
      );
    }
    if (
      !temp.metadata.mimeType.startsWith('video/') &&
      !temp.metadata.mimeType.startsWith('audio/')
    ) {
      throw new Error(
        `Clip preview source ${body.sourceTempId} must be audio or video (${temp.metadata.mimeType}).`
      );
    }

    const durationSeconds = await probeMediaDurationSeconds(temp.filePath);
    return {
      filePath: temp.filePath,
      durationSeconds,
      mediaKind: temp.metadata.mimeType.startsWith('video/')
        ? 'video'
        : 'audio',
    };
  }

  const latestEvent = await readLatestArtifactEvent(
    body.blueprintFolder,
    body.movieId,
    body.artifactId
  );

  const blob = latestEvent?.output.blob;
  if (!blob?.hash || !blob.mimeType) {
    throw new Error(
      `Artifact ${body.artifactId} has no succeeded blob output in the event log.`
    );
  }
  if (
    !blob.mimeType.startsWith('video/') &&
    !blob.mimeType.startsWith('audio/')
  ) {
    throw new Error(
      `Clip preview requires an audio or video artifact, got ${blob.mimeType}.`
    );
  }

  const buildsRoot = path.join(body.blueprintFolder, 'builds');
  const filePath = await resolveExistingBlobPath(
    buildsRoot,
    body.movieId,
    blob.hash,
    blob.mimeType
  );

  const durationSeconds = await probeMediaDurationSeconds(filePath);

  return {
    filePath,
    durationSeconds,
    mediaKind: blob.mimeType.startsWith('video/') ? 'video' : 'audio',
  };
}

function assertClipRangeWithinDuration(
  body: ArtifactPreviewGenerateRequest | ArtifactPreviewEstimateRequest,
  durationSeconds: number
): void {
  if (!body.clipParams) {
    throw new Error('Clip preview mode requires clipParams.');
  }

  const { startTimeSeconds, endTimeSeconds } = body.clipParams;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Source media duration is invalid for clip preview.');
  }

  if (startTimeSeconds >= durationSeconds) {
    throw new Error(
      `Clip start time ${startTimeSeconds} exceeds source duration ${durationSeconds}.`
    );
  }

  if (endTimeSeconds > durationSeconds) {
    throw new Error(
      `Clip end time ${endTimeSeconds} exceeds source duration ${durationSeconds}.`
    );
  }
}

async function probeMediaDurationSeconds(filePath: string): Promise<number> {
  const stdout = await runCommand(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    FFPROBE_TIMEOUT_MS
  );

  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(
      `Could not parse media duration from ffprobe output: ${stdout.trim()}`
    );
  }

  return duration;
}

function toFfmpegTimestamp(seconds: number): string {
  return seconds.toFixed(6);
}

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `${command} timed out after ${timeoutMs}ms for args: ${args.join(' ')}`
        )
      );
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn ${command}: ${error.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${code}. stderr: ${stderr.trim()}`
        )
      );
    });
  });
}
