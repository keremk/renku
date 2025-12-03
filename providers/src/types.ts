import type {
  ArtefactEventStatus,
  ProducedArtefact,
  ProviderName,
  RevisionId,
  Logger,
} from '@renku/core';
import type { SchemaRegistry } from './schema-registry.js';

export type ProviderMode = 'mock' | 'live' | 'simulated';
export type ProviderEnvironment = 'local' | 'cloud';

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

export interface ProviderAttachment {
  name: string;
  contents: string;
  format: 'json' | 'toml' | 'text';
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
  notifications?: import('@renku/core').NotificationBus;
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
  notifications?: import('@renku/core').NotificationBus;
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
