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

// ============================================================================
// Config Schemas Types
// ============================================================================

/**
 * JSON Schema property definition.
 */
export interface SchemaProperty {
  type?: string;
  description?: string;
  title?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
}

/**
 * Config property with metadata for UI display.
 */
export interface ConfigProperty {
  /** Property key (e.g., "aspect_ratio", "imageClip.artifact") */
  key: string;
  /** JSON schema for this property */
  schema: SchemaProperty;
  /** Whether this property is required */
  required: boolean;
}

/**
 * Config schema for a specific provider/model combination.
 */
export interface ModelConfigSchema {
  provider: string;
  model: string;
  properties: ConfigProperty[];
}

/**
 * Config schemas for a producer's available models.
 */
export interface ProducerConfigSchemas {
  producerId: string;
  category: ProducerCategory;
  /** Config schemas per model - key is "provider/model" */
  modelSchemas: Record<string, ModelConfigSchema>;
}

/**
 * Response from producer-config-schemas endpoint
 */
export interface ProducerConfigSchemasResponse {
  producers: Record<string, ProducerConfigSchemas>;
}

// ============================================================================
// Prompts Types
// ============================================================================

/**
 * Prompt data structure from TOML file.
 */
export interface PromptData {
  /** Variables used in the prompts (e.g., ["Audience", "Duration"]) */
  variables?: string[];
  /** System prompt template */
  systemPrompt?: string;
  /** User prompt template */
  userPrompt?: string;
  /** Additional config from TOML */
  config?: Record<string, unknown>;
  /** Source of the prompt data: 'build' if edited, 'template' if original */
  source?: "build" | "template";
}

/**
 * Response from GET /blueprints/builds/prompts
 */
export interface ProducerPromptsResponse {
  producerId: string;
  /** Source of the prompt data: 'build' if edited, 'template' if original */
  source: "build" | "template";
  /** The prompt data */
  prompts: PromptData;
  /** Path to the prompt file (for reference) */
  promptPath: string;
}
