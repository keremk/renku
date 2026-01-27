import { useMemo, useState } from "react";
import { RemotionPreview } from "@/components/player/RemotionPreview";
import { TimelineEditor } from "@/components/timeline/TimelineEditor";
import { BlueprintViewer } from "@/components/blueprint/BlueprintViewer";
import { useMovieRoute } from "@/hooks/use-movie-route";
import { useBlueprintRoute, isBlueprintRoute } from "@/hooks/use-blueprint-route";
import { useMovieTimeline } from "@/services/use-movie-timeline";
import { useBlueprintData } from "@/services/use-blueprint-data";
import { useBuildsList } from "@/services/use-builds-list";
import { useBuildManifest } from "@/services/use-build-manifest";
import type { TimelineDocument } from "@/types/timeline";

const clampTime = (time: number, duration: number) => {
  const maxDuration = Math.max(duration, 1);
  return Math.max(0, Math.min(time, maxDuration));
};

function App() {
  // Check if we're on a blueprint route
  if (isBlueprintRoute()) {
    return <BlueprintApp />;
  }

  return <MovieApp />;
}

function BlueprintApp() {
  const blueprintRoute = useBlueprintRoute();

  // Load blueprint data by name - this resolves the name to paths and fetches data
  const { graph, inputs, resolvedPaths, status, error } = useBlueprintData(
    blueprintRoute?.blueprintName ?? null,
    blueprintRoute?.inputsFilename
  );

  // Load builds list when blueprint folder is available (from resolved paths)
  const { builds, status: buildsStatus, refetch: refetchBuilds } = useBuildsList(
    resolvedPaths?.blueprintFolder ?? null
  );

  // Load manifest for selected build
  const { manifest: selectedBuildManifest } = useBuildManifest(
    resolvedPaths?.blueprintFolder ?? null,
    blueprintRoute?.selectedBuildId ?? null
  );

  if (!blueprintRoute?.blueprintName) {
    return (
      <LandingLayout>
        <h1 className="text-3xl font-semibold">Blueprint Viewer</h1>
        <p className="text-muted-foreground">
          No blueprint provided. Use the CLI:
        </p>
        <code className="text-sm bg-muted/50 p-2 rounded">
          renku viewer:blueprint --bp=&lt;blueprint-name&gt;
        </code>
      </LandingLayout>
    );
  }

  if (status === "loading" || status === "idle") {
    return (
      <LandingLayout>
        <p className="text-lg text-muted-foreground">Loading blueprint...</p>
      </LandingLayout>
    );
  }

  if (error || !graph) {
    return (
      <LandingLayout>
        <h1 className="text-2xl font-semibold">Unable to load blueprint</h1>
        <p className="text-muted-foreground">{error?.message ?? "Blueprint data unavailable."}</p>
      </LandingLayout>
    );
  }

  return (
    <BlueprintViewer
      graphData={graph}
      inputData={inputs}
      movieId={blueprintRoute.movieId}
      blueprintFolder={resolvedPaths?.blueprintFolder ?? null}
      blueprintName={blueprintRoute.blueprintName}
      blueprintPath={resolvedPaths?.blueprintPath ?? ""}
      catalogRoot={resolvedPaths?.catalogRoot}
      builds={builds}
      buildsLoading={buildsStatus === "loading"}
      selectedBuildId={blueprintRoute.selectedBuildId}
      selectedBuildManifest={selectedBuildManifest}
      onBuildsRefresh={refetchBuilds}
    />
  );
}

function MovieApp() {
  const movieId = useMovieRoute();
  const { timeline, status, error } = useMovieTimeline(movieId);

  if (!movieId) {
    return (
      <LandingLayout>
        <h1 className="text-3xl font-semibold">Select a Movie</h1>
        <p className="text-muted-foreground">
          Navigate to <code>/movies/&lt;movie-id&gt;</code> to load a build from your Renku workspace.
        </p>
      </LandingLayout>
    );
  }

  if (status === "loading" || status === "idle") {
    return (
      <LandingLayout>
        <p className="text-lg text-muted-foreground">Loading timeline for {movieId}…</p>
      </LandingLayout>
    );
  }

  if (error || !timeline) {
    return (
      <LandingLayout>
        <h1 className="text-2xl font-semibold">Unable to load timeline</h1>
        <p className="text-muted-foreground">{error?.message ?? "Timeline data unavailable."}</p>
      </LandingLayout>
    );
  }

  return <MovieViewer key={movieId} movieId={movieId} timeline={timeline} />;
}

const LandingLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-6">
    <div className="max-w-xl w-full rounded-2xl border border-border/50 bg-card/60 p-8 shadow-lg flex flex-col gap-4">
      {children}
    </div>
  </div>
);

export default App;

const MovieViewer = ({
  movieId,
  timeline,
}: {
  movieId: string;
  timeline: TimelineDocument;
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const duration = timeline?.duration ?? 0;

  const safeCurrentTime = useMemo(
    () => clampTime(currentTime, duration || 1),
    [currentTime, duration],
  );

  const handleSeek = (time: number) => {
    setCurrentTime(clampTime(time, duration || 1));
  };

  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);

  return (
    <div className="min-h-screen bg-background text-foreground px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="rounded-3xl bg-card shadow-xl border border-border/60 p-6 flex flex-col gap-4 min-h-[75vh]">
          <header className="flex flex-col gap-1">
            <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">
              Remotion Viewer
            </p>
            <h1 className="text-3xl font-semibold">{timeline.movieTitle ?? timeline.name ?? movieId}</h1>
            <p className="text-muted-foreground">
              Inspect timeline <span className="font-semibold">{timeline.id}</span> for movie{" "}
              <span className="font-semibold">{movieId}</span>.
            </p>
          </header>
          <div className="flex-1 min-h-0 flex flex-col gap-4">
            <div className="flex-shrink-0 overflow-hidden rounded-xl border border-border/40 bg-black/80 shadow-inner h-[360px]">
              <RemotionPreview
                movieId={movieId}
                timeline={timeline}
                currentTime={safeCurrentTime}
                isPlaying={isPlaying}
                onSeek={handleSeek}
                onPlay={handlePlay}
                onPause={handlePause}
              />
            </div>
            <div className="h-[360px]">
              <TimelineEditor
                timeline={timeline}
                currentTime={safeCurrentTime}
                isPlaying={isPlaying}
                onPlay={handlePlay}
                onPause={handlePause}
                onSeek={handleSeek}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
