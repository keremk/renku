import type {
  ProviderAdapter,
  ProviderClient,
  ProviderInputFile,
} from './provider-adapter.js';
import { createProviderError, SdkErrorCode } from '../errors.js';

interface ResolveProviderFileInputsOptions {
  payload: Record<string, unknown>;
  inputSchema: string;
  adapter: ProviderAdapter;
  client: ProviderClient | null;
}

interface BlobInput {
  data: Uint8Array | Buffer;
  mimeType: string;
}

type BlobLikeInput = Uint8Array | BlobInput;

/**
 * Resolves blob-like payload values to URL strings for URI schema fields.
 *
 * Blob-like values are only resolved through the provider adapter upload hook.
 * This keeps live and simulated mode on the same adapter-owned boundary.
 */
export async function resolveProviderFileInputs(
  options: ResolveProviderFileInputsOptions
): Promise<Record<string, unknown>> {
  const parsedSchema = parseInputSchema(options.inputSchema);
  const resolvedPayload = parsedSchema
    ? await resolveObjectBySchema(
        options.payload,
        parsedSchema,
        options,
        'input'
      )
    : { ...options.payload };

  const unresolvedBlobPaths = collectBlobLikePaths(resolvedPayload, 'input');
  if (unresolvedBlobPaths.length > 0) {
    throw createProviderError(
      SdkErrorCode.BLOB_INPUT_NO_STORAGE,
      `Provider "${options.adapter.name}" received blob input(s) that could not be resolved to URL fields: ${unresolvedBlobPaths.join(', ')}. ` +
        'Map these values to schema fields with format "uri".',
      { kind: 'user_input', causedByUser: true }
    );
  }

  return resolvedPayload;
}

async function resolveObjectBySchema(
  payload: Record<string, unknown>,
  schema: Record<string, unknown>,
  options: ResolveProviderFileInputsOptions,
  pathPrefix: string
): Promise<Record<string, unknown>> {
  const schemaProperties = readSchemaProperties(schema);
  if (!schemaProperties) {
    return { ...payload };
  }

  const resolvedPayload: Record<string, unknown> = { ...payload };
  for (const [key, value] of Object.entries(payload)) {
    const fieldSchema = schemaProperties[key];
    if (!fieldSchema) {
      continue;
    }

    const fieldPath = `${pathPrefix}.${key}`;
    resolvedPayload[key] = await resolveValueBySchema(
      value,
      fieldSchema,
      options,
      fieldPath
    );
  }

  return resolvedPayload;
}

async function resolveValueBySchema(
  value: unknown,
  schema: Record<string, unknown>,
  options: ResolveProviderFileInputsOptions,
  valuePath: string
): Promise<unknown> {
  const uriSchema = getUriFieldSchema(schema);
  if (uriSchema) {
    if (isBlobLikeInput(value)) {
      return resolveBlobValueToUrl(value, options, valuePath);
    }
    return value;
  }

  if (Array.isArray(value)) {
    const itemsSchema = readItemsSchema(schema);
    if (!itemsSchema) {
      return value;
    }

    const resolvedItems: unknown[] = [];
    for (const [index, item] of value.entries()) {
      resolvedItems.push(
        await resolveValueBySchema(
          item,
          itemsSchema,
          options,
          `${valuePath}[${index}]`
        )
      );
    }
    return resolvedItems;
  }

  if (!isObjectRecord(value)) {
    return value;
  }

  const nestedProperties = readSchemaProperties(schema);
  if (!nestedProperties) {
    return value;
  }

  const resolvedObject: Record<string, unknown> = { ...value };
  for (const [key, entry] of Object.entries(value)) {
    const nestedSchema = nestedProperties[key];
    if (!nestedSchema) {
      continue;
    }

    resolvedObject[key] = await resolveValueBySchema(
      entry,
      nestedSchema,
      options,
      `${valuePath}.${key}`
    );
  }

  return resolvedObject;
}

function parseInputSchema(
  inputSchema: string
): Record<string, unknown> | undefined {
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

function readItemsSchema(
  schema: Record<string, unknown>
): Record<string, unknown> | undefined {
  const rawItems = schema.items;
  if (!rawItems || typeof rawItems !== 'object' || Array.isArray(rawItems)) {
    return undefined;
  }
  return rawItems as Record<string, unknown>;
}

function isUriFieldSchema(schema: Record<string, unknown>): boolean {
  return typeof schema.format === 'string' && schema.format === 'uri';
}

function getUriFieldSchema(
  schema: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (isUriFieldSchema(schema)) {
    return schema;
  }

  const variants = readSchemaVariants(schema);
  if (!variants) {
    return undefined;
  }

  return variants.find((variant) => isUriFieldSchema(variant));
}

function readSchemaVariants(
  schema: Record<string, unknown>
): Record<string, unknown>[] | undefined {
  const rawAnyOf = schema.anyOf;
  if (Array.isArray(rawAnyOf)) {
    return rawAnyOf.filter(isSchemaRecord);
  }

  const rawOneOf = schema.oneOf;
  if (Array.isArray(rawOneOf)) {
    return rawOneOf.filter(isSchemaRecord);
  }

  return undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array) &&
    !Buffer.isBuffer(value)
  );
}

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isBlobLikeInput(value: unknown): value is BlobLikeInput {
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return true;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'mimeType' in value
  ) {
    const objectValue = value as { data: unknown; mimeType: unknown };
    return (
      (objectValue.data instanceof Uint8Array ||
        Buffer.isBuffer(objectValue.data)) &&
      typeof objectValue.mimeType === 'string'
    );
  }

  return false;
}

function toProviderInputFile(value: BlobLikeInput): ProviderInputFile {
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return {
      data: value,
      mimeType: 'application/octet-stream',
    };
  }

  return {
    data: value.data,
    mimeType: value.mimeType,
  };
}

async function resolveBlobValueToUrl(
  value: BlobLikeInput,
  options: ResolveProviderFileInputsOptions,
  path: string
): Promise<string> {
  const file = toProviderInputFile(value);

  if (!options.adapter.uploadInputFile) {
    throw createProviderError(
      SdkErrorCode.BLOB_INPUT_NO_STORAGE,
      `Provider "${options.adapter.name}" does not support native file uploads for blob input at "${path}".`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  if (!options.client) {
    throw new Error(
      `Provider client is not initialized for ${options.adapter.name} file upload.`
    );
  }

  const uploadedUrl = await options.adapter.uploadInputFile(
    options.client,
    file
  );
  if (typeof uploadedUrl !== 'string' || uploadedUrl.length === 0) {
    throw new Error(
      `Provider ${options.adapter.name} returned an invalid file URL after upload.`
    );
  }
  return uploadedUrl;
}

function collectBlobLikePaths(value: unknown, path: string): string[] {
  const paths: string[] = [];
  collectBlobLikePathsRecursive(value, path, paths);
  return paths;
}

function collectBlobLikePathsRecursive(
  value: unknown,
  path: string,
  paths: string[]
): void {
  if (isBlobLikeInput(value)) {
    paths.push(path);
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectBlobLikePathsRecursive(item, `${path}[${index}]`, paths);
    }
    return;
  }

  if (!isObjectRecord(value)) {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    collectBlobLikePathsRecursive(entry, `${path}.${key}`, paths);
  }
}
