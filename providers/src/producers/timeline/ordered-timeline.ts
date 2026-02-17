import { Buffer } from 'node:buffer';
import { isCanonicalInputId } from '@gorenku/core';
import {
  Input,
  ALL_FORMATS,
  BufferSource as MediaBufferSource,
} from 'mediabunny';
import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import { createProviderError, SdkErrorCode } from '../../sdk/errors.js';
import { canonicalizeAuthoredInputId } from '../../sdk/config-utils.js';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import type { ResolvedInputsAccessor } from '../../sdk/types.js';

interface FanInValue {
  groupBy: string;
  orderBy?: string;
  groups: string[][];
}

/**
 * Context for master track expansion. Maps groups to segments when groups have multiple items.
 */
interface MasterTrackContext {
  /** For each segment index, which group index it belongs to */
  segmentToGroup: number[];
  /** For each group index, the segment indices it expanded into */
  groupToSegments: Map<number, number[]>;
  /** Original number of groups */
  groupCount: number;
  /** Duration of each expanded segment */
  segmentDurations: number[];
  /** Start time offset of each expanded segment */
  segmentOffsets: number[];
  /** Total timeline duration */
  totalDuration: number;
  /** The canonical input ID of the primary master track that drives expansion */
  primaryMasterInputId: string;
}

type ClipKind =
  | 'Image'
  | 'Audio'
  | 'Music'
  | 'Video'
  | 'Captions'
  | 'Transcription';

interface TimelineClipConfig {
  kind: ClipKind;
  inputs: string;
  effect?: string;
  duration?: string;
  play?: string;
  partitionBy?: number;
  captionAlgorithm?: string;
  volume?: number;
}

interface TimelineProducerConfig {
  numTracks?: number;
  masterTracks?: ClipKind[];
  clips: TimelineClipConfig[];
  tracks?: ClipKind[];
}

interface TimelineTrack {
  id: string;
  kind: ClipKind;
  clips: TimelineClip[];
}

interface TimelineClip {
  id: string;
  kind: ClipKind;
  startTime: number;
  duration: number;
  properties: Record<string, unknown>;
}

interface TimelineDocument {
  id: string;
  movieId?: string;
  movieTitle?: string;
  duration: number;
  assetFolder?: {
    source?: string;
    rootPath?: string;
  };
  tracks: TimelineTrack[];
}

interface KenBurnsPreset {
  style: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startScale: number;
  endScale: number;
}

const DEFAULT_EFFECT = 'KenBurns';

const KEN_BURNS_PRESETS: KenBurnsPreset[] = [
  {
    style: 'cinematicPushInCenter',
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    startScale: 1.04,
    endScale: 1.16,
  },
  {
    style: 'cinematicPanLeftToRight',
    startX: -56,
    startY: 0,
    endX: 56,
    endY: 0,
    startScale: 1.08,
    endScale: 1.2,
  },
  {
    style: 'cinematicPanRightToLeft',
    startX: 56,
    startY: 0,
    endX: -56,
    endY: 0,
    startScale: 1.08,
    endScale: 1.2,
  },
  {
    style: 'cinematicPanTopToBottom',
    startX: 0,
    startY: -34,
    endX: 0,
    endY: 34,
    startScale: 1.07,
    endScale: 1.18,
  },
  {
    style: 'cinematicPanBottomToTop',
    startX: 0,
    startY: 34,
    endX: 0,
    endY: -34,
    startScale: 1.07,
    endScale: 1.18,
  },
  {
    style: 'cinematicPullOutCenter',
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    startScale: 1.18,
    endScale: 1.06,
  },
];

const KEN_BURNS_SEQUENCE_PRESETS: readonly number[][] = [
  [1, 0, 2],
  [3, 0, 4],
  [2, 0, 1],
  [4, 0, 3],
  [0, 1, 5],
  [0, 2, 5],
];

const TRACK_KINDS_WITH_NATIVE_DURATION = new Set<ClipKind>([
  'Audio',
  'Music',
  'Video',
]);
const SIMULATED_OUTPUT_PREFIX = 'simulated-output:';

function canonicalizeClips(
  config: TimelineProducerConfig,
  availableInputs: string[],
  allowedKinds: Set<ClipKind>
): TimelineClipConfig[] {
  const filtered = config.clips.filter((clip) => allowedKinds.has(clip.kind));
  if (filtered.length === 0) {
    return [];
  }
  return filtered.map((clip) => ({
    ...clip,
    inputs: canonicalizeAuthoredInputId(
      parseInputReference(clip.inputs),
      availableInputs
    ),
  }));
}

function resolveAllowedTracks(config: TimelineProducerConfig): Set<ClipKind> {
  if (config.tracks && config.tracks.length > 0) {
    return new Set(config.tracks);
  }
  throw createProviderError(
    SdkErrorCode.INVALID_CONFIG,
    'TimelineProducer requires tracks to be specified.',
    { kind: 'user_input', causedByUser: true }
  );
}

/**
 * Finds the primary master clip (first master track with fan-in data).
 */
function findPrimaryMasterClip(
  clips: TimelineClipConfig[],
  masterKinds: ClipKind[],
  fanInByInput: Map<string, FanInValue>
): { clip: TimelineClipConfig; fanIn: FanInValue } | undefined {
  for (const masterKind of masterKinds) {
    const candidates = clips.filter((clip) => clip.kind === masterKind);
    for (const candidate of candidates) {
      const fanIn = fanInByInput.get(candidate.inputs);
      if (fanIn && fanIn.groups.length > 0) {
        return { clip: candidate, fanIn };
      }
    }
  }
  return undefined;
}

/**
 * Builds MasterTrackContext by expanding groups with multiple items into segments.
 * Each item in a group becomes its own segment while preserving group membership info.
 */
