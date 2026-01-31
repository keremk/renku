/**
 * OpenTimelineIO (OTIO) export module.
 *
 * Exports Renku timelines to OTIO format for DaVinci Resolve, Premiere Pro,
 * and other professional NLE applications.
 *
 * @example
 * ```typescript
 * import { exportTimelineToOTIO } from '@gorenku/core';
 *
 * const result = exportTimelineToOTIO({
 *   timeline,
 *   assetPaths: { 'asset-1': '/path/to/image.png' },
 *   options: { fps: 30, movieName: 'My Movie' },
 * });
 *
 * // Write to file
 * await writeFile('project.otio', result.otioJson);
 * ```
 */

import type { TimelineDocument } from '@gorenku/compositions';
import type { OTIOExportResult, OTIOExportOptions } from './types.js';
import { convertTimelineToOTIO } from './converter.js';

// Re-export types
export type {
  OTIOTimeline,
  OTIOStack,
  OTIOTrack,
  OTIOTrackKind,
  OTIOClip,
  OTIOGap,
  OTIOTransition,
  OTIOMarker,
  OTIOMarkerColor,
  OTIOEffect,
  OTIOLinearTimeWarp,
  OTIOFreezeFrame,
  OTIOExternalReference,
  OTIOMissingReference,
  OTIOGeneratorReference,
  OTIOMediaReference,
  OTIORationalTime,
  OTIOTimeRange,
  OTIOExportResult,
  OTIOExportOptions,
  OTIOExportStats,
} from './types.js';

// Re-export time utilities for advanced use cases
export {
  createRationalTime,
  createTimeRange,
  createZeroTime,
  framesToSeconds,
  secondsToFrames,
  addRationalTimes,
  getTimeRangeEndTime,
  rationalTimeToSeconds,
  timeRangeDurationSeconds,
} from './time-utils.js';

/**
 * Arguments for exporting a timeline to OTIO format.
 */
export interface ExportTimelineToOTIOArgs {
  /** The Renku timeline document to export */
  timeline: TimelineDocument;
  /** Map of asset IDs to file paths */
  assetPaths: Record<string, string>;
  /** Export options */
  options: OTIOExportOptions;
}

/**
 * Exports a Renku TimelineDocument to OpenTimelineIO (OTIO) format.
 *
 * This is the main public API for OTIO export. It converts the timeline
 * structure to OTIO format and returns both the structured data and a
 * JSON string ready to write to a file.
 *
 * @param args - Export arguments including timeline, asset paths, and options
 * @returns OTIO export result with timeline structure, JSON string, and stats
 *
 * @example
 * ```typescript
 * import { exportTimelineToOTIO } from '@gorenku/core';
 *
 * const result = exportTimelineToOTIO({
 *   timeline: myTimeline,
 *   assetPaths: {
 *     'Artifact:ImageProducer.SegmentImage[0]': '/path/to/image0.png',
 *     'Artifact:AudioProducer.Narration[0]': '/path/to/audio0.mp3',
 *   },
 *   options: {
 *     fps: 30,
 *     movieName: 'My Documentary',
 *   },
 * });
 *
 * console.log(`Exported ${result.stats.clipCount} clips across ${result.stats.trackCount} tracks`);
 * await fs.writeFile('project.otio', result.otioJson);
 * ```
 *
 * ## DaVinci Resolve Import
 *
 * To import the exported OTIO file in DaVinci Resolve:
 * 1. Open DaVinci Resolve and go to the Edit page
 * 2. Right-click in Media Pool → Timelines → Import → OTIO
 * 3. Select the exported .otio file
 * 4. If media paths don't match, Resolve will prompt to locate the folder containing media
 *
 * ## Track Mapping
 *
 * | Renku Track | OTIO Track | Notes |
 * |-------------|------------|-------|
 * | ImageTrack | Video | Each Ken Burns effect = separate clip |
 * | VideoTrack | Video | Direct mapping |
 * | AudioTrack | Audio | Narration with volume/fade in metadata |
 * | MusicTrack | Audio | Background music |
 * | CaptionsTrack | Markers | Text captions as timeline markers |
 */
export function exportTimelineToOTIO(args: ExportTimelineToOTIOArgs): OTIOExportResult {
  const { timeline, assetPaths, options } = args;
  return convertTimelineToOTIO(timeline, assetPaths, options);
}
