import type {
  ProviderAttachment,
  ProviderDescriptor,
  ProviderJobContext,
  ProviderLogger,
  ProviderMode,
} from '../types.js';
import type {
  ProducerRuntime,
  ProducerDomain,
  ProducerRuntimeConfig,
  AttachmentReader,
  ResolvedInputsAccessor,
  RuntimeSdkHelpers,
  ArtifactRegistry,
} from './types.js';
import {
  type BlueprintProducerSdkMappingField,
  type MappingFieldDefinition,
  type NotificationBus,
} from '@gorenku/core';
import { buildSdkPayload } from './payload-builder.js';
import { createProviderError, SdkErrorCode } from './errors.js';

interface SerializedJobContext {
  producerId?: string;
  inputBindings?: Record<string, string>;
  sdkMapping?: Record<
    string,
    BlueprintProducerSdkMappingField | MappingFieldDefinition
  >;
}

type ConfigValidator<T = unknown> = (value: unknown) => T;

interface RuntimeInit {
  descriptor: ProviderDescriptor;
  domain: ProducerDomain;
  request: ProviderJobContext;
  logger?: ProviderLogger;
  configValidator?: ConfigValidator;
  mode: ProviderMode;
  notifications?: NotificationBus;
}

export function createProducerRuntime(init: RuntimeInit): ProducerRuntime {
  const { descriptor, domain, request, logger, configValidator, mode } = init;
  const config = createRuntimeConfig(
    request.context.providerConfig,
    configValidator
  );
  const attachments = createAttachmentReader(
    request.context.rawAttachments ?? []
  );
  const resolvedInputs = resolveInputs(request.context.extras);
  const jobContext = extractJobContext(request.context.extras);
  const inputs = createInputsAccessor(resolvedInputs);
  const sdk = createSdkHelper(inputs, jobContext, logger);
  const artifacts = createArtifactRegistry(request.produces);

  return {
    descriptor,
    domain,
    mode,
    config,
    attachments,
    inputs,
    sdk,
    artifacts,
    logger,
    notifications: init.notifications,
  };
}

function createRuntimeConfig(
  raw: unknown,
  validator?: ConfigValidator
): ProducerRuntimeConfig {
  return {
    raw,
    parse<T = unknown>(schema?: (value: unknown) => T): T {
      const effective = (schema ?? validator) as
        | ((value: unknown) => T)
        | undefined;
      if (!effective) {
        return raw as T;
      }
      return effective(raw);
    },
  };
}

function createAttachmentReader(
  source: ProviderAttachment[]
): AttachmentReader {
  const attachments = [...source];
  return {
    all() {
      return attachments;
    },
    find(name: string) {
      return attachments.find((attachment) => attachment.name === name);
    },
    text(name: string) {
      const attachment = attachments.find((entry) => entry.name === name);
      return attachment ? attachment.contents : undefined;
    },
  };
}

function resolveInputs(
  extras: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!extras || typeof extras !== 'object') {
    return {};
  }
  const resolved = extras.resolvedInputs;
  if (!resolved || typeof resolved !== 'object') {
    return {};
  }
  return { ...(resolved as Record<string, unknown>) };
}

function extractJobContext(
  extras: Record<string, unknown> | undefined
): SerializedJobContext | undefined {
  if (!extras || typeof extras !== 'object') {
    return undefined;
  }
  const jobContext = (extras as Record<string, unknown>).jobContext;
  if (jobContext && typeof jobContext === 'object') {
    return jobContext as SerializedJobContext;
  }
  return undefined;
}

function createInputsAccessor(
  source: Record<string, unknown>
): ResolvedInputsAccessor {
  return {
    all() {
      return source;
    },
    get<T = unknown>(key: string) {
      return source[key] as T | undefined;
    },
    getByNodeId<T = unknown>(canonicalId: string) {
      return source[canonicalId] as T | undefined;
    },
  };
}

function createSdkHelper(
  inputs: ResolvedInputsAccessor,
  jobContext?: SerializedJobContext,
  logger?: ProviderLogger
): RuntimeSdkHelpers {
  return {
    async buildPayload(mapping, inputSchema) {
      const effectiveMapping = mapping ?? jobContext?.sdkMapping;
      const result = buildSdkPayload({
        mapping: effectiveMapping,
        resolvedInputs: inputs.all(),
        inputBindings: jobContext?.inputBindings ?? {},
        producerId: jobContext?.producerId,
        inputSchema,
        logger,
      });

      return result.payload;
    },
  };
}

function createArtifactRegistry(produces: string[]): ArtifactRegistry {
  const set = new Set(produces);
  function ensure(id: string): string {
    if (!set.has(id)) {
      throw createProviderError(
        SdkErrorCode.UNKNOWN_ARTIFACT,
        `Unknown artifact "${id}" for producer invoke.`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    return id;
  }
  return {
    expectBlob(artifactId: string) {
      return ensure(artifactId);
    },
  };
}