async function buildMasterTrackContext(args: {
  clips: TimelineClipConfig[];
  fanInByInput: Map<string, FanInValue>;
  masterKinds: ClipKind[];
  inputs: ResolvedInputsAccessor;
  durationCache: Map<string, number>;
}): Promise<MasterTrackContext> {
  const { clips, fanInByInput, masterKinds, inputs, durationCache } = args;

  const primaryMaster = findPrimaryMasterClip(clips, masterKinds, fanInByInput);
  if (!primaryMaster) {
    throw createProviderError(
      SdkErrorCode.MISSING_SEGMENTS,
      'TimelineProducer requires at least one master track with fan-in data.',
      { kind: 'user_input', causedByUser: true }
    );
  }

  const { clip: primaryClip, fanIn: primaryFanIn } = primaryMaster;
  const primaryMasterInputId = primaryClip.inputs;
  const groupCount = primaryFanIn.groups.length;
  const primaryGroups = filterExistingAssets(
    normalizeGroups(primaryFanIn.groups, groupCount),
    inputs
  ).map((group) => [...group].sort());
  const expandedSegmentCount = primaryGroups.reduce(
    (sum, group) => sum + Math.max(1, group.length),
    0
  );

  // Build segment-to-group and group-to-segments mappings
  const segmentToGroup: number[] = [];
  const groupToSegments = new Map<number, number[]>();
  const segmentDurations: number[] = [];

  // Pre-compute master clips by kind for duration fallback
  const masterClipsByKind = new Map<
    ClipKind,
    { clip: TimelineClipConfig; fanIn: FanInValue }[]
  >();
  for (const masterKind of masterKinds) {
    const candidates = clips.filter((c) => c.kind === masterKind);
    const clipsWithFanIn: { clip: TimelineClipConfig; fanIn: FanInValue }[] =
      [];
    for (const candidate of candidates) {
      const fanIn = fanInByInput.get(candidate.inputs);
      if (fanIn) {
        clipsWithFanIn.push({ clip: candidate, fanIn });
      }
    }
    if (clipsWithFanIn.length > 0) {
      masterClipsByKind.set(masterKind, clipsWithFanIn);
    }
  }

  const resolvedInputs = inputs.all();

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const groupAssets = primaryGroups[groupIndex] ?? [];

    const segmentIndices: number[] = [];

    if (groupAssets.length === 0) {
      // Empty group still creates one segment (for backward compatibility and non-master tracks)
      const segmentIndex = segmentToGroup.length;
      segmentToGroup.push(groupIndex);
      segmentIndices.push(segmentIndex);

      // Determine duration using fallback chain
      const duration = await determineDurationForSegment({
        groupIndex,
        masterClipsByKind,
        masterKinds,
        groupCount,
        expandedSegmentCount,
        inputs,
        durationCache,
        resolvedInputs,
      });
      segmentDurations.push(duration);
    } else {
      // Each item in the group becomes a segment
      for (const assetId of groupAssets) {
        const segmentIndex = segmentToGroup.length;
        segmentToGroup.push(groupIndex);
        segmentIndices.push(segmentIndex);

        // Get duration from this specific asset
        let duration: number | undefined;

        // For master tracks with native duration, use the asset's actual duration
        if (TRACK_KINDS_WITH_NATIVE_DURATION.has(primaryClip.kind)) {
          duration = await tryLoadAssetDuration({
            assetId,
            inputs,
            cache: durationCache,
          });
        }

        // Fallback chain if no native duration
        if (duration === undefined) {
          duration = await determineDurationForSegment({
            groupIndex,
            masterClipsByKind,
            masterKinds,
            groupCount,
            expandedSegmentCount,
            inputs,
            durationCache,
            resolvedInputs,
          });
        }

        segmentDurations.push(duration);
      }
    }

    groupToSegments.set(groupIndex, segmentIndices);
  }

  const segmentOffsets = buildSegmentOffsets(segmentDurations);
  const totalDuration = roundSeconds(
    segmentDurations.reduce((sum, d) => sum + d, 0)
  );

  return {
    segmentToGroup,
    groupToSegments,
    groupCount,
    segmentDurations,
    segmentOffsets,
    totalDuration,
    primaryMasterInputId,
  };
}

/**
 * Determines the duration for a segment using the master track fallback chain.
 */
async function determineDurationForSegment(args: {
  groupIndex: number;
  masterClipsByKind: Map<
    ClipKind,
    { clip: TimelineClipConfig; fanIn: FanInValue }[]
  >;
  masterKinds: ClipKind[];
  groupCount: number;
  expandedSegmentCount: number;
  inputs: ResolvedInputsAccessor;
  durationCache: Map<string, number>;
  resolvedInputs: Record<string, unknown>;
}): Promise<number> {
  const {
    groupIndex,
    masterClipsByKind,
    masterKinds,
    groupCount,
    expandedSegmentCount,
    inputs,
    durationCache,
    resolvedInputs,
  } = args;

  // Try each master track kind in priority order
  for (const masterKind of masterKinds) {
    if (!TRACK_KINDS_WITH_NATIVE_DURATION.has(masterKind)) {
      continue;
    }
    const clipsForKind = masterClipsByKind.get(masterKind);
    if (!clipsForKind) {
      continue;
    }
    for (const { fanIn } of clipsForKind) {
      const groups = normalizeGroups(fanIn.groups, groupCount);
      const assetId = groups[groupIndex]?.[0];
      if (assetId) {
        const assetDuration = await tryLoadAssetDuration({
          assetId,
          inputs,
          cache: durationCache,
        });
        if (assetDuration !== undefined) {
          return assetDuration;
        }
      }
    }
  }

  // Fallback: use SegmentDuration input
  const segmentDuration = readOptionalPositiveNumber(resolvedInputs, [
    'Input:SegmentDuration',
    'SegmentDuration',
  ]);
  if (segmentDuration !== undefined) {
    return segmentDuration;
  }

  // Final fallback: divide total Duration equally
  const totalDuration = readTimelineDuration(resolvedInputs);
  return roundSeconds(totalDuration / expandedSegmentCount);
}

