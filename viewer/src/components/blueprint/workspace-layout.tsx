import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { DetailPanel } from "./detail-panel";
import { BuildsListSidebar } from "./builds-list-sidebar";
import { RunButton } from "./run-button";
import { PlanDialog } from "./plan-dialog";
import { BottomTabbedPanel } from "./bottom-tabbed-panel";
import { ExecutionProvider, useExecution } from "@/contexts/execution-context";
import { computeBlueprintLayerCount } from "@/lib/blueprint-layout";
import { enableBuildEditing } from "@/data/blueprint-client";
import { useBuildInputs, useProducerModels, usePanelResizer, useBottomPanelTabs } from "@/hooks";
import type {
  BlueprintGraphData,
  InputTemplateData,
  ModelSelectionValue,
} from "@/types/blueprint-graph";
import type { BuildInfo, BuildManifestResponse } from "@/types/builds";

interface WorkspaceLayoutProps {
  graphData: BlueprintGraphData;
  inputData: InputTemplateData | null;
  movieId: string | null;
  /** Blueprint folder for builds listing */
  blueprintFolder: string | null;
  /** Blueprint name (folder name, e.g., "my-blueprint") for API calls */
  blueprintName: string;
  /** Full path to the blueprint YAML file */
  blueprintPath: string;
  /** Catalog root path (if using a catalog) */
  catalogRoot?: string | null;
  /** List of builds in the folder */
  builds: BuildInfo[];
  /** Whether builds are loading */
  buildsLoading: boolean;
  /** Currently selected build ID */
  selectedBuildId: string | null;
  /** Manifest data for the selected build */
  selectedBuildManifest: BuildManifestResponse | null;
  /** Callback to refresh builds list */
  onBuildsRefresh?: () => Promise<void>;
}

// Blueprint flow panel sizing (the graph at the bottom)
const MIN_BLUEPRINT_FLOW_PERCENT = 30;
const MAX_BLUEPRINT_FLOW_PERCENT = 70;
const DEFAULT_BLUEPRINT_FLOW_PERCENT = 30;

/**
 * Inner component that uses the execution context.
 */
