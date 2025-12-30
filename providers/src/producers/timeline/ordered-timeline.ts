import { Buffer } from 'node:buffer';
import { isCanonicalInputId } from '@gorenku/core';
import { Input, ALL_FORMATS, BufferSource as MediaBufferSource } from 'mediabunny';
import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import { createProviderError } from '../../sdk/errors.js';
import { canonicalizeAuthoredInputId } from '../../sdk/config-utils.js';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import type { ResolvedInputsAccessor } from '../../sdk/types.js';

interface FanInValue {
  groupBy: string;
  orderBy?: string;
  groups: string[][];
}

type ClipKind = 'Image' | 'Audio' | 'Music' | 'Video' | 'Captions';

interface TimelineClipConfig {
  kind: ClipKind;
  inputs: string;
  effect?: string;
  duration?: string;
  play?: string;
  fitStrategy?: string;
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
    style: 'portraitZoomIn',
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    startScale: 1,
    endScale: 1.2,
  },
  {
    style: 'portraitZoomOut',
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    startScale: 1.2,
    endScale: 1,
  },
  {
    style: 'diagonalZoomInDownLeft',
    startX: 40,
    startY: -40,
    endX: -30,
    endY: 30,
    startScale: 1,
    endScale: 1.3,
  },
  {
    style: 'diagonalZoomInUpRight',
    startX: -40,
    startY: 40,
    endX: 30,
    endY: -30,
    startScale: 1,
    endScale: 1.3,
  },
  {
    style: 'landscapePanLeft',
    startX: 60,
    startY: 0,
    endX: -60,
    endY: 0,
    startScale: 1.1,
    endScale: 1.3,
  },
  {
    style: 'landscapePanRight',
    startX: -60,
    startY: 0,
    endX: 60,
    endY: 0,
    startScale: 1.1,
    endScale: 1.3,
  },
];

const TRACK_KINDS_WITH_NATIVE_DURATION = new Set<ClipKind>(['Audio', 'Music', 'Video']);
const SIMULATED_OUTPUT_PREFIX = 'simulated-output:';

function canonicalizeClips(
  config: TimelineProducerConfig,
  availableInputs: string[],
  allowedKinds: Set<ClipKind>,
): TimelineClipConfig[] {
  const filtered = config.clips.filter((clip) => allowedKinds.has(clip.kind));
  if (filtered.length === 0) {
    return [];
  }
  return filtered.map((clip) => ({
    ...clip,
    inputs: canonicalizeAuthoredInputId(parseInputReference(clip.inputs), availableInputs),
  }));
}

function resolveAllowedTracks(config: TimelineProducerConfig): Set<ClipKind> {
  if (config.tracks && config.tracks.length > 0) {
    return new Set(config.tracks);
  }
  throw createProviderError('TimelineProducer requires tracks to be specified.', {
    code: 'invalid_config',
    kind: 'user_input',
    causedByUser: true,
  });
}

/**
 * Resolves segment count by finding the first master track with fan-in data.
 */
function resolveSegmentCount(
  clips: TimelineClipConfig[],
  masterKinds: ClipKind[],
  fanInByInput: Map<string, FanInValue>,
): number {
  for (const masterKind of masterKinds) {
    const candidates = clips.filter((clip) => clip.kind === masterKind);
    for (const candidate of candidates) {
      const fanIn = fanInByInput.get(candidate.inputs);
      if (fanIn && fanIn.groups.length > 0) {
        return fanIn.groups.length;
      }
    }
  }
  return 0;
}

