import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { BlueprintFlow } from "./BlueprintFlow";
import { DetailPanel } from "./DetailPanel";
import { BuildsListSidebar } from "./BuildsListSidebar";
import { RunButton } from "./run-button";
import { PlanDialog } from "./plan-dialog";
import { ExecutionProvider, useExecution } from "@/contexts/execution-context";
import type { BlueprintGraphData, InputTemplateData } from "@/types/blueprint-graph";
import type { BuildInfo, BuildManifestResponse } from "@/types/builds";

interface BlueprintViewerProps {
  graphData: BlueprintGraphData;
  inputData: InputTemplateData | null;
  movieId: string | null;
  /** Blueprint folder for builds listing */
  blueprintFolder: string | null;
  /** Blueprint name (folder name, e.g., "my-blueprint") for API calls */
  blueprintName: string;
  /** List of builds in the folder */
  builds: BuildInfo[];
  /** Whether builds are loading */
  buildsLoading: boolean;
  /** Currently selected build ID */
  selectedBuildId: string | null;
  /** Manifest data for the selected build */
  selectedBuildManifest: BuildManifestResponse | null;
}

// Blueprint flow panel sizing (the graph at the bottom)
const MIN_BLUEPRINT_FLOW_PERCENT = 30;
const MAX_BLUEPRINT_FLOW_PERCENT = 70;
const DEFAULT_BLUEPRINT_FLOW_PERCENT = 30;

/**
 * Inner component that uses the execution context.
 */
function BlueprintViewerInner({
  graphData,
  inputData,
  movieId,
  blueprintFolder,
  blueprintName,
  builds,
  buildsLoading,
  selectedBuildId,
  selectedBuildManifest,
}: BlueprintViewerProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [blueprintFlowPercent, setBlueprintFlowPercent] = useState(DEFAULT_BLUEPRINT_FLOW_PERCENT);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { state, setTotalLayers, initializeFromManifest } = useExecution();

  // Inputs panel is the inverse of blueprint flow
  const inputsPanelPercent = 100 - blueprintFlowPercent;

  // Determine if we should show the sidebar (only when blueprintFolder is available)
  const showSidebar = Boolean(blueprintFolder);

  // Merge input data from manifest if a build is selected
  const effectiveInputData = useMemo<InputTemplateData | null>(() => {
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
  }, [inputData, selectedBuildManifest]);

  // Initialize producer statuses from manifest when build changes
  useEffect(() => {
    if (selectedBuildManifest?.artefacts) {
      initializeFromManifest(selectedBuildManifest.artefacts);
    }
  }, [selectedBuildManifest, initializeFromManifest]);

  // Calculate total layers from graph data for the layer slider
  useEffect(() => {
    // Count unique layers from producers
    const producers = graphData.nodes.filter(n => n.type === 'producer');
    // A simple heuristic: producers on a path define layers
    // For now, we'll use the number of producers as a rough estimate
    // This will be refined when the plan is created
    const estimatedLayers = Math.max(1, Math.ceil(producers.length / 2));
    setTotalLayers(estimatedLayers);
  }, [graphData, setTotalLayers]);

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const relativeY = e.clientY - containerRect.top;
      // Calculate inputs panel percent from top, then derive blueprint flow percent
      const inputsPercent = (relativeY / containerRect.height) * 100;
      const flowPercent = 100 - inputsPercent;
      const clampedFlowPercent = Math.max(MIN_BLUEPRINT_FLOW_PERCENT, Math.min(MAX_BLUEPRINT_FLOW_PERCENT, flowPercent));
      setBlueprintFlowPercent(clampedFlowPercent);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Determine effective movie ID - use selected build or passed movieId
  const effectiveMovieId = selectedBuildId ?? movieId;

  // Create the Run button to pass to DetailPanel
  const runButton = (
    <RunButton blueprintName={blueprintName} movieId={effectiveMovieId ?? undefined} />
  );

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
                isLoading={buildsLoading}
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

        {/* Blueprint Flow Panel (bottom - full width) */}
        <div
          className="shrink-0 min-h-0 rounded-xl border border-border/40 overflow-hidden relative"
          style={{ flexBasis: `${blueprintFlowPercent}%`, maxHeight: `${blueprintFlowPercent}%` }}
        >
          <ReactFlowProvider>
            <BlueprintFlow
              graphData={graphData}
              onNodeSelect={handleNodeSelect}
              producerStatuses={state.producerStatuses}
            />
          </ReactFlowProvider>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center text-xs text-muted-foreground pt-3 mt-3 border-t border-border/30 shrink-0">
        {/* Node types legend */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-blue-500/30 border border-blue-500/50" />
            <span>Input</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-3 rounded bg-card border border-border/60" />
            <span>Producer</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-purple-500/30 border border-purple-500/50" />
            <span>Output</span>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <div className="w-8 h-0 border-t border-gray-400" />
            <span>Connection</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-0 border-t border-dashed border-amber-400" />
            <span>Conditional</span>
          </div>
        </div>
      </div>

      {/* Plan Dialog */}
      <PlanDialog />
    </div>
  );
}

/**
 * BlueprintViewer wrapped with ExecutionProvider.
 */
export function BlueprintViewer(props: BlueprintViewerProps) {
  return (
    <ExecutionProvider>
      <BlueprintViewerInner {...props} />
    </ExecutionProvider>
  );
}
