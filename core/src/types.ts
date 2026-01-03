import { Buffer } from 'buffer';

type Id = string;
type IsoDatetime = string;

// --- node kinds ---
export type NodeKind = "InputSource" | "Producer" | "Artifact";

// --- artifacts ---
export type ArtifactKind = string;

export interface Artifact {
  id: Id;
  kind: ArtifactKind;
  version: number;
  createdAt: IsoDatetime;
  producedBy: Id;          // Producer.id
  payloadRef: string;      // blob/key/URL; never inline raw bytes
  meta?: Record<string, unknown>;
}

// --- inputs (CUI) ---
export type InputSourceKind = string;

export interface InputSource<T = unknown> {
  id: Id;
  kind: InputSourceKind;
  value: T;
  editable: boolean;      // true for user-editable CUIs
  updatedAt: IsoDatetime;
}

// --- producers (GEN) ---
export type ProducerKind = string;

export type ProviderName = string;

/** Environment where the provider runs */
export type ProviderEnvironment = 'local' | 'cloud';

/** An attachment to pass additional data to a provider */
export interface ProviderAttachment {
  name: string;
  contents: string;
  format: 'json' | 'toml' | 'text';
}

export interface Producer {
  id: Id;
  kind: ProducerKind;
  provider: ProviderName;
  providerModel: string;
  // Input dependencies by id (InputSource or Artifact)
  inputs: Id[];
  // Declared outputs’ kinds (for planning)
  produces: ArtifactKind[];
  // Execution characteristics
  rateKey: string;          // key for rate-limiting bucket
  costClass?: "low" | "mid" | "high";
  medianLatencySec?: number;
}

export interface ProducerCatalogEntry {
  provider: ProviderName;
  providerModel: string;
  rateKey: string;
  costClass?: "low" | "mid" | "high";
  medianLatencySec?: number;
}

export type ProducerCatalog = Record<ProducerKind, ProducerCatalogEntry>;

// Allow both strict known types and string for user-defined/namespaced nodes
type NodeId<K extends NodeKind> =
  K extends "InputSource" ? (InputSourceKind | string) :
  K extends "Producer" ? (ProducerKind | string) :
  (ArtifactKind | string);

export type BlueprintNodeRef<K extends NodeKind = NodeKind> = {
  kind: K;
  id: NodeId<K>;
};

export interface BlueprintNode<K extends NodeKind = NodeKind> {
  ref: BlueprintNodeRef<K>;
  label?: string;
  description?: string;
}

export interface BlueprintEdge {
  from: BlueprintNodeRef;
  to: BlueprintNodeRef;
  note?: string;
}

// --- new simplified blueprint system ---

/**
 * Blueprint metadata.
 */
export interface BlueprintMeta {
  id: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  /** Path to TOML file with LLM prompts (relative to producer YAML file) */
  promptFile?: string;
  /** Path to JSON schema for structured output (relative to producer YAML file) */
  outputSchema?: string;
}

/**
 * Input declaration for validation/documentation.
 */
export interface BlueprintInput {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  itemType?: string;  // For array types
}

/**
 * Output declaration for validation/documentation.
 */
export interface BlueprintOutput {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  itemType?: string;  // For array types
}

/**
 * Reference to a sub-blueprint.
 */
export interface SubBlueprintRef {
  id: string;           // Used in node refs (e.g., "ScriptGeneration")
  blueprintId: string;  // Matches loaded blueprint's meta.id
  path?: string;        // Optional path override for locating the sub-blueprint file
}

/**
 * Producer configuration (inline in blueprint).
 * All properties beyond the core ones are provider-specific and passed through as-is.
 */
export interface ProducerConfig {
  name: string;  // Must match ProducerKind
  // Legacy single-model fields (kept for backward compatibility)
  provider?: ProviderName;
  model?: string;
  systemPrompt?: string;
  userPrompt?: string;
  jsonSchema?: string;
  textFormat?: string;
  variables?: string[];
  sdkMapping?: Record<string, BlueprintProducerSdkMappingField>;
  outputs?: Record<string, BlueprintProducerOutputDefinition>;
  config?: Record<string, unknown>;
  // Preferred multi-model definition
  models?: ProducerModelVariant[];
  // Any other provider-specific attributes
  [key: string]: unknown;
}

/**
 * Unresolved edge with string references (before flattening).
 * String references support dot notation for sub-blueprint nodes.
 */
