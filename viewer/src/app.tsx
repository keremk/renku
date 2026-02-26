import { useEffect } from 'react';
import { WorkspaceLayout } from '@/components/blueprint/workspace-layout';
import {
  useBlueprintRoute,
  updateBlueprintRoute,
  clearLastFlag,
} from '@/hooks/use-blueprint-route';
import { reconcileBuildSelection } from '@/lib/build-selection';
import { useBlueprintData } from '@/services/use-blueprint-data';
import { useBuildsList } from '@/services/use-builds-list';
import { useBuildManifest } from '@/services/use-build-manifest';

function getFolderName(folderPath: string): string {
  const normalizedPath = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const segments = normalizedPath.split('/');
  return segments[segments.length - 1];
}

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
  const {
    builds,
    status: buildsStatus,
    blueprintFolder: buildsBlueprintFolder,
    refetch: refetchBuilds,
  } = useBuildsList(resolvedPaths?.blueprintFolder ?? null);

  // Load manifest for selected build
  const { manifest: selectedBuildManifest, refetch: refetchManifest } =
    useBuildManifest(
      resolvedPaths?.blueprintFolder ?? null,
      blueprintRoute?.selectedBuildId ?? null
    );

  // Reconcile build selection for the current blueprint.
  // - `last=1` always selects newest build (or clears when no builds exist)
  // - stale `build` URL params are repaired to newest build (or cleared when no builds exist)
  // - when `build` is absent, newest build is auto-selected if available
  useEffect(() => {
    if (!blueprintRoute?.blueprintName || buildsStatus !== 'success') return;
    if (!resolvedPaths?.blueprintFolder) return;

    // Ensure builds are from the current resolved blueprint.
    if (buildsBlueprintFolder !== resolvedPaths?.blueprintFolder) return;
    if (
      getFolderName(resolvedPaths.blueprintFolder) !==
      blueprintRoute.blueprintName
    )
      return;

    const decision = reconcileBuildSelection({
      builds,
      selectedBuildId: blueprintRoute.selectedBuildId,
      useLast: blueprintRoute.useLast,
    });

    if (decision.clearLastFlag) {
      clearLastFlag();
    }

    if (decision.shouldUpdateSelection) {
      updateBlueprintRoute(decision.nextBuildId);
    }
  }, [
    blueprintRoute?.blueprintName,
    blueprintRoute?.selectedBuildId,
    blueprintRoute?.useLast,
    buildsStatus,
    builds,
    buildsBlueprintFolder,
    resolvedPaths?.blueprintFolder,
  ]);

  if (!blueprintRoute?.blueprintName) {
    return (
      <LandingLayout>
        <h1 className='text-3xl font-semibold'>Blueprint Viewer</h1>
        <p className='text-muted-foreground'>
          No blueprint provided. Use the CLI:
        </p>
        <code className='text-sm bg-muted/50 p-2 rounded'>
          renku viewer ./path/to/blueprint.yaml
        </code>
      </LandingLayout>
    );
  }

  if (status === 'loading' || status === 'idle') {
    return (
      <LandingLayout>
        <p className='text-lg text-muted-foreground'>Loading blueprint...</p>
      </LandingLayout>
    );
  }

  if (error || !graph) {
    return (
      <LandingLayout>
        <h1 className='text-2xl font-semibold'>Unable to load blueprint</h1>
        <p className='text-muted-foreground'>
          {error?.message ?? 'Blueprint data unavailable.'}
        </p>
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
      blueprintPath={resolvedPaths?.blueprintPath ?? ''}
      catalogRoot={resolvedPaths?.catalogRoot}
      builds={builds}
      buildsLoading={buildsStatus === 'loading'}
      selectedBuildId={blueprintRoute.selectedBuildId}
      selectedBuildManifest={selectedBuildManifest}
      onBuildsRefresh={refetchBuilds}
      onManifestRefresh={refetchManifest}
    />
  );
}

const LandingLayout = ({ children }: { children: React.ReactNode }) => (
  <div className='min-h-screen flex items-center justify-center bg-background text-foreground px-6'>
    <div className='max-w-xl w-full rounded-2xl border border-border/50 bg-card/60 p-8 shadow-lg flex flex-col gap-4'>
      {children}
    </div>
  </div>
);

export default App;
