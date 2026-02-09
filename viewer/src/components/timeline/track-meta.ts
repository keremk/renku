import { Film, Mic, Mic2, Music, Video, Volume2 } from "lucide-react";
import type { TimelineTrack } from "@/types/timeline";

const TRACK_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  Image: Film,
  Audio: Mic,
  Music,
  Video,
  Captions: Volume2,
  Transcription: Mic2,
};

const TRACK_LABEL: Record<string, string> = {
  Image: "Visual",
  Audio: "Narration",
  Music: "Music",
  Video: "Video",
  Captions: "Captions",
  Transcription: "Transcription",
};

export const getTrackMeta = (track: TimelineTrack) => {
  const Icon = TRACK_ICON[track.kind] ?? Volume2;
  const label = TRACK_LABEL[track.kind] ?? track.kind;
  return { Icon, label };
};
