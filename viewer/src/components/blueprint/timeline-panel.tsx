import { Layers } from "lucide-react";
import { TimelineEditor } from "@/components/timeline/timeline-editor";
import type { TimelineDocument } from "@/types/timeline";

type TimelineStatus = "idle" | "loading" | "success" | "error";

interface TimelinePanelProps {
  timeline: TimelineDocument | null;
  status: TimelineStatus;
  error: Error | null;
  currentTime: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  hasTimeline: boolean;
  movieId: string | null;
}

export function TimelinePanel({
  timeline,
  status,
  error,
  currentTime,
  isPlaying,
  onPlay,
  onPause,
  onSeek,
  hasTimeline,
  movieId,
}: TimelinePanelProps) {
  // No build selected
  if (!movieId) {
    return (
      <EmptyState
        title="No Build Selected"
        description="Select a build from the sidebar to view the timeline."
      />
    );
  }

  // Build selected but no timeline artifact
  if (!hasTimeline) {
    return (
      <EmptyState
        title="No Timeline Available"
        description="Run the pipeline fully to generate a timeline."
      />
    );
  }

  // Loading state
  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground text-sm">Loading timeline...</div>
      </div>
    );
  }

  // Error state
  if (status === "error" || !timeline) {
    return (
      <EmptyState
        title="Failed to Load Timeline"
        description={error?.message ?? "An error occurred while loading the timeline."}
      />
    );
  }

  // Success state - show timeline editor
  return (
    <div className="h-full p-4 overflow-auto">
      <TimelineEditor
        timeline={timeline}
        currentTime={currentTime}
        isPlaying={isPlaying}
        onPlay={onPlay}
        onPause={onPause}
        onSeek={onSeek}
      />
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <Layers className="size-8 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium text-foreground mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground max-w-[280px]">{description}</p>
    </div>
  );
}
