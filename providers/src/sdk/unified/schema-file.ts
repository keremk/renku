import type { JSONSchema7 } from 'ai';

/**
 * Parsed schema file with input/output schemas and $ref definitions.
 */
export interface SchemaFile {
  /** The input schema for the model */
  inputSchema: JSONSchema7;
  /** The output schema for the model (optional for backward compatibility) */
  outputSchema?: JSONSchema7;
  /** Additional type definitions for $ref resolution (e.g., ImageSize, File, VideoFile) */
  definitions: Record<string, JSONSchema7>;
}

/**
 * Raw schema file structure with input_schema/output_schema keys.
 * Used for the new format with explicit schema separation.
 */
interface NewFormatSchemaFile {
  input_schema: JSONSchema7;
  output_schema?: JSONSchema7;
  [key: string]: JSONSchema7 | undefined;
}

/**
 * Checks if the parsed object is in the new format with input_schema key.
 */
function isNewFormat(obj: unknown): obj is NewFormatSchemaFile {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'input_schema' in obj &&
    typeof (obj as Record<string, unknown>).input_schema === 'object'
  );
}

/**
 * Parses a schema file content string into a structured SchemaFile.
 *
 * Supports two formats:
 *
 * 1. **New format** (with explicit input/output separation):
 * ```json
 * {
 *   "input_schema": { ... },
 *   "output_schema": { ... },
 *   "ImageSize": { ... },     // $ref definition
 *   "File": { ... }           // $ref definition
 * }
 * ```
 *
 * 2. **Old format** (flat input schema only):
 * ```json
 * {
 *   "type": "object",
 *   "properties": { ... }
 * }
 * ```
 *
 * @param content - Raw JSON string content of the schema file
 * @returns Parsed SchemaFile with inputSchema, optional outputSchema, and definitions
 * @throws Error if the content is not valid JSON or missing required schema
 */
export function parseSchemaFile(content: string): SchemaFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid schema file JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Schema file must be a JSON object');
  }

  if (isNewFormat(parsed)) {
    // New format: extract input_schema, output_schema, and remaining definitions
    const { input_schema, output_schema, ...rest } = parsed;

    // Filter out undefined values and collect definitions
    const definitions: Record<string, JSONSchema7> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined && typeof value === 'object') {
        definitions[key] = value as JSONSchema7;
      }
    }

    return {
      inputSchema: input_schema,
      outputSchema: output_schema,
      definitions,
    };
  }

  // Old format: the entire object is the input schema
  return {
    inputSchema: parsed as JSONSchema7,
    outputSchema: undefined,
    definitions: {},
  };
}

/**
 * Extracts just the input schema string from a schema file content.
 * This is useful for backward compatibility with existing code that
 * expects just the input schema as a string.
 *
 * @param content - Raw JSON string content of the schema file
 * @returns JSON string of the input schema only
 */
export function extractInputSchemaString(content: string): string {
  const schemaFile = parseSchemaFile(content);
  return JSON.stringify(schemaFile.inputSchema);
}

/**
 * Extracts just the output schema string from a schema file content.
 *
 * @param content - Raw JSON string content of the schema file
 * @returns JSON string of the output schema, or undefined if not present
 */
export function extractOutputSchemaString(content: string): string | undefined {
  const schemaFile = parseSchemaFile(content);
  if (!schemaFile.outputSchema) {
    return undefined;
  }
  return JSON.stringify(schemaFile.outputSchema);
}

/**
 * Checks if a schema file content has an output schema defined.
 *
 * @param content - Raw JSON string content of the schema file
 * @returns true if output schema is present
 */
export function hasOutputSchema(content: string): boolean {
  const schemaFile = parseSchemaFile(content);
  return schemaFile.outputSchema !== undefined;
}

/**
 * Resolves $ref references by merging definitions into the schema's $defs property.
 * This allows AJV to properly resolve references like "#/ImageSize" by converting them
 * to standard JSON Schema $defs references.
 *
 * For example, a reference like "$ref": "#/ImageSize" will be rewritten to
 * "$ref": "#/$defs/ImageSize" and the ImageSize definition will be added to $defs.
 *
 * @param schema - The schema that may contain $ref references
 * @param definitions - The definitions to merge into the schema
 * @returns A new schema with definitions merged into $defs and references updated
 */
export function resolveSchemaRefs(
  schema: JSONSchema7,
  definitions: Record<string, JSONSchema7>
): JSONSchema7 {
  if (Object.keys(definitions).length === 0) {
    return schema;
  }

  // Deep clone the schema to avoid mutating the original
  const resolved = JSON.parse(JSON.stringify(schema)) as JSONSchema7;

  // Add definitions to $defs
  resolved.$defs = {
    ...(resolved.$defs as Record<string, JSONSchema7> | undefined),
    ...definitions,
  };

  // Rewrite $ref from "#/Name" to "#/$defs/Name"
  rewriteRefs(resolved, definitions);

  return resolved;
}

/**
 * Recursively rewrites $ref values from "#/Name" format to "#/$defs/Name" format.
 */
function rewriteRefs(obj: unknown, definitions: Record<string, JSONSchema7>): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      rewriteRefs(item, definitions);
    }
    return;
  }

  const record = obj as Record<string, unknown>;

  // Check if this object has a $ref that needs rewriting
  if (typeof record.$ref === 'string') {
    const ref = record.$ref;
    // Match refs like "#/ImageSize" (not "#/$defs/ImageSize" or other paths)
    const match = ref.match(/^#\/([A-Za-z_][A-Za-z0-9_]*)$/);
    if (match) {
      const defName = match[1];
      if (defName in definitions) {
        record.$ref = `#/$defs/${defName}`;
      }
    }
  }

  // Recurse into all properties
  for (const value of Object.values(record)) {
    rewriteRefs(value, definitions);
  }
}
