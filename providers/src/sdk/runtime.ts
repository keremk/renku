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
  inferBlobExtension,
  type BlueprintProducerSdkMappingField,
  type MappingFieldDefinition,
  type NotificationBus,
  type StorageContext,
} from '@gorenku/core';
import { createHash } from 'node:crypto';
import {
  applyMapping,
  setNestedValue,
  type TransformContext,
} from './transforms.js';
import { createProviderError, SdkErrorCode } from './errors.js';

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
  /** Cloud storage context for uploading blob inputs (optional). */
  cloudStorage?: StorageContext;
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
  const sdk = createSdkHelper(inputs, jobContext, init.cloudStorage, logger);
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
    cloudStorage: init.cloudStorage,
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
  cloudStorage?: StorageContext,
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
        coercePayloadEnumValues(payload, parsedInputSchema, logger);
      }

      // Process blob inputs for fields with format: "uri" in schema
      // First, check if any blob inputs exist in the payload
      const hasBlobInputs = Object.values(payload).some(
        (value) =>
          isBlobInput(value) ||
          (Array.isArray(value) && value.some((item) => isBlobInput(item)))
      );

      if (hasBlobInputs && !cloudStorage) {
        throw createProviderError(
          SdkErrorCode.BLOB_INPUT_NO_STORAGE,
          'Blob inputs (file: references) require cloud storage configuration. ' +
            'Set S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET_NAME environment variables.',
          { kind: 'user_input', causedByUser: true }
        );
      }

      if (cloudStorage && inputSchema) {
        const parsedSchema =
          parsedInputSchema ??
          (JSON.parse(inputSchema) as Record<string, unknown>);
        const schemaProperties = readSchemaProperties(parsedSchema);
        for (const [key, value] of Object.entries(payload)) {
          const fieldSchema = schemaProperties?.[key];
          const fieldFormat =
            typeof fieldSchema?.format === 'string'
              ? fieldSchema.format
              : undefined;

          // Check for direct format: "uri" field
          const isUriField = fieldFormat === 'uri';
          if (isUriField && isBlobInput(value)) {
            const url = await uploadBlobAndGetUrl(value, cloudStorage);
            payload[key] = url;
            continue;
          }

          // Check for array with items.format: "uri"
          const itemsSchema =
            fieldSchema &&
            typeof fieldSchema.items === 'object' &&
            fieldSchema.items !== null &&
            !Array.isArray(fieldSchema.items)
              ? (fieldSchema.items as Record<string, unknown>)
              : undefined;
          const isArrayOfUris =
            fieldSchema?.type === 'array' && itemsSchema?.format === 'uri';
          if (isArrayOfUris && Array.isArray(value)) {
            const uploadedUrls: string[] = [];
            for (const item of value) {
              if (isBlobInput(item)) {
                const url = await uploadBlobAndGetUrl(item, cloudStorage);
                uploadedUrls.push(url);
              } else if (typeof item === 'string') {
                // Already a URL, keep as-is
                uploadedUrls.push(item);
              }
            }
            payload[key] = uploadedUrls;
          }
        }
      }

      return payload;
    },
  };
}

function parseInputSchema(
  inputSchema: string | undefined
): Record<string, unknown> | undefined {
  if (!inputSchema) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(inputSchema);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readSchemaProperties(
  schema: Record<string, unknown>
): Record<string, Record<string, unknown>> | undefined {
  const rawProperties = schema.properties;
  if (
    !rawProperties ||
    typeof rawProperties !== 'object' ||
    Array.isArray(rawProperties)
  ) {
    return undefined;
  }

  const properties: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(rawProperties)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      properties[key] = value as Record<string, unknown>;
    }
  }

  return properties;
}

function coercePayloadEnumValues(
  payload: Record<string, unknown>,
  schema: Record<string, unknown>,
  logger?: ProviderLogger,
  fieldPrefix = ''
): void {
  const properties = readSchemaProperties(schema);
  if (!properties) {
    return;
  }

  for (const [fieldName, value] of Object.entries(payload)) {
    const propertySchema = properties[fieldName];
    if (!propertySchema) {
      continue;
    }

    const fieldPath = fieldPrefix ? `${fieldPrefix}.${fieldName}` : fieldName;
    const normalized = normalizeEnumValue(value, propertySchema);
    if (normalized.changed) {
      payload[fieldName] = normalized.value;
      logger?.debug?.('providers.sdk.payload.enum-normalized', {
        field: fieldPath,
        requested: value,
        normalized: normalized.value,
      });
    }

    const currentValue = payload[fieldName];
    if (
      currentValue &&
      typeof currentValue === 'object' &&
      !Array.isArray(currentValue)
    ) {
      coercePayloadEnumValues(
        currentValue as Record<string, unknown>,
        propertySchema,
        logger,
        fieldPath
      );
    }
  }
}