export function createTimelineProducerHandler(): HandlerFactory {
  return createProducerHandlerFactory({
    domain: 'media',
    configValidator: parseTimelineConfig,
    invoke: async ({ request, runtime }) => {
      const notifier = (
        type: 'progress' | 'success' | 'error',
        message: string
      ) => {
        runtime.notifications?.publish({
          type,
          message,
          timestamp: new Date().toISOString(),
        });
      };
      notifier('progress', `Building timeline for job ${request.jobId}`);
      const baseConfig =
        runtime.config.parse<TimelineProducerConfig>(parseTimelineConfig);
      const overrides = readConfigOverrides(runtime.inputs, request);
      const config = mergeConfig(baseConfig, overrides);
      const allowedKinds = resolveAllowedTracks(config);
      const masterTracks = config.masterTracks ?? [];
      if (masterTracks.length === 0) {
        throw createProviderError(
          SdkErrorCode.INVALID_CONFIG,
          'TimelineProducer requires masterTracks to be specified.',
          { kind: 'user_input', causedByUser: true }
        );
      }
      for (const masterKind of masterTracks) {
        if (!allowedKinds.has(masterKind)) {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            `Master track kind "${masterKind}" is not included in configured tracks.`,
            { kind: 'user_input', causedByUser: true }
          );
        }
      }
      const canonicalInputs = request.inputs.filter((input) =>
        isCanonicalInputId(input)
      );
      const clips = canonicalizeClips(config, canonicalInputs, allowedKinds);
      if (clips.length === 0) {
        throw createProviderError(
          SdkErrorCode.INVALID_CONFIG,
          'TimelineProducer config must define at least one clip.',
          { kind: 'user_input', causedByUser: true }
        );
      }

      const resolvedInputs = runtime.inputs.all();
      const assetDurationCache = new Map<string, number>();
      const fanInByInput = new Map<string, FanInValue>();

      for (const clip of clips) {
        if (fanInByInput.has(clip.inputs)) {
          continue;
        }
        const fanIn = readFanInForInput(runtime.inputs, clip.inputs);
        if (fanIn) {
          fanInByInput.set(clip.inputs, fanIn);
        }
      }

      // Build master track context with group-to-segment expansion
      const masterContext = await buildMasterTrackContext({
        clips,
        fanInByInput,
        masterKinds: masterTracks,
        inputs: runtime.inputs,
        durationCache: assetDurationCache,
      });

      const tracks: TimelineTrack[] = await Promise.all(
        clips.map(async (clip, index) => {
          const fanIn = fanInByInput.get(clip.inputs);
          if (!fanIn) {
            throw createProviderError(
              SdkErrorCode.MISSING_FANIN_DATA,
              `Missing fan-in data for "${clip.inputs}".`,
              { kind: 'user_input', causedByUser: true }
            );
          }
          return buildTrack({
            clip,
            fanIn,
            trackIndex: index,
            masterContext,
            inputs: runtime.inputs,
            durationCache: assetDurationCache,
          });
        })
      );

      const timeline: TimelineDocument = {
        id: `timeline-${request.revision}`,
        movieId: readOptionalString(resolvedInputs, ['MovieId', 'movieId']),
        movieTitle: readOptionalString(resolvedInputs, [
          'MovieTitle',
          'ScriptGenerator.MovieTitle',
        ]),
        duration: masterContext.totalDuration,
        assetFolder: buildAssetFolder(runtime.inputs),
        tracks,
      };

      const artefactId = runtime.artefacts.expectBlob(
        request.produces[0] ?? ''
      );
      const timelinePayload = JSON.stringify(timeline, null, 2);
      const result = {
        status: 'succeeded' as const,
        artefacts: [
          {
            artefactId,
            status: 'succeeded' as const,
            blob: {
              data: timelinePayload,
              mimeType: 'application/json',
            },
          },
        ],
      };
      notifier('success', `Timeline built for job ${request.jobId}`);
      return result;
    },
  });
}

export const createTimelineStubHandler = createTimelineProducerHandler;

function parseTimelineConfig(raw: unknown): TimelineProducerConfig {
  if (!isRecord(raw)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'TimelineProducer provider configuration must include a config object.',
      { kind: 'user_input', causedByUser: true }
    );
  }
  const outer = isRecord(raw.config)
    ? (raw.config as Record<string, unknown>)
    : (raw as Record<string, unknown>);
  if (!isRecord(outer.timeline)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'TimelineProducer config must include a "timeline" object.',
      { kind: 'user_input', causedByUser: true }
    );
  }
  const source = outer.timeline as Record<string, unknown>;
  const tracks = Array.isArray(source.tracks)
    ? source.tracks
        .map((entry) =>
          typeof entry === 'string' ? (entry as ClipKind) : undefined
        )
        .filter((entry): entry is ClipKind => Boolean(entry))
    : undefined;
  const clipsRaw = Array.isArray(source.clips) ? source.clips : [];
  const explicitClips: TimelineClipConfig[] = clipsRaw
    .map((entry) => (isRecord(entry) ? entry : undefined))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      kind: typeof entry.kind === 'string' ? (entry.kind as ClipKind) : 'Image',
      inputs: typeof entry.inputs === 'string' ? entry.inputs : '',
      effect: typeof entry.effect === 'string' ? entry.effect : undefined,
      duration: typeof entry.duration === 'string' ? entry.duration : undefined,
      play: typeof entry.play === 'string' ? entry.play : undefined,
      partitionBy:
        typeof entry.partitionBy === 'number' ? entry.partitionBy : undefined,
      captionAlgorithm:
        typeof entry.captionAlgorithm === 'string'
          ? entry.captionAlgorithm
          : undefined,
      volume: typeof entry.volume === 'number' ? entry.volume : undefined,
    }))
    .filter((clip) => clip.inputs.length > 0);

  const derivedClips = buildClipsFromShorthand(source);
  const clips = explicitClips.length > 0 ? explicitClips : derivedClips;

  const masterTracks = Array.isArray(source.masterTracks)
    ? source.masterTracks
        .map((entry) =>
          typeof entry === 'string' ? (entry as ClipKind) : undefined
        )
        .filter((entry): entry is ClipKind => Boolean(entry))
    : undefined;

  return {
    numTracks:
      typeof source.numTracks === 'number' ? source.numTracks : undefined,
    masterTracks,
    clips,
    tracks,
  };
}