export interface UnresolvedBlueprintEdge {
  from: string | BlueprintNodeRef;
  to: string | BlueprintNodeRef;
  note?: string;
}

/**
 * Simplified blueprint definition.
 * Replaces GraphBlueprint and BlueprintSection with a flat structure.
 * Edges use string references that get resolved during flattening.
 */
export interface Blueprint {
  meta: BlueprintMeta;
  inputs: BlueprintInput[];
  outputs: BlueprintOutput[];
  subBlueprints: SubBlueprintRef[];
  nodes: BlueprintNode[];
  edges: UnresolvedBlueprintEdge[];
  producers: ProducerConfig[];
}

// --- Blueprint V2 definitions ---

export interface BlueprintInputDefinition {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  fanIn?: boolean;
}

/**
 * Mapping from a JSON array path to its dimension sizing input.
 * Used for decomposing JSON artifacts into multiple separate artifacts.
 */
export interface ArrayDimensionMapping {
  /** Path to the array property (e.g., "Segments" or "Segments.ImagePrompts") */
  path: string;
  /** Input name that determines the array size (e.g., "NumOfSegments") */
  countInput: string;
  /** Optional offset for the count */
  countInputOffset?: number;
}

/**
 * JSON schema definition for structured output validation.
 */
export interface JsonSchemaDefinition {
  name: string;
  strict?: boolean;
  schema: JsonSchemaProperty;
}

/**
 * JSON schema property definition (recursive).
 */
export interface JsonSchemaProperty {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  description?: string;
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  required?: string[];
  enum?: string[];
  additionalProperties?: boolean;
}

export interface BlueprintArtefactDefinition {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  itemType?: string;
  countInput?: string;
  countInputOffset?: number;
  /** For type: json artifacts - array dimension mappings for decomposition */
  arrays?: ArrayDimensionMapping[];
  /** For type: json artifacts - the parsed JSON schema */
  schema?: JsonSchemaDefinition;
}

export interface BlueprintProducerSdkMappingField {
  /** Target API field name. Optional when using expand:true */
  field?: string;
  type?: string;
  /**
   * Value transformation mapping. Maps input values to model-specific values.
   * Keys are the input values (as strings), values are what to send to the model.
   * Example: { "1K": { width: 1024, height: 1024 }, "2K": "auto_2K" }
   */
  transform?: Record<string, unknown>;
  /**
   * When true, the transformed value (which must be an object) is spread into
   * the payload instead of being assigned to a single field. This enables
   * one input to map to multiple output fields.
   * Example: Size with expand:true and transform { "1K": { width: 1024, height: 1024 } }
   * results in payload.width = 1024 and payload.height = 1024
   */
  expand?: boolean;
}

export interface BlueprintProducerOutputDefinition {
  type: string;
  mimeType?: string;
}

export interface ProducerModelVariant {
  provider: ProviderName;
  model: string;
  promptFile?: string;
  inputSchema?: string;
  outputSchema?: string;
  /** Parsed JSON schema for structured output (if outputSchema is provided) */
  outputSchemaParsed?: JsonSchemaDefinition;
  inputs?: Record<string, BlueprintProducerSdkMappingField>;
  outputs?: Record<string, BlueprintProducerOutputDefinition>;
  config?: Record<string, unknown>;
  systemPrompt?: string;
  userPrompt?: string;
  textFormat?: string;
  variables?: string[];
}

export interface BlueprintEdgeDefinition {
  from: string;
  to: string;
  note?: string;
  /** Reference to a named condition defined in the conditions block */
  if?: string;
  /** Inline condition definition */
  conditions?: EdgeConditionDefinition;
}

// === Condition Types ===

/**
 * Operators for condition evaluation.
 */
export type ConditionOperator =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterOrEqual'
  | 'lessOrEqual'
  | 'exists'
  | 'matches';

/**
 * A single condition clause.
 * Specifies a path to an artifact field and an operator/value to compare.
 */
export interface EdgeConditionClause {
  /** Path to artifact field with dimensions (e.g., "Producer.Output.Field[segment]") */
  when: string;
  /** Equality check */
  is?: unknown;
  /** Inequality check */
  isNot?: unknown;
  /** String/array contains check */
  contains?: unknown;
  /** Greater than comparison */
  greaterThan?: number;
  /** Less than comparison */
  lessThan?: number;
  /** Greater than or equal comparison */
  greaterOrEqual?: number;
  /** Less than or equal comparison */
  lessOrEqual?: number;
  /** Check if value exists (non-null/undefined) */
  exists?: boolean;
  /** Regex pattern to match against */
  matches?: string;
}

