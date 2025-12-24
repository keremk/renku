import Ajv, { type ValidateFunction, type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';
import type { JSONSchema7 } from 'ai';
import type { SchemaFile } from './schema-file.js';

/**
 * Result of output validation.
 */
export interface OutputValidationResult {
  /** Whether the output is valid according to the schema */
  valid: boolean;
  /** Validation errors if any */
  errors?: string[];
  /** Whether validation was skipped (no output schema) */
  skipped?: boolean;
}

/**
 * Cache key for validators combining output schema and definitions.
 */
type ValidatorCacheKey = string;

interface ValidatorEntry {
  key: ValidatorCacheKey;
  validate: ValidateFunction;
}

// Create a dedicated ajv instance for output validation
// with strict: false to allow $ref resolution
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Cache for compiled validators
const cache = new Map<ValidatorCacheKey, ValidatorEntry>();

/**
 * Compute a cache key from the schema file content.
 */
function computeKey(schemaFile: SchemaFile): ValidatorCacheKey {
  const content = JSON.stringify({
    output: schemaFile.outputSchema,
    definitions: schemaFile.definitions,
  });
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Format validation errors into human-readable messages.
 */
function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) {
    return [];
  }
  return errors.map((err) => {
    const path = err.instancePath || '/';
    const message = err.message ?? 'unknown error';
    return `${path} ${message}`.trim();
  });
}

/**
 * Create a schema with embedded definitions for $ref resolution.
 * This embeds the definitions directly into the output schema so ajv can resolve $refs.
 */
function createSchemaWithDefinitions(
  outputSchema: JSONSchema7,
  definitions: Record<string, JSONSchema7>
): JSONSchema7 {
  // If no definitions, return schema as-is
  if (Object.keys(definitions).length === 0) {
    return outputSchema;
  }

  // Create a copy with $defs for local reference resolution
  // The $refs in fal.ai schemas use format "#/TypeName" which maps to local definitions
  return {
    ...outputSchema,
    $defs: definitions,
  };
}

/**
 * Transform $refs in the schema from "#/TypeName" to "#/$defs/TypeName" format.
 * Fal.ai uses a non-standard $ref format where types are at the root level.
 */
function transformRefs(schema: JSONSchema7): JSONSchema7 {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === '$ref' && typeof value === 'string') {
      // Transform "#/TypeName" to "#/$defs/TypeName"
      if (value.startsWith('#/') && !value.startsWith('#/$defs/')) {
        const typeName = value.slice(2); // Remove "#/"
        result[key] = `#/$defs/${typeName}`;
      } else {
        result[key] = value;
      }
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? transformRefs(item as JSONSchema7)
          : item
      );
    } else if (typeof value === 'object' && value !== null) {
      result[key] = transformRefs(value as JSONSchema7);
    } else {
      result[key] = value;
    }
  }

  return result as JSONSchema7;
}

/**
 * Validate provider output against the output schema in a SchemaFile.
 *
 * This function:
 * 1. Skips validation if no output schema is defined (backward compatible)
 * 2. Resolves $ref references using the definitions in the SchemaFile
 * 3. Returns a validation result (does not throw)
 *
 * @param output - The provider output to validate
 * @param schemaFile - The parsed schema file with output schema and definitions
 * @returns Validation result with valid flag and any errors
 */
export function validateOutput(
  output: unknown,
  schemaFile: SchemaFile
): OutputValidationResult {
  // Skip validation if no output schema
  if (!schemaFile.outputSchema) {
    return { valid: true, skipped: true };
  }

  const key = computeKey(schemaFile);
  let entry = cache.get(key);

  if (!entry) {
    try {
      // Transform $refs and embed definitions
      const transformedSchema = transformRefs(schemaFile.outputSchema);
      const transformedDefs: Record<string, JSONSchema7> = {};

      for (const [name, def] of Object.entries(schemaFile.definitions)) {
        transformedDefs[name] = transformRefs(def);
      }

      const schemaWithDefs = createSchemaWithDefinitions(transformedSchema, transformedDefs);
      const validate = ajv.compile(schemaWithDefs);
      entry = { key, validate };
      cache.set(key, entry);
    } catch (error) {
      // Schema compilation failed - return as invalid with error
      const message = error instanceof Error ? error.message : String(error);
      return {
        valid: false,
        errors: [`Schema compilation failed: ${message}`],
      };
    }
  }

  const valid = entry.validate(output);
  if (!valid) {
    return {
      valid: false,
      errors: formatErrors(entry.validate.errors),
    };
  }

  return { valid: true };
}

/**
 * Validate output and log warnings if invalid.
 * This is a convenience wrapper that logs to the provided logger.
 *
 * @param output - The provider output to validate
 * @param schemaFile - The parsed schema file
 * @param logger - Optional logger for warnings
 * @param context - Additional context for log messages
 */
export function validateOutputWithLogging(
  output: unknown,
  schemaFile: SchemaFile,
  logger?: { warn?: (key: string, data: Record<string, unknown>) => void },
  context?: { provider?: string; model?: string; jobId?: string }
): OutputValidationResult {
  const result = validateOutput(output, schemaFile);

  if (!result.valid && !result.skipped && logger?.warn) {
    logger.warn('providers.unified.output.validation.warning', {
      ...context,
      errors: result.errors,
    });
  }

  return result;
}
