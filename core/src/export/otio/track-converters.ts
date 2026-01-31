/**
 * Track converters for OpenTimelineIO export.
 *
 * Converts Renku timeline tracks to OTIO tracks.
 * Each track type has specific handling for its clip properties.
 */

import type {
  ImageTrack,
  AudioTrack,
  MusicTrack,
  VideoTrack,
  CaptionsTrack,
  ImageClip,
  AudioClip,
  MusicClip,
  VideoClip,
  CaptionsClip,
} from '@gorenku/compositions';

import type {
  OTIOTrack,
  OTIOClip,
  OTIOMarker,
  OTIOExternalReference,
  OTIOMissingReference,
  OTIOGap,
} from './types.js';

import { createTimeRange } from './time-utils.js';

/**
 * Context for track conversion, providing asset paths and settings.
 */
export interface TrackConversionContext {
  /** Map of asset IDs to file paths */
  assetPaths: Record<string, string>;
  /** Frames per second */
  fps: number;
}

// =============================================================================
// Image Track Conversion
// =============================================================================

/**
 * Converts an ImageTrack to an OTIO video track.
 * Each Ken Burns effect becomes a separate clip.
 */
export function convertImageTrack(
  track: ImageTrack,
  ctx: TrackConversionContext,
): OTIOTrack {
  const otioClips: OTIOClip[] = [];

  for (const clip of track.clips) {
    const convertedClips = convertImageClip(clip, ctx);
    otioClips.push(...convertedClips);
  }

  return {
    OTIO_SCHEMA: 'Track.1',
    name: track.id,
    kind: 'Video',
    children: otioClips,
    effects: [],
    markers: [],
    enabled: true,
    metadata: {
      renku: {
        originalKind: 'Image',
        trackId: track.id,
      },
    },
  };
}

/**
 * Converts an ImageClip to OTIO clips.
 * Each Ken Burns effect within the clip becomes a separate OTIO clip.
 */
function convertImageClip(
  clip: ImageClip,
  ctx: TrackConversionContext,
): OTIOClip[] {
  const effects = clip.properties.effects ?? [];

  if (effects.length === 0) {
    // No effects - create a single clip if there's an asset
    return [];
  }

  return effects.map((effect, index) => {
    const assetPath = ctx.assetPaths[effect.assetId];
    const effectDuration = clip.duration / effects.length;
    const effectStartTime = clip.startTime + index * effectDuration;

    return createOTIOClip({
      name: effect.name ?? `${clip.id}_effect_${index}`,
      assetId: effect.assetId,
      assetPath,
      startTime: effectStartTime,
      duration: effectDuration,
      fps: ctx.fps,
      metadata: {
        renku: {
          clipId: clip.id,
          effectIndex: index,
          effectStyle: effect.style,
          kenBurns: {
            startX: effect.startX,
            startY: effect.startY,
            endX: effect.endX,
            endY: effect.endY,
            startScale: effect.startScale,
            endScale: effect.endScale,
          },
        },
      },
    });
  });
}

// =============================================================================
// Video Track Conversion
// =============================================================================

/**
 * Converts a VideoTrack to an OTIO video track.
 */
export function convertVideoTrack(
  track: VideoTrack,
  ctx: TrackConversionContext,
): OTIOTrack {
  const otioClips: OTIOClip[] = track.clips.map((clip) =>
    convertVideoClip(clip, ctx),
  );

  return {
    OTIO_SCHEMA: 'Track.1',
    name: track.id,
    kind: 'Video',
    children: otioClips,
    effects: [],
    markers: [],
    enabled: true,
    metadata: {
      renku: {
        originalKind: 'Video',
        trackId: track.id,
      },
    },
  };
}

/**
 * Converts a VideoClip to an OTIO clip.
 */
function convertVideoClip(
  clip: VideoClip,
  ctx: TrackConversionContext,
): OTIOClip {
  const assetPath = ctx.assetPaths[clip.properties.assetId];

  return createOTIOClip({
    name: clip.id,
    assetId: clip.properties.assetId,
    assetPath,
    startTime: clip.startTime,
    duration: clip.duration,
    fps: ctx.fps,
    metadata: {
      renku: {
        clipId: clip.id,
        fitStrategy: clip.properties.fitStrategy,
        originalDuration: clip.properties.originalDuration,
        volume: clip.properties.volume,
      },
    },
  });
}

