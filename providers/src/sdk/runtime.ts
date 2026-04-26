import { isDeepStrictEqual } from 'node:util';
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
import { resolveInputValue } from './transforms.js';
import { createProviderError, SdkErrorCode } from './errors.js';
import { parseInputSchema, readSchemaProperties } from './compatibility.js';

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
  const inputs = createInputsAccessor(
    resolvedInputs,
    jobContext?.inputBindings ?? {},
    jobContext?.sdkMapping,
    logger
  );
  const sdk = createSdkHelper(
    inputs,
    request.context.providerConfig,
    jobContext,
    logger
  );
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
  source: Record<string, unknown>,
  inputBindings: Record<string, string>,
  sdkMapping:
    | Record<string, BlueprintProducerSdkMappingField | MappingFieldDefinition>
    | undefined,
  logger?: ProviderLogger
): ResolvedInputsAccessor {
  return {
    all() {
      return source;
    },
    get<T = unknown>(key: string) {
      return source[key] as T | undefined;
    },
    getByNodeId<T = unknown>(canonicalId: string) {
      return resolveInputValue(canonicalId, source) as T | undefined;
    },
    value<T = unknown>(inputName: string): T {
      const canonicalId = requireInputBinding(inputName, inputBindings);
      const value = resolveInputValue(canonicalId, source);
      if (value === undefined) {
        throw createProviderError(
          SdkErrorCode.MISSING_REQUIRED_INPUT,
          `Missing resolved input "${canonicalId}" for producer input "${inputName}".`,
          { kind: 'user_input', causedByUser: true }
        );
      }
      return value as T;
    },
    fanIn(inputName: string) {
      const canonicalId = requireInputBinding(inputName, inputBindings);
      const value = resolveInputValue(canonicalId, source);
      if (!isFanInValue(value)) {
        throw createProviderError(
          SdkErrorCode.MISSING_FANIN_DATA,
          `Producer input "${inputName}" is bound to "${canonicalId}", but the resolved value is not fan-in data.`,
          { kind: 'user_input', causedByUser: true }
        );
      }
      return value;
    },
    async buildModelInput(mapping, inputSchema) {
      return buildSdkPayload({
        mapping: mapping ?? sdkMapping,
        resolvedInputs: source,
        inputBindings,
        inputSchema,
        logger,
      }).payload;
    },
  };
}

function requireInputBinding(
  inputName: string,
  inputBindings: Record<string, string>
): string {
  const canonicalId = inputBindings[inputName];
  if (!canonicalId) {
    throw createProviderError(
      SdkErrorCode.MISSING_REQUIRED_INPUT,
      `Missing input binding metadata for producer input "${inputName}".`,
      { kind: 'user_input', causedByUser: true }
    );
  }
  return canonicalId;
}

function isFanInValue(
  value: unknown
): value is { groupBy: string; orderBy?: string; groups: string[][] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as { groupBy?: unknown; groups?: unknown };
  return typeof record.groupBy === 'string' && Array.isArray(record.groups);
}

function createSdkHelper(
  inputs: ResolvedInputsAccessor,
  providerConfig: unknown,
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

      return mergeExactProviderConfigFields({
        payload: result.payload,
        providerConfig,
        inputSchema,
      });
    },
  };
}

function mergeExactProviderConfigFields(args: {
  payload: Record<string, unknown>;
  providerConfig: unknown;
  inputSchema?: string;
}): Record<string, unknown> {
  const schema = parseInputSchema(args.inputSchema);
  if (!schema) {
    return args.payload;
  }

  const properties = readSchemaProperties(schema);
  if (!properties) {
    return args.payload;
  }

  const explicitConfig = extractExplicitProviderConfig(args.providerConfig);
  if (!explicitConfig) {
    return args.payload;
  }

  const payload = { ...args.payload };
  for (const fieldName of Object.keys(properties)) {
    if (!(fieldName in explicitConfig)) {
      continue;
    }

    const configValue = explicitConfig[fieldName];
    if (configValue === undefined) {
      continue;
    }

    const existingValue = payload[fieldName];
    if (existingValue !== undefined) {
      if (!isDeepStrictEqual(existingValue, configValue)) {
        throw createProviderError(
          SdkErrorCode.INVALID_CONFIG,
          `Provider config field "${fieldName}" conflicts with the mapped payload value. Remove one of the values so the field is set explicitly only once.`,
          {
            kind: 'user_input',
            causedByUser: true,
            metadata: {
              fieldName,
              mappedValue: existingValue,
              configValue,
            },
          }
        );
      }
      continue;
    }

    payload[fieldName] = configValue;
  }

  return payload;
}

function extractExplicitProviderConfig(
  providerConfig: unknown
): Record<string, unknown> | undefined {
  if (!providerConfig || typeof providerConfig !== 'object' || Array.isArray(providerConfig)) {
    return undefined;
  }

  const record = providerConfig as Record<string, unknown>;
  const nestedConfig = record.config;
  if (
    nestedConfig &&
    typeof nestedConfig === 'object' &&
    !Array.isArray(nestedConfig)
  ) {
    return nestedConfig as Record<string, unknown>;
  }

  if ('defaults' in record || 'customAttributes' in record) {
    return undefined;
  }

  return record;
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
