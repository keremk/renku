#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { fetchReplicateInputSchema, modelNameToFilename } from './fetch-replicate-schema.mjs';

/**
 * Batch process all models in replicate.yaml and update missing schemas.
 *
 * Usage: node scripts/update-replicate-catalog.mjs <yaml-path> [--dry-run]
 *
 * Example: node scripts/update-replicate-catalog.mjs catalog/models/replicate/replicate.yaml
 *          node scripts/update-replicate-catalog.mjs catalog/models/replicate/replicate.yaml --dry-run
 *
 * Requires REPLICATE_API_TOKEN environment variable (unless --dry-run with all schemas present).
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

/**
 * Check if a JSON file already has the flat Replicate schema format
 * (has "type" and "properties" at top level, not wrapped in input_schema/output_schema)
 */
async function hasSchema(filePath) {
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    const json = JSON.parse(content);
    return 'type' in json && 'properties' in json;
  } catch {
    return false;
  }
}

/**
 * Sleep for the given number of milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filteredArgs = args.filter((arg) => !arg.startsWith('--'));

  if (filteredArgs.length < 1) {
    console.error('Usage: node scripts/update-replicate-catalog.mjs <yaml-path> [--dry-run]');
    console.error('Example: node scripts/update-replicate-catalog.mjs catalog/models/replicate/replicate.yaml');
    console.error('         node scripts/update-replicate-catalog.mjs catalog/models/replicate/replicate.yaml --dry-run');
    process.exit(1);
  }

  if (dryRun) {
    console.log('[update-replicate] DRY RUN MODE - no files will be modified\n');
  }

  const yamlPath = resolve(repoRoot, filteredArgs[0]);

  if (!existsSync(yamlPath)) {
    console.error(`[update-replicate] YAML file not found: ${yamlPath}`);
    process.exit(1);
  }

  console.log(`[update-replicate] Loading catalog from ${yamlPath}`);

  const yamlContent = await readFile(yamlPath, 'utf-8');
  const catalog = parseYaml(yamlContent);

  if (!catalog?.models || !Array.isArray(catalog.models)) {
    console.error('[update-replicate] No models array found in YAML file');
    process.exit(1);
  }

  const catalogDir = dirname(yamlPath);

  let converted = 0;
  let skipped = 0;
  let failed = 0;
  let needsFetch = false;

  // First pass: check if any models need fetching
  for (const model of catalog.models) {
    const { name, type } = model;
    if (!name || !type) continue;
    const typeDir = resolve(catalogDir, type);
    const filename = modelNameToFilename(name);
    const outputPath = resolve(typeDir, filename);
    if (!(await hasSchema(outputPath))) {
      needsFetch = true;
      break;
    }
  }

  // Validate token if we'll need to fetch
  if (needsFetch && !dryRun && !process.env.REPLICATE_API_TOKEN) {
    console.error('[update-replicate] REPLICATE_API_TOKEN is required to fetch missing schemas.');
    console.error('Get your token at https://replicate.com/account/api-tokens');
    process.exit(1);
  }

  let isFirstFetch = true;

  for (const model of catalog.models) {
    const { name, type } = model;

    if (!name || !type) {
      console.warn(`[update-replicate] Skipping model with missing name or type: ${JSON.stringify(model)}`);
      failed++;
      continue;
    }

    // Determine output directory based on type
    const typeDir = resolve(catalogDir, type);
    const filename = modelNameToFilename(name);
    const outputPath = resolve(typeDir, filename);

    // Check if already has schema
    if (await hasSchema(outputPath)) {
      console.log(`[update-replicate] SKIP: ${name} (already has schema)`);
      skipped++;
      continue;
    }

    // Fetch schema
    try {
      if (dryRun) {
        console.log(`[update-replicate] WOULD CONVERT: ${name} → ${outputPath}`);
        converted++;
      } else {
        // Rate limit: 500ms between API calls
        if (!isFirstFetch) {
          await sleep(500);
        }
        isFirstFetch = false;

        const schema = await fetchReplicateInputSchema(name);
        await writeFile(outputPath, JSON.stringify(schema, null, 2) + '\n');
        console.log(`[update-replicate] CONVERTED: ${name} → ${outputPath}`);
        converted++;
      }
    } catch (error) {
      console.error(`[update-replicate] FAILED: ${name} - ${error instanceof Error ? error.message : error}`);
      failed++;
    }
  }

  console.log('');
  console.log('[update-replicate] Summary:');
  console.log(`  Converted: ${converted}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Total:     ${catalog.models.length}`);
}

main().catch((error) => {
  console.error('[update-replicate] Error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
