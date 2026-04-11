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
  type: 'input' | 'producer' | 'output';
  label: string;
  /** Loop dimension (e.g., "segment" or "segment.image") */
  loop?: string;
  /** Producer type (e.g., "asset/text-to-image") */
  producerType?: string;
  /** Description from the blueprint */
  description?: string;
  /** Detailed incoming bindings for producer nodes */
  inputBindings?: ProducerBinding[];
  /** Detailed outgoing bindings for producer nodes */
  outputBindings?: ProducerBinding[];
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

export type SystemInputKind = 'user' | 'derived' | 'runtime';

export interface BlueprintInputSystemMeta {
  kind: SystemInputKind;
  userSupplied: boolean;
  source: 'declared' | 'synthetic';
}

export interface BlueprintInputDef {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  itemType?: string;
  countInput?: string;
  system?: BlueprintInputSystemMeta;
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
  /** Loop-indexed grouped input metadata for paged input editing */
  loopGroups?: BlueprintLoopGroup[];
  /** Count inputs that are managed by grouped loop controls */
  managedCountInputs?: string[];
}

export type BindingEndpointType = 'input' | 'producer' | 'output' | 'unknown';

export type BindingSelector =
  | {
      kind: 'loop';
      raw: string;
      symbol: string;
      offset: number;
    }
  | {
      kind: 'const';
      raw: string;
      value: number;
    };

export interface BindingEndpointSegment {
  name: string;
  selectors: BindingSelector[];
}

export interface ProducerBindingEndpoint {
  kind: Exclude<BindingEndpointType, 'unknown'>;
  reference: string;
  producerName?: string;
  inputName?: string;
  outputName?: string;
  segments: BindingEndpointSegment[];
  loopSelectors: Array<Extract<BindingSelector, { kind: 'loop' }>>;
  constantSelectors: Array<Extract<BindingSelector, { kind: 'const' }>>;
  arraySelectors: Array<{
    segment: string;
    segmentIndex: number;
    selector: BindingSelector;
  }>;
}

export interface ProducerBinding {
  from: string;
  to: string;
  sourceType: BindingEndpointType;
  targetType: BindingEndpointType;
  sourceEndpoint?: ProducerBindingEndpoint;
  targetEndpoint?: ProducerBindingEndpoint;
  conditionName?: string;
  isConditional: boolean;
}

export interface BlueprintLoopGroupMember {
  inputName: string;
}

export interface BlueprintLoopGroup {
  groupId: string;
  primaryDimension: string;
  countInput: string;
  countInputOffset: number;
  members: BlueprintLoopGroupMember[];
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
  format?: string;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  oneOf?: SchemaProperty[];
  anyOf?: SchemaProperty[];
  allOf?: SchemaProperty[];
  /** JSON Schema $ref for referencing other schema definitions */
  $ref?: string;
}

export type ViewerComponent =
  | 'string'
  | 'file-uri'
  | 'string-enum'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'nullable'
  | 'union'
  | 'object'
  | 'array-scalar'
  | 'array-file-uri'
  | 'array-object-cards'
  | 'placeholder-to-be-annotated';

export type MappingSource = 'none' | 'input' | 'artifact' | 'mixed';

export type UnionEditorConfig = EnumDimensionsUnionEditorConfig;

export interface EnumDimensionsUnionEditorConfig {
  type: 'enum-dimensions';
  enumVariantId: string;
  customVariantId: string;
  customSelection?:
    | {
        source: 'enum-value';
        value: string;
      }
    | {
        source: 'virtual-option';
        label?: string;
      };
}

export interface VoiceOption {
  value: string;
  label: string;
  tagline?: string;
  description?: string;
  preview_url?: string;
}

export interface VoiceIdCustomConfig {
  allow_custom?: boolean;
  options?: VoiceOption[];
  options_file?: string;
  options_rich?: VoiceOption[];
  [key: string]: unknown;
}

