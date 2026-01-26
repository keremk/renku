import type { Node, Edge } from "@xyflow/react";
import type { BlueprintGraphData } from "@/types/blueprint-graph";
import type { ProducerStatusMap } from "@/types/generation";

export interface LayoutConfig {
  nodeWidth: number;
  nodeHeight: number;
  horizontalSpacing: number;
  verticalSpacing: number;
}

const defaultConfig: LayoutConfig = {
  nodeWidth: 180,
  nodeHeight: 60,
  horizontalSpacing: 250,
  verticalSpacing: 80,
};

export interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
}

export function layoutBlueprintGraph(
  data: BlueprintGraphData,
  config: LayoutConfig = defaultConfig,
  producerStatuses?: ProducerStatusMap
): LayoutResult {
  const { nodes: graphNodes, edges: graphEdges } = data;

  // Separate nodes by type
  const inputNodes = graphNodes.filter((n) => n.type === "input");
  const producerNodes = graphNodes.filter((n) => n.type === "producer");
  const outputNodes = graphNodes.filter((n) => n.type === "output");

  // Use pre-computed layer assignments from server
  const producerLayers: Map<string, number> = new Map(
    Object.entries(data.layerAssignments ?? {})
  );

  // Position nodes in columns: inputs (left) -> producers (center) -> outputs (right)
  const nodes: Node[] = [];

  // Position inputs in the left column
  inputNodes.forEach((node, index) => {
    nodes.push({
      id: node.id,
      type: "inputNode",
      position: {
        x: 0,
        y: index * config.verticalSpacing,
      },
      data: {
        label: node.label,
        description: node.description,
      },
    });
  });

  // Position producers in the middle columns based on their layer
  // Sort by layer for consistent ordering within each layer
  const sortedProducers = [...producerNodes].sort((a, b) => {
    const layerA = producerLayers.get(a.id) ?? 0;
    const layerB = producerLayers.get(b.id) ?? 0;
    return layerA - layerB;
  });

  const layerCounts: Map<number, number> = new Map();

  sortedProducers.forEach((node) => {
    const layer = producerLayers.get(node.id) ?? 0;
    const layerIndex = layerCounts.get(layer) ?? 0;
    layerCounts.set(layer, layerIndex + 1);

    nodes.push({
      id: node.id,
      type: "producerNode",
      position: {
        x: (layer + 1) * config.horizontalSpacing,
        y: layerIndex * config.verticalSpacing,
      },
      data: {
        label: node.label,
        loop: node.loop,
        producerType: node.producerType,
        description: node.description,
        status: producerStatuses?.[node.label] ?? 'not-run-yet',
      },
    });
  });

  // Determine the rightmost layer
  const maxLayer = Math.max(0, ...Array.from(producerLayers.values()));

  // Position outputs in the right column
  outputNodes.forEach((node, index) => {
    nodes.push({
      id: node.id,
      type: "outputNode",
      position: {
        x: (maxLayer + 2) * config.horizontalSpacing,
        y: index * config.verticalSpacing,
      },
      data: {
        label: node.label,
        description: node.description,
      },
    });
  });

  // Convert edges
  const edges: Edge[] = graphEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.isConditional ? "conditionalEdge" : "default",
    data: {
      conditionName: edge.conditionName,
      isConditional: edge.isConditional,
    },
    animated: edge.isConditional,
    style: edge.isConditional
      ? { strokeDasharray: "5,5", stroke: "#888" }
      : undefined,
  }));

  return { nodes, edges };
}

/**
 * Get the total number of layers in a blueprint from server-provided data.
 * Layers are based on the longest path from inputs through producers.
 */
export function computeBlueprintLayerCount(data: BlueprintGraphData): number {
  return data.layerCount ?? 0;
}