export function createTimelineProducerHandler(): HandlerFactory {
  return createProducerHandlerFactory({
    domain: 'media',
    configValidator: parseTimelineConfig,
    invoke: async ({ request, runtime }) => {
      const notifier = (type: 'progress' | 'success' | 'error', message: string) => {
        runtime.notifications?.publish({
          type,
          message,
          timestamp: new Date().toISOString(),
        });
      };
      notifier('progress', `Building timeline for job ${request.jobId}`);
      const baseConfig = runtime.config.parse<TimelineProducerConfig>(parseTimelineConfig);
      const overrides = readConfigOverrides(runtime.inputs, request);
      const config = mergeConfig(baseConfig, overrides);
      const allowedKinds = resolveAllowedTracks(config);
      const masterTracks = config.masterTracks ?? [];
      if (masterTracks.length === 0) {
        throw createProviderError('TimelineProducer requires masterTracks to be specified.', {
          code: 'invalid_config',
          kind: 'user_input',
          causedByUser: true,
        });
      }
      for (const masterKind of masterTracks) {
        if (!allowedKinds.has(masterKind)) {
          throw createProviderError(
            `Master track kind "${masterKind}" is not included in configured tracks.`,
            {
              code: 'invalid_config',
              kind: 'user_input',
              causedByUser: true,
            },
          );
        }
      }
      const canonicalInputs = request.inputs.filter((input) => isCanonicalInputId(input));
      const clips = canonicalizeClips(config, canonicalInputs, allowedKinds);
      if (clips.length === 0) {
        throw createProviderError('TimelineProducer config must define at least one clip.', {
          code: 'invalid_config',
          kind: 'user_input',
          causedByUser: true,
        });
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

      // Determine segment count from the first master track with fan-in data
      const segmentCount = resolveSegmentCount(clips, masterTracks, fanInByInput);
      if (segmentCount === 0) {
        throw createProviderError('TimelineProducer requires at least one master track with fan-in data.', {
          code: 'missing_segments',
          kind: 'user_input',
          causedByUser: true,
        });
      }

      // Determine segment durations using fallback master tracks
      const segmentDurations = await determineMasterSegmentDurationsWithFallback({
        clips,
        fanInByInput,
        masterKinds: masterTracks,
        segmentCount,
        inputs: runtime.inputs,
        durationCache: assetDurationCache,
      });
      const segmentOffsets = buildSegmentOffsets(segmentDurations);

      const totalTimelineDuration = roundSeconds(segmentDurations.reduce((sum, value) => sum + value, 0));

      const tracks: TimelineTrack[] = await Promise.all(
        clips.map(async (clip, index) => {
          const fanIn = fanInByInput.get(clip.inputs);
          if (!fanIn) {
            throw createProviderError(`Missing fan-in data for "${clip.inputs}".`, {
              code: 'missing_fanin',
              kind: 'user_input',
              causedByUser: true,
            });
          }
          return buildTrack({
            clip,
            fanIn,
            trackIndex: index,
            segmentDurations,
            segmentOffsets,
            totalDuration: totalTimelineDuration,
            inputs: runtime.inputs,
            durationCache: assetDurationCache,
          });
        }),
      );

      const timeline: TimelineDocument = {
        id: `timeline-${request.revision}`,
        movieId: readOptionalString(resolvedInputs, ['MovieId', 'movieId']),
        movieTitle: readOptionalString(resolvedInputs, ['MovieTitle', 'ScriptGenerator.MovieTitle']),
        duration: totalTimelineDuration,
        assetFolder: buildAssetFolder(runtime.inputs),
        tracks,
      };

      const artefactId = runtime.artefacts.expectBlob(request.produces[0] ?? '');
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
    throw createProviderError('TimelineProducer provider configuration must include a config object.', {
      code: 'invalid_config',
      kind: 'user_input',
      causedByUser: true,
    });
  }
  const source = isRecord(raw.config) ? (raw.config as Record<string, unknown>) : (raw as Record<string, unknown>);
  const tracks = Array.isArray(source.tracks)
    ? source.tracks
      .map((entry) => (typeof entry === 'string' ? (entry as ClipKind) : undefined))
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
      fitStrategy: typeof entry.fitStrategy === 'string' ? entry.fitStrategy : undefined,
      partitionBy: typeof entry.partitionBy === 'number' ? entry.partitionBy : undefined,
      captionAlgorithm: typeof entry.captionAlgorithm === 'string' ? entry.captionAlgorithm : undefined,
      volume: typeof entry.volume === 'number' ? entry.volume : undefined,
    }))
    .filter((clip) => clip.inputs.length > 0);

  const derivedClips = buildClipsFromShorthand(source);
  const clips = explicitClips.length > 0 ? explicitClips : derivedClips;

  const masterTracks = Array.isArray(source.masterTracks)
    ? source.masterTracks
      .map((entry) => (typeof entry === 'string' ? (entry as ClipKind) : undefined))
      .filter((entry): entry is ClipKind => Boolean(entry))
    : undefined;

  return {
    numTracks: typeof source.numTracks === 'number' ? source.numTracks : undefined,
    masterTracks,
    clips,
    tracks,
  };
}

