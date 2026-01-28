import { Play, Pause, RotateCcw, Film } from "lucide-react";
import { RemotionPreview } from "@/components/player/remotion-preview";
import { useMovieTimeline } from "@/services/use-movie-timeline";
import { usePreviewPlayback } from "@/hooks";

interface PreviewPanelProps {
  movieId: string | null;
  blueprintFolder: string | null;
  hasTimeline: boolean;
}

export function PreviewPanel({ movieId, blueprintFolder, hasTimeline }: PreviewPanelProps) {
  const { timeline, status, error } = useMovieTimeline(
    hasTimeline ? blueprintFolder : null,
    hasTimeline ? movieId : null
  );
  const { currentTime, isPlaying, play, pause, seek, reset } = usePreviewPlayback(movieId);

  // No build selected
  if (!movieId) {
    return (
      <EmptyState
        title="No Build Selected"
        description="Select a build from the sidebar to preview your movie."
      />
    );
  }

  // Build selected but no timeline artifact
  if (!hasTimeline) {
    return (
      <EmptyState
        title="No Preview Available"
        description="Run the pipeline fully to generate a timeline and preview your movie."
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

  // Success state - show player with controls
  const duration = timeline.duration ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* Playback controls */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border/40 bg-muted/30">
        {/* Play/Pause button */}
        <button
          type="button"
          onClick={isPlaying ? pause : play}
          className="p-1.5 rounded-md hover:bg-muted transition-colors text-foreground"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>

        {/* Reset button */}
        <button
          type="button"
          onClick={reset}
          className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Reset"
        >
          <RotateCcw className="size-4" />
        </button>

        {/* Time display */}
        <div className="text-xs text-muted-foreground font-mono">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>

      {/* Player */}
      <div className="flex-1 min-h-0">
        <RemotionPreview
          movieId={movieId}
          timeline={timeline}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onSeek={seek}
          onPlay={play}
          onPause={pause}
          blueprintFolder={blueprintFolder}
        />
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <Film className="size-8 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium text-foreground mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground max-w-[280px]">{description}</p>
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