function buildClipsFromShorthand(
  source: Record<string, unknown>
): TimelineClipConfig[] {
  const clips: TimelineClipConfig[] = [];
  const imageClip = isRecord(source.imageClip)
    ? (source.imageClip as Record<string, unknown>)
    : undefined;
  const videoClip = isRecord(source.videoClip)
    ? (source.videoClip as Record<string, unknown>)
    : undefined;
  const audioClip = isRecord(source.audioClip)
    ? (source.audioClip as Record<string, unknown>)
    : undefined;
  const musicClip = isRecord(source.musicClip)
    ? (source.musicClip as Record<string, unknown>)
    : undefined;
  const transcriptionClip = isRecord(source.transcriptionClip)
    ? (source.transcriptionClip as Record<string, unknown>)
    : undefined;

  if (imageClip?.artifact && typeof imageClip.artifact === 'string') {
    clips.push({
      kind: 'Image',
      inputs: imageClip.artifact,
      effect:
        typeof imageClip.effect === 'string' ? imageClip.effect : undefined,
    });
  }
  if (videoClip?.artifact && typeof videoClip.artifact === 'string') {
    clips.push({
      kind: 'Video',
      inputs: videoClip.artifact,
      volume:
        typeof videoClip.volume === 'number' ? videoClip.volume : undefined,
    });
  }
  if (audioClip?.artifact && typeof audioClip.artifact === 'string') {
    clips.push({
      kind: 'Audio',
      inputs: audioClip.artifact,
      volume:
        typeof audioClip.volume === 'number' ? audioClip.volume : undefined,
    });
  }
  if (musicClip?.artifact && typeof musicClip.artifact === 'string') {
    clips.push({
      kind: 'Music',
      inputs: musicClip.artifact,
      play:
        typeof musicClip.play === 'string'
          ? musicClip.play
          : (musicClip.playStrategy as string | undefined),
      volume:
        typeof musicClip.volume === 'number' ? musicClip.volume : undefined,
    });
  }
  if (
    transcriptionClip?.artifact &&
    typeof transcriptionClip.artifact === 'string'
  ) {
    clips.push({
      kind: 'Transcription',
      inputs: transcriptionClip.artifact,
    });
  }
  return clips;
}

function readConfigOverrides(
  inputs: ResolvedInputsAccessor,
  request: ProviderJobContext
): Record<string, unknown> {
  const qualifiedProducer = readProducerAlias(request);
  if (!qualifiedProducer) {
    return {};
  }
  const prefix = `Input:${qualifiedProducer}.`;
  const overrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs.all())) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const path = key.slice(prefix.length);
    assignPath(overrides, path, value);
  }
  return overrides;
}

function readProducerAlias(request: ProviderJobContext): string | undefined {
  const extras = request.context.extras;
  if (!extras || typeof extras !== 'object') {
    return undefined;
  }
  const jobContext = (extras as Record<string, unknown>).jobContext;
  if (!jobContext || typeof jobContext !== 'object') {
    return undefined;
  }
  const producerAlias = (jobContext as Record<string, unknown>).producerAlias;
  return typeof producerAlias === 'string' ? producerAlias : undefined;
}

function assignPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const segments = path.split('.').filter((segment) => segment.length > 0);
  let cursor: Record<string, unknown> = target;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }
    if (!isRecord(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  });
}

function mergeConfig(
  base: TimelineProducerConfig,
  overrides: Record<string, unknown>
): TimelineProducerConfig {
  const result: Record<string, unknown> = { ...base };
  const apply = (
    source: Record<string, unknown>,
    target: Record<string, unknown>
  ) => {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!isRecord(target[key])) {
          target[key] = {};
        }
        apply(
          value as Record<string, unknown>,
          target[key] as Record<string, unknown>
        );
      } else {
        target[key] = value;
      }
    }
  };
  apply(overrides, result);
  return {
    clips: base.clips,
    numTracks:
      typeof result.numTracks === 'number' ? result.numTracks : base.numTracks,
    masterTracks: Array.isArray(result.masterTracks)
      ? (result.masterTracks as ClipKind[])
      : base.masterTracks,
    tracks: Array.isArray(result.tracks)
      ? (result.tracks as ClipKind[])
      : base.tracks,
  };
}

function buildAssetFolder(
  inputs: ResolvedInputsAccessor
): TimelineDocument['assetFolder'] {
  const storageRoot =
    inputs.getByNodeId<string>('Input:StorageRoot') ??
    inputs.get<string>('StorageRoot');
  if (
    !storageRoot ||
    typeof storageRoot !== 'string' ||
    storageRoot.trim().length === 0
  ) {
    throw createProviderError(
      SdkErrorCode.MISSING_STORAGE_ROOT,
      'TimelineProducer is missing storage root (Input:StorageRoot).',
      { kind: 'user_input', causedByUser: true }
    );
  }
  const basePath =
    inputs.getByNodeId<string>('Input:StorageBasePath') ??
    inputs.get<string>('StorageBasePath');
  const movieId =
    inputs.getByNodeId<string>('Input:MovieId') ??
    inputs.get<string>('MovieId');
  const segments = [storageRoot, basePath, movieId].filter(
    (segment) => typeof segment === 'string' && segment.trim().length > 0
  ) as string[];
  const rootPath = segments.join('/');
  return {
    source: 'local',
    rootPath,
  };
}

