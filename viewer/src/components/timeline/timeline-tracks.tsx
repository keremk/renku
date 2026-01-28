import { GripVertical } from "lucide-react";
import type { TimelineClip, TimelineDocument } from "@/types/timeline";
import { cn } from "@/lib/utils";

interface TimelineTracksProps {
  timeline: TimelineDocument;
  currentTime: number;
  totalContentDuration: number;
  pixelsPerSecond: number;
  onSeek: (time: number) => void;
  className?: string;
}

const channelHeight = 48;
const trackHeight = 40;

export const TimelineTracks = ({
  timeline,
  currentTime,
  totalContentDuration,
  pixelsPerSecond,
  onSeek,
  className,
}: TimelineTracksProps) => {
  const totalTimelineHeight = Math.max(timeline.tracks.length, 1) * channelHeight;

  const handleTimelineClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const time = x / pixelsPerSecond;
    onSeek(Math.max(0, Math.min(time, totalContentDuration)));
  };

  const playheadPercent =
    totalContentDuration > 0
      ? Math.min((currentTime / totalContentDuration) * 100, 100)
      : 0;

  return (
    <div
      className={cn("overflow-y-auto", className)}
      style={{ height: `${totalTimelineHeight + 32}px` }}
    >
      <div className="relative p-4">
        <div className="px-2">
          <div
            className="relative cursor-pointer select-none w-full"
            style={{ height: `${totalTimelineHeight}px` }}
            onClick={handleTimelineClick}
          >
            {timeline.tracks.map((track, index) => (
              <div
                key={`bg-${track.id}-${index}`}
                className="absolute inset-x-0 border-b border-border/30"
                style={{ top: `${index * channelHeight}px`, height: `${channelHeight}px` }}
              />
            ))}

            {timeline.tracks.map((track, index) =>
              track.clips
                .slice()
                .sort((a, b) => a.startTime - b.startTime)
                .map((clip) => (
                  <div
                    key={clip.id}
                    className={cn(
                      "absolute rounded transition-all border border-white/20 text-white text-xs overflow-hidden",
                      getClipColor(track.kind),
                    )}
                    style={getClipStyle(clip, index, totalContentDuration)}
                  >
                    <div className="flex items-center gap-1 px-2 h-full text-white text-xs overflow-hidden">
                      <GripVertical className="w-3 h-3 opacity-70" />
                      <span className="truncate">{clip.id}</span>
                    </div>
                  </div>
                )),
            )}

            <div
              className="absolute top-0 w-0.5 bg-red-500 z-20 pointer-events-none inset-y-0"
              style={{ left: `${playheadPercent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const getClipColor = (kind: string) => {
  switch (kind) {
    case "Image":
      return "bg-indigo-600/80 hover:bg-indigo-500";
    case "Audio":
      return "bg-purple-600/80 hover:bg-purple-500";
    case "Music":
      return "bg-emerald-600/80 hover:bg-emerald-500";
    case "Video":
      return "bg-blue-600/80 hover:bg-blue-500";
    case "Captions":
      return "bg-amber-600/80 hover:bg-amber-500";
    default:
      return "bg-slate-600/80 hover:bg-slate-500";
  }
};

const getClipStyle = (
  clip: TimelineClip,
  trackIndex: number,
  totalContentDuration: number,
) => {
  const leftPercent =
    totalContentDuration > 0 ? (clip.startTime / totalContentDuration) * 100 : 0;
  const widthPercent =
    totalContentDuration > 0 ? (clip.duration / totalContentDuration) * 100 : 0;
  const verticalPadding = (channelHeight - trackHeight) / 2;
  const top = trackIndex * channelHeight + verticalPadding;

  return {
    left: `${leftPercent}%`,
    top: `${top}px`,
    width: `${Math.max(widthPercent, 0.5)}%`,
    height: `${trackHeight}px`,
  };
};
