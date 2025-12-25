#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { fetchAndTransformSchema, modelNameToFilename } from './fetch-fal-schema.mjs';

/**
 * Batch process all models in fal-ai.yaml and update missing schemas.
 *
 * Usage: node scripts/update-fal-catalog.mjs <yaml-path>
 *
 * Example: node scripts/update-fal-catalog.mjs catalog/models/fal-ai/fal-ai.yaml
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

/**
 * Check if a JSON file already has both input_schema and output_schema
 */
async function hasSchemas(filePath) {
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    const json = JSON.parse(content);
    return 'input_schema' in json && 'output_schema' in json;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filteredArgs = args.filter((arg) => !arg.startsWith('--'));

  if (filteredArgs.length < 1) {
    console.error('Usage: node scripts/update-fal-catalog.mjs <yaml-path> [--dry-run]');
    console.error('Example: node scripts/update-fal-catalog.mjs catalog/models/fal-ai/fal-ai.yaml');
    console.error('         node scripts/update-fal-catalog.mjs catalog/models/fal-ai/fal-ai.yaml --dry-run');
    process.exit(1);
  }

  if (dryRun) {
    console.log('[update-fal] DRY RUN MODE - no files will be modified\n');
  }

  const yamlPath = resolve(repoRoot, filteredArgs[0]);

  if (!existsSync(yamlPath)) {
    console.error(`[update-fal] YAML file not found: ${yamlPath}`);
    process.exit(1);
  }

  console.log(`[update-fal] Loading catalog from ${yamlPath}`);

  const yamlContent = await readFile(yamlPath, 'utf-8');
  const catalog = parseYaml(yamlContent);

  if (!catalog?.models || !Array.isArray(catalog.models)) {
    console.error('[update-fal] No models array found in YAML file');
    process.exit(1);
  }

  const catalogDir = dirname(yamlPath);

  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const model of catalog.models) {
    const { name, type, subProvider } = model;

    if (!name || !type) {
      console.warn(`[update-fal] Skipping model with missing name or type: ${JSON.stringify(model)}`);
      failed++;
      continue;
    }

    // Determine output directory based on type
    const typeDir = resolve(catalogDir, type);
    const filename = modelNameToFilename(name);
    const outputPath = resolve(typeDir, filename);

    // Check if already converted
    if (await hasSchemas(outputPath)) {
      console.log(`[update-fal] SKIP: ${name} (already has schemas)`);
      skipped++;
      continue;
    }

    // Fetch and transform schema
    try {
      if (dryRun) {
        const subProviderInfo = subProvider ? ` [subProvider: ${subProvider}]` : '';
        console.log(`[update-fal] WOULD CONVERT: ${name}${subProviderInfo} → ${outputPath}`);
        converted++;
      } else {
        const schema = await fetchAndTransformSchema(name, subProvider);
        await writeFile(outputPath, JSON.stringify(schema, null, 2) + '\n');
        console.log(`[update-fal] CONVERTED: ${name} → ${outputPath}`);
        converted++;
      }
    } catch (error) {
      console.error(`[update-fal] FAILED: ${name} - ${error instanceof Error ? error.message : error}`);
      failed++;
    }
  }

  console.log('');
  console.log('[update-fal] Summary:');
  console.log(`  Converted: ${converted}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Total:     ${catalog.models.length}`);
}

main().catch((error) => {
  console.error('[update-fal] Error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
