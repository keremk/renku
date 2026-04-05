#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyViewerAnnotationsOrThrow,
  mergeExistingViewerAnnotations,
} from './schema-viewer-annotations.mjs';
import { normalizeSchemaFileForCatalog } from './schema-file-validation.mjs';
import {
  applySchemaOverrides,
  loadSchemaOverrideManifest,
} from './schema-overrides.mjs';

/**
 * Fetch input schema from Replicate API for a single model.
 *
 * Usage:
 *   node scripts/fetch-replicate-schema.mjs <owner/model-name> <output-path>
 *   node scripts/fetch-replicate-schema.mjs <owner/model-name> --type=audio|video|image|json
 *
 * Examples:
 *   node scripts/fetch-replicate-schema.mjs openai/sora-2 --type=video
 *   node scripts/fetch-replicate-schema.mjs minimax/speech-02-hd --type=audio
 *   node scripts/fetch-replicate-schema.mjs bytedance/seedream-4 --type=image
 *
 * Requires REPLICATE_API_TOKEN environment variable.
 */

const REPLICATE_API_BASE = 'https://api.replicate.com/v1/models';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const REPLICATE_SCHEMA_OVERRIDES_PATH = resolve(
  repoRoot,
  'catalog',
  'models',
  'replicate',
  'schema-overrides.yaml'
);

// Load .env from repo root (Node 21.7+)
try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  // .env file may not exist; token can still come from environment
}

/**
 * Convert model name to filename (kebab-case with .json extension)
 * Examples:
 * - openai/sora-2 → openai-sora-2.json
 * - bytedance/seedream-4.5 → bytedance-seedream-4-5.json
 * - pixverse/pixverse-v5.6 → pixverse-pixverse-v5-6.json
 */
export function modelNameToFilename(modelName) {
  return modelName.replace(/\//g, '-').replace(/\./g, '-') + '.json';
}

function isObjectRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeOpenApiComponentRefs(node) {
  if (Array.isArray(node)) {
    return node.map((value) => normalizeOpenApiComponentRefs(value));
  }

  if (!isObjectRecord(node)) {
    return node;
  }

  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') {
      result[key] = value.replace('#/components/schemas/', '#/');
      continue;
    }
    result[key] = normalizeOpenApiComponentRefs(value);
  }
  return result;
}

function buildReplicateSchemaFile(componentsSchemas) {
  const schemaFile = {};

  for (const [schemaName, schemaValue] of Object.entries(componentsSchemas)) {
    if (schemaName === 'Input') {
      schemaFile.input_schema = schemaValue;
      continue;
    }
    if (schemaName === 'Output') {
      schemaFile.output_schema = schemaValue;
      continue;
    }
    schemaFile[schemaName] = schemaValue;
  }

  return normalizeOpenApiComponentRefs(schemaFile);
}

function inferSchemaTypeFromOutputPath(outputPath) {
  if (!outputPath) {
    return undefined;
  }

  const normalized = outputPath.replace(/\\/g, '/');
  const marker = '/catalog/models/replicate/';
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex === -1) {
    return undefined;
  }

  const remainder = normalized.slice(markerIndex + marker.length);
  const [type] = remainder.split('/');
  return type || undefined;
}

/**
 * Fetch input schema for a Replicate model.
 * Returns a full schema file:
 * { input_schema, output_schema?, ...definitions }
 */
