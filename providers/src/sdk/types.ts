import type {
  ProducerHandler,
  ProviderJobContext,
  ProviderResult,
  ProviderAttachment,
  ProviderDescriptor,
  ProviderLogger,
  ProviderMode,
} from '../types.js';
import type { BlueprintProducerSdkMappingField } from '@renku/core';

export type ProducerDomain = 'prompt' | 'media';

export interface ProducerExtras {
  plannerContext?: Record<string, unknown>;
  resolvedInputs?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProducerInvokeArgs {
  request: ProviderJobContext;
  runtime: ProducerRuntime;
}

export type ProducerInvokeFn = (args: ProducerInvokeArgs) => Promise<ProviderResult>;

export interface ProducerWarmStartArgs {
  handler: ProducerHandler;
  logger?: ProviderLogger;
  notifications?: import('@renku/core').NotificationBus;
}

export type ProducerWarmStartFn = (args: ProducerWarmStartArgs) => Promise<void>;

export interface ProducerRuntimeConfig {
  raw: unknown;
  parse<T = unknown>(schema?: (value: unknown) => T): T;
}

export interface AttachmentReader {
  all(): ProviderAttachment[];
  find(name: string): ProviderAttachment | undefined;
  text(name: string): string | undefined;
}

export interface ResolvedInputsAccessor {
  all(): Record<string, unknown>;
  get<T = unknown>(key: string): T | undefined;
  getByNodeId<T = unknown>(canonicalId: string): T | undefined;
}

export interface RuntimeSdkHelpers {
  buildPayload(
    sdkMapping?: Record<string, BlueprintProducerSdkMappingField>,
  ): Record<string, unknown>;
}

export interface ArtefactRegistry {
  expectBlob(artefactId: string): string;
}

export interface ProducerRuntime {
  descriptor: ProviderDescriptor;
  domain: ProducerDomain;
  mode: ProviderMode;
  config: ProducerRuntimeConfig;
  attachments: AttachmentReader;
  inputs: ResolvedInputsAccessor;
  sdk: RuntimeSdkHelpers;
  artefacts: ArtefactRegistry;
  logger?: ProviderLogger;
  notifications?: import('@renku/core').NotificationBus;
}
