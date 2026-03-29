#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filterSchemaPathsByModel,
  listCatalogModelSchemaPaths,
  validateSchemaFileViewerAnnotations,
} from './schema-viewer-annotations.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const modelArg = args.find((arg) => arg.startsWith('--model='));
  const modelFilter = modelArg ? modelArg.slice('--model='.length) : undefined;
  const catalogArg = args.find((arg) => arg.startsWith('--catalog-root='));
  const catalogRoot = catalogArg
    ? catalogArg.slice('--catalog-root='.length)
    : 'catalog/models';

  return {
    modelFilter,
    catalogRoot: resolve(repoRoot, catalogRoot),
  };
}

async function main() {
  const { modelFilter, catalogRoot } = parseArgs();
  const allPaths = await listCatalogModelSchemaPaths(catalogRoot);
  const targetPaths = filterSchemaPathsByModel(allPaths, modelFilter);

  if (targetPaths.length === 0) {
    throw new Error(
      modelFilter
        ? `No schemas found for --model=${modelFilter}`
        : `No schema files found under ${catalogRoot}`
    );
  }

  const failures = [];
  const placeholders = [];
  let checkedPointers = 0;

  for (const schemaPath of targetPaths) {
    try {
      const raw = await readFile(schemaPath, 'utf8');
      const schemaFile = JSON.parse(raw);
      const result = validateSchemaFileViewerAnnotations(schemaFile);
      checkedPointers += result.checkedPointers;

      if (result.placeholderPointers.length > 0) {
        for (const pointer of result.placeholderPointers) {
          placeholders.push({ schemaPath, pointer });
        }
      }

      if (result.errors.length > 0) {
        failures.push(
          `${schemaPath}\n${result.errors.map((error) => `  - ${error}`).join('\n')}`
        );
      }
    } catch (error) {
      failures.push(
        `${schemaPath}\n  - ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  console.log('[validate-viewer] Summary:');
  console.log(`  Schemas checked: ${targetPaths.length}`);
  console.log(`  Pointers checked: ${checkedPointers}`);
  console.log(`  Placeholders: ${placeholders.length}`);
  console.log(`  Failures: ${failures.length}`);

  if (placeholders.length > 0) {
    console.log('');
    console.log('[validate-viewer] Placeholder pointers (search these):');
    for (const entry of placeholders) {
      console.log(`  ${entry.schemaPath} :: ${entry.pointer}`);
    }
  }

  if (failures.length > 0) {
    console.error('');
    console.error('[validate-viewer] Validation failures:');
    console.error(failures.join('\n\n'));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    '[validate-viewer] Error:',
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
