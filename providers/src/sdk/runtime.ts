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
  ArtefactRegistry,
} from './types.js';
import {
  type BlueprintProducerSdkMappingField,
  type MappingFieldDefinition,
  type NotificationBus,
} from '@gorenku/core';
import {
  applyMapping,
  setNestedValue,
  type TransformContext,
} from './transforms.js';
import { createProviderError, SdkErrorCode } from './errors.js';
import {
  evaluateAndNormalizePayloadCompatibility,
  parseInputSchema,
  readSchemaProperties,
} from './compatibility.js';

interface SerializedJobContext {
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
  const artefacts = createArtefactRegistry(request.produces);

  return {
    descriptor,
    domain,
    mode,
    config,
    attachments,
    inputs,
    sdk,
    artefacts,
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
      if (!effectiveMapping) {
        return {};
      }

      // Parse schema to get required fields AND defaults (for validation only)
      // We don't apply defaults ourselves - provider APIs use their own defaults
      const schemaRequired = new Set<string>();
      const schemaDefaults = new Set<string>(); // Track which fields have defaults
      const parsedInputSchema = parseInputSchema(inputSchema);
      if (parsedInputSchema) {
        const required = parsedInputSchema.required;
        if (Array.isArray(required)) {
          for (const value of required) {
            if (typeof value === 'string') {
              schemaRequired.add(value);
            }
          }
        }

        const properties = readSchemaProperties(parsedInputSchema);
        if (properties) {
          for (const [field, propertySchema] of Object.entries(properties)) {
            if ('default' in propertySchema) {
              schemaDefaults.add(field);
            }
          }
        }
      }

      // Build transform context for the new transform engine
      const transformContext: TransformContext = {
        inputs: inputs.all(),
        inputBindings: jobContext?.inputBindings ?? {},
      };

      const payload: Record<string, unknown> = {};
      for (const [alias, fieldDef] of Object.entries(effectiveMapping)) {
        // Cast to MappingFieldDefinition (BlueprintProducerSdkMappingField is a subset)
        const mapping = fieldDef as MappingFieldDefinition;

        // Use the transform engine for all mappings
        const result = applyMapping(alias, mapping, transformContext);
        if (result === undefined) {
          // Transform returned undefined - check if this is a required field
          const isExpandField = mapping.expand === true;
          const fieldName = mapping.field ?? '';
          const isRequiredBySchema =
            inputSchema && !isExpandField && schemaRequired.has(fieldName);
          const hasSchemaDefault = schemaDefaults.has(fieldName);

          if (isRequiredBySchema && !hasSchemaDefault) {
            const canonicalId = jobContext?.inputBindings?.[alias] ?? alias;
            throw createProviderError(
              SdkErrorCode.MISSING_REQUIRED_INPUT,
              `Missing required input "${canonicalId}" for field "${fieldName}" (requested "${alias}"). No schema default available.`,
              { kind: 'user_input', causedByUser: true }
            );
          }
          // Skip field - provider will use its default if one exists
          continue;
        }

        if ('expand' in result) {
          Object.assign(payload, result.expand);
        } else {
          // Use setNestedValue to handle dot notation paths
          setNestedValue(payload, result.field, result.value);
        }
      }

      if (parsedInputSchema) {
        const compatibility = evaluateAndNormalizePayloadCompatibility(
          payload,
          parsedInputSchema
        );
        for (const issue of compatibility.issues) {
          if (issue.reason === 'normalized') {
            logger?.debug?.('providers.sdk.payload.enum-normalized', {
              field: issue.field,
              requested: issue.requested,
              normalized: issue.normalized,
              source: issue.source,
            });
            if (
              issue.source === 'x-renku-constraints' &&
              issue.confidence === 'medium'
            ) {
              logger?.warn?.('providers.sdk.payload.constraint-normalized', {
                field: issue.field,
                requested: issue.requested,
                normalized: issue.normalized,
                source: issue.source,
                confidence: issue.confidence,
              });
            }
            continue;
          }

          if (issue.severity === 'error') {
            throw createProviderError(
              SdkErrorCode.INVALID_CONFIG,
              `Input for field "${issue.field}" is incompatible with model constraints and cannot be normalized safely. Requested value: ${JSON.stringify(issue.requested)}.`,
              { kind: 'user_input', causedByUser: true }
            );
          }

          logger?.warn?.('providers.sdk.payload.constraint-unsupported', {
            field: issue.field,
            requested: issue.requested,
            source: issue.source,
            confidence: issue.confidence,
          });
        }
      }

      return payload;
    },
  };
}

function createArtefactRegistry(produces: string[]): ArtefactRegistry {
  const set = new Set(produces);
  function ensure(id: string): string {
    if (!set.has(id)) {
      throw createProviderError(
        SdkErrorCode.UNKNOWN_ARTEFACT,
        `Unknown artefact "${id}" for producer invoke.`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    return id;
  }
  return {
    expectBlob(artefactId: string) {
      return ensure(artefactId);
    },
  };
}