// =============================================================================
// Audio Track Conversion
// =============================================================================

/**
 * Converts an AudioTrack (narration) to an OTIO audio track.
 */
export function convertAudioTrack(
  track: AudioTrack,
  ctx: TrackConversionContext,
): OTIOTrack {
  const otioClips: OTIOClip[] = track.clips.map((clip) =>
    convertAudioClip(clip, ctx),
  );

  return {
    OTIO_SCHEMA: 'Track.1',
    name: track.id,
    kind: 'Audio',
    children: otioClips,
    effects: [],
    markers: [],
    enabled: true,
    metadata: {
      renku: {
        originalKind: 'Audio',
        trackId: track.id,
      },
    },
  };
}

/**
 * Converts an AudioClip to an OTIO clip.
 */
function convertAudioClip(
  clip: AudioClip,
  ctx: TrackConversionContext,
): OTIOClip {
  const assetPath = ctx.assetPaths[clip.properties.assetId];

  return createOTIOClip({
    name: clip.id,
    assetId: clip.properties.assetId,
    assetPath,
    startTime: clip.startTime,
    duration: clip.duration,
    fps: ctx.fps,
    metadata: {
      renku: {
        clipId: clip.id,
        volume: clip.properties.volume,
        fadeInDuration: clip.properties.fadeInDuration,
        fadeOutDuration: clip.properties.fadeOutDuration,
      },
    },
  });
}

// =============================================================================
// Music Track Conversion
// =============================================================================

/**
 * Converts a MusicTrack to an OTIO audio track.
 */
export function convertMusicTrack(
  track: MusicTrack,
  ctx: TrackConversionContext,
): OTIOTrack {
  const otioClips: OTIOClip[] = track.clips.map((clip) =>
    convertMusicClip(clip, ctx),
  );

  return {
    OTIO_SCHEMA: 'Track.1',
    name: track.id,
    kind: 'Audio',
    children: otioClips,
    effects: [],
    markers: [],
    enabled: true,
    metadata: {
      renku: {
        originalKind: 'Music',
        trackId: track.id,
      },
    },
  };
}

/**
 * Converts a MusicClip to an OTIO clip.
 */
function convertMusicClip(
  clip: MusicClip,
  ctx: TrackConversionContext,
): OTIOClip {
  const assetPath = ctx.assetPaths[clip.properties.assetId];

  return createOTIOClip({
    name: clip.id,
    assetId: clip.properties.assetId,
    assetPath,
    startTime: clip.startTime,
    duration: clip.duration,
    fps: ctx.fps,
    metadata: {
      renku: {
        clipId: clip.id,
        volume: clip.properties.volume,
        duration: clip.properties.duration,
        play: clip.properties.play,
      },
    },
  });
}

// =============================================================================
// Captions Track Conversion
// =============================================================================

/**
 * Converts a CaptionsTrack to OTIO markers on a video track.
 * Since OTIO doesn't have a native caption track, we use markers.
 */
export function convertCaptionsToMarkers(
  track: CaptionsTrack,
  ctx: TrackConversionContext,
): OTIOMarker[] {
  const markers: OTIOMarker[] = [];

  for (const clip of track.clips) {
    const clipMarkers = convertCaptionsClipToMarkers(clip, ctx);
    markers.push(...clipMarkers);
  }

  return markers;
}

/**
 * Converts a CaptionsClip to OTIO markers.
 */
function convertCaptionsClipToMarkers(
  clip: CaptionsClip,
  ctx: TrackConversionContext,
): OTIOMarker[] {
  const captions = clip.properties.captions ?? [];

  if (captions.length === 0) {
    return [];
  }

  // If we have multiple captions, distribute them evenly across the clip duration
  const captionDuration = clip.duration / captions.length;

  return captions.map((captionText, index) => {
    const captionStartTime = clip.startTime + index * captionDuration;

    return {
      OTIO_SCHEMA: 'Marker.2',
      name: `Caption_${clip.id}_${index}`,
      marked_range: createTimeRange(captionStartTime, captionDuration, ctx.fps),
      color: 'CYAN',
      comment: captionText,
      metadata: {
        renku: {
          clipId: clip.id,
          captionIndex: index,
          captionAlgorithm: clip.properties.captionAlgorithm,
        },
      },
    };
  });
}

