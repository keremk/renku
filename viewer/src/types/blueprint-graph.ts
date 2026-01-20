/**
 * Types for blueprint graph visualization.
 */

export interface BlueprintGraphMeta {
  id: string;
  name: string;
  description?: string;
  version?: string;
}

export interface BlueprintGraphNode {
  id: string;
  type: "input" | "producer" | "output";
  label: string;
  /** Loop dimension (e.g., "segment" or "segment.image") */
  loop?: string;
  /** Producer type (e.g., "asset/text-to-image") */
  producerType?: string;
  /** Description from the blueprint */
  description?: string;
}

export interface BlueprintGraphEdge {
  id: string;
  source: string;
  target: string;
  /** Reference to named condition if conditional */
  conditionName?: string;
  /** Whether this edge is conditional */
  isConditional?: boolean;
}

export interface BlueprintInputDef {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  itemType?: string;
}

export interface BlueprintOutputDef {
  name: string;
  type: string;
  description?: string;
  itemType?: string;
}

export interface ConditionDef {
  name: string;
  definition: unknown;
}

export interface BlueprintGraphData {
  meta: BlueprintGraphMeta;
  nodes: BlueprintGraphNode[];
  edges: BlueprintGraphEdge[];
  inputs: BlueprintInputDef[];
  outputs: BlueprintOutputDef[];
  conditions?: ConditionDef[];
}

export interface InputTemplateData {
  inputs: Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
    value?: unknown;
  }>;
}
