/**
 * Main converter for OpenTimelineIO export.
 *
 * Converts a Renku TimelineDocument to OTIO Timeline format.
 */

import type {
  TimelineDocument,
  TimelineTrack,
  ImageTrack,
  VideoTrack,
  AudioTrack,
  MusicTrack,
  CaptionsTrack,
} from '@gorenku/compositions';

import type {
  OTIOTimeline,
  OTIOStack,
  OTIOTrack,
  OTIOMarker,
  OTIOExportResult,
  OTIOExportOptions,
  OTIOExportStats,
} from './types.js';

import { createZeroTime } from './time-utils.js';

import {
  convertImageTrack,
  convertVideoTrack,
  convertAudioTrack,
  convertMusicTrack,
  convertCaptionsToMarkers,
  insertGapsInTrack,
  type TrackConversionContext,
} from './track-converters.js';

/**
 * Converts a Renku TimelineDocument to OTIO Timeline format.
 *
 * @param timeline - The Renku timeline document to convert
 * @param assetPaths - Map of asset IDs to file paths
 * @param options - Export options (fps, movie name)
 * @returns OTIO export result with timeline, JSON string, and stats
 */
export function convertTimelineToOTIO(
  timeline: TimelineDocument,
  assetPaths: Record<string, string>,
  options: OTIOExportOptions,
): OTIOExportResult {
  const ctx: TrackConversionContext = {
    assetPaths,
    fps: options.fps,
  };

  const otioTracks: OTIOTrack[] = [];
  const allMarkers: OTIOMarker[] = [];
  let clipCount = 0;
  let videoTrackCount = 0;
  let audioTrackCount = 0;

  // Process each track
  for (const track of timeline.tracks) {
    const result = convertTrack(track, ctx);

    if (result.track) {
      // Insert gaps to maintain proper timeline positioning
      const trackWithGaps = insertGapsInTrack(result.track, timeline.duration, options.fps);
      otioTracks.push(trackWithGaps);

      // Count clips
      clipCount += trackWithGaps.children.filter(
        (item) => item.OTIO_SCHEMA === 'Clip.2',
      ).length;

      // Count track types
      if (trackWithGaps.kind === 'Video') {
        videoTrackCount++;
      } else if (trackWithGaps.kind === 'Audio') {
        audioTrackCount++;
      }
    }

    if (result.markers) {
      allMarkers.push(...result.markers);
    }
  }

  // Create the stack (container for tracks)
  const stack: OTIOStack = {
    OTIO_SCHEMA: 'Stack.1',
    name: 'Tracks',
    children: otioTracks,
    effects: [],
    markers: allMarkers,
    metadata: {
      renku: {
        timelineId: timeline.id,
      },
    },
  };

  // Create the timeline
  const otioTimeline: OTIOTimeline = {
    OTIO_SCHEMA: 'Timeline.1',
    name: options.movieName ?? timeline.movieTitle ?? timeline.id,
    global_start_time: createZeroTime(options.fps),
    tracks: stack,
    metadata: {
      renku: {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        sourceTimelineId: timeline.id,
        sourceMovieId: timeline.movieId,
        duration: timeline.duration,
      },
    },
  };

  // Calculate stats
  const stats: OTIOExportStats = {
    trackCount: otioTracks.length,
    clipCount,
    duration: timeline.duration,
    fps: options.fps,
    videoTrackCount,
    audioTrackCount,
  };

  // Serialize to JSON
  const otioJson = JSON.stringify(otioTimeline, null, 2);

  return {
    timeline: otioTimeline,
    otioJson,
    stats,
  };
}

/**
 * Result of converting a single track.
 */
interface TrackConversionResult {
  track?: OTIOTrack;
  markers?: OTIOMarker[];
}

/**
 * Converts a Renku track to OTIO format.
 */
function convertTrack(
  track: TimelineTrack,
  ctx: TrackConversionContext,
): TrackConversionResult {
  // Type guards to narrow the union type
  if (track.kind === 'Image') {
    return { track: convertImageTrack(track as ImageTrack, ctx) };
  }

  if (track.kind === 'Video') {
    return { track: convertVideoTrack(track as VideoTrack, ctx) };
  }

  if (track.kind === 'Audio') {
    return { track: convertAudioTrack(track as AudioTrack, ctx) };
  }

  if (track.kind === 'Music') {
    return { track: convertMusicTrack(track as MusicTrack, ctx) };
  }

  if (track.kind === 'Captions') {
    // Captions become markers, not a separate track
    return { markers: convertCaptionsToMarkers(track as CaptionsTrack, ctx) };
  }

  // Unknown track kind - skip
  return {};
}
