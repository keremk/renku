#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fetch and transform OpenAPI schema from fal.ai for a single model.
 *
 * Usage:
 *   node scripts/fetch-fal-schema.mjs <model-name> <output-path>
 *   node scripts/fetch-fal-schema.mjs <model-name> --type=audio|video|image [--subprovider=<name>]
 *
 * Examples:
 *   node scripts/fetch-fal-schema.mjs minimax/speech-02-hd --type=audio
 *   node scripts/fetch-fal-schema.mjs fal-ai/veo3.1 --type=video
 *   node scripts/fetch-fal-schema.mjs wan/v2.6/image-to-image --type=image --subprovider=wan
 */

const FAL_OPENAPI_BASE = 'https://fal.ai/api/openapi/queue/openapi.json';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

/**
 * Convert model name to filename (kebab-case with .json extension)
 * Examples:
 * - minimax/speech-02-hd → minimax-speech-02-hd.json
 * - bytedance/seedream/v4/text-to-image → bytedance-seedream-v4-text-to-image.json
 * - gpt-image-1.5 → gpt-image-1-5.json
 * - veo3.1 → veo3-1.json
 */
export function modelNameToFilename(modelName) {
  return modelName.replace(/\//g, '-').replace(/\./g, '-') + '.json';
}

/**
 * Normalize model name by stripping fal-ai/ prefix if present
 */
function normalizeModelName(modelName) {
  return modelName.startsWith('fal-ai/') ? modelName.slice(7) : modelName;
}

/**
 * Recursively fix $ref paths from #/components/schemas/X to #/X
 */
function fixRefs(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(fixRefs);
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '$ref' && typeof value === 'string') {
      result[key] = value.replace('#/components/schemas/', '#/');
    } else {
      result[key] = fixRefs(value);
    }
  }
  return result;
}

/**
 * Recursively add "format": "uri" to string properties whose name contains "url" (case-insensitive)
 */
function addUriFormat(obj, propertyName = null) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => addUriFormat(item, null));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      // Process properties object - each key is a property name
      const processedProps = {};
      for (const [propName, propValue] of Object.entries(value)) {
        processedProps[propName] = addUriFormat(propValue, propName);
      }
      result[key] = processedProps;
    } else {
      result[key] = addUriFormat(value, null);
    }
  }

  // If this object represents a property and its name contains "url", add format: uri
  if (
    propertyName &&
    propertyName.toLowerCase().includes('url') &&
    result.type === 'string' &&
    !result.format
  ) {
    result.format = 'uri';
  }

  // Handle arrays of strings (e.g., image_urls: { type: "array", items: { type: "string" } })
  if (
    propertyName &&
    propertyName.toLowerCase().includes('url') &&
    result.type === 'array' &&
    result.items &&
    typeof result.items === 'object' &&
    result.items.type === 'string' &&
    !result.items.format
  ) {
    result.items.format = 'uri';
  }

  return result;
}

/**
 * Fetch and transform schema for a model
 * @param {string} modelName - The model name
 * @param {string} [subProvider] - Optional sub-provider. If specified, use model name as-is for endpoint.
 */
export async function fetchAndTransformSchema(modelName, subProvider) {
  // Normalize model name (strip fal-ai/ if present)
  const normalizedName = normalizeModelName(modelName);

  // Construct endpoint ID based on subProvider
  // If subProvider is specified, use model name as-is (already fully qualified)
  // Otherwise, prepend fal-ai/
  const endpointId = subProvider ? normalizedName : `fal-ai/${normalizedName}`;

  const url = `${FAL_OPENAPI_BASE}?endpoint_id=${encodeURIComponent(endpointId)}`;

  console.log(`[fetch-fal] Fetching schema for ${endpointId}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch schema: ${response.status} ${response.statusText}`);
  }

  const openapi = await response.json();

  // Extract components.schemas
  const schemas = openapi?.components?.schemas;
  if (!schemas) {
    throw new Error('No schemas found in OpenAPI response');
  }

  // Build the result object
  const result = {};

  for (const [schemaName, schemaValue] of Object.entries(schemas)) {
    // Skip QueueStatus
    if (schemaName === 'QueueStatus') {
      continue;
    }

    // Rename Input/Output schemas
    let outputKey;
    if (schemaName.endsWith('Input')) {
      outputKey = 'input_schema';
    } else if (schemaName.endsWith('Output')) {
      outputKey = 'output_schema';
    } else {
      outputKey = schemaName;
    }

    result[outputKey] = schemaValue;
  }

  // Fix $ref paths
  const withFixedRefs = fixRefs(result);

  // Add format: uri to URL fields
  const withUriFormat = addUriFormat(withFixedRefs);

  return withUriFormat;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  const typeArg = args.find((arg) => arg.startsWith('--type='));
  const type = typeArg ? typeArg.split('=')[1] : null;

  const subProviderArg = args.find((arg) => arg.startsWith('--subprovider='));
  const subProvider = subProviderArg ? subProviderArg.split('=')[1] : null;

  const positionalArgs = args.filter((arg) => !arg.startsWith('--'));

  if (positionalArgs.length < 1) {
    console.error('Usage:');
    console.error('  node scripts/fetch-fal-schema.mjs <model-name> <output-path>');
    console.error('  node scripts/fetch-fal-schema.mjs <model-name> --type=audio|video|image [--subprovider=<name>]');
    console.error('');
    console.error('Examples:');
    console.error('  node scripts/fetch-fal-schema.mjs minimax/speech-02-hd --type=audio');
    console.error('  node scripts/fetch-fal-schema.mjs fal-ai/veo3.1 --type=video');
    console.error('  node scripts/fetch-fal-schema.mjs wan/v2.6/image-to-image --type=image --subprovider=wan');
    process.exit(1);
  }

  const modelName = positionalArgs[0];
  const normalizedName = normalizeModelName(modelName);

  // Determine output path
  let outputPath;
  if (type) {
    if (!['audio', 'video', 'image'].includes(type)) {
      console.error(`[fetch-fal] Invalid type: ${type}. Must be one of: audio, video, image`);
      process.exit(1);
    }
    const filename = modelNameToFilename(normalizedName);
    outputPath = resolve(repoRoot, 'catalog', 'models', 'fal-ai', type, filename);
  } else if (positionalArgs.length >= 2) {
    outputPath = positionalArgs[1];
  } else {
    console.error('[fetch-fal] Error: Either provide an output path or use --type=audio|video|image');
    process.exit(1);
  }

  const schema = await fetchAndTransformSchema(normalizedName, subProvider);

  await writeFile(outputPath, JSON.stringify(schema, null, 2) + '\n');
  console.log(`[fetch-fal] Wrote schema to ${outputPath}`);
}

// Only run main if this script is invoked directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    console.error('[fetch-fal] Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
