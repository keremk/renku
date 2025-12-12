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
  defaultValue?: unknown;
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
  settings?: Record<string, unknown>;
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
  defaultValue?: unknown;
  fanIn?: boolean;
}

export interface BlueprintArtefactDefinition {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  itemType?: string;
  countInput?: string;
  countInputOffset?: number;
}

export interface BlueprintProducerSdkMappingField {
  field: string;
  type?: string;
  required?: boolean;
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
  inputs?: Record<string, BlueprintProducerSdkMappingField>;
  outputs?: Record<string, BlueprintProducerOutputDefinition>;
  config?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  systemPrompt?: string;
  userPrompt?: string;
  textFormat?: string;
  variables?: string[];
}

export interface BlueprintEdgeDefinition {
  from: string;
  to: string;
  note?: string;
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

export interface BlueprintDocument {
  meta: BlueprintMeta;
  inputs: BlueprintInputDefinition[];
  artefacts: BlueprintArtefactDefinition[];
  producers: ProducerConfig[];
  /** Producer imports from the `producers:` section. No namespace is created. */
  producerImports: ProducerImportDefinition[];
  edges: BlueprintEdgeDefinition[];
  collectors?: BlueprintCollectorDefinition[];
}

export interface BlueprintTreeNode {
  id: string;
  namespacePath: string[];
  document: BlueprintDocument;
  children: Map<string, BlueprintTreeNode>;
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
