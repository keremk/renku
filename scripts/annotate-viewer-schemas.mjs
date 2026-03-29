#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  annotateSchemaFileForViewer,
  filterSchemaPathsByModel,
  listCatalogModelSchemaPaths,
  validateSchemaFileViewerAnnotations,
} from './schema-viewer-annotations.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const rewrite = args.includes('--rewrite');
  const modelArg = args.find((arg) => arg.startsWith('--model='));
  const modelFilter = modelArg ? modelArg.slice('--model='.length) : undefined;
  const catalogArg = args.find((arg) => arg.startsWith('--catalog-root='));
  const catalogRoot = catalogArg
    ? catalogArg.slice('--catalog-root='.length)
    : 'catalog/models';

  return {
    dryRun,
    rewrite,
    modelFilter,
    catalogRoot: resolve(repoRoot, catalogRoot),
  };
}

async function main() {
  const { dryRun, rewrite, modelFilter, catalogRoot } = parseArgs();
  const allPaths = await listCatalogModelSchemaPaths(catalogRoot);
  const targetPaths = filterSchemaPathsByModel(allPaths, modelFilter);

  if (targetPaths.length === 0) {
    throw new Error(
      modelFilter
        ? `No schemas found for --model=${modelFilter}`
        : `No schema files found under ${catalogRoot}`
    );
  }

  let changedFiles = 0;
  let unchangedFiles = 0;
  let failedFiles = 0;
  let totalPointers = 0;
  const placeholderEntries = [];

  for (const schemaPath of targetPaths) {
    try {
      const raw = await readFile(schemaPath, 'utf8');
      const schemaFile = JSON.parse(raw);

      const annotation = annotateSchemaFileForViewer(schemaFile, { rewrite });
      if (annotation.errors.length > 0) {
        failedFiles += 1;
        for (const error of annotation.errors) {
          console.error(`[annotate-viewer] ${schemaPath}: ${error}`);
        }
        continue;
      }

      const validation = validateSchemaFileViewerAnnotations(schemaFile);
      if (validation.errors.length > 0) {
        failedFiles += 1;
        for (const error of validation.errors) {
          console.error(`[annotate-viewer] ${schemaPath}: ${error}`);
        }
        continue;
      }

      totalPointers += annotation.annotatedPointers;
      if (annotation.placeholderPointers.length > 0) {
        for (const pointer of annotation.placeholderPointers) {
          placeholderEntries.push({ schemaPath, pointer });
        }
      }

      if (annotation.changed) {
        changedFiles += 1;
        if (!dryRun) {
          await writeFile(
            schemaPath,
            `${JSON.stringify(schemaFile, null, 2)}\n`
          );
        }
      } else {
        unchangedFiles += 1;
      }
    } catch (error) {
      failedFiles += 1;
      console.error(
        `[annotate-viewer] ${schemaPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  console.log('');
  console.log('[annotate-viewer] Summary:');
  console.log(`  Schemas checked: ${targetPaths.length}`);
  console.log(`  Files changed:   ${changedFiles}`);
  console.log(`  Files unchanged: ${unchangedFiles}`);
  console.log(`  Files failed:    ${failedFiles}`);
  console.log(`  Pointers tagged: ${totalPointers}`);
  console.log(`  Placeholders:    ${placeholderEntries.length}`);

  if (placeholderEntries.length > 0) {
    console.log('');
    console.log('[annotate-viewer] Placeholder pointers (search these):');
    for (const entry of placeholderEntries) {
      console.log(`  ${entry.schemaPath} :: ${entry.pointer}`);
    }
  }

  if (failedFiles > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    '[annotate-viewer] Error:',
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
