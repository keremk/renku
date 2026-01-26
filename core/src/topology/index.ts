/**
 * Topology service for computing layer assignments in DAGs.
 *
 * This provides a single source of truth for blueprint topology computation,
 * used by both the planner (for execution planning) and the viewer (for visualization).
 */

export interface GraphNode {
  id: string;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface TopologyResult {
  /** Maps node ID to its layer index (0-indexed) */
  layerAssignments: Map<string, number>;
  /** Total number of layers in the graph (max layer + 1) */
  layerCount: number;
}

/**
 * Computes layer assignments for nodes in a DAG using Kahn's algorithm.
 *
 * Each node is assigned to the earliest layer where all its dependencies
 * have been satisfied. This produces a topological ordering grouped into layers.
 *
 * @param nodes - Array of nodes with id property
 * @param edges - Array of edges with from/to properties
 * @returns Layer assignments and total layer count
 */
export function computeTopologyLayers<N extends GraphNode>(
  nodes: N[],
  edges: GraphEdge[]
): TopologyResult {
  if (nodes.length === 0) {
    return {
      layerAssignments: new Map(),
      layerCount: 0,
    };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));

  // Build indegree and adjacency maps (only for edges between known nodes)
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const node of nodes) {
    indegree.set(node.id, 0);
    adjacency.set(node.id, new Set());
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      continue;
    }
    adjacency.get(edge.from)!.add(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  // Kahn's algorithm with level tracking
  const queue: Array<{ nodeId: string; level: number }> = [];
  for (const [nodeId, degree] of indegree) {
    if (degree === 0) {
      queue.push({ nodeId, level: 0 });
    }
  }

  const levelMap = new Map<string, number>();

  while (queue.length > 0) {
    const { nodeId, level } = queue.shift()!;
    const currentLevel = levelMap.get(nodeId);
    if (currentLevel !== undefined && currentLevel <= level) {
      continue;
    }
    levelMap.set(nodeId, level);

    const neighbors = adjacency.get(nodeId);
    if (!neighbors) {
      continue;
    }
    for (const neighbor of neighbors) {
      const remaining = (indegree.get(neighbor) ?? 0) - 1;
      indegree.set(neighbor, remaining);
      if (remaining === 0) {
        queue.push({ nodeId: neighbor, level: level + 1 });
      }
    }
  }

  // Check for cycles (nodes with remaining indegree > 0)
  const unvisited = nodes.filter(
    (n) => !levelMap.has(n.id) || (indegree.get(n.id) ?? 0) > 0
  );
  if (unvisited.length > 0) {
    // Handle cycles by assigning unvisited nodes to layer 0
    // The planner will detect and throw on cycles separately
    for (const node of unvisited) {
      if (!levelMap.has(node.id)) {
        levelMap.set(node.id, 0);
      }
    }
  }

  const maxLevel = levelMap.size === 0 ? 0 : Math.max(...levelMap.values());

  return {
    layerAssignments: levelMap,
    layerCount: maxLevel + 1,
  };
}

/**
 * Simplified version that returns just the layer count.
 * Useful when you only need to know how many layers exist.
 */
export function computeLayerCount<N extends GraphNode>(
  nodes: N[],
  edges: GraphEdge[]
): number {
  return computeTopologyLayers(nodes, edges).layerCount;
}