function buildClipsFromShorthand(source: Record<string, unknown>): TimelineClipConfig[] {
  const clips: TimelineClipConfig[] = [];
  const imageClip = isRecord(source.imageClip) ? (source.imageClip as Record<string, unknown>) : undefined;
  const videoClip = isRecord(source.videoClip) ? (source.videoClip as Record<string, unknown>) : undefined;
  const audioClip = isRecord(source.audioClip) ? (source.audioClip as Record<string, unknown>) : undefined;
  const musicClip = isRecord(source.musicClip) ? (source.musicClip as Record<string, unknown>) : undefined;

  if (imageClip?.artifact && typeof imageClip.artifact === 'string') {
    clips.push({
      kind: 'Image',
      inputs: imageClip.artifact,
      effect: typeof imageClip.effect === 'string' ? imageClip.effect : undefined,
    });
  }
  if (videoClip?.artifact && typeof videoClip.artifact === 'string') {
    clips.push({
      kind: 'Video',
      inputs: videoClip.artifact,
      fitStrategy: typeof videoClip.fitStrategy === 'string' ? videoClip.fitStrategy : undefined,
      volume: typeof videoClip.volume === 'number' ? videoClip.volume : undefined,
    });
  }
  if (audioClip?.artifact && typeof audioClip.artifact === 'string') {
    clips.push({
      kind: 'Audio',
      inputs: audioClip.artifact,
      volume: typeof audioClip.volume === 'number' ? audioClip.volume : undefined,
    });
  }
  if (musicClip?.artifact && typeof musicClip.artifact === 'string') {
    clips.push({
      kind: 'Music',
      inputs: musicClip.artifact,
      play: typeof musicClip.play === 'string' ? musicClip.play : musicClip.playStrategy as string | undefined,
      volume: typeof musicClip.volume === 'number' ? musicClip.volume : undefined,
    });
  }
  return clips;
}

function readConfigOverrides(inputs: ResolvedInputsAccessor, request: ProviderJobContext): Record<string, unknown> {
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

function assignPath(target: Record<string, unknown>, path: string, value: unknown): void {
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

function mergeConfig(base: TimelineProducerConfig, overrides: Record<string, unknown>): TimelineProducerConfig {
  const result: Record<string, unknown> = { ...base };
  const apply = (source: Record<string, unknown>, target: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!isRecord(target[key])) {
          target[key] = {};
        }
        apply(value as Record<string, unknown>, target[key] as Record<string, unknown>);
      } else {
        target[key] = value;
      }
    }
  };
  apply(overrides, result);
  return {
    clips: base.clips,
    numTracks: typeof result.numTracks === 'number' ? result.numTracks : base.numTracks,
    masterTracks: Array.isArray(result.masterTracks) ? (result.masterTracks as ClipKind[]) : base.masterTracks,
    tracks: Array.isArray(result.tracks) ? (result.tracks as ClipKind[]) : base.tracks,
  };
}

function buildAssetFolder(inputs: ResolvedInputsAccessor): TimelineDocument['assetFolder'] {
  const storageRoot = inputs.getByNodeId<string>('Input:StorageRoot') ?? inputs.get<string>('StorageRoot');
  if (!storageRoot || typeof storageRoot !== 'string' || storageRoot.trim().length === 0) {
    throw createProviderError('TimelineProducer is missing storage root (Input:StorageRoot).', {
      code: 'missing_storage_root',
      kind: 'user_input',
      causedByUser: true,
    });
  }
  const basePath = inputs.getByNodeId<string>('Input:StorageBasePath') ?? inputs.get<string>('StorageBasePath');
  const movieId = inputs.getByNodeId<string>('Input:MovieId') ?? inputs.get<string>('MovieId');
  const segments = [storageRoot, basePath, movieId].filter((segment) => typeof segment === 'string' && segment.trim().length > 0) as string[];
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
  segmentDurations: number[];
  segmentOffsets: number[];
  totalDuration: number;
  inputs: ResolvedInputsAccessor;
  durationCache: Map<string, number>;
}): Promise<TimelineTrack> {
  const { clip, fanIn, trackIndex, segmentDurations, segmentOffsets, totalDuration, inputs, durationCache } = args;
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
        segmentDurations,
        segmentOffsets,
        inputs,
      });
    case 'Image':
      return buildImageTrack({
        clip,
        fanIn,
        trackIndex,
        segmentDurations,
        segmentOffsets,
        inputs,
      });
    case 'Music':
      return buildMusicTrack({
        clip,
        fanIn,
        trackIndex,
        totalDuration,
        inputs,
        durationCache,
      });
    case 'Video':
      return buildVideoTrack({
        clip,
        fanIn,
        trackIndex,
        segmentDurations,
        segmentOffsets,
        inputs,
        durationCache,
      });
    default:
      throw createProviderError(`TimelineProducer does not yet support clip kind "${clip.kind}".`, {
        code: 'unsupported_clip',
        kind: 'user_input',
        causedByUser: true,
      });
  }
}

