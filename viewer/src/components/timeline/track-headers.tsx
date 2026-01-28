import { Play, Pause, Video } from "lucide-react";
import type { TimelineTrack } from "@/types/timeline";
import { getTrackMeta } from "./track-meta";

interface TrackHeadersProps {
  tracks: TimelineTrack[];
  isPlaying?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
}

export const TrackHeaders = ({
  tracks,
  isPlaying = false,
  onPlay,
  onPause,
}: TrackHeadersProps) => {
  const channelHeight = 48;

  const handlePlayPauseClick = () => {
    if (isPlaying) {
      onPause?.();
    } else {
      onPlay?.();
    }
  };

  return (
    <div className="w-16 shrink-0 bg-background/80 border-r border-border/30">
      <div
        className="border-b border-muted/90 flex items-center justify-center"
        style={{ height: "72px" }}
      >
        <button
          onClick={handlePlayPauseClick}
          className="p-2 rounded-md hover:bg-muted/50 transition-colors"
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 text-foreground" />
          ) : (
            <Play className="w-5 h-5 text-foreground" />
          )}
        </button>
      </div>
      {tracks.map((track) => {
        const meta = getTrackMeta(track);
        const IconComponent = meta.Icon ?? Video;
        return (
          <div
            key={track.id}
            className="flex items-center justify-center hover:bg-muted/30 transition-colors border-b border-muted/90"
            style={{ height: `${channelHeight}px` }}
            title={meta.label}
          >
            <IconComponent className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
          </div>
        );
      })}
    </div>
  );
};
