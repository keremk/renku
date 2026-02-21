#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fetch input schema from Replicate API for a single model.
 *
 * Usage:
 *   node scripts/fetch-replicate-schema.mjs <owner/model-name> <output-path>
 *   node scripts/fetch-replicate-schema.mjs <owner/model-name> --type=audio|video|image
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

/**
 * Fetch input schema for a Replicate model.
 * Returns the flat input schema: { type, title, required, properties }
 */
export async function fetchReplicateInputSchema(modelName) {
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
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
  }

  const model = await response.json();

  const inputSchema =
    model?.latest_version?.openapi_schema?.components?.schemas?.Input;

  if (!inputSchema) {
    throw new Error(
      `No input schema found for ${modelName}. ` +
      'The model may not have a latest_version or openapi_schema.'
    );
  }

  return inputSchema;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  const typeArg = args.find((arg) => arg.startsWith('--type='));
  const type = typeArg ? typeArg.split('=')[1] : null;

  const positionalArgs = args.filter((arg) => !arg.startsWith('--'));

  if (positionalArgs.length < 1) {
    console.error('Usage:');
    console.error('  node scripts/fetch-replicate-schema.mjs <owner/model-name> <output-path>');
    console.error('  node scripts/fetch-replicate-schema.mjs <owner/model-name> --type=audio|video|image');
    console.error('');
    console.error('Examples:');
    console.error('  node scripts/fetch-replicate-schema.mjs openai/sora-2 --type=video');
    console.error('  node scripts/fetch-replicate-schema.mjs minimax/speech-02-hd --type=audio');
    console.error('');
    console.error('Requires REPLICATE_API_TOKEN environment variable.');
    process.exit(1);
  }

  const modelName = positionalArgs[0];

  // Determine output path
  let outputPath;
  if (type) {
    if (!['audio', 'video', 'image', 'json'].includes(type)) {
      console.error(`[fetch-replicate] Invalid type: ${type}. Must be one of: audio, video, image, json`);
      process.exit(1);
    }
    const filename = modelNameToFilename(modelName);
    outputPath = resolve(repoRoot, 'catalog', 'models', 'replicate', type, filename);
  } else if (positionalArgs.length >= 2) {
    outputPath = positionalArgs[1];
  } else {
    console.error('[fetch-replicate] Error: Either provide an output path or use --type=audio|video|image');
    process.exit(1);
  }

  const schema = await fetchReplicateInputSchema(modelName);

  await writeFile(outputPath, JSON.stringify(schema, null, 2) + '\n');
  console.log(`[fetch-replicate] Wrote schema to ${outputPath}`);
}

// Only run main if this script is invoked directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    console.error('[fetch-replicate] Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
