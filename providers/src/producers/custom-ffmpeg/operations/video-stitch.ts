import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  generateSimulatedDataForMimeType,
} from '../../../sdk/unified/simulated-media.js';
import { createProviderError, SdkErrorCode } from '../../../sdk/errors.js';
import type { ProducerInvokeArgs } from '../../../sdk/types.js';
import type { ProviderResult } from '../../../types.js';
import {
  ensureReadableFile,
  getFfmpegPath,
  getFfprobePath,
  getRequiredCanonicalInputId,
  probeVideoAsset,
  readInputBinding,
  readPositiveDuration,
  type VideoProbeResult,
  runCommand,
} from '../shared.js';
import type { CustomFfmpegConfig, CustomFfmpegOperation } from '../types.js';

interface FanInValue {
  groupBy: string;
  orderBy?: string;
  groups: string[][];
}

interface StitchedClip {
  artifactId: string;
  filePath: string;
  probe: VideoProbeResult;
}

const OUTPUT_MIME_TYPE = 'video/mp4';
const OUTPUT_FILE_NAME = 'stitched-video.mp4';
const STITCHED_OUTPUT_ARTIFACT_INDEX = 0;
const FPS_TOLERANCE = 0.01;

export const videoStitchOperation: CustomFfmpegOperation = {
  async invoke(args: ProducerInvokeArgs): Promise<ProviderResult> {
    const { request, runtime } = args;
    const extras = request.context.extras as Record<string, unknown> | undefined;
    const producerAlias = readProducerAlias(extras);
    if (!producerAlias) {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        'Video stitcher requires producerAlias in job context.',
        {
          kind: 'user_input',
          causedByUser: true,
        }
      );
    }

    const videoSegmentsInputId = getRequiredCanonicalInputId(
      producerAlias,
      'VideoSegments'
    );

    const resolvedInputs = runtime.inputs.all();
    const config = (runtime.config.raw ?? {}) as CustomFfmpegConfig;
    const outputArtifactId = request.produces[STITCHED_OUTPUT_ARTIFACT_INDEX];
    if (!outputArtifactId) {
      throw createProviderError(
        SdkErrorCode.UNKNOWN_ARTIFACT,
        'Video stitcher requires a declared stitched video artifact output.',
        {
          kind: 'user_input',
          causedByUser: true,
        }
      );
    }

    if (runtime.mode === 'simulated') {
      const boundDurationInputId = readInputBinding(extras, 'Duration');
      if (!boundDurationInputId) {
        throw createProviderError(
          SdkErrorCode.MISSING_DURATION,
          'Video stitcher requires an explicit canonical binding for Duration.',
          {
            kind: 'user_input',
            causedByUser: true,
          }
        );
      }
      const simulatedDurationSeconds = readPositiveDuration(
        resolvedInputs,
        boundDurationInputId
      );
      const buffer = await generateSimulatedDataForMimeType({
        mimeType: OUTPUT_MIME_TYPE,
        durationSeconds: simulatedDurationSeconds,
      });
      return {
        status: 'succeeded',
        artifacts: [
          {
            artifactId: runtime.artifacts.expectBlob(outputArtifactId),
            status: 'succeeded',
            blob: {
              data: buffer,
              mimeType: OUTPUT_MIME_TYPE,
            },
            diagnostics: {
              source: 'simulated',
              clipCount: flattenFanInGroups(
                readFanInValue(resolvedInputs, videoSegmentsInputId)
              ).length,
            },
          },
        ],
      };
    }

    const assetBlobPaths = readAssetBlobPaths(extras);
    const ffmpegPath = getFfmpegPath(config);
    const ffprobePath = getFfprobePath(ffmpegPath);
    const clipArtifactIds = flattenFanInGroups(
      readFanInValue(resolvedInputs, videoSegmentsInputId)
    );

    if (clipArtifactIds.length < 2) {
      throw createProviderError(
        SdkErrorCode.MISSING_SEGMENTS,
        `Video stitcher requires at least 2 clips in "${videoSegmentsInputId}".`,
        {
          kind: 'user_input',
          causedByUser: true,
          metadata: {
            canonicalInputId: videoSegmentsInputId,
            clipCount: clipArtifactIds.length,
          },
        }
      );
    }

    const storageRoot = resolveStorageRoot(resolvedInputs, assetBlobPaths);
    const stitchedClips = await Promise.all(
      clipArtifactIds.map(async (artifactId) => {
        const mappedPath = assetBlobPaths[artifactId];
        if (typeof mappedPath !== 'string' || mappedPath.trim().length === 0) {
          throw createProviderError(
            SdkErrorCode.MISSING_ASSET,
            `Video stitcher is missing assetBlobPaths entry for "${artifactId}".`,
            {
              kind: 'user_input',
              causedByUser: true,
              metadata: {
                artifactId,
              },
            }
          );
        }
        const filePath = path.isAbsolute(mappedPath)
          ? mappedPath
          : path.resolve(storageRoot, mappedPath);
        await ensureReadableFile(filePath);
        const probe = await probeVideoAsset({
          ffprobePath,
          filePath,
          signal: request.signal,
        });
        return {
          artifactId,
          filePath,
          probe,
        } satisfies StitchedClip;
      })
    );

    ensureCompatibleClipSet(stitchedClips);

    const tempDir = await mkdtemp(path.join(tmpdir(), 'renku-video-stitch-'));
    const outputPath = path.join(tempDir, OUTPUT_FILE_NAME);
    try {
      const commandArgs = buildVideoStitchArgs({
        clips: stitchedClips,
        config,
        outputPath,
      });
      await runCommand({
        command: ffmpegPath,
        commandArgs,
        signal: request.signal,
      });
      const outputBuffer = await readFile(outputPath);

      return {
        status: 'succeeded',
        artifacts: [
          {
            artifactId: runtime.artifacts.expectBlob(outputArtifactId),
            status: 'succeeded',
            blob: {
              data: outputBuffer,
              mimeType: OUTPUT_MIME_TYPE,
            },
            diagnostics: {
              operation: 'ffmpeg/video-stitch',
              clipArtifactIds,
              hasAudio: stitchedClips[0]?.probe.hasAudio ?? false,
              width: stitchedClips[0]?.probe.width,
              height: stitchedClips[0]?.probe.height,
              fps: stitchedClips[0]?.probe.fps,
            },
          },
        ],
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
};

function readProducerAlias(
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

function readAssetBlobPaths(
  extras: Record<string, unknown> | undefined
): Record<string, string> {
  if (!extras || typeof extras !== 'object') {
    throw createProviderError(
      SdkErrorCode.MISSING_ASSET,
      'Video stitcher requires asset blob paths in job context extras.',
      {
        kind: 'user_input',
        causedByUser: true,
      }
    );
  }
  const assetBlobPaths = extras.assetBlobPaths;
  if (
    !assetBlobPaths ||
    typeof assetBlobPaths !== 'object' ||
    Array.isArray(assetBlobPaths)
  ) {
    throw createProviderError(
      SdkErrorCode.MISSING_ASSET,
      'Video stitcher requires asset blob paths in job context extras.',
      {
        kind: 'user_input',
        causedByUser: true,
      }
    );
  }
  return assetBlobPaths as Record<string, string>;
}

function resolveStorageRoot(
  resolvedInputs: Record<string, unknown>,
  assetBlobPaths: Record<string, string>
): string {
  const hasRelativeAssetPath = Object.values(assetBlobPaths).some(
    (assetPath) => typeof assetPath === 'string' && !path.isAbsolute(assetPath)
  );
  if (!hasRelativeAssetPath) {
    return '';
  }

  const storageRoot = resolvedInputs['Input:StorageRoot'];
  if (typeof storageRoot === 'string' && storageRoot.trim().length > 0) {
    return storageRoot;
  }
  throw createProviderError(
    SdkErrorCode.MISSING_STORAGE_ROOT,
    'Video stitcher requires Input:StorageRoot when asset blob paths are relative.',
    {
      kind: 'user_input',
      causedByUser: true,
    }
  );
}

function readFanInValue(
  resolvedInputs: Record<string, unknown>,
  canonicalInputId: string
): FanInValue {
  const value = resolvedInputs[canonicalInputId];
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as FanInValue).groupBy === 'string' &&
    Array.isArray((value as FanInValue).groups)
  ) {
    return value as FanInValue;
  }
  throw createProviderError(
    SdkErrorCode.MISSING_FANIN_DATA,
    `Video stitcher requires fan-in data at "${canonicalInputId}".`,
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

export function flattenFanInGroups(fanIn: FanInValue): string[] {
  const flattened: string[] = [];
  for (const group of fanIn.groups) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (const member of group) {
      if (typeof member === 'string' && member.length > 0) {
        flattened.push(member);
      }
    }
  }
  return flattened;
}

export function ensureCompatibleClipSet(clips: StitchedClip[]): void {
  const [reference, ...rest] = clips;
  if (!reference) {
    return;
  }
  for (const clip of rest) {
    if (clip.probe.width !== reference.probe.width) {
      throw incompatibleClipError(clips, 'width');
    }
    if (clip.probe.height !== reference.probe.height) {
      throw incompatibleClipError(clips, 'height');
    }
    if (Math.abs(clip.probe.fps - reference.probe.fps) > FPS_TOLERANCE) {
      throw incompatibleClipError(clips, 'fps');
    }
    if (clip.probe.hasAudio !== reference.probe.hasAudio) {
      throw incompatibleClipError(clips, 'audio');
    }
  }
}

function incompatibleClipError(
  clips: StitchedClip[],
  field: 'width' | 'height' | 'fps' | 'audio'
) {
  return createProviderError(
    SdkErrorCode.INVALID_CONFIG,
    `Video stitcher requires all clips to share the same ${field}.`,
    {
      kind: 'user_input',
      causedByUser: true,
      metadata: {
        field,
        clips: clips.map((clip) => ({
          artifactId: clip.artifactId,
          width: clip.probe.width,
          height: clip.probe.height,
          fps: clip.probe.fps,
          hasAudio: clip.probe.hasAudio,
        })),
      },
    }
  );
}

function buildVideoStitchArgs(args: {
  clips: StitchedClip[];
  config: CustomFfmpegConfig;
  outputPath: string;
}): string[] {
  const { clips, config, outputPath } = args;
  const hasAudio = clips[0]?.probe.hasAudio ?? false;
  const videoLabels: string[] = [];
  const audioLabels: string[] = [];
  const filterParts: string[] = [];
  const commandArgs: string[] = [];

  for (const clip of clips) {
    commandArgs.push('-i', clip.filePath);
  }

  clips.forEach((clip, index) => {
    const videoLabel = `v${index}`;
    filterParts.push(
      `[${index}:v:0]fps=${clip.probe.fps},scale=${clip.probe.width}:${clip.probe.height},format=yuv420p[${videoLabel}]`
    );
    videoLabels.push(`[${videoLabel}]`);

    if (hasAudio) {
      const audioLabel = `a${index}`;
      filterParts.push(
        `[${index}:a:0]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[${audioLabel}]`
      );
      audioLabels.push(`[${audioLabel}]`);
    }
  });

  const concatInputs = hasAudio
    ? videoLabels.flatMap((videoLabel, index) => [videoLabel, audioLabels[index]!])
    : videoLabels;
  filterParts.push(
    `${concatInputs.join('')}concat=n=${clips.length}:v=1:a=${hasAudio ? 1 : 0}[outv]${hasAudio ? '[outa]' : ''}`
  );

  commandArgs.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[outv]',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    config.preset ?? 'medium',
    '-crf',
    String(config.crf ?? 23)
  );

  if (hasAudio) {
    commandArgs.push(
      '-map',
      '[outa]',
      '-c:a',
      'aac',
      '-b:a',
      config.audioBitrate ?? '192k'
    );
  } else {
    commandArgs.push('-an');
  }

  commandArgs.push('-movflags', '+faststart', '-y', outputPath);
  return commandArgs;
}

export const __test__ = {
  flattenFanInGroups,
  ensureCompatibleClipSet,
};
