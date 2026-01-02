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
import { applyMapping, setNestedValue, type TransformContext } from './transforms.js';

interface SerializedJobContext {
  inputBindings?: Record<string, string>;
  sdkMapping?: Record<string, BlueprintProducerSdkMappingField | MappingFieldDefinition>;
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
  const config = createRuntimeConfig(request.context.providerConfig, configValidator);
  const attachments = createAttachmentReader(request.context.rawAttachments ?? []);
  const resolvedInputs = resolveInputs(request.context.extras);
  const jobContext = extractJobContext(request.context.extras);
  const inputs = createInputsAccessor(resolvedInputs);
  const sdk = createSdkHelper(inputs, jobContext, init.cloudStorage);
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

function createRuntimeConfig(raw: unknown, validator?: ConfigValidator): ProducerRuntimeConfig {
  return {
    raw,
    parse<T = unknown>(schema?: (value: unknown) => T): T {
      const effective = (schema ?? validator) as ((value: unknown) => T) | undefined;
      if (!effective) {
        return raw as T;
      }
      return effective(raw);
    },
  };
}

function createAttachmentReader(source: ProviderAttachment[]): AttachmentReader {
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

function resolveInputs(extras: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!extras || typeof extras !== 'object') {
    return {};
  }
  const resolved = extras.resolvedInputs;
  if (!resolved || typeof resolved !== 'object') {
    return {};
  }
  return { ...(resolved as Record<string, unknown>) };
}

function extractJobContext(extras: Record<string, unknown> | undefined): SerializedJobContext | undefined {
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
      if (inputSchema) {
        try {
          const parsed = JSON.parse(inputSchema);
          if (Array.isArray(parsed.required)) {
            parsed.required.forEach((f: string) => schemaRequired.add(f));
          }
          // Check which properties have default values defined
          if (parsed.properties && typeof parsed.properties === 'object') {
            for (const [field, prop] of Object.entries(parsed.properties)) {
              if (prop && typeof prop === 'object' && 'default' in prop) {
                schemaDefaults.add(field);
              }
            }
          }
        } catch {
          // If schema parsing fails, continue in permissive mode
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
          const isRequiredBySchema = inputSchema && !isExpandField && schemaRequired.has(fieldName);
          const hasSchemaDefault = schemaDefaults.has(fieldName);

          if (isRequiredBySchema && !hasSchemaDefault) {
            const canonicalId = jobContext?.inputBindings?.[alias] ?? alias;
            throw new Error(
              `Missing required input "${canonicalId}" for field "${fieldName}" (requested "${alias}"). No schema default available.`,
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

      // Process blob inputs for fields with format: "uri" in schema
      // First, check if any blob inputs exist in the payload
      const hasBlobInputs = Object.values(payload).some(
        (value) =>
          isBlobInput(value) ||
          (Array.isArray(value) && value.some((item) => isBlobInput(item))),
      );

      if (hasBlobInputs && !cloudStorage) {
        throw new Error(
          'Blob inputs (file: references) require cloud storage configuration. ' +
            'Set S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET_NAME environment variables.',
        );
      }

      if (cloudStorage && inputSchema) {
        const parsedSchema = JSON.parse(inputSchema);
        for (const [key, value] of Object.entries(payload)) {
          const fieldSchema = parsedSchema?.properties?.[key];

          // Check for direct format: "uri" field
          const isUriField = fieldSchema?.format === 'uri';
          if (isUriField && isBlobInput(value)) {
            const url = await uploadBlobAndGetUrl(value, cloudStorage);
            payload[key] = url;
            continue;
          }

          // Check for array with items.format: "uri"
          const isArrayOfUris = fieldSchema?.type === 'array' && fieldSchema?.items?.format === 'uri';
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
  if (typeof value === 'object' && value !== null && 'data' in value && 'mimeType' in value) {
    const obj = value as { data: unknown; mimeType: unknown };
    return (obj.data instanceof Uint8Array || Buffer.isBuffer(obj.data)) && typeof obj.mimeType === 'string';
  }
  return false;
}

async function uploadBlobAndGetUrl(
  blob: Uint8Array | BlobInput,
  cloudStorage: StorageContext,
): Promise<string> {
  const data = blob instanceof Uint8Array || Buffer.isBuffer(blob) ? blob : blob.data;
  const mimeType = blob instanceof Uint8Array || Buffer.isBuffer(blob) ? 'application/octet-stream' : blob.mimeType;

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
    throw new Error('Cloud storage does not support temporaryUrl - ensure you are using cloud storage kind.');
  }
  return cloudStorage.temporaryUrl(key, 3600);
}

function createArtefactRegistry(produces: string[]): ArtefactRegistry {
  const set = new Set(produces);
  function ensure(id: string): string {
    if (!set.has(id)) {
      throw new Error(`Unknown artefact "${id}" for producer invoke.`);
    }
    return id;
  }
  return {
    expectBlob(artefactId: string) {
      return ensure(artefactId);
    },
  };
}

