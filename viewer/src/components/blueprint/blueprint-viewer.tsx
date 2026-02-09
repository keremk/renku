import { useCallback, useMemo, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  // MiniMap,
  useNodesState,
  useEdgesState,
  type OnNodesChange,
  type NodeMouseHandler,
  type Node,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { InputNode } from "./nodes/input-node";
import { ProducerNode } from "./nodes/producer-node";
import { OutputNode } from "./nodes/output-node";
import { ConditionalEdge } from "./edges/conditional-edge";
import { ProducerDetailsDialog, type ProducerDetails } from "./producer-details-dialog";
import { layoutBlueprintGraph } from "@/lib/blueprint-layout";
import type { BlueprintGraphData, ProducerBinding } from "@/types/blueprint-graph";
import type { ProducerStatusMap, ProducerStatus } from "@/types/generation";

const nodeTypes: NodeTypes = {
  inputNode: InputNode,
  producerNode: ProducerNode,
  outputNode: OutputNode,
};

const edgeTypes: EdgeTypes = {
  conditionalEdge: ConditionalEdge,
};

interface BlueprintViewerProps {
  graphData: BlueprintGraphData;
  onNodeSelect?: (nodeId: string | null) => void;
  producerStatuses?: ProducerStatusMap;
}

interface ProducerNodeData {
  label: string;
  loop?: string;
  producerType?: string;
  description?: string;
  status: ProducerStatus;
  inputBindings: ProducerBinding[];
  outputBindings: ProducerBinding[];
}

const validProducerStatuses: ProducerStatus[] = [
  "success",
  "error",
  "not-run-yet",
  "skipped",
  "running",
  "pending",
];

function parseProducerNodeData(node: Node): ProducerDetails {
  if (node.type !== "producerNode") {
    throw new Error(`Expected producer node type, received: ${String(node.type)}`);
  }

  const data = node.data as Partial<ProducerNodeData>;

  if (typeof data.label !== "string" || data.label.length === 0) {
    throw new Error(`Producer node ${node.id} is missing a label`);
  }
  if (!Array.isArray(data.inputBindings)) {
    throw new Error(`Producer node ${node.id} is missing input bindings`);
  }
  if (!Array.isArray(data.outputBindings)) {
    throw new Error(`Producer node ${node.id} is missing output bindings`);
  }
  if (typeof data.status !== "string" || !validProducerStatuses.includes(data.status as ProducerStatus)) {
    throw new Error(`Producer node ${node.id} has an invalid status`);
  }

  return {
    nodeId: node.id,
    label: data.label,
    loop: data.loop,
    producerType: data.producerType,
    description: data.description,
    status: data.status,
    inputBindings: data.inputBindings,
    outputBindings: data.outputBindings,
  };
}

export function BlueprintViewer({
  graphData,
  onNodeSelect,
  producerStatuses,
}: BlueprintViewerProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => layoutBlueprintGraph(graphData, undefined, producerStatuses),
    [graphData, producerStatuses]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [dialogProducer, setDialogProducer] = useState<ProducerDetails | null>(null);

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
    setDialogProducer(null);
  }, [onNodeSelect]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onNodeSelect?.(node.id);

      if (node.type === "producerNode") {
        setDialogProducer(parseProducerNodeData(node));
        return;
      }

      setDialogProducer(null);
    },
    [onNodeSelect]
  );

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDialogProducer(null);
    }
  }, []);

  return (
    <div className="absolute inset-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
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
      <ProducerDetailsDialog
        open={dialogProducer !== null}
        producer={dialogProducer}
        onOpenChange={handleDialogOpenChange}
      />
    </div>
  );
}