export interface ConfigFieldDescriptor {
  keyPath: string;
  component: ViewerComponent;
  custom?: string;
  customConfig?: VoiceIdCustomConfig;
  label: string;
  required: boolean;
  description?: string;
  presentation?: string;
  unionEditor?: UnionEditorConfig;
  schema?: SchemaProperty;
  mappingSource: MappingSource;
  mappedAliases: string[];
  fields?: ConfigFieldDescriptor[];
  item?: ConfigFieldDescriptor;
  value?: ConfigFieldDescriptor;
  variants?: ConfigFieldVariantDescriptor[];
}

export interface ConfigFieldVariantDescriptor extends ConfigFieldDescriptor {
  id: string;
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
  fields: ConfigFieldDescriptor[];
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
  /** Nested model schemas (if the producer's schema declares nested models) */
  nestedModels?: NestedModelConfigSchema[];
  /** Non-fatal per-model errors while building config descriptors */
  errorsByModel?: Record<string, ProducerContractError>;
}

/**
 * Declaration of a nested model slot within a parent model's schema.
 */
export interface NestedModelDeclaration {
  /** Unique name for this nested model slot (e.g., "stt") */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Path in config object where nested model lives (e.g., "stt") */
  configPath: string;
  /** Property name within configPath for provider (e.g., "provider") */
  providerField: string;
  /** Property name within configPath for model (e.g., "model") */
  modelField: string;
  /** Whether this nested model is required */
  required?: boolean;
  /** Filter available models by type */
  allowedTypes?: string[];
  /** Filter available providers */
  allowedProviders?: string[];
  /** Fields that are provided by the parent and should not be shown in nested model config UI */
  mappedFields?: string[];
}

/**
 * Schema information for a nested model slot.
 */
export interface NestedModelConfigSchema {
  /** Declaration from the parent schema's x-renku-nested-models */
  declaration: NestedModelDeclaration;
  /** Available models from catalog that match this slot's constraints */
  availableModels: Array<{ provider: string; model: string }>;
  /** Config schemas for each available nested model - key is "provider/model" */
  modelSchemas: Record<string, ModelConfigSchema>;
}

/**
 * Response from producer-config-schemas endpoint
 */
export interface ProducerConfigSchemasResponse {
  producers: Record<string, ProducerConfigSchemas>;
  errorsByProducer?: Record<string, ProducerContractError>;
}

export interface ProducerContractError {
  error: string;
  code: string;
}

export type ProducerFieldPreviewStatus = 'ok' | 'warning' | 'error';

export interface ProducerFieldPreviewFieldInstance {
  instanceId: string;
  instanceOrder: number;
  indices: Record<string, number>;
  value: unknown;
  status: ProducerFieldPreviewStatus;
  warnings: string[];
  errors: string[];
  connected: boolean;
  sourceAliases: string[];
  sourceBindings: Record<string, string>;
}

export interface ProducerFieldPreviewField {
  field: string;
  value: unknown;
  status: ProducerFieldPreviewStatus;
  warnings: string[];
  errors: string[];
  connected: boolean;
  sourceAliases: string[];
  schemaType?: string;
  enumOptions?: unknown[];
  connectionBehavior?: 'invariant' | 'variant' | 'conditional';
  overridePolicy?: 'editable' | 'read_only_dynamic';
  instances?: ProducerFieldPreviewFieldInstance[];
}

export interface ProducerFieldPreviewEntry {
  producerId: string;
  fields: ProducerFieldPreviewField[];
}

export interface ProducerFieldPreviewResponse {
  producers: Record<string, ProducerFieldPreviewEntry>;
  errorsByProducer?: Record<string, ProducerContractError>;
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
  source?: 'build' | 'template';
}

/**
 * Response from GET /blueprints/builds/prompts
 */
export interface ProducerPromptsResponse {
  producerId: string;
  /** Source of the prompt data: 'build' if edited, 'template' if original */
  source: 'build' | 'template';
  /** The prompt data */
  prompts: PromptData;
  /** Path to the prompt file (for reference) */
  promptPath: string;
}