function WorkspaceLayoutInner({
  graphData,
  inputData,
  movieId,
  blueprintFolder,
  blueprintName,
  blueprintPath,
  catalogRoot,
  builds,
  buildsLoading,
  selectedBuildId,
  selectedBuildManifest,
  onBuildsRefresh,
}: WorkspaceLayoutProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { state, initializeFromManifest, setTotalLayers } = useExecution();
  const isExecuting = state.status === 'executing';

  // Tab state management with auto-switching
  const { activeTab, setActiveTab } = useBottomPanelTabs({
    isExecuting,
    bottomPanelVisible: state.bottomPanelVisible,
  });

  // Find the selected build to check if it has inputs
  const selectedBuild = useMemo(
    () => builds.find((b) => b.movieId === selectedBuildId),
    [builds, selectedBuildId]
  );

  // Custom hooks for data fetching and panel resizing
  const { producerModels } = useProducerModels({
    blueprintPath,
    catalogRoot,
  });

  const {
    inputs: buildInputs,
    models: buildModels,
    isLoading: buildInputsLoading,
    saveInputs: handleSaveInputs,
    saveModels: handleSaveModels,
  } = useBuildInputs({
    blueprintFolder,
    blueprintPath,
    selectedBuildId,
    hasInputsFile: selectedBuild?.hasInputsFile ?? false,
    catalogRoot,
  });

  const {
    percent: blueprintFlowPercent,
    isDragging,
    handleMouseDown,
  } = usePanelResizer({
    containerRef,
    minPercent: MIN_BLUEPRINT_FLOW_PERCENT,
    maxPercent: MAX_BLUEPRINT_FLOW_PERCENT,
    defaultPercent: DEFAULT_BLUEPRINT_FLOW_PERCENT,
  });

  // Compute and set total layers from graph topology on load
  useEffect(() => {
    const layerCount = computeBlueprintLayerCount(graphData);
    setTotalLayers(layerCount);
  }, [graphData, setTotalLayers]);

  // Inputs panel is the inverse of blueprint flow
  const inputsPanelPercent = 100 - blueprintFlowPercent;

  // Determine if we should show the sidebar (only when blueprintFolder is available)
  const showSidebar = Boolean(blueprintFolder);

  // Convert parsed build inputs to InputTemplateData format
  const parsedBuildInputs = useMemo<InputTemplateData | null>(() => {
    if (!buildInputs || Object.keys(buildInputs).length === 0) return null;

    // Create a map of input definitions from graph for type/required info
    const inputDefMap = new Map<string, { type: string; required: boolean; description?: string }>();
    for (const inputDef of graphData.inputs) {
      inputDefMap.set(inputDef.name, {
        type: inputDef.type,
        required: inputDef.required,
        description: inputDef.description,
      });
    }

    // Convert server response to InputTemplateData format
    const inputs: InputTemplateData["inputs"] = [];
    for (const [name, value] of Object.entries(buildInputs)) {
      // Get type info from input definitions, with fallback
      const def = inputDefMap.get(name);
      inputs.push({
        name,
        value,
        type: def?.type ?? "string",
        required: def?.required ?? false,
        description: def?.description,
      });
    }

    return inputs.length > 0 ? { inputs } : null;
  }, [buildInputs, graphData.inputs]);

  // Model selections: prioritize build inputs, fall back to manifest models
  const parsedModelSelections = useMemo<ModelSelectionValue[]>(() => {
    // Use models from build inputs if available (editable builds)
    if (buildModels.length > 0) {
      return buildModels;
    }

    // Fall back to models from manifest (read-only builds)
    // API now extracts these into a separate field
    return selectedBuildManifest?.models ?? [];
  }, [buildModels, selectedBuildManifest?.models]);

  // Merge input data from build inputs or manifest
  const effectiveInputData = useMemo<InputTemplateData | null>(() => {
    // Priority: build inputs file > manifest inputs > template inputs
    if (parsedBuildInputs) {
      return parsedBuildInputs;
    }
    // If we have a selected build manifest with inputs, use those
    if (selectedBuildManifest?.inputs && Object.keys(selectedBuildManifest.inputs).length > 0) {
      const manifestInputs = Object.entries(selectedBuildManifest.inputs).map(([name, value]) => ({
        name,
        value,
        type: typeof value === 'string' ? 'string' :
              typeof value === 'number' ? 'number' :
              typeof value === 'boolean' ? 'boolean' : 'unknown',
        required: true,
      }));
      return { inputs: manifestInputs };
    }
    // Fall back to the input data from file
    return inputData;
  }, [inputData, selectedBuildManifest, parsedBuildInputs]);

  // Check if inputs are editable (has build with inputs file selected)
  const isInputsEditable = Boolean(
    blueprintFolder && selectedBuildId && selectedBuild?.hasInputsFile
  );

  // Check if editing can be enabled (build selected but no inputs file)
  const canEnableEditing = Boolean(
    blueprintFolder && selectedBuildId && selectedBuild && !selectedBuild.hasInputsFile
  );

  // Handle enabling editing for a build
  const handleEnableEditing = useCallback(async () => {
    if (!blueprintFolder || !selectedBuildId) return;

    await enableBuildEditing(blueprintFolder, selectedBuildId);
    // Refresh builds list to update hasInputsFile flag
    if (onBuildsRefresh) {
      await onBuildsRefresh();
    }
  }, [blueprintFolder, selectedBuildId, onBuildsRefresh]);

  // Initialize producer statuses from manifest when build changes
  useEffect(() => {
    if (selectedBuildManifest?.artefacts) {
      initializeFromManifest(selectedBuildManifest.artefacts);
    }
  }, [selectedBuildManifest, initializeFromManifest]);

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  // Determine effective movie ID - use selected build or passed movieId
  const effectiveMovieId = selectedBuildId ?? movieId;

  // Create the Run button to pass to DetailPanel
  const runButton = (
    <RunButton blueprintName={blueprintName} movieId={effectiveMovieId ?? undefined} />
  );

  // Check if we have execution logs to show
  const hasExecutionLogs = state.executionLogs.length > 0;

  return (
    <div
      className="h-screen w-screen bg-background text-foreground p-4 flex flex-col"
      style={{ userSelect: isDragging ? "none" : "auto" }}
    >
      {/* Resizable panels wrapper */}
      <div ref={containerRef} className="flex-1 min-h-0 flex flex-col">
        {/* Top Panel: Sidebar + Detail Panel */}
        <div
          className="shrink-0 min-h-0 overflow-hidden flex gap-4"
          style={{ flexBasis: `${inputsPanelPercent}%`, maxHeight: `${inputsPanelPercent}%` }}
        >
          {/* Builds Sidebar (fixed width) */}
          {showSidebar && (
            <div className="w-64 shrink-0">
              <BuildsListSidebar
                builds={builds}
                selectedBuildId={selectedBuildId}
                isLoading={buildsLoading || buildInputsLoading}
                blueprintFolder={blueprintFolder}
                onRefresh={onBuildsRefresh}
              />
            </div>
          )}

          {/* Detail Panel (flexible width) */}
          <div className="flex-1 min-w-0">
            <DetailPanel
              graphData={graphData}
              inputData={effectiveInputData}
              selectedNodeId={selectedNodeId}
              movieId={effectiveMovieId}
              blueprintFolder={blueprintFolder}
              artifacts={selectedBuildManifest?.artefacts ?? []}
              actionButton={runButton}
              isInputsEditable={isInputsEditable}
              onSaveInputs={handleSaveInputs}
              canEnableEditing={canEnableEditing}
              onEnableEditing={handleEnableEditing}
              producerModels={producerModels}
              modelSelections={parsedModelSelections}
              onSaveModels={handleSaveModels}
            />
          </div>
        </div>

        {/* Resize Handle */}
        <div
          className="shrink-0 h-2 flex items-center justify-center cursor-row-resize group"
          onMouseDown={handleMouseDown}
        >
          <div className={`w-16 h-1 rounded-full transition-colors ${
            isDragging
              ? "bg-primary"
              : "bg-border/60 group-hover:bg-border"
          }`} />
        </div>

        {/* Bottom Panel with Tabs (Blueprint Flow or Execution) */}
        <div
          className="shrink-0 min-h-0 rounded-xl border border-border/40 overflow-hidden relative flex flex-col"
          style={{ flexBasis: `${blueprintFlowPercent}%`, maxHeight: `${blueprintFlowPercent}%` }}
        >
          <BottomTabbedPanel
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isExecuting={isExecuting}
            hasLogs={hasExecutionLogs}
            graphData={graphData}
            onNodeSelect={handleNodeSelect}
            producerStatuses={state.producerStatuses}
            executionLogs={state.executionLogs}
          />
        </div>
      </div>

      {/* Plan Dialog */}
      <PlanDialog />
    </div>
  );
}

/**
 * WorkspaceLayout wrapped with ExecutionProvider.
 */
export function WorkspaceLayout(props: WorkspaceLayoutProps) {
  return (
    <ExecutionProvider>
      <WorkspaceLayoutInner {...props} />
    </ExecutionProvider>
  );
}