/**
 * Condition group with AND/OR logic.
 */
export interface EdgeConditionGroup {
  /** All conditions must be true (AND) */
  all?: EdgeConditionClause[];
  /** Any condition must be true (OR) */
  any?: EdgeConditionClause[];
}

/**
 * A named condition definition (can be a clause or group).
 */
export type NamedConditionDefinition = EdgeConditionClause | EdgeConditionGroup;

/**
 * Map of condition name to definition.
 */
export type BlueprintConditionDefinitions = Record<string, NamedConditionDefinition>;

/**
 * Inline condition on an edge.
 */
export type EdgeConditionDefinition =
  | EdgeConditionClause
  | EdgeConditionClause[]
  | EdgeConditionGroup
  | (EdgeConditionClause | EdgeConditionGroup)[];

// === Resolved Condition Types (after dimension expansion) ===

/**
 * Resolved condition for runtime evaluation.
 * Contains the canonical artifact ID and field path.
 */
export interface ResolvedEdgeCondition {
  /** Canonical artifact ID (e.g., "Artifact:Producer.Output[0]") */
  sourceArtifactId: string;
  /** Path within the artifact to access (e.g., ["NarrationType"]) */
  fieldPath: string[];
  /** The operator to apply */
  operator: ConditionOperator;
  /** The value to compare against */
  compareValue: unknown;
}

/**
 * Resolved condition group with AND/OR logic.
 */
export interface ResolvedEdgeConditionGroup {
  logic: 'and' | 'or';
  conditions: (ResolvedEdgeCondition | ResolvedEdgeConditionGroup)[];
}

/**
 * Definition for importing a producer blueprint.
 *
 * Producers are imported via the `producers:` section in blueprint YAML.
 * They are inlined into the graph and do NOT create a namespace.
 * The `name` field is the alias used to refer to the producer in connections.
 */
export interface ProducerImportDefinition {
  /** Alias used to refer to this producer in connections (e.g., "ScriptProducer") */
  name: string;
  /** Path to the producer blueprint file (relative to this blueprint) */
  path?: string;
  /** Qualified producer name (e.g., "prompt/script", "asset/text-to-speech") */
  producer?: string;
  /** Optional description */
  description?: string;
  /** Loop variable if this producer runs in a loop context */
  loop?: string;
}

export interface BlueprintCollectorDefinition {
  name: string;
  from: string;
  into: string;
  groupBy: string;
  orderBy?: string;
}

/**
 * Loop dimension definition.
 * Defines a dimension for looping over artifacts.
 */
export interface BlueprintLoopDefinition {
  /** Dimension name used in edge references (e.g., "segment", "image") */
  name: string;
  /** Parent dimension name for nested loops */
  parent?: string;
  /** Input that provides the iteration count */
  countInput: string;
  /** Optional offset for the count */
  countInputOffset?: number;
}

export interface BlueprintDocument {
  meta: BlueprintMeta;
  inputs: BlueprintInputDefinition[];
  artefacts: BlueprintArtefactDefinition[];
  producers: ProducerConfig[];
  /** Producer imports from the `producers:` section. No namespace is created. */
  producerImports: ProducerImportDefinition[];
  edges: BlueprintEdgeDefinition[];
  collectors?: BlueprintCollectorDefinition[];
  /** Loop dimension definitions for artifact iteration */
  loops?: BlueprintLoopDefinition[];
  /** Named condition definitions for reuse across edges */
  conditions?: BlueprintConditionDefinitions;
  /** Provider/model-specific SDK mappings for media producers */
  mappings?: ProducerMappings;
}

export interface BlueprintTreeNode {
  id: string;
  namespacePath: string[];
  document: BlueprintDocument;
  children: Map<string, BlueprintTreeNode>;
  /** Absolute path to the source YAML file */
  sourcePath: string;
}

/**
 * Configuration for blueprint expansion.
 */
export interface BlueprintExpansionConfig {
  segmentCount: number;
  imagesPerSegment: number;
}

// --- build / planning ---
export type RevisionId = `rev-${string}`;