interface EnumNormalizationResult {
  value: unknown;
  changed: boolean;
}

function normalizeEnumValue(
  value: unknown,
  schema: Record<string, unknown>
): EnumNormalizationResult {
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (!enumValues || enumValues.length === 0) {
    return { value, changed: false };
  }

  if (enumValues.some((enumValue) => Object.is(enumValue, value))) {
    return { value, changed: false };
  }

  if (typeof value === 'number') {
    const asStringMatch = enumValues.find(
      (enumValue) =>
        typeof enumValue === 'string' && enumValue === String(value)
    );
    if (asStringMatch !== undefined) {
      return { value: asStringMatch, changed: true };
    }
  }

  if (typeof value === 'string') {
    const parsedNumericValue = Number(value);
    if (Number.isFinite(parsedNumericValue)) {
      const numericMatch = enumValues.find(
        (enumValue) =>
          typeof enumValue === 'number' &&
          Object.is(enumValue, parsedNumericValue)
      );
      if (numericMatch !== undefined) {
        return { value: numericMatch, changed: true };
      }
    }
  }

  const incomingNumeric = parseNumericEnumValue(value);
  if (incomingNumeric === undefined) {
    return { value, changed: false };
  }

  const numericCandidates = enumValues
    .map((enumValue) => {
      const parsed = parseNumericEnumValue(enumValue);
      if (parsed === undefined) {
        return undefined;
      }
      return {
        raw: enumValue,
        numeric: parsed,
      };
    })
    .filter(
      (
        candidate
      ): candidate is {
        raw: unknown;
        numeric: number;
      } => candidate !== undefined
    );

  if (numericCandidates.length === 0) {
    return { value, changed: false };
  }

  const nearestCandidate = pickNearestEnumCandidate(
    incomingNumeric,
    numericCandidates
  );
  if (
    nearestCandidate === undefined ||
    Object.is(nearestCandidate.raw, value)
  ) {
    return { value, changed: false };
  }

  return { value: nearestCandidate.raw, changed: true };
}

function parseNumericEnumValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)(?:[a-zA-Z%]*)$/);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pickNearestEnumCandidate(
  target: number,
  candidates: Array<{ raw: unknown; numeric: number }>
): { raw: unknown; numeric: number } | undefined {
  let nearest: { raw: unknown; numeric: number } | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = Math.abs(candidate.numeric - target);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
      continue;
    }

    if (
      distance === nearestDistance &&
      nearest &&
      candidate.numeric < nearest.numeric
    ) {
      nearest = candidate;
    }
  }

  return nearest;
}

/** Blob input can be Uint8Array or an object with data and mimeType. */
interface BlobInput {
  data: Uint8Array | Buffer;
  mimeType: string;
}

function isBlobInput(value: unknown): value is Uint8Array | BlobInput {
  // Check if value is Uint8Array/Buffer
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return true;
  }
  // Check if value has blob-like structure { data, mimeType }
  if (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'mimeType' in value
  ) {
    const obj = value as { data: unknown; mimeType: unknown };
    return (
      (obj.data instanceof Uint8Array || Buffer.isBuffer(obj.data)) &&
      typeof obj.mimeType === 'string'
    );
  }
  return false;
}

async function uploadBlobAndGetUrl(
  blob: Uint8Array | BlobInput,
  cloudStorage: StorageContext
): Promise<string> {
  const data =
    blob instanceof Uint8Array || Buffer.isBuffer(blob) ? blob : blob.data;
  const mimeType =
    blob instanceof Uint8Array || Buffer.isBuffer(blob)
      ? 'application/octet-stream'
      : blob.mimeType;

  // Generate content-addressed key
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const hash = createHash('sha256').update(buffer).digest('hex');
  const prefix = hash.slice(0, 2);
  const ext = inferBlobExtension(mimeType);
  const key = `blobs/${prefix}/${hash}${ext ? '.' + ext : ''}`;

  // Upload to cloud storage (content-addressed, so overwriting is safe)
  await cloudStorage.storage.write(key, buffer, { mimeType });

  // Get signed URL (default 1 hour expiry)
  if (!cloudStorage.temporaryUrl) {
    throw createProviderError(
      SdkErrorCode.CLOUD_STORAGE_URL_FAILED,
      'Cloud storage does not support temporaryUrl - ensure you are using cloud storage kind.',
      { kind: 'user_input', causedByUser: true }
    );
  }
  return cloudStorage.temporaryUrl(key, 3600);
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
