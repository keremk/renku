import { WorkspaceLayout } from "@/components/blueprint/workspace-layout";
import { useBlueprintRoute } from "@/hooks/use-blueprint-route";
import { useBlueprintData } from "@/services/use-blueprint-data";
import { useBuildsList } from "@/services/use-builds-list";
import { useBuildManifest } from "@/services/use-build-manifest";

function App() {
  return <BlueprintApp />;
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
          renku viewer ./path/to/blueprint.yaml
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
    <WorkspaceLayout
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

const LandingLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-6">
    <div className="max-w-xl w-full rounded-2xl border border-border/50 bg-card/60 p-8 shadow-lg flex flex-col gap-4">
      {children}
    </div>
  </div>
);

export default App;
