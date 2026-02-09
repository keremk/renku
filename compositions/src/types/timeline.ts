export type TimelineTrackKind = "Image" | "Audio" | "Music" | "Video" | "Captions" | "Transcription";

export interface TimelineDocument {
  id: string;
  duration: number;
  name?: string;
  movieId?: string;
  movieTitle?: string;
  assetFolder?: {
    source?: string;
    rootPath?: string;
  };
  tracks: TimelineTrack[];
}

export type TimelineTrack =
  | ImageTrack
  | AudioTrack
  | MusicTrack
  | VideoTrack
  | CaptionsTrack
  | TranscriptionTrack
  | UnknownTrack;

interface TimelineTrackBase<TKind extends string, TClip extends TimelineClip> {
  id: string;
  kind: TKind;
  clips: TClip[];
}

interface TimelineClipBase<TKind extends string, TProps extends Record<string, unknown>> {
  id: string;
  kind: TKind;
  startTime: number;
  duration: number;
  properties: TProps;
}

export interface KenBurnsEffect {
  name?: string;
  style?: string;
  assetId: string;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  startScale?: number;
  endScale?: number;
}

export type ImageClip = TimelineClipBase<
  "Image",
  {
    effect?: string;
    effects: KenBurnsEffect[];
  }
>;

export type AudioClip = TimelineClipBase<
  "Audio",
  {
    assetId: string;
    volume?: number;
    fadeInDuration?: number;
    fadeOutDuration?: number;
  }
>;

export type MusicClip = TimelineClipBase<
  "Music",
  {
    assetId: string;
    volume?: number;
    duration?: "full" | "match";
    play?: "loop" | "no-loop";
  }
>;

export type VideoClip = TimelineClipBase<
  "Video",
  {
    assetId: string;
    originalDuration?: number;
    fitStrategy?: string;
    volume?: number;
  }
>;

export type CaptionsClip = TimelineClipBase<
  "Captions",
  {
    assetId?: string;
    captions?: string[];
    partitionBy?: number;
    captionAlgorithm?: string;
  }
>;

export type TranscriptionClip = TimelineClipBase<
  "Transcription",
  {
    assetId: string;
  }
>;

export type UnknownClip = TimelineClipBase<string, Record<string, unknown>>;

export type TimelineClip =
  | ImageClip
  | AudioClip
  | MusicClip
  | VideoClip
  | CaptionsClip
  | TranscriptionClip
  | UnknownClip;

export type ImageTrack = TimelineTrackBase<"Image", ImageClip>;
export type AudioTrack = TimelineTrackBase<"Audio", AudioClip>;
export type MusicTrack = TimelineTrackBase<"Music", MusicClip>;
export type VideoTrack = TimelineTrackBase<"Video", VideoClip>;
export type CaptionsTrack = TimelineTrackBase<"Captions", CaptionsClip>;
export type TranscriptionTrack = TimelineTrackBase<"Transcription", TranscriptionClip>;
export type UnknownTrack = TimelineTrackBase<string, TimelineClip>;

export interface AssetMap {
  [canonicalId: string]: string;
}
