import type { Node, Edge } from "@xyflow/react";
import type { BlueprintGraphData, BlueprintGraphNode, BlueprintGraphEdge } from "@/types/blueprint-graph";
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

  // Build adjacency for topological ordering of producers
  const adjacency = buildAdjacency(graphNodes, graphEdges);
  const orderedProducers = topologicalSort(producerNodes, adjacency, graphEdges);

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
  const producerLayers = computeProducerLayers(orderedProducers, graphEdges);
  const layerCounts: Map<number, number> = new Map();

  orderedProducers.forEach((node) => {
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

function buildAdjacency(
  nodes: BlueprintGraphNode[],
  edges: BlueprintGraphEdge[]
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }

  for (const edge of edges) {
    const deps = adjacency.get(edge.target);
    if (deps) {
      deps.add(edge.source);
    }
  }

  return adjacency;
}

function topologicalSort(
  producerNodes: BlueprintGraphNode[],
  _adjacency: Map<string, Set<string>>,
  edges: BlueprintGraphEdge[]
): BlueprintGraphNode[] {
  const producerIds = new Set(producerNodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  // Initialize
  for (const node of producerNodes) {
    inDegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  // Count edges between producers
  for (const edge of edges) {
    if (producerIds.has(edge.source) && producerIds.has(edge.target)) {
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
      outgoing.get(edge.source)?.push(edge.target);
    }
  }

  // Kahn's algorithm
  const queue = producerNodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);
  const result: BlueprintGraphNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);

    for (const neighbor of outgoing.get(node.id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        const neighborNode = producerNodes.find((n) => n.id === neighbor);
        if (neighborNode) {
          queue.push(neighborNode);
        }
      }
    }
  }

  // Add any remaining nodes (in case of cycles or disconnected nodes)
  for (const node of producerNodes) {
    if (!result.includes(node)) {
      result.push(node);
    }
  }

  return result;
}

function computeProducerLayers(
  orderedProducers: BlueprintGraphNode[],
  edges: BlueprintGraphEdge[]
): Map<string, number> {
  const layers = new Map<string, number>();
  const producerIds = new Set(orderedProducers.map((n) => n.id));

  // Build reverse adjacency (predecessors)
  const predecessors = new Map<string, string[]>();
  for (const node of orderedProducers) {
    predecessors.set(node.id, []);
  }

  for (const edge of edges) {
    if (producerIds.has(edge.source) && producerIds.has(edge.target)) {
      predecessors.get(edge.target)?.push(edge.source);
    }
  }

  // Compute layers based on longest path from inputs
  for (const node of orderedProducers) {
    const preds = predecessors.get(node.id) ?? [];
    if (preds.length === 0) {
      layers.set(node.id, 0);
    } else {
      const maxPredLayer = Math.max(
        ...preds.map((pred) => layers.get(pred) ?? 0)
      );
      layers.set(node.id, maxPredLayer + 1);
    }
  }

  return layers;
}

/**
 * Compute the total number of layers in a blueprint from its graph topology.
 * Layers are based on the longest path from inputs through producers.
 */
export function computeBlueprintLayerCount(data: BlueprintGraphData): number {
  const { nodes: graphNodes, edges: graphEdges } = data;

  const producerNodes = graphNodes.filter((n) => n.type === "producer");

  // Handle empty case
  if (producerNodes.length === 0) {
    return 0;
  }

  // Build adjacency and sort
  const adjacency = buildAdjacency(graphNodes, graphEdges);
  const orderedProducers = topologicalSort(producerNodes, adjacency, graphEdges);

  // Compute layers
  const producerLayers = computeProducerLayers(orderedProducers, graphEdges);

  // Return total layer count (max layer + 1, since layers are 0-indexed)
  const maxLayer = Math.max(0, ...Array.from(producerLayers.values()));
  return maxLayer + 1;
}