export interface ProducerJobContextExtras {
  resolvedInputs?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FanInDescriptor {
  groupBy: string;
  orderBy?: string;
  members: FanInMember[];
}

export interface FanInMember {
  id: Id;
  group: number;
  order?: number;
}

/**
 * Condition info for a specific input edge.
 */
export interface InputConditionInfo {
  /** The condition definition */
  condition: EdgeConditionDefinition;
  /** Dimension indices for resolving condition paths at runtime */
  indices: Record<string, number>;
}

export interface ProducerJobContext {
  namespacePath: string[];
  indices: Record<string, number>;
  /** The producer alias - the reference name used in blueprint connections */
  producerAlias: string;
  inputs: Id[];
  produces: Id[];
  inputBindings?: Record<string, Id>;
  sdkMapping?: Record<string, BlueprintProducerSdkMappingField>;
  outputs?: Record<string, BlueprintProducerOutputDefinition>;
  extras?: ProducerJobContextExtras;
  fanIn?: Record<string, FanInDescriptor>;
  /** Conditions for each input (keyed by input ID) */
  inputConditions?: Record<Id, InputConditionInfo>;
}

export interface JobDescriptor {
  jobId: Id;
  producer: ProducerKind | string;
  inputs: Id[];
  produces: Id[];
  provider: ProviderName;
  providerModel: string;
  rateKey: string;
  context?: ProducerJobContext;
}

export interface ExecutionPlan {
  revision: RevisionId;
  manifestBaseHash: string;
  layers: JobDescriptor[][];
  createdAt: IsoDatetime;
}

export interface BlobRef {
  hash: string;
  size: number;
  mimeType: string;
}

export interface ManifestInputEntry {
  hash: string;
  payloadDigest: string;
  createdAt: IsoDatetime;
}

export interface ManifestArtefactEntry {
  hash: string;
  blob?: BlobRef;
  producedBy: Id;
  status: ArtefactEventStatus;
  diagnostics?: Record<string, unknown>;
  createdAt: IsoDatetime;
}

export interface Manifest {
  revision: RevisionId;
  baseRevision: RevisionId | null;
  createdAt: IsoDatetime;
  inputs: Record<string, ManifestInputEntry>;
  artefacts: Record<string, ManifestArtefactEntry>;
  timeline?: TimelineDocument;
}

export type TimelineDocument = Record<string, unknown>;

export interface ManifestPointer {
  revision: RevisionId | null;
  manifestPath: string | null;
  hash: string | null;
  updatedAt: IsoDatetime | null;
}

export interface Clock {
  now(): IsoDatetime;
}

export interface ProducerGraphNode {
  jobId: Id;
  producer: ProducerKind | string;
  inputs: Id[];
  produces: Id[];
  provider: ProviderName;
  providerModel: string;
  rateKey: string;
  context?: ProducerJobContext;
}

export interface ProducerGraphEdge {
  from: Id;
  to: Id;
  /** Resolved conditions for runtime evaluation */
  conditions?: ResolvedEdgeConditionGroup;
}

export interface ProducerGraph {
  nodes: ProducerGraphNode[];
  edges: ProducerGraphEdge[];
}

export type InputEventSource = 'user' | 'system';

export interface InputEvent {
  id: Id;
  revision: RevisionId;
  hash: string;
  payload: unknown;
  editedBy: InputEventSource;
  createdAt: IsoDatetime;
}

export type ArtefactEventStatus = 'succeeded' | 'failed' | 'skipped';

export interface ArtefactEventOutput {
  blob?: BlobRef;
}

export interface ArtefactEvent {
  artefactId: Id;
  revision: RevisionId;
  inputsHash: string;
  output: ArtefactEventOutput;
  status: ArtefactEventStatus;
  producedBy: Id;
  diagnostics?: Record<string, unknown>;
  createdAt: IsoDatetime;
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export interface ProducedBlobOutput {
  data: Uint8Array | string;
  mimeType: string;
}

export interface ProducedArtefact {
  artefactId: Id;
  status?: ArtefactEventStatus;
  blob?: ProducedBlobOutput;
  diagnostics?: Record<string, unknown>;
}

export interface ProduceRequest {
  movieId: Id;
  job: JobDescriptor;
  layerIndex: number;
  attempt: number;
  revision: RevisionId;
}

export interface ProduceResult {
  jobId: Id;
  status?: ArtefactEventStatus;
  artefacts: ProducedArtefact[];
  diagnostics?: Record<string, unknown>;
}

/* eslint-disable no-unused-vars */
export type ProduceFn = (request: ProduceRequest) => Promise<ProduceResult>;

export interface JobResult {
  jobId: Id;
  producer: ProducerKind | string;
  status: ArtefactEventStatus;
  artefacts: ArtefactEvent[];
  diagnostics?: Record<string, unknown>;
  layerIndex: number;
  attempt: number;
  startedAt: IsoDatetime;
  completedAt: IsoDatetime;
  error?: SerializedError;
}

export type RunStatus = 'succeeded' | 'failed';

export interface RunResult {
  status: RunStatus;
  revision: RevisionId;
  manifestBaseHash: string;
  jobs: JobResult[];
  startedAt: IsoDatetime;
  completedAt: IsoDatetime;
  buildManifest(): Promise<Manifest>;
}

// === Producer Mapping Types ===

/**
 * Condition for conditional transforms.
 * Evaluates whether a field should be included based on another input's value.
 */
export interface MappingCondition {
  /** Input name to check */
  input: string;
  /** Value equality check */
  equals?: unknown;
  /** Check if value is provided (non-null/undefined/empty) */
  notEmpty?: boolean;
  /** Check if value is NOT provided */
  empty?: boolean;
}

/**
 * Combine transform: merge multiple inputs into one field.
 * Uses a lookup table with composite keys in "{value1}+{value2}" format.
 */
export interface CombineTransform {
  /** Input names to combine (order matters for key format) */
  inputs: string[];
  /** Lookup table where keys are "{value1}+{value2}" format */
  table: Record<string, unknown>;
}

/**
 * Conditional transform: include field only when condition is met.
 */
export interface ConditionalTransform {
  when: MappingCondition;
  then: MappingFieldDefinition;
}

/**
 * Duration to frames transform configuration.
 */
export interface DurationToFramesConfig {
  fps: number;
}

/**
 * SDK mapping field definition with all transform types.
 * Supports: simple (string), transform, combine, conditional, firstOf, invert, intToString, durationToFrames.
 */
export interface MappingFieldDefinition {
  /** Target API field name (supports dot notation for nested: "voice_setting.voice_id") */
  field?: string;
  /** Type hint for the field */
  type?: string;
  /** Value lookup table (transform type) */
  transform?: Record<string, unknown>;
  /** Spread transformed object into payload (expand type) */
  expand?: boolean;
  /** Combine multiple inputs into one field */
  combine?: CombineTransform;
  /** Conditional field inclusion */
  conditional?: ConditionalTransform;
  /** Take first element from array input */
  firstOf?: boolean;
  /** Invert boolean value */
  invert?: boolean;
  /** Convert integer to string */
  intToString?: boolean;
  /** Convert duration (seconds) to frame count */
  durationToFrames?: DurationToFramesConfig;
}

/**
 * Mapping value can be either:
 * - string: simple field rename (e.g., "Prompt: prompt")
 * - MappingFieldDefinition: complex transform
 */
export type MappingValue = string | MappingFieldDefinition;

/**
 * Model-specific input mappings.
 * Maps producer input names to provider API field definitions.
 * Structure: { [producerInput]: MappingValue }
 */
export type InputMappings = Record<string, MappingValue>;

/**
 * Provider-specific model mappings.
 * Structure: { [model]: { [producerInput]: MappingValue } }
 */
export type ModelMappings = Record<string, InputMappings>;

/**
 * Producer mappings section.
 * Structure: { [provider]: { [model]: { [producerInput]: MappingValue } } }
 */
export type ProducerMappings = Record<string, ModelMappings>;

/** Blob loaded from a local file. */
export interface BlobInput {
  data: Buffer;
  mimeType: string;
}

export function isBlobInput(value: unknown): value is BlobInput {
  return typeof value === 'object' && value !== null &&
         'data' in value && 'mimeType' in value &&
         (Buffer.isBuffer((value as BlobInput).data) ||
          (value as BlobInput).data instanceof Uint8Array);
}

export function isBlobRef(value: unknown): value is BlobRef {
  return typeof value === 'object' && value !== null &&
         'hash' in value && 'size' in value && 'mimeType' in value &&
         typeof (value as BlobRef).hash === 'string' &&
         typeof (value as BlobRef).size === 'number' &&
         typeof (value as BlobRef).mimeType === 'string';
}
