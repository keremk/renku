import type {
  ArtefactEventStatus,
  ProducedArtefact,
  ProviderName,
  ProviderEnvironment,
  ProviderAttachment,
  RevisionId,
  Logger,
  StorageContext,
} from '@gorenku/core';
import type { SchemaRegistry } from './schema-registry.js';

export type ProviderMode = 'mock' | 'live' | 'simulated';

// Re-export from core for backward compatibility
export type { ProviderEnvironment, ProviderAttachment } from '@gorenku/core';

export interface ProviderDescriptor {
  provider: ProviderName;
  model: string;
  environment: ProviderEnvironment;
}

export interface ProviderVariantMatch {
  provider: ProviderName | '*';
  model: string | '*';
  environment: ProviderEnvironment | '*';
}

export interface ProviderContextPayload {
  providerConfig?: unknown;
  rawAttachments?: ProviderAttachment[];
  environment?: ProviderEnvironment;
  observability?: Record<string, unknown>;
  extras?: Record<string, unknown>;
}

export interface SecretResolver {
  getSecret(key: string): Promise<string | null>;
}

export interface ProviderJobContext {
  jobId: string;
  provider: ProviderName;
  model: string;
  revision: RevisionId;
  layerIndex: number;
  attempt: number;
  inputs: string[];
  produces: string[];
  context: ProviderContextPayload;
  signal?: AbortSignal;
}

export interface ProviderResult {
  status?: ArtefactEventStatus;
  artefacts: ProducedArtefact[];
  diagnostics?: Record<string, unknown>;
}

export interface ProviderLogger extends Partial<Logger> {}

export interface WarmStartContext {
  logger?: ProviderLogger;
}

export interface ProducerHandler {
  provider: ProviderName;
  model: string;
  environment: ProviderEnvironment;
  mode: ProviderMode;
  warmStart?(context: WarmStartContext): Promise<void>;
  invoke(request: ProviderJobContext): Promise<ProviderResult>;
}

export interface HandlerFactoryInit {
  descriptor: ProviderDescriptor;
  mode: ProviderMode;
  secretResolver: SecretResolver;
  logger?: ProviderLogger;
  schemaRegistry?: SchemaRegistry;
  notifications?: import('@gorenku/core').NotificationBus;
  /** Cloud storage context for uploading blob inputs (optional). */
  cloudStorage?: StorageContext;
  /**
   * Handler resolver function allowing internal handlers to resolve and invoke
   * other handlers from the registry. Used for delegation patterns where one
   * handler needs to call another provider's handler (e.g., TranscriptionProducer
   * delegating to fal-ai STT handler).
   */
  handlerResolver?: (descriptor: ProviderDescriptor) => ProducerHandler;
  /**
   * Schema loader function for retrieving model schemas from the catalog.
   * Used by internal handlers that delegate to other providers and need
   * to pass the schema in the job context.
   */
  getModelSchema?: (provider: string, model: string) => Promise<string | null>;
}

export type HandlerFactory = (init: HandlerFactoryInit) => ProducerHandler;

export interface ProviderImplementation {
  match: ProviderVariantMatch;
  mode: ProviderMode;
  factory: HandlerFactory;
}

export type ProviderImplementationRegistry = ProviderImplementation[];

export interface ProviderRegistryOptions {
  mode?: ProviderMode;
  logger?: ProviderLogger;
  secretResolver?: SecretResolver;
  schemaRegistry?: SchemaRegistry;
  notifications?: import('@gorenku/core').NotificationBus;
  /** Cloud storage context for uploading blob inputs to S3-compatible storage. */
  cloudStorage?: StorageContext;
}

export interface ResolvedProviderHandler {
  descriptor: ProviderDescriptor;
  handler: ProducerHandler;
}

export interface ProviderRegistry {
  mode: ProviderMode;
  resolve(descriptor: ProviderDescriptor): ProducerHandler;
  resolveMany(descriptors: ProviderDescriptor[]): ResolvedProviderHandler[];
  warmStart?(bindings: ResolvedProviderHandler[]): Promise<void>;
}

// === Simulation Hints for Condition-Aware Mock Generation ===

/**
 * Hint for a field that should vary its values during simulation.
 * Used to exercise different conditional branches in dry-run mode.
 */
export interface VaryingFieldHint {
  /** Path to the field within the schema (e.g., "Segments.NarrationType") */
  path: string;
  /** Values to cycle through when generating array items */
  values: unknown[];
  /** Dimension name to vary on (e.g., "segment") - determines which array index to use for cycling */
  dimension?: string;
  /** Artifact path for matching (e.g., "DocProducer.VideoScript") */
  artifactPath: string;
}

/**
 * Hints for condition-aware mock generation.
 * Controls how simulated values are generated to test different branches.
 */
export interface ConditionHints {
  /** Fields that should vary their values */
  varyingFields: VaryingFieldHint[];
  /**
   * Generation mode:
   * - 'first-value': Use first enum/expected value (default legacy behavior)
   * - 'alternating': Alternate between values based on array index
   * - 'comprehensive': Try all combinations (future use)
   */
  mode: 'first-value' | 'alternating' | 'comprehensive';
}