async function buildTrack(args: {
  clip: TimelineClipConfig;
  fanIn: FanInValue;
  trackIndex: number;
  masterContext: MasterTrackContext;
  inputs: ResolvedInputsAccessor;
  durationCache: Map<string, number>;
}): Promise<TimelineTrack> {
  const { clip, fanIn, trackIndex, masterContext, inputs, durationCache } =
    args;
  if (!fanIn || fanIn.groups.length === 0) {
    return {
      id: `track-${trackIndex}`,
      kind: clip.kind,
      clips: [],
    };
  }
  switch (clip.kind) {
    case 'Audio':
      return buildAudioTrack({
        clip,
        fanIn,
        trackIndex,
        masterContext,
        inputs,
      });
    case 'Image':
      return buildImageTrack({
        clip,
        fanIn,
        trackIndex,
        masterContext,
        inputs,
      });
    case 'Music':
      return buildMusicTrack({
        clip,
        fanIn,
        trackIndex,
        masterContext,
        inputs,
        durationCache,
      });
    case 'Video':
      return buildVideoTrack({
        clip,
        fanIn,
        trackIndex,
        masterContext,
        inputs,
        durationCache,
      });
    case 'Transcription':
      return buildTranscriptionTrack({
        clip,
        fanIn,
        trackIndex,
        masterContext,
        inputs,
      });
    default:
      throw createProviderError(
        SdkErrorCode.UNSUPPORTED_CLIP_KIND,
        `TimelineProducer does not yet support clip kind "${clip.kind}".`,
        { kind: 'user_input', causedByUser: true }
      );
  }
}

function buildAudioTrack(args: {
  clip: TimelineClipConfig;
  fanIn: FanInValue;
  trackIndex: number;
  masterContext: MasterTrackContext;
  inputs: ResolvedInputsAccessor;
}): TimelineTrack {
  const { clip, fanIn, trackIndex, masterContext, inputs } = args;
  const {
    groupCount,
    groupToSegments,
    segmentDurations,
    segmentOffsets,
    primaryMasterInputId,
  } = masterContext;
  const isMaster = clip.inputs === primaryMasterInputId;
  const normalizedGroups = normalizeGroups(fanIn.groups, groupCount);
  // Filter out assets that don't exist (were skipped due to conditional execution)
  const groups = filterExistingAssets(normalizedGroups, inputs);
  const clips: TimelineClip[] = [];
  const volume = typeof clip.volume === 'number' ? clip.volume : 1;

  if (isMaster) {
    // Master mode: iterate all items across all groups, each item gets its own segment
    let segmentIndex = 0;
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
      const assets = groups[groupIndex] ?? [];
      // Sort assets alphabetically to match the expansion order in buildMasterTrackContext
      const sortedAssets = [...assets].sort();

      if (sortedAssets.length === 0) {
        // Empty group still has one segment
        segmentIndex++;
        continue;
      }

      for (const assetId of sortedAssets) {
        clips.push({
          id: `clip-${trackIndex}-${segmentIndex}`,
          kind: clip.kind,
          startTime: segmentOffsets[segmentIndex] ?? 0,
          duration: segmentDurations[segmentIndex] ?? 0,
          properties: {
            volume,
            assetId,
          },
        });

        segmentIndex++;
      }
    }
  } else {
    // Non-master span mode: one clip per group spanning all its segments
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
      const assets = groups[groupIndex] ?? [];
      const assetId = assets[0];
      if (!assetId) {
        // Skip groups with no audio assets (conditionally skipped)
        continue;
      }

      const segmentIndices = groupToSegments.get(groupIndex) ?? [];
      if (segmentIndices.length === 0) {
        continue;
      }

      // Compute start time and combined duration for this group
      const startSegment = Math.min(...segmentIndices);
      const startTime = segmentOffsets[startSegment] ?? 0;
      const duration = segmentIndices.reduce(
        (sum, segIdx) => sum + (segmentDurations[segIdx] ?? 0),
        0
      );

      clips.push({
        id: `clip-${trackIndex}-${groupIndex}`,
        kind: clip.kind,
        startTime,
        duration,
        properties: {
          volume,
          assetId,
        },
      });
    }
  }

  return {
    id: `track-${trackIndex}`,
    kind: clip.kind,
    clips,
  };
}

function buildImageTrack(args: {
  clip: TimelineClipConfig;
  fanIn: FanInValue;
  trackIndex: number;
  masterContext: MasterTrackContext;
  inputs: ResolvedInputsAccessor;
}): TimelineTrack {
  const { clip, fanIn, trackIndex, masterContext, inputs } = args;
  const { groupCount, segmentToGroup, segmentDurations, segmentOffsets } =
    masterContext;
  const effectName = clip.effect ?? DEFAULT_EFFECT;
  const normalizedGroups = normalizeGroups(fanIn.groups, groupCount);
  // Filter out assets that don't exist (were skipped due to conditional execution)
  const groups = filterExistingAssets(normalizedGroups, inputs);
  const clips: TimelineClip[] = [];
  const segmentCount = segmentDurations.length;

  // Per-segment mode: each segment uses images from its group
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
    const groupIndex = segmentToGroup[segmentIndex] ?? 0;
    const images = groups[groupIndex] ?? [];
    if (images.length === 0) {
      // Skip segments with no image assets (conditionally skipped)
      continue;
    }
    const effects = images.map((assetId, imageIndex) => {
      const preset = pickKenBurnsPreset(
        segmentIndex,
        imageIndex,
        images.length
      );
      return {
        name: effectName,
        style: preset.style,
        assetId,
        startX: preset.startX,
        startY: preset.startY,
        endX: preset.endX,
        endY: preset.endY,
        startScale: preset.startScale,
        endScale: preset.endScale,
      };
    });

    clips.push({
      id: `clip-${trackIndex}-${segmentIndex}`,
      kind: clip.kind,
      startTime: segmentOffsets[segmentIndex] ?? 0,
      duration: segmentDurations[segmentIndex] ?? 0,
      properties: {
        effect: effectName,
        effects,
      },
    });
  }

  return {
    id: `track-${trackIndex}`,
    kind: clip.kind,
    clips,
  };
}

