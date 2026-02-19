#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const sourceCatalog = resolve(repoRoot, 'catalog');
const bundledCatalog = resolve(repoRoot, 'cli', 'catalog');

const REQUIRED_DIRECTORIES = ['blueprints', 'models', 'producers'];
const MAX_REPORT_ITEMS = 20;

function assertSourceCatalog() {
  if (!existsSync(sourceCatalog)) {
    throw new Error(`Missing source catalog at ${sourceCatalog}`);
  }

  for (const directory of REQUIRED_DIRECTORIES) {
    const path = resolve(sourceCatalog, directory);
    if (!existsSync(path)) {
      throw new Error(`Source catalog is missing required directory: ${path}`);
    }
  }
}

async function collectFileHashes(root, relative = '', entries = new Map()) {
  const dirPath = relative ? resolve(root, relative) : root;
  const dirEntries = await readdir(dirPath, { withFileTypes: true });

  dirEntries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of dirEntries) {
    const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const absolutePath = resolve(root, nextRelative);

    if (entry.isDirectory()) {
      await collectFileHashes(root, nextRelative, entries);
      continue;
    }

    if (entry.isFile()) {
      const fileBytes = await readFile(absolutePath);
      const fileHash = createHash('sha256').update(fileBytes).digest('hex');
      entries.set(nextRelative, fileHash);
      continue;
    }

    throw new Error(`Unsupported catalog entry type at ${absolutePath}`);
  }

  return entries;
}

function printSection(title, items) {
  if (items.length === 0) {
    return;
  }

  console.error(`\n${title} (${items.length}):`);
  for (const item of items.slice(0, MAX_REPORT_ITEMS)) {
    console.error(`  - ${item}`);
  }
  if (items.length > MAX_REPORT_ITEMS) {
    console.error(`  ...and ${items.length - MAX_REPORT_ITEMS} more`);
  }
}

async function main() {
  assertSourceCatalog();

  if (!existsSync(bundledCatalog)) {
    console.log(
      '[catalog:check] cli/catalog is missing (expected for generated-only local flow).'
    );
    return;
  }

  const sourceEntries = await collectFileHashes(sourceCatalog);
  const bundledEntries = await collectFileHashes(bundledCatalog);

  const missingInBundle = [...sourceEntries.keys()].filter(
    (entry) => !bundledEntries.has(entry)
  );
  const extraInBundle = [...bundledEntries.keys()].filter(
    (entry) => !sourceEntries.has(entry)
  );
  const contentMismatches = [...sourceEntries.keys()].filter(
    (entry) =>
      bundledEntries.has(entry) &&
      sourceEntries.get(entry) !== bundledEntries.get(entry)
  );

  if (
    missingInBundle.length > 0 ||
    extraInBundle.length > 0 ||
    contentMismatches.length > 0
  ) {
    console.error('[catalog:check] cli/catalog is out of sync with catalog/.');
    printSection('Missing in cli/catalog', missingInBundle);
    printSection('Unexpected files in cli/catalog', extraInBundle);
    printSection('Changed files', contentMismatches);
    console.error(
      '\nRun `pnpm bundle:catalog` to regenerate cli/catalog from catalog/.'
    );
    process.exit(1);
  }

  console.log('[catalog:check] cli/catalog is in sync with catalog/.');
}

main().catch((error) => {
  console.error(
    '[catalog:check] Failed:',
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