export async function fetchReplicateInputSchema(
  modelName,
  existingSchema,
  options = {}
) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error(
      'REPLICATE_API_TOKEN environment variable is required. ' +
        'Get your token at https://replicate.com/account/api-tokens'
    );
  }

  const url = `${REPLICATE_API_BASE}/${modelName}`;

  console.log(`[fetch-replicate] Fetching schema for ${modelName}...`);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch model: ${response.status} ${response.statusText}`
    );
  }

  const model = await response.json();

  const componentsSchemas =
    model?.latest_version?.openapi_schema?.components?.schemas;
  if (!componentsSchemas || !isObjectRecord(componentsSchemas)) {
    throw new Error(
      `No components.schemas found for ${modelName}. ` +
        'The model may not have a latest_version or openapi_schema.'
    );
  }

  if (!componentsSchemas.Input) {
    throw new Error(
      `No input schema found for ${modelName}. ` +
        'The model may not have a latest_version or openapi_schema.'
    );
  }

  const schemaFile = buildReplicateSchemaFile(componentsSchemas);

  if (!isObjectRecord(schemaFile.input_schema)) {
    throw new Error(
      `Input schema is malformed for ${modelName}. ` +
        'Expected input_schema object in transformed schema file.'
    );
  }

  const schemaType =
    options.schemaType ?? inferSchemaTypeFromOutputPath(options.outputPath);
  if (schemaType) {
    const overrides = await loadSchemaOverrideManifest(
      REPLICATE_SCHEMA_OVERRIDES_PATH
    );
    const { applied } = applySchemaOverrides({
      targetSchema: schemaFile,
      manifest: overrides,
      modelName,
      schemaType,
      manifestPath: REPLICATE_SCHEMA_OVERRIDES_PATH,
    });
    if (applied > 0) {
      console.log(
        `[fetch-replicate] Applied ${applied} schema override patch(es) for ${modelName} (${schemaType}).`
      );
    }
  }

  if (existingSchema) {
    mergeExistingViewerAnnotations(existingSchema, schemaFile);
  }

  applyViewerAnnotationsOrThrow(schemaFile);
  const { schemaFile: normalizedSchema, repairsApplied } =
    normalizeSchemaFileForCatalog(
      schemaFile,
      `Replicate schema for ${modelName}`
    );
  if (repairsApplied > 0) {
    console.log(
      `[fetch-replicate] Applied ${repairsApplied} known schema repair(s) for ${modelName}.`
    );
  }

  return normalizedSchema;
}

async function readExistingSchemaIfAny(schemaPath) {
  let content;
  try {
    content = await readFile(schemaPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return undefined;
    }

    throw new Error(
      `[fetch-replicate] Failed to read existing schema at ${schemaPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `[fetch-replicate] Existing schema at ${schemaPath} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `[fetch-replicate] Existing schema at ${schemaPath} must be a top-level JSON object.`
    );
  }

  return parsed;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  const typeArg = args.find((arg) => arg.startsWith('--type='));
  const type = typeArg ? typeArg.split('=')[1] : null;

  const positionalArgs = args.filter((arg) => !arg.startsWith('--'));

  if (positionalArgs.length < 1) {
    console.error('Usage:');
    console.error(
      '  node scripts/fetch-replicate-schema.mjs <owner/model-name> <output-path>'
    );
    console.error(
      '  node scripts/fetch-replicate-schema.mjs <owner/model-name> --type=audio|video|image|json'
    );
    console.error('');
    console.error('Examples:');
    console.error(
      '  node scripts/fetch-replicate-schema.mjs openai/sora-2 --type=video'
    );
    console.error(
      '  node scripts/fetch-replicate-schema.mjs minimax/speech-02-hd --type=audio'
    );
    console.error('');
    console.error('Requires REPLICATE_API_TOKEN environment variable.');
    process.exit(1);
  }

  const modelName = positionalArgs[0];

  // Determine output path
  let outputPath;
  if (type) {
    if (!['audio', 'video', 'image', 'json'].includes(type)) {
      console.error(
        `[fetch-replicate] Invalid type: ${type}. Must be one of: audio, video, image, json`
      );
      process.exit(1);
    }
    const filename = modelNameToFilename(modelName);
    outputPath = resolve(
      repoRoot,
      'catalog',
      'models',
      'replicate',
      type,
      filename
    );
  } else if (positionalArgs.length >= 2) {
    outputPath = positionalArgs[1];
  } else {
    console.error(
      '[fetch-replicate] Error: Either provide an output path or use --type=audio|video|image|json'
    );
    process.exit(1);
  }

  const existingSchema = await readExistingSchemaIfAny(outputPath);
  const schema = await fetchReplicateInputSchema(modelName, existingSchema, {
    schemaType: type,
    outputPath,
  });

  await writeFile(outputPath, JSON.stringify(schema, null, 2) + '\n');
  console.log(`[fetch-replicate] Wrote schema to ${outputPath}`);
}

// Only run main if this script is invoked directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    console.error(
      '[fetch-replicate] Error:',
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  });
}