async function buildMusicTrack(args: {
  clip: TimelineClipConfig;
  fanIn: FanInValue;
  trackIndex: number;
  masterContext: MasterTrackContext;
  inputs: ResolvedInputsAccessor;
  durationCache: Map<string, number>;
}): Promise<TimelineTrack> {
  const { clip, fanIn, trackIndex, masterContext, inputs, durationCache } =
    args;
  const { totalDuration } = masterContext;
  const allAssets = flattenFanInAssets(fanIn);
  // Filter out assets that don't exist (were skipped due to conditional execution)
  const assets = allAssets.filter(
    (assetId) => tryResolveAssetBinary(inputs, assetId) !== undefined
  );
  if (assets.length === 0) {
    throw createProviderError(
      SdkErrorCode.MISSING_ASSET,
      'TimelineProducer requires at least one asset for music tracks.',
      { kind: 'user_input', causedByUser: true }
    );
  }

  const durationMode = clip.duration === 'match' ? 'match' : 'full';
  const playMode = clip.play === 'no-loop' ? 'no-loop' : 'loop';
  const volume = typeof clip.volume === 'number' ? clip.volume : 1;
  const clips: TimelineClip[] = [];
  let cursor = 0;

  const playAsset = (assetId: string, clipDuration: number): void => {
    if (clipDuration <= 0) {
      return;
    }
    clips.push({
      id: `clip-${trackIndex}-${clips.length}`,
      kind: clip.kind,
      startTime: roundSeconds(cursor),
      duration: clipDuration,
      properties: {
        volume,
        assetId,
      },
    });
    cursor = roundSeconds(cursor + clipDuration);
  };

  if (durationMode === 'match') {
    for (const assetId of assets) {
      if (cursor >= totalDuration) {
        break;
      }
      const assetDuration = await loadAssetDuration({
        assetId,
        inputs,
        cache: durationCache,
      });
      const remaining = totalDuration - cursor;
      playAsset(assetId, Math.min(assetDuration, remaining));
    }
  } else if (playMode === 'no-loop') {
    for (const assetId of assets) {
      if (cursor >= totalDuration) {
        break;
      }
      const assetDuration = await loadAssetDuration({
        assetId,
        inputs,
        cache: durationCache,
      });
      const remaining = totalDuration - cursor;
      playAsset(assetId, Math.min(assetDuration, remaining));
    }
  } else {
    let loopIndex = 0;
    while (cursor < totalDuration && assets.length > 0) {
      const assetId = assets[loopIndex % assets.length]!;
      const assetDuration = await loadAssetDuration({
        assetId,
        inputs,
        cache: durationCache,
      });
      const remaining = totalDuration - cursor;
      playAsset(assetId, Math.min(assetDuration, remaining));
      loopIndex += 1;
    }
  }

  if (clips.length === 0) {
    throw createProviderError(
      SdkErrorCode.MISSING_ASSET,
      'TimelineProducer could not schedule any music clips.',
      { kind: 'user_input', causedByUser: true }
    );
  }

  return {
    id: `track-${trackIndex}`,
    kind: clip.kind,
    clips,
  };
}

async function buildVideoTrack(args: {
  clip: TimelineClipConfig;
  fanIn: FanInValue;
  trackIndex: number;
  masterContext: MasterTrackContext;
  inputs: ResolvedInputsAccessor;
  durationCache: Map<string, number>;
}): Promise<TimelineTrack> {
  const { clip, fanIn, trackIndex, masterContext, inputs, durationCache } =
    args;
  const {
    groupCount,
    groupToSegments,
    segmentDurations,
    segmentOffsets,
    primaryMasterInputId,
  } = masterContext;
  const isMaster = clip.inputs === primaryMasterInputId;
  const normalizedGroups = normalizeGroups(fanIn.groups, groupCount);
  // Filter out assets that don't exist (were skipped due to conditional execution)
  const groups = filterExistingAssets(normalizedGroups, inputs);
  const clips: TimelineClip[] = [];

  if (isMaster) {
    // Master mode: iterate all items across all groups, each item gets its own segment
    let segmentIndex = 0;
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
      const assets = groups[groupIndex] ?? [];
      // Sort assets alphabetically to match the expansion order in buildMasterTrackContext
      const sortedAssets = [...assets].sort();

      if (sortedAssets.length === 0) {
        // Empty group still has one segment
        segmentIndex++;
        continue;
      }

      for (const assetId of sortedAssets) {
        const originalDuration = await loadAssetDuration({
          assetId,
          inputs,
          cache: durationCache,
        });
        const fitStrategy = resolveVideoFitStrategy();
        const properties: Record<string, unknown> = {
          assetId,
          originalDuration,
          fitStrategy,
        };
        if (typeof clip.volume === 'number') {
          properties.volume = clip.volume;
        }

        clips.push({
          id: `clip-${trackIndex}-${segmentIndex}`,
          kind: clip.kind,
          startTime: segmentOffsets[segmentIndex] ?? 0,
          duration: segmentDurations[segmentIndex] ?? 0,
          properties,
        });

        segmentIndex++;
      }
    }
  } else {
    // Non-master span mode: one clip per group spanning all its segments
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
      const assets = groups[groupIndex] ?? [];
      const assetId = assets[0];
      if (!assetId) {
        continue;
      }

      const segmentIndices = groupToSegments.get(groupIndex) ?? [];
      if (segmentIndices.length === 0) {
        continue;
      }

      // Compute start time and combined duration for this group
      const startSegment = Math.min(...segmentIndices);
      const startTime = segmentOffsets[startSegment] ?? 0;
      const duration = segmentIndices.reduce(
        (sum, segIdx) => sum + (segmentDurations[segIdx] ?? 0),
        0
      );

      const originalDuration = await loadAssetDuration({
        assetId,
        inputs,
        cache: durationCache,
      });
      const fitStrategy = resolveVideoFitStrategy();
      const properties: Record<string, unknown> = {
        assetId,
        originalDuration,
        fitStrategy,
      };
      if (typeof clip.volume === 'number') {
        properties.volume = clip.volume;
      }

      clips.push({
        id: `clip-${trackIndex}-${groupIndex}`,
        kind: clip.kind,
        startTime,
        duration,
        properties,
      });
    }
  }

  return {
    id: `track-${trackIndex}`,
    kind: clip.kind,
    clips,
  };
}

