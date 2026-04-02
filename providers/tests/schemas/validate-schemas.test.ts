import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { CATALOG_MODELS_ROOT } from '../test-catalog-paths.js';

const SCHEMAS_ROOT = CATALOG_MODELS_ROOT;
const RESERVED_SCHEMA_KEYS = new Set([
  'input_schema',
  'output_schema',
  'x-renku-nested-models',
  'x-renku-viewer',
]);

async function listJsonSchemas(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonSchemas(full)));
    } else if (
      entry.isFile() &&
      extname(entry.name).toLowerCase() === '.json'
    ) {
      files.push(full);
    }
  }
  return files;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function extractDefinitions(schema: Record<string, unknown>): Record<string, unknown> {
  const definitions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (RESERVED_SCHEMA_KEYS.has(key)) {
      continue;
    }
    if (isObjectRecord(value)) {
      definitions[key] = value;
    }
  }
  return definitions;
}

function buildWrappedSchema(
  schema: Record<string, unknown>,
  schemaPath: string
): Record<string, unknown> {
  const inputSchema = isObjectRecord(schema.input_schema)
    ? (schema.input_schema as Record<string, unknown>)
    : schema;
  if (!isObjectRecord(inputSchema)) {
    throw new Error(
      `Schema "${schemaPath}" must contain an object input schema.`
    );
  }

  const definitions = isObjectRecord(schema.input_schema)
    ? extractDefinitions(schema)
    : {};
  return {
    ...inputSchema,
    input_schema: inputSchema,
    ...definitions,
    $defs: definitions,
  };
}

function formatAjvErrors(errors: Ajv['errors']): string {
  if (!errors || errors.length === 0) {
    return 'Unknown schema validation error.';
  }
  return errors
    .map((error) => `${error.instancePath || 'data'} ${error.message}`)
    .join(', ');
}

describe('blueprint module schemas', () => {
  it('all model schema files are valid JSON objects', async () => {
    // Ensure root exists (sanity guard)
    const stats = await stat(SCHEMAS_ROOT);
    expect(stats.isDirectory()).toBe(true);

    const schemaPaths = await listJsonSchemas(SCHEMAS_ROOT);
    expect(schemaPaths.length).toBeGreaterThan(0);

    for (const schemaPath of schemaPaths) {
      const contents = await readFile(schemaPath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(contents) as unknown;
      } catch (error) {
        throw new Error(
          `Schema "${schemaPath}" is not valid JSON: ${(error as Error).message}`
        );
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Schema "${schemaPath}" must be a JSON object.`);
      }
    }
  });

  it('all model schemas pass wrapped input_schema meta validation', async () => {
    const stats = await stat(SCHEMAS_ROOT);
    expect(stats.isDirectory()).toBe(true);

    const schemaPaths = await listJsonSchemas(SCHEMAS_ROOT);
    expect(schemaPaths.length).toBeGreaterThan(0);

    const ajv = new Ajv({
      allErrors: true,
      strict: false,
    });

    for (const schemaPath of schemaPaths) {
      const contents = await readFile(schemaPath, 'utf8');
      const parsed = JSON.parse(contents) as Record<string, unknown>;
      const wrappedSchema = buildWrappedSchema(parsed, schemaPath);
      const valid = ajv.validateSchema(wrappedSchema);
      if (!valid) {
        throw new Error(
          `Schema "${schemaPath}" failed meta validation: ${formatAjvErrors(
            ajv.errors
          )}`
        );
      }
    }
  });
});
