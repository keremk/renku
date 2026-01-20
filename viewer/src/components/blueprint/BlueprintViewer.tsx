import { useState, useCallback } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { BlueprintFlow } from "./BlueprintFlow";
import { DetailPanel } from "./DetailPanel";
import type { BlueprintGraphData, InputTemplateData } from "@/types/blueprint-graph";

interface BlueprintViewerProps {
  graphData: BlueprintGraphData;
  inputData: InputTemplateData | null;
  movieId: string | null;
}

export function BlueprintViewer({
  graphData,
  inputData,
  movieId,
}: BlueprintViewerProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  return (
    <div className="h-screen w-screen bg-background text-foreground p-4 flex flex-col">
      {/* Detail Panel (top) */}
      <div className="h-[200px] flex-shrink-0 mb-4">
        <DetailPanel
          graphData={graphData}
          inputData={inputData}
          selectedNodeId={selectedNodeId}
          movieId={movieId}
        />
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
      <div className="flex items-center gap-6 text-xs text-muted-foreground pt-3 mt-3 border-t border-border/30">
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
