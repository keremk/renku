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
  /** Pre-computed layer assignments for producer nodes (nodeId -> layer index) */
  layerAssignments?: Record<string, number>;
  /** Total number of layers in the blueprint topology */
  layerCount?: number;
}

export interface InputTemplateData {
  inputs: Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
    value?: unknown;
  }>;
  models?: ModelSelectionValue[];
}

/**
 * Model selection for a producer as stored in inputs.yaml
 */
export interface ModelSelectionValue {
  producerId: string;
  provider: string;
  model: string;
  config?: Record<string, unknown>;
}

/**
 * Available model option from producer mappings
 */
export interface AvailableModelOption {
  provider: string;
  model: string;
}

/**
 * Producer category determines how models are sourced and displayed.
 * - 'asset': Models from producer mappings (e.g., asset/text-to-image)
 * - 'prompt': LLM models from catalog (custom blueprints with promptFile)
 * - 'composition': No model selection required (e.g., composition/*)
 */
export type ProducerCategory = 'asset' | 'prompt' | 'composition';

/**
 * Producer model info from API endpoint
 */
export interface ProducerModelInfo {
  description?: string;
  producerType?: string;
  category: ProducerCategory;
  availableModels: AvailableModelOption[];
}

/**
 * Response from producer-models endpoint
 */
export interface ProducerModelsResponse {
  producers: Record<string, ProducerModelInfo>;
}
