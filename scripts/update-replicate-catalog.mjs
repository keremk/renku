#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  fetchReplicateInputSchema,
  modelNameToFilename,
} from './fetch-replicate-schema.mjs';
import { normalizeSchemaFileForCatalog } from './schema-file-validation.mjs';
import {
  validateSchemaFileViewerAnnotations,
} from './schema-viewer-annotations.mjs';

/**
 * Batch process models in replicate.yaml.
 *
 * Modes:
 * - default (missing-only): fetch/write only missing or invalid local schema files.
 * - --check-diff: fetch API schemas and report local-vs-api differences.
 * - --update-diff: fetch API schemas and write only changed/missing/invalid files.
 *
 * Usage:
 *   node scripts/update-replicate-catalog.mjs <yaml-path> [--dry-run]
 *   node scripts/update-replicate-catalog.mjs <yaml-path> --check-diff [--model=<owner/model>] [--dry-run]
 *   node scripts/update-replicate-catalog.mjs <yaml-path> --update-diff [--model=<owner/model>] [--dry-run]
 *
 * Requires REPLICATE_API_TOKEN whenever an API fetch is needed.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const FETCH_DELAY_MS = 500;
const SUPPORTED_SCHEMA_TYPES = new Set(['audio', 'video', 'image', 'json']);

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function isObjectRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJson(entry));
  }
  if (!isObjectRecord(value)) {
    return value;
  }

  const result = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = canonicalizeJson(value[key]);
  }
  return result;
}

function schemasEqual(left, right) {
  return (
    JSON.stringify(canonicalizeJson(left)) ===
    JSON.stringify(canonicalizeJson(right))
  );
}

function isValidSchemaFile(json) {
  if (!isObjectRecord(json)) {
    return false;
  }

  if (isObjectRecord(json.input_schema)) {
    return true;
  }

  // Legacy flat format support (for migration mode)
  return isObjectRecord(json.properties) && typeof json.type === 'string';
}

async function readLocalSchemaState(filePath) {
  let content;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (error) {
    const maybeNodeError = error;
    if (maybeNodeError && maybeNodeError.code === 'ENOENT') {
      return { state: 'missing' };
    }
    throw error;
  }

  try {
    const parsed = JSON.parse(content);
    if (!isValidSchemaFile(parsed)) {
      return { state: 'invalid' };
    }

    const validation = validateSchemaFileViewerAnnotations(parsed);
    if (validation.errors.length > 0) {
      return { state: 'invalid' };
    }

    const { schemaFile: normalizedSchema, repairsApplied } =
      normalizeSchemaFileForCatalog(parsed, `Local schema ${filePath}`);
    if (repairsApplied > 0) {
      return { state: 'invalid' };
    }

    return { state: 'ok', schema: normalizedSchema };
  } catch {
    return { state: 'invalid' };
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const checkDiff = args.includes('--check-diff');
  const updateDiff = args.includes('--update-diff');
  const modelArg = args.find((arg) => arg.startsWith('--model='));
  const modelFilter = modelArg ? modelArg.slice('--model='.length) : undefined;
  const positionalArgs = args.filter((arg) => !arg.startsWith('--'));

  if (checkDiff && updateDiff) {
    throw new Error('Use only one of --check-diff or --update-diff.');
  }

  if (positionalArgs.length < 1) {
    throw new Error(
      'Usage: node scripts/update-replicate-catalog.mjs <yaml-path> [--dry-run] [--check-diff|--update-diff] [--model=<owner/model>]'
    );
  }

  const mode = checkDiff
    ? 'check-diff'
    : updateDiff
      ? 'update-diff'
      : 'missing-only';

  return {
    dryRun,
    mode,
    modelFilter,
    yamlArg: positionalArgs[0],
  };
}

async function main() {
  const { dryRun, mode, modelFilter, yamlArg } = parseArgs();

  if (dryRun) {
    console.log(
      '[update-replicate] DRY RUN MODE - no files will be modified\n'
    );
  }

  const yamlPath = resolve(repoRoot, yamlArg);
  const yamlContent = await readFile(yamlPath, 'utf-8');
  const catalog = parseYaml(yamlContent);

  if (!catalog?.models || !Array.isArray(catalog.models)) {
    throw new Error('No models array found in YAML file');
  }

  const targetModels = catalog.models.filter((entry) => {
    if (!entry?.name || !entry?.type) {
      return false;
    }
    if (modelFilter && entry.name !== modelFilter) {
      return false;
    }
    return true;
  });

  if (targetModels.length === 0) {
    throw new Error(
      modelFilter
        ? `No models matched --model=${modelFilter}`
        : 'No valid models found in catalog'
    );
  }

  const catalogDir = dirname(yamlPath);

  const counters = {
    upToDate: 0,
    updated: 0,
    wouldUpdate: 0,
    skipped: 0,
    missingLocal: 0,
    invalidLocal: 0,
    different: 0,
    failed: 0,
  };

  const localStateMap = new Map();
  for (const model of targetModels) {
    const { name, type } = model;
    if (!SUPPORTED_SCHEMA_TYPES.has(type)) {
      continue;
    }
    const filePath = resolve(catalogDir, type, modelNameToFilename(name));
    localStateMap.set(name, await readLocalSchemaState(filePath));
  }

  const requiresFetch =
    mode === 'check-diff' ||
    mode === 'update-diff' ||
    (!dryRun &&
      mode === 'missing-only' &&
      targetModels.some((model) => {
        const state = localStateMap.get(model.name);
        return state?.state === 'missing' || state?.state === 'invalid';
      }));

  if (requiresFetch && !process.env.REPLICATE_API_TOKEN) {
    throw new Error(
      'REPLICATE_API_TOKEN is required for this mode. Get your token at https://replicate.com/account/api-tokens'
    );
  }

  console.log(`[update-replicate] Loading catalog from ${yamlPath}`);
  console.log(`[update-replicate] Mode: ${mode}`);
  if (modelFilter) {
    console.log(`[update-replicate] Model filter: ${modelFilter}`);
  }
  console.log('');

  let firstFetch = true;

  for (const model of targetModels) {
    const { name, type } = model;
    const schemaPath = resolve(catalogDir, type, modelNameToFilename(name));

    if (!SUPPORTED_SCHEMA_TYPES.has(type)) {
      console.error(
        `[update-replicate] FAILED: ${name} uses unsupported schema type "${type}"`
      );
      counters.failed += 1;
      continue;
    }

    const localState = localStateMap.get(name);
    if (!localState) {
      console.error(
        `[update-replicate] FAILED: could not determine local schema state for ${name}`
      );
      counters.failed += 1;
      continue;
    }

    if (mode === 'missing-only') {
      if (localState.state === 'ok') {
        console.log(`[update-replicate] SKIP: ${name} (already has schema)`);
        counters.skipped += 1;
        continue;
      }

      if (dryRun) {
        console.log(
          `[update-replicate] WOULD FETCH: ${name} -> ${schemaPath} (${localState.state})`
        );
        counters.wouldUpdate += 1;
        continue;
      }

      try {
        if (!firstFetch) {
          await sleep(FETCH_DELAY_MS);
        }
        firstFetch = false;

        const fetchedSchema = await fetchReplicateInputSchema(
          name,
          localState.state === 'ok' ? localState.schema : undefined,
          {
            schemaType: type,
            outputPath: schemaPath,
          }
        );
        await writeFile(
          schemaPath,
          JSON.stringify(fetchedSchema, null, 2) + '\n'
        );
        console.log(
          `[update-replicate] UPDATED: ${name} -> ${schemaPath} (${localState.state})`
        );
        counters.updated += 1;
      } catch (error) {
        console.error(
          `[update-replicate] FAILED: ${name} - ${error instanceof Error ? error.message : error}`
        );
        counters.failed += 1;
      }

      continue;
    }

    try {
      if (!firstFetch) {
        await sleep(FETCH_DELAY_MS);
      }
      firstFetch = false;

      const fetchedSchema = await fetchReplicateInputSchema(
        name,
        localState.state === 'ok' ? localState.schema : undefined,
        {
          schemaType: type,
          outputPath: schemaPath,
        }
      );

      let driftState = 'up-to-date';
      if (localState.state === 'missing') {
        driftState = 'missing-local';
      } else if (localState.state === 'invalid') {
        driftState = 'invalid-local';
      } else if (!schemasEqual(localState.schema, fetchedSchema)) {
        driftState = 'different';
      }

      if (driftState === 'up-to-date') {
        console.log(`[update-replicate] UP TO DATE: ${name}`);
        counters.upToDate += 1;
        continue;
      }

      if (driftState === 'missing-local') {
        counters.missingLocal += 1;
      } else if (driftState === 'invalid-local') {
        counters.invalidLocal += 1;
      } else if (driftState === 'different') {
        counters.different += 1;
      }

      if (mode === 'check-diff') {
        console.log(`[update-replicate] DIFF: ${name} (${driftState})`);
        continue;
      }

      if (dryRun) {
        console.log(`[update-replicate] WOULD UPDATE: ${name} (${driftState})`);
        counters.wouldUpdate += 1;
      } else {
        await writeFile(
          schemaPath,
          JSON.stringify(fetchedSchema, null, 2) + '\n'
        );
        console.log(`[update-replicate] UPDATED: ${name} (${driftState})`);
        counters.updated += 1;
      }
    } catch (error) {
      console.error(
        `[update-replicate] FAILED: ${name} - ${error instanceof Error ? error.message : error}`
      );
      counters.failed += 1;
    }
  }

  console.log('');
  console.log('[update-replicate] Summary:');
  console.log(`  Up to date:   ${counters.upToDate}`);
  console.log(`  Updated:      ${counters.updated}`);
  console.log(`  Would update: ${counters.wouldUpdate}`);
  console.log(`  Skipped:      ${counters.skipped}`);
  console.log(`  Different:    ${counters.different}`);
  console.log(`  Missing:      ${counters.missingLocal}`);
  console.log(`  Invalid:      ${counters.invalidLocal}`);
  console.log(`  Failed:       ${counters.failed}`);
  console.log(`  Total:        ${targetModels.length}`);

  const hasDrift =
    counters.different > 0 ||
    counters.missingLocal > 0 ||
    counters.invalidLocal > 0;

  if (counters.failed > 0) {
    process.exit(1);
  }

  if (mode === 'check-diff' && hasDrift) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    '[update-replicate] Error:',
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
