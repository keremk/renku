import Ajv from 'ajv';

const RESERVED_SCHEMA_KEYS = new Set([
  'input_schema',
  'output_schema',
  'x-renku-nested-models',
  'x-renku-viewer',
]);

const schemaMetaAjv = new Ajv({
  allErrors: true,
  strict: false,
});

function isObjectRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatAjvErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return 'Unknown schema validation error.';
  }
  return errors
    .map((error) => {
      const path = error.instancePath || 'data';
      return `${path} ${error.message}`;
    })
    .join(', ');
}

function extractSchemaDefinitions(schemaFile) {
  const definitions = {};
  for (const [key, value] of Object.entries(schemaFile)) {
    if (RESERVED_SCHEMA_KEYS.has(key)) {
      continue;
    }
    if (isObjectRecord(value)) {
      definitions[key] = value;
    }
  }
  return definitions;
}

function buildWrappedInputSchema(schemaFile, contextLabel) {
  if (!isObjectRecord(schemaFile)) {
    throw new Error(`[schema-validation] ${contextLabel} must be a JSON object.`);
  }

  const inputSchema = schemaFile.input_schema;
  if (!isObjectRecord(inputSchema)) {
    throw new Error(
      `[schema-validation] ${contextLabel} is missing a valid input_schema object.`
    );
  }

  const definitions = extractSchemaDefinitions(schemaFile);
  return {
    ...inputSchema,
    input_schema: inputSchema,
    ...definitions,
    $defs: definitions,
  };
}

function stripKnownReplicateUriAnyOf(node) {
  if (Array.isArray(node)) {
    return node.reduce(
      (count, item) => count + stripKnownReplicateUriAnyOf(item),
      0
    );
  }

  if (!isObjectRecord(node)) {
    return 0;
  }

  let repairsApplied = 0;
  if (
    Array.isArray(node.anyOf) &&
    node.anyOf.length === 0 &&
    node.type === 'string' &&
    node.format === 'uri'
  ) {
    delete node.anyOf;
    repairsApplied += 1;
  }

  for (const value of Object.values(node)) {
    repairsApplied += stripKnownReplicateUriAnyOf(value);
  }

  return repairsApplied;
}

export function validateWrappedInputSchemaOrThrow(
  schemaFile,
  contextLabel = 'schema file'
) {
  const wrappedInputSchema = buildWrappedInputSchema(schemaFile, contextLabel);
  const isValid = schemaMetaAjv.validateSchema(wrappedInputSchema);
  if (isValid) {
    return;
  }

  const message = formatAjvErrors(schemaMetaAjv.errors);
  throw new Error(
    `[schema-validation] ${contextLabel} is invalid: ${message}`
  );
}

export function normalizeSchemaFileForCatalog(
  schemaFile,
  contextLabel = 'schema file'
) {
  const normalized = cloneJsonValue(schemaFile);
  const repairsApplied = stripKnownReplicateUriAnyOf(normalized);
  validateWrappedInputSchemaOrThrow(normalized, contextLabel);
  return {
    schemaFile: normalized,
    repairsApplied,
  };
}