// =============================================================================
// Helper Functions
// =============================================================================

interface CreateOTIOClipArgs {
  name: string;
  assetId: string;
  assetPath: string | undefined;
  startTime: number;
  duration: number;
  fps: number;
  metadata?: Record<string, unknown>;
}

const DEFAULT_MEDIA_KEY = 'DEFAULT_MEDIA';

/**
 * Creates an OTIO clip with proper media references.
 * Uses media_references (plural) with active_media_reference_key per OTIO spec.
 */
function createOTIOClip(args: CreateOTIOClipArgs): OTIOClip {
  const { name, assetId, assetPath, startTime, duration, fps, metadata } = args;

  // Create the available_range for the media (same as clip duration for now)
  const availableRange = createTimeRange(0, duration, fps);

  // Create media reference based on whether we have a path
  // Note: DaVinci Resolve expects paths WITHOUT the "file://" prefix
  const mediaReference: OTIOExternalReference | OTIOMissingReference = assetPath
    ? {
        OTIO_SCHEMA: 'ExternalReference.1',
        name: assetId,
        target_url: assetPath,
        available_range: availableRange,
        metadata: {
          renku: { assetId },
        },
      }
    : {
        OTIO_SCHEMA: 'MissingReference.1',
        name: assetId,
        available_range: availableRange,
        metadata: {
          renku: { assetId, missing: true },
        },
      };

  return {
    OTIO_SCHEMA: 'Clip.2',
    name,
    source_range: createTimeRange(0, duration, fps),
    media_references: {
      [DEFAULT_MEDIA_KEY]: mediaReference,
    },
    active_media_reference_key: DEFAULT_MEDIA_KEY,
    effects: [],
    markers: [],
    enabled: true,
    metadata: {
      ...metadata,
      renku: {
        ...(metadata?.renku as Record<string, unknown> | undefined),
        timelineStartTime: startTime,
      },
    },
  };
}

/**
 * Creates an OTIO gap (empty space) for the track.
 * Note: source_range always starts at 0 - timeline position is determined by
 * the sequential order of items in the track.
 */
export function createOTIOGap(
  name: string,
  duration: number,
  fps: number,
): OTIOGap {
  return {
    OTIO_SCHEMA: 'Gap.1',
    name,
    source_range: createTimeRange(0, duration, fps),
    effects: [],
    markers: [],
  };
}

/**
 * Inserts gaps between clips to maintain proper timeline positioning.
 * OTIO tracks are sequential, so we need explicit gaps where there's empty space.
 */
export function insertGapsInTrack(track: OTIOTrack, totalDuration: number, fps: number): OTIOTrack {
  const items = track.children;
  if (items.length === 0) {
    return track;
  }

  // Get clips with their timeline start times from metadata
  const clipsWithTimes = items
    .filter((item): item is OTIOClip => item.OTIO_SCHEMA === 'Clip.2')
    .map((clip) => ({
      clip,
      startTime: (clip.metadata?.renku as Record<string, unknown>)?.timelineStartTime as number ?? 0,
      duration: clip.source_range?.duration.value ?? 0,
    }))
    .sort((a, b) => a.startTime - b.startTime);

  if (clipsWithTimes.length === 0) {
    return track;
  }

  const newChildren: (OTIOClip | OTIOGap)[] = [];
  let currentTime = 0;

  for (const { clip, startTime, duration } of clipsWithTimes) {
    // Calculate the actual start time in seconds
    const startTimeSeconds = startTime;
    const durationSeconds = duration / fps;

    // Insert gap if there's space before this clip
    if (startTimeSeconds > currentTime) {
      const gapDuration = startTimeSeconds - currentTime;
      newChildren.push(createOTIOGap(`Gap_${currentTime}`, gapDuration, fps));
    }

    newChildren.push(clip);
    currentTime = startTimeSeconds + durationSeconds;
  }

  // Add final gap if needed
  if (currentTime < totalDuration) {
    const gapDuration = totalDuration - currentTime;
    newChildren.push(createOTIOGap(`Gap_end`, gapDuration, fps));
  }

  return {
    ...track,
    children: newChildren,
  };
}
