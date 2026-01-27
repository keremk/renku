import { useCallback, useMemo, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  // MiniMap,
  useNodesState,
  useEdgesState,
  type OnNodesChange,
  // type Node,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { InputNode } from "./nodes/InputNode";
import { ProducerNode } from "./nodes/ProducerNode";
import { OutputNode } from "./nodes/OutputNode";
import { ConditionalEdge } from "./edges/ConditionalEdge";
import { layoutBlueprintGraph } from "@/lib/blueprint-layout";
import type { BlueprintGraphData } from "@/types/blueprint-graph";
import type { ProducerStatusMap } from "@/types/generation";

const nodeTypes: NodeTypes = {
  inputNode: InputNode,
  producerNode: ProducerNode,
  outputNode: OutputNode,
};

const edgeTypes: EdgeTypes = {
  conditionalEdge: ConditionalEdge,
};

interface BlueprintFlowProps {
  graphData: BlueprintGraphData;
  onNodeSelect?: (nodeId: string | null) => void;
  producerStatuses?: ProducerStatusMap;
}

export function BlueprintFlow({
  graphData,
  onNodeSelect,
  producerStatuses,
}: BlueprintFlowProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => layoutBlueprintGraph(graphData, undefined, producerStatuses),
    [graphData, producerStatuses]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Synchronize nodes and edges when layout changes (new build selected, graph changes, etc.)
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);

      // Find selection changes
      for (const change of changes) {
        if (change.type === "select") {
          if (change.selected) {
            onNodeSelect?.(change.id);
          }
        }
      }
    },
    [onNodesChange, onNodeSelect]
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect?.(null);
  }, [onNodeSelect]);

  return (
    <div className="absolute inset-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{
          padding: 0.2,
          maxZoom: 1.5,
        }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        <Background color="#333" gap={20} />
        <Controls
          className="!bg-card !border-border/60 !shadow-lg"
          showInteractive={false}
        />
        {/* <MiniMap
          className="!bg-card !border-border/60"
          nodeColor={(node: Node) => {
            switch (node.type) {
              case "inputNode":
                return "#3b82f6";
              case "producerNode":
                return "#6b7280";
              case "outputNode":
                return "#a855f7";
              default:
                return "#666";
            }
          }}
          maskColor="rgba(0,0,0,0.8)"
        /> */}
      </ReactFlow>
    </div>
  );
}