function buildAudioTrack(args: {
  clip: TimelineClipConfig;
  fanIn: FanInValue;
  trackIndex: number;
  segmentDurations: number[];
  segmentOffsets: number[];
  inputs: ResolvedInputsAccessor;
}): TimelineTrack {
  const { clip, fanIn, trackIndex, segmentDurations, segmentOffsets, inputs } = args;
  const normalizedGroups = normalizeGroups(fanIn.groups, segmentDurations.length);
  // Filter out assets that don't exist (were skipped due to conditional execution)
  const groups = filterExistingAssets(normalizedGroups, inputs);
  const clips: TimelineClip[] = [];

  for (let index = 0; index < segmentDurations.length; index += 1) {
    const assets = groups[index] ?? [];
    const assetId = assets[0];
    if (!assetId) {
      // Skip segments with no audio assets (conditionally skipped)
      continue;
    }

    clips.push({
      id: `clip-${trackIndex}-${index}`,
      kind: clip.kind,
      startTime: segmentOffsets[index],
      duration: segmentDurations[index],
      properties: {
        volume: typeof clip.volume === 'number' ? clip.volume : 1,
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

function buildImageTrack(args: {
  clip: TimelineClipConfig;
  fanIn: FanInValue;
  trackIndex: number;
  segmentDurations: number[];
  segmentOffsets: number[];
  inputs: ResolvedInputsAccessor;
}): TimelineTrack {
  const { clip, fanIn, trackIndex, segmentDurations, segmentOffsets, inputs } = args;
  const effectName = clip.effect ?? DEFAULT_EFFECT;
  const normalizedGroups = normalizeGroups(fanIn.groups, segmentDurations.length);
  // Filter out assets that don't exist (were skipped due to conditional execution)
  const groups = filterExistingAssets(normalizedGroups, inputs);
  const clips: TimelineClip[] = [];

  for (let index = 0; index < segmentDurations.length; index += 1) {
    const images = groups[index] ?? [];
    if (images.length === 0) {
      // Skip segments with no image assets (conditionally skipped)
      continue;
    }
    const effects = images.map((assetId, imageIndex) => {
      const preset = pickKenBurnsPreset(index, imageIndex);
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
      id: `clip-${trackIndex}-${index}`,
      kind: clip.kind,
      startTime: segmentOffsets[index],
      duration: segmentDurations[index],
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
  totalDuration: number;
  inputs: ResolvedInputsAccessor;
  durationCache: Map<string, number>;
}): Promise<TimelineTrack> {
  const { clip, fanIn, trackIndex, totalDuration, inputs, durationCache } = args;
  const allAssets = flattenFanInAssets(fanIn);
  // Filter out assets that don't exist (were skipped due to conditional execution)
  const assets = allAssets.filter((assetId) => tryResolveAssetBinary(inputs, assetId) !== undefined);
  if (assets.length === 0) {
    throw createProviderError('TimelineProducer requires at least one asset for music tracks.', {
      code: 'missing_asset',
      kind: 'user_input',
      causedByUser: true,
    });
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
      const assetDuration = await loadAssetDuration({ assetId, inputs, cache: durationCache });
      const remaining = totalDuration - cursor;
      playAsset(assetId, Math.min(assetDuration, remaining));
    }
  } else if (playMode === 'no-loop') {
    for (const assetId of assets) {
      if (cursor >= totalDuration) {
        break;
      }
      const assetDuration = await loadAssetDuration({ assetId, inputs, cache: durationCache });
      const remaining = totalDuration - cursor;
      playAsset(assetId, Math.min(assetDuration, remaining));
    }
  } else {
    let loopIndex = 0;
    while (cursor < totalDuration && assets.length > 0) {
      const assetId = assets[loopIndex % assets.length]!;
      const assetDuration = await loadAssetDuration({ assetId, inputs, cache: durationCache });
      const remaining = totalDuration - cursor;
      playAsset(assetId, Math.min(assetDuration, remaining));
      loopIndex += 1;
    }
  }

  if (clips.length === 0) {
    throw createProviderError('TimelineProducer could not schedule any music clips.', {
      code: 'missing_asset',
      kind: 'user_input',
      causedByUser: true,
    });
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
  segmentDurations: number[];
  segmentOffsets: number[];
  inputs: ResolvedInputsAccessor;
  durationCache: Map<string, number>;
}): Promise<TimelineTrack> {
  const { clip, fanIn, trackIndex, segmentDurations, segmentOffsets, inputs, durationCache } = args;
  const normalizedGroups = normalizeGroups(fanIn.groups, segmentDurations.length);
  // Filter out assets that don't exist (were skipped due to conditional execution)
  const groups = filterExistingAssets(normalizedGroups, inputs);
  const clips: TimelineClip[] = [];

  for (let index = 0; index < segmentDurations.length; index += 1) {
    const assets = groups[index] ?? [];
    const assetId = assets[0];
    if (!assetId) {
      continue;
    }
    // Asset is guaranteed to exist since we filtered above
    const originalDuration = await loadAssetDuration({ assetId, inputs, cache: durationCache });
    const fitStrategy = resolveVideoFitStrategy(clip.fitStrategy, segmentDurations[index], originalDuration);
    const properties: Record<string, unknown> = {
      assetId,
      originalDuration,
      fitStrategy,
    };
    if (typeof clip.volume === 'number') {
      properties.volume = clip.volume;
    }

    clips.push({
      id: `clip-${trackIndex}-${index}`,
      kind: clip.kind,
      startTime: segmentOffsets[index],
      duration: segmentDurations[index],
      properties,
    });
  }

  return {
    id: `track-${trackIndex}`,
    kind: clip.kind,
    clips,
  };
}

function pickKenBurnsPreset(segmentIndex: number, imageIndex: number): KenBurnsPreset {
  const presetIndex = (segmentIndex + imageIndex) % KEN_BURNS_PRESETS.length;
  return KEN_BURNS_PRESETS[presetIndex]!;
}

function readFanInForInput(inputs: ResolvedInputsAccessor, canonicalId: string): FanInValue {
  const fanIn = resolveFanIn(inputs, canonicalId);
  if (fanIn) {
    return fanIn;
  }
  return {
    groupBy: 'segment',
    groups: [],
  };
}

function resolveFanIn(inputs: ResolvedInputsAccessor, canonicalId: string): FanInValue | undefined {
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
  throw createProviderError('TimelineProducer requires a positive Duration input.', {
    code: 'missing_duration',
    kind: 'user_input',
    causedByUser: true,
  });
}

/**
 * Determines segment durations using a fallback chain of master tracks.
 * For each segment, tries master tracks in priority order until one has an asset.
 * Falls back to SegmentDuration input or equal division of Duration if no master track has an asset.
 */
async function determineMasterSegmentDurationsWithFallback(args: {
  clips: TimelineClipConfig[];
  fanInByInput: Map<string, FanInValue>;
  masterKinds: ClipKind[];
  segmentCount: number;
  inputs: ResolvedInputsAccessor;
  durationCache: Map<string, number>;
}): Promise<number[]> {
  const { clips, fanInByInput, masterKinds, segmentCount, inputs, durationCache } = args;
  const resolvedInputs = inputs.all();
  const durations: number[] = [];

  // Pre-compute master clips and their fan-in data grouped by kind
  const masterClipsByKind = new Map<ClipKind, { clip: TimelineClipConfig; fanIn: FanInValue }[]>();
  for (const masterKind of masterKinds) {
    const candidates = clips.filter((clip) => clip.kind === masterKind);
    const clipsWithFanIn: { clip: TimelineClipConfig; fanIn: FanInValue }[] = [];
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

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    let duration: number | undefined;

    // Try each master track kind in priority order
    for (const masterKind of masterKinds) {
      if (duration !== undefined) {
        break;
      }
      // Only tracks with native duration (Audio, Video, Music) can provide segment duration
      if (!TRACK_KINDS_WITH_NATIVE_DURATION.has(masterKind)) {
        continue;
      }
      const clipsForKind = masterClipsByKind.get(masterKind);
      if (!clipsForKind) {
        continue;
      }
      for (const { fanIn } of clipsForKind) {
        const groups = normalizeGroups(fanIn.groups, segmentCount);
        const assetId = groups[segmentIndex]?.[0];
        if (assetId) {
          // Use tryLoadAssetDuration to handle skipped assets gracefully
          const assetDuration = await tryLoadAssetDuration({ assetId, inputs, cache: durationCache });
          if (assetDuration !== undefined) {
            duration = assetDuration;
            break;
          }
          // Asset was skipped - continue to next candidate
        }
      }
    }

    // Fallback: use SegmentDuration input if no master track had an asset
    if (duration === undefined) {
      const segmentDuration = readOptionalPositiveNumber(resolvedInputs, [
        'Input:SegmentDuration',
        'SegmentDuration',
      ]);
      if (segmentDuration !== undefined) {
        duration = segmentDuration;
      }
    }

    // Final fallback: divide total Duration equally
    if (duration === undefined) {
      const totalDuration = readTimelineDuration(resolvedInputs);
      duration = roundSeconds(totalDuration / segmentCount);
    }

    durations.push(duration);
  }

  return durations;
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
    throw createProviderError(`TimelineProducer failed to read duration for asset "${args.assetId}".`, {
      code: 'asset_duration_failed',
      kind: 'unknown',
      causedByUser: false,
      metadata: { assetId: args.assetId },
      raw: error,
    });
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

  throw createProviderError(`TimelineProducer could not locate binary data for asset "${args.assetId}".`, {
    code: 'missing_asset_payload',
    kind: 'unknown',
    causedByUser: false,
    metadata: { assetId: args.assetId },
  });
}

/**
 * Tries to resolve asset binary data, returning undefined if the asset is missing.
 * This is used for conditional execution where some assets may be skipped.
 */
function tryResolveAssetBinary(
  inputs: ResolvedInputsAccessor,
  assetId: string,
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

function isBinaryPayload(value: unknown): value is ArrayBuffer | ArrayBufferView {
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

  if (totalDuration !== undefined && numSegments !== undefined && numSegments > 0) {
    return totalDuration / numSegments;
  }

  return undefined;
}

function isSimulatedPayload(payload: ArrayBuffer | ArrayBufferView): boolean {
  const view = toUint8Array(payload);
  if (view.byteLength < SIMULATED_OUTPUT_PREFIX.length) {
    return false;
  }
  const prefix = Buffer.from(view.slice(0, SIMULATED_OUTPUT_PREFIX.length)).toString('utf8');
  return prefix.startsWith(SIMULATED_OUTPUT_PREFIX);
}

function toUint8Array(payload: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
}

function readOptionalPositiveNumber(inputs: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = inputs[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return undefined;
}

function readOptionalString(inputs: Record<string, unknown>, keys: string[]): string | undefined {
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
    return group.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  });
}

/**
 * Filters groups to only include assets that actually exist in resolved inputs.
 * This is necessary for conditional execution where some producers may be skipped.
 */
function filterExistingAssets(groups: string[][], inputs: ResolvedInputsAccessor): string[][] {
  return groups.map((group) =>
    group.filter((assetId) => {
      // Check if the asset exists in resolved inputs
      const payload = tryResolveAssetBinary(inputs, assetId);
      return payload !== undefined;
    }),
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

function resolveVideoFitStrategy(fitStrategy: string | undefined, segmentDuration: number, originalDuration: number): string {
  if (typeof fitStrategy === 'string' && fitStrategy !== 'auto') {
    return fitStrategy;
  }
  if (!Number.isFinite(originalDuration) || originalDuration <= 0) {
    return fitStrategy ?? 'stretch';
  }
  const ratio = Math.abs(segmentDuration - originalDuration) / originalDuration;
  return ratio <= 0.2 ? 'stretch' : 'freeze-fade';
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
