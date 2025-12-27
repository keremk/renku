import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';

type ValidatorCacheKey = string;

interface ValidatorEntry {
  key: ValidatorCacheKey;
  validate: ValidateFunction;
  schemaProperties: Set<string>;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const cache = new Map<ValidatorCacheKey, ValidatorEntry>();

function computeKey(schemaText: string): ValidatorCacheKey {
  return createHash('sha256').update(schemaText).digest('hex');
}

/**
 * Extracts all property names from a JSON schema, including nested properties.
 */
function extractSchemaProperties(schema: unknown): Set<string> {
  const properties = new Set<string>();
  if (!schema || typeof schema !== 'object') {
    return properties;
  }
  const schemaObj = schema as Record<string, unknown>;
  if (schemaObj.properties && typeof schemaObj.properties === 'object') {
    for (const key of Object.keys(schemaObj.properties as Record<string, unknown>)) {
      properties.add(key);
    }
  }
  return properties;
}

export function validatePayload(schemaText: string | undefined, payload: unknown, label: string): void {
  if (!schemaText) {
    return;
  }
  const key = computeKey(schemaText);
  let entry = cache.get(key);
  if (!entry) {
    const schema = JSON.parse(schemaText);
    let validate: ValidateFunction;
    try {
      validate = ajv.compile(schema);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid ${label} schema: ${message}`);
    }
    const schemaProperties = extractSchemaProperties(schema);
    entry = { key, validate, schemaProperties };
    cache.set(key, entry);
  }

  // Check for unknown fields in the payload that don't exist in the schema
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const payloadKeys = Object.keys(payload as Record<string, unknown>);
    const unknownFields = payloadKeys.filter((k) => !entry.schemaProperties.has(k));
    if (unknownFields.length > 0) {
      throw new Error(
        `Invalid ${label} payload: unknown field(s) [${unknownFields.join(', ')}] not defined in schema. ` +
          `Valid fields are: [${[...entry.schemaProperties].join(', ')}]`
      );
    }
  }

  const valid = entry.validate(payload);
  if (!valid) {
    const messages = (entry.validate.errors ?? []).map((err) => `${err.instancePath || '/'} ${err.message ?? ''}`.trim());
    throw new Error(`Invalid ${label} payload: ${messages.join('; ')}`);
  }
}
