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

const MIN_PANEL_PERCENT = 30;
const MAX_PANEL_PERCENT = 70;
const DEFAULT_PANEL_PERCENT = 30;

export function BlueprintViewer({
  graphData,
  inputData,
  movieId,
}: BlueprintViewerProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [detailPanelPercent, setDetailPanelPercent] = useState(DEFAULT_PANEL_PERCENT);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
      // Account for padding (16px top) and legend height (~40px)
      const availableHeight = containerRect.height - 56;
      const relativeY = e.clientY - containerRect.top - 16;
      const percent = (relativeY / availableHeight) * 100;
      const clampedPercent = Math.max(MIN_PANEL_PERCENT, Math.min(MAX_PANEL_PERCENT, percent));
      setDetailPanelPercent(clampedPercent);
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
      ref={containerRef}
      className="h-screen w-screen bg-background text-foreground p-4 flex flex-col"
      style={{ userSelect: isDragging ? "none" : "auto" }}
    >
      {/* Detail Panel (top) */}
      <div
        className="flex-shrink-0 min-h-0 overflow-hidden"
        style={{ height: `${detailPanelPercent}%` }}
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
        className="flex-shrink-0 h-2 flex items-center justify-center cursor-row-resize group"
        onMouseDown={handleMouseDown}
      >
        <div className={`w-16 h-1 rounded-full transition-colors ${
          isDragging
            ? "bg-primary"
            : "bg-border/60 group-hover:bg-border"
        }`} />
      </div>

      {/* Flow Panel (bottom) */}
      <div className="flex-1 min-h-0 rounded-xl border border-border/40 overflow-hidden relative">
        <ReactFlowProvider>
          <BlueprintFlow
            graphData={graphData}
            onNodeSelect={handleNodeSelect}
          />
        </ReactFlowProvider>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground pt-3 mt-3 border-t border-border/30 flex-shrink-0">
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
