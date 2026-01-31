/**
 * OpenTimelineIO (OTIO) type definitions.
 *
 * OTIO is an open-source interchange format for editorial timeline information.
 * It uses a JSON-based structure to represent timelines, tracks, clips, and media references.
 *
 * @see https://opentimelineio.readthedocs.io/
 */

// =============================================================================
// Core Time Types
// =============================================================================

/**
 * Rational time representation in OTIO.
 * Time is represented as a rational number (value / rate) for precise frame-based calculations.
 */
export interface OTIORationalTime {
  OTIO_SCHEMA: 'RationalTime.1';
  value: number;
  rate: number;
}

/**
 * Time range with start time and duration.
 */
export interface OTIOTimeRange {
  OTIO_SCHEMA: 'TimeRange.1';
  start_time: OTIORationalTime;
  duration: OTIORationalTime;
}

// =============================================================================
// Media Reference Types
// =============================================================================

/**
 * Reference to external media file.
 */
export interface OTIOExternalReference {
  OTIO_SCHEMA: 'ExternalReference.1';
  name: string;
  target_url: string;
  available_range?: OTIOTimeRange;
  metadata?: Record<string, unknown>;
}

/**
 * Reference to missing media (placeholder).
 */
export interface OTIOMissingReference {
  OTIO_SCHEMA: 'MissingReference.1';
  name: string;
  available_range?: OTIOTimeRange;
  metadata?: Record<string, unknown>;
}

/**
 * Generator reference (for generated content like bars, black, etc.).
 */
export interface OTIOGeneratorReference {
  OTIO_SCHEMA: 'GeneratorReference.1';
  name: string;
  generator_kind: string;
  available_range?: OTIOTimeRange;
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Union type for all media references.
 */
export type OTIOMediaReference =
  | OTIOExternalReference
  | OTIOMissingReference
  | OTIOGeneratorReference;

// =============================================================================
// Effect Types
// =============================================================================

/**
 * Base effect interface.
 */
export interface OTIOEffect {
  OTIO_SCHEMA: 'Effect.1';
  name: string;
  effect_name: string;
  metadata?: Record<string, unknown>;
}

/**
 * Linear time warp effect (speed change).
 */
export interface OTIOLinearTimeWarp {
  OTIO_SCHEMA: 'LinearTimeWarp.1';
  name: string;
  effect_name: string;
  time_scalar: number;
  metadata?: Record<string, unknown>;
}

/**
 * Freeze frame effect.
 */
export interface OTIOFreezeFrame {
  OTIO_SCHEMA: 'FreezeFrame.1';
  name: string;
  effect_name: string;
  metadata?: Record<string, unknown>;
}

/**
 * Union type for all effects.
 */
export type OTIOEffectType = OTIOEffect | OTIOLinearTimeWarp | OTIOFreezeFrame;

// =============================================================================
// Marker Type
// =============================================================================

/**
 * Timeline marker for annotations.
 */
export interface OTIOMarker {
  OTIO_SCHEMA: 'Marker.2';
  name: string;
  marked_range: OTIOTimeRange;
  color: OTIOMarkerColor;
  comment?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Marker color enum matching OTIO specification.
 */
export type OTIOMarkerColor =
  | 'RED'
  | 'PINK'
  | 'ORANGE'
  | 'YELLOW'
  | 'GREEN'
  | 'CYAN'
  | 'BLUE'
  | 'PURPLE'
  | 'MAGENTA'
  | 'BLACK'
  | 'WHITE';

// =============================================================================
// Item Types (Clips, Gaps, Transitions)
// =============================================================================

/**
 * A clip represents a piece of media on the timeline.
 * Uses media_references (plural) with active_media_reference_key per OTIO spec.
 */
export interface OTIOClip {
  OTIO_SCHEMA: 'Clip.2';
  name: string;
  source_range?: OTIOTimeRange;
  /** Map of reference keys to media references. Use "DEFAULT_MEDIA" as the standard key. */
  media_references: Record<string, OTIOMediaReference>;
  /** Key into media_references for the active reference. Typically "DEFAULT_MEDIA". */
  active_media_reference_key: string;
  effects?: OTIOEffectType[];
  markers?: OTIOMarker[];
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * A gap (empty space) on the timeline.
 */
export interface OTIOGap {
  OTIO_SCHEMA: 'Gap.1';
  name: string;
  source_range: OTIOTimeRange;
  effects?: OTIOEffectType[];
  markers?: OTIOMarker[];
  metadata?: Record<string, unknown>;
}

/**
 * A transition between clips.
 */
export interface OTIOTransition {
  OTIO_SCHEMA: 'Transition.1';
  name: string;
  transition_type: string;
  in_offset: OTIORationalTime;
  out_offset: OTIORationalTime;
  metadata?: Record<string, unknown>;
}

/**
 * Union type for all items that can appear in a track.
 */
export type OTIOTrackItem = OTIOClip | OTIOGap | OTIOTransition;

// =============================================================================
// Track Types
// =============================================================================

/**
 * Track kind enum.
 */
export type OTIOTrackKind = 'Video' | 'Audio';

/**
 * A track contains a sequence of items.
 */
export interface OTIOTrack {
  OTIO_SCHEMA: 'Track.1';
  name: string;
  kind: OTIOTrackKind;
  children: OTIOTrackItem[];
  source_range?: OTIOTimeRange;
  effects?: OTIOEffectType[];
  markers?: OTIOMarker[];
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Stack Type
// =============================================================================

/**
 * A stack contains multiple tracks layered on top of each other.
 */
export interface OTIOStack {
  OTIO_SCHEMA: 'Stack.1';
  name: string;
  children: OTIOTrack[];
  source_range?: OTIOTimeRange;
  effects?: OTIOEffectType[];
  markers?: OTIOMarker[];
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Timeline Type
// =============================================================================

/**
 * The root timeline object.
 */
export interface OTIOTimeline {
  OTIO_SCHEMA: 'Timeline.1';
  name: string;
  global_start_time?: OTIORationalTime;
  tracks: OTIOStack;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Export Result Types
// =============================================================================

/**
 * Statistics about the exported timeline.
 */
export interface OTIOExportStats {
  trackCount: number;
  clipCount: number;
  duration: number;
  fps: number;
  videoTrackCount: number;
  audioTrackCount: number;
}

/**
 * Result of exporting a timeline to OTIO format.
 */
export interface OTIOExportResult {
  /** The OTIO timeline structure */
  timeline: OTIOTimeline;
  /** JSON string ready to write to file */
  otioJson: string;
  /** Export statistics */
  stats: OTIOExportStats;
}

/**
 * Options for OTIO export.
 */
export interface OTIOExportOptions {
  /** Frames per second for the timeline */
  fps: number;
  /** Movie name for the timeline */
  movieName?: string;
}