function buildTranscriptionTrack(args: {
  clip: TimelineClipConfig;
  fanIn: FanInValue;
  trackIndex: number;
  masterContext: MasterTrackContext;
  inputs: ResolvedInputsAccessor;
}): TimelineTrack {
  const { clip, fanIn, trackIndex, masterContext, inputs } = args;
  const { groupCount, groupToSegments, segmentDurations, segmentOffsets } =
    masterContext;
  const normalizedGroups = normalizeGroups(fanIn.groups, groupCount);
  const groups = filterExistingAssets(normalizedGroups, inputs);
  const clips: TimelineClip[] = [];

  // Non-master span mode: one clip per group spanning all its segments
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const assets = groups[groupIndex] ?? [];
    const assetId = assets[0];
    if (!assetId) {
      // Skip groups with no transcription audio (silent segments)
      continue;
    }

    const segmentIndices = groupToSegments.get(groupIndex) ?? [];
    if (segmentIndices.length === 0) {
      continue;
    }

    // Compute start time and combined duration for this group
    const startSegment = Math.min(...segmentIndices);
    const startTime = segmentOffsets[startSegment] ?? 0;
    const duration = segmentIndices.reduce(
      (sum, segIdx) => sum + (segmentDurations[segIdx] ?? 0),
      0
    );

    clips.push({
      id: `clip-${trackIndex}-${groupIndex}`,
      kind: clip.kind,
      startTime,
      duration,
      properties: {
        assetId,
      },
    });
  }

  return {
    id: `track-${trackIndex}`,
    kind: clip.kind,
    clips,
  };
}

function pickKenBurnsPreset(
  segmentIndex: number,
  imageIndex: number,
  imageCount: number
): KenBurnsPreset {
  const sequence =
    KEN_BURNS_SEQUENCE_PRESETS[
      segmentIndex % KEN_BURNS_SEQUENCE_PRESETS.length
    ]!;

  const sequenceIndex =
    imageCount <= sequence.length
      ? imageIndex
      : Math.floor(
          (imageIndex / Math.max(1, imageCount - 1)) * (sequence.length - 1)
        );

  const presetIndex =
    sequence[Math.min(sequence.length - 1, Math.max(0, sequenceIndex))]!;
  return KEN_BURNS_PRESETS[presetIndex]!;
}

function readFanInForInput(
  inputs: ResolvedInputsAccessor,
  canonicalId: string
): FanInValue {
  const fanIn = resolveFanIn(inputs, canonicalId);
  if (fanIn) {
    return fanIn;
  }
  return {
    groupBy: 'segment',
    groups: [],
  };
}

function resolveFanIn(
  inputs: ResolvedInputsAccessor,
  canonicalId: string
): FanInValue | undefined {
  const direct = inputs.getByNodeId<FanInValue>(canonicalId);
  if (isFanInValue(direct)) {
    return normalizeFanIn(direct);
  }
  return undefined;
}

function normalizeFanIn(value: FanInValue): FanInValue {
  const groups = Array.isArray(value.groups) ? value.groups : [];
  return {
    groupBy: value.groupBy,
    orderBy: value.orderBy,
    groups: groups.map((group) => (Array.isArray(group) ? [...group] : [])),
  };
}

