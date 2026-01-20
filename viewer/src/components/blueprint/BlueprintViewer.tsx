import { useState, useCallback, useRef, useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { BlueprintFlow } from "./BlueprintFlow";
import { DetailPanel } from "./DetailPanel";
import type { BlueprintGraphData, InputTemplateData } from "@/types/blueprint-graph";

interface BlueprintViewerProps {
  graphData: BlueprintGraphData;
  inputData: InputTemplateData | null;
  movieId: string | null;
}

// Blueprint flow panel sizing (the graph at the bottom)
const MIN_BLUEPRINT_FLOW_PERCENT = 30;
const MAX_BLUEPRINT_FLOW_PERCENT = 70;
const DEFAULT_BLUEPRINT_FLOW_PERCENT = 30;

export function BlueprintViewer({
  graphData,
  inputData,
  movieId,
}: BlueprintViewerProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [blueprintFlowPercent, setBlueprintFlowPercent] = useState(DEFAULT_BLUEPRINT_FLOW_PERCENT);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Inputs panel is the inverse of blueprint flow
  const inputsPanelPercent = 100 - blueprintFlowPercent;

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

  return (
    <div
      className="h-screen w-screen bg-background text-foreground p-4 flex flex-col"
      style={{ userSelect: isDragging ? "none" : "auto" }}
    >
      {/* Resizable panels wrapper */}
      <div ref={containerRef} className="flex-1 min-h-0 flex flex-col">
        {/* Inputs/Outputs Panel (top) */}
        <div
          className="shrink-0 min-h-0 overflow-hidden"
          style={{ flexBasis: `${inputsPanelPercent}%`, maxHeight: `${inputsPanelPercent}%` }}
        >
          <DetailPanel
            graphData={graphData}
            inputData={inputData}
            selectedNodeId={selectedNodeId}
            movieId={movieId}
          />
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

        {/* Blueprint Flow Panel (bottom) */}
        <div
          className="shrink-0 min-h-0 rounded-xl border border-border/40 overflow-hidden relative"
          style={{ flexBasis: `${blueprintFlowPercent}%`, maxHeight: `${blueprintFlowPercent}%` }}
        >
          <ReactFlowProvider>
            <BlueprintFlow
              graphData={graphData}
              onNodeSelect={handleNodeSelect}
            />
          </ReactFlowProvider>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground pt-3 mt-3 border-t border-border/30 shrink-0">
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
  );
}
