export type {
  TimelineDocument,
  TimelineTrack,
  ImageTrack,
  AudioTrack,
  MusicTrack,
  VideoTrack,
  CaptionsTrack,
  TranscriptionTrack,
  UnknownTrack,
  TimelineClip,
  ImageClip,
  AudioClip,
  MusicClip,
  VideoClip,
  CaptionsClip,
  TranscriptionClip,
  KenBurnsEffect,
  AssetMap,
} from "./types/timeline.js";

export { remapSpeed } from "./lib/remotion/remap-speed.js";
export { DocumentaryComposition, type DocumentaryCompositionProps } from "./compositions/documentary/VideoComposition.js";
export { DOCUMENTARY_COMPOSITION_ID, DocumentaryRoot } from "./remotion/index.js";