function readTimelineDuration(inputs: Record<string, unknown>): number {
  const candidates = [
    'Input:TimelineComposer.Duration',
    'TimelineComposer.Duration',
    'Input:Duration',
    'Duration',
  ];
  for (const key of candidates) {
    const value = inputs[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  throw createProviderError(
    SdkErrorCode.MISSING_DURATION,
    'TimelineProducer requires a positive Duration input.',
    { kind: 'user_input', causedByUser: true }
  );
}

/**
 * Tries to load asset duration, returning undefined if the asset is missing.
 * This is used for conditional execution where some assets may be skipped.
 */
async function tryLoadAssetDuration(args: {
  assetId: string;
  inputs: ResolvedInputsAccessor;
  cache: Map<string, number>;
}): Promise<number | undefined> {
  const cached = args.cache.get(args.assetId);
  if (cached !== undefined) {
    return cached;
  }

  const payload = tryResolveAssetBinary(args.inputs, args.assetId);
  if (payload === undefined) {
    // Asset is missing (was skipped) - return undefined so caller can fallback
    return undefined;
  }

  const synthetic = maybeResolveSyntheticDuration({
    assetId: args.assetId,
    payload,
    inputs: args.inputs,
  });
  if (synthetic !== undefined) {
    const rounded = roundSeconds(synthetic);
    args.cache.set(args.assetId, rounded);
    return rounded;
  }

  let input: Input<MediaBufferSource> | undefined;

  try {
    const source = new MediaBufferSource(payload);
    input = new Input({
      formats: ALL_FORMATS,
      source,
    });
    const duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Asset reported a non-positive duration.');
    }
    const rounded = roundSeconds(duration);
    args.cache.set(args.assetId, rounded);
    return rounded;
  } catch (error) {
    throw createProviderError(
      SdkErrorCode.MISSING_ASSET,
      `TimelineProducer failed to read duration for asset "${args.assetId}".`,
      {
        kind: 'unknown',
        causedByUser: false,
        metadata: { assetId: args.assetId },
        raw: error,
      }
    );
  } finally {
    input?.dispose();
  }
}

async function loadAssetDuration(args: {
  assetId: string;
  inputs: ResolvedInputsAccessor;
  cache: Map<string, number>;
}): Promise<number> {
  const result = await tryLoadAssetDuration(args);
  if (result !== undefined) {
    return result;
  }

  throw createProviderError(
    SdkErrorCode.MISSING_ASSET,
    `TimelineProducer could not locate binary data for asset "${args.assetId}".`,
    {
      kind: 'unknown',
      causedByUser: false,
      metadata: { assetId: args.assetId },
    }
  );
}

/**
 * Tries to resolve asset binary data, returning undefined if the asset is missing.
 * This is used for conditional execution where some assets may be skipped.
 */
function tryResolveAssetBinary(
  inputs: ResolvedInputsAccessor,
  assetId: string
): ArrayBuffer | ArrayBufferView | undefined {
  const value = inputs.getByNodeId(assetId);
  if (isBinaryPayload(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return Buffer.from(value);
  }
  // Asset is missing or not binary - return undefined for graceful handling
  return undefined;
}

function isBinaryPayload(
  value: unknown
): value is ArrayBuffer | ArrayBufferView {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function maybeResolveSyntheticDuration(args: {
  assetId: string;
  payload: ArrayBuffer | ArrayBufferView;
  inputs: ResolvedInputsAccessor;
}): number | undefined {
  if (!isSimulatedPayload(args.payload)) {
    return undefined;
  }

  const resolvedInputs = args.inputs.all();

  if (args.assetId.includes('MusicGenerator.Music')) {
    const timelineDuration = readOptionalPositiveNumber(resolvedInputs, [
      'Input:TimelineComposer.Duration',
      'TimelineComposer.Duration',
      'Input:Duration',
      'Duration',
    ]);
    if (timelineDuration !== undefined) {
      return timelineDuration;
    }
  }

  const segmentDuration = readOptionalPositiveNumber(resolvedInputs, [
    'Input:SegmentDuration',
    'SegmentDuration',
  ]);
  if (segmentDuration !== undefined) {
    return segmentDuration;
  }

  const totalDuration = readOptionalPositiveNumber(resolvedInputs, [
    'Input:TimelineComposer.Duration',
    'TimelineComposer.Duration',
    'Input:Duration',
    'Duration',
  ]);
  const numSegments = readOptionalPositiveNumber(resolvedInputs, [
    'Input:NumOfSegments',
    'NumOfSegments',
  ]);

  if (
    totalDuration !== undefined &&
    numSegments !== undefined &&
    numSegments > 0
  ) {
    return totalDuration / numSegments;
  }

  return undefined;
}

function isSimulatedPayload(payload: ArrayBuffer | ArrayBufferView): boolean {
  const view = toUint8Array(payload);
  if (view.byteLength < SIMULATED_OUTPUT_PREFIX.length) {
    return false;
  }
  const prefix = Buffer.from(
    view.slice(0, SIMULATED_OUTPUT_PREFIX.length)
  ).toString('utf8');
  return prefix.startsWith(SIMULATED_OUTPUT_PREFIX);
}

function toUint8Array(payload: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
}

function readOptionalPositiveNumber(
  inputs: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = inputs[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return undefined;
}

function readOptionalString(
  inputs: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = inputs[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function buildSegmentOffsets(durations: number[]): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (const duration of durations) {
    offsets.push(roundSeconds(cursor));
    cursor += duration;
  }
  return offsets;
}

function normalizeGroups(groups: string[][], length: number): string[][] {
  return Array.from({ length }, (_, index) => {
    const group = groups[index];
    if (!Array.isArray(group)) {
      return [];
    }
    return group.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0
    );
  });
}

/**
 * Filters groups to only include assets that actually exist in resolved inputs.
 * This is necessary for conditional execution where some producers may be skipped.
 */
function filterExistingAssets(
  groups: string[][],
  inputs: ResolvedInputsAccessor
): string[][] {
  return groups.map((group) =>
    group.filter((assetId) => {
      // Check if the asset exists in resolved inputs
      const payload = tryResolveAssetBinary(inputs, assetId);
      return payload !== undefined;
    })
  );
}

function flattenFanInAssets(fanIn: FanInValue): string[] {
  const flattened: string[] = [];
  for (const group of fanIn.groups) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (const assetId of group) {
      if (typeof assetId === 'string' && assetId.length > 0) {
        flattened.push(assetId);
      }
    }
  }
  return flattened;
}

function parseInputReference(reference: string): string {
  const bracketIndex = reference.indexOf('[');
  const base = bracketIndex >= 0 ? reference.slice(0, bracketIndex) : reference;
  return base.trim();
}

function resolveVideoFitStrategy(): string {
  // Always use stretch to slow down video to match audio master track duration.
  // freeze-fade (freezing last frame and fading to black) has been removed.
  return 'stretch';
}

function roundSeconds(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isFanInValue(value: unknown): value is FanInValue {
  if (!isRecord(value)) {
    return false;
  }
  return Array.isArray(value.groups);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
