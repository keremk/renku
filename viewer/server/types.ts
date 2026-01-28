/**
 * Shared type definitions for the viewer API.
 * These types are used across blueprints, builds, and movies modules.
 */

/**
 * Blueprint graph data for visualization.
 */
export interface BlueprintGraphData {
  meta: {
    id: string;
    name: string;
    description?: string;
    version?: string;
  };
  nodes: BlueprintGraphNode[];
  edges: BlueprintGraphEdge[];
  inputs: BlueprintInputDef[];
  outputs: BlueprintOutputDef[];
  conditions?: ConditionDef[];
  /** Pre-computed layer assignments for producer nodes (nodeId -> layer index) */
  layerAssignments?: Record<string, number>;
  /** Total number of layers in the blueprint topology */
  layerCount?: number;
}

/**
 * Graph node representing inputs, producers, or outputs.
 */
export interface BlueprintGraphNode {
  id: string;
  type: "input" | "producer" | "output";
  label: string;
  loop?: string;
  producerType?: string;
  description?: string;
}

/**
 * Graph edge connecting nodes.
 */
export interface BlueprintGraphEdge {
  id: string;
  source: string;
  target: string;
  conditionName?: string;
  isConditional?: boolean;
}

/**
 * Blueprint input definition for graph display.
 */
export interface BlueprintInputDef {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  itemType?: string;
}

/**
 * Blueprint output definition for graph display.
 */
export interface BlueprintOutputDef {
  name: string;
  type: string;
  description?: string;
  itemType?: string;
}

/**
 * Named condition definition.
 */
export interface ConditionDef {
  name: string;
  definition: unknown;
}
