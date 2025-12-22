#!/usr/bin/env node
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const sourceCatalog = resolve(repoRoot, 'catalog');
const targetCatalog = resolve(repoRoot, 'cli', 'catalog');

function assertSourceExists() {
  if (!existsSync(sourceCatalog)) {
    console.error(`[catalog] Missing source catalog at ${sourceCatalog}`);
    process.exit(1);
  }
}

async function main() {
  assertSourceExists();
  await rm(targetCatalog, { recursive: true, force: true });
  await mkdir(targetCatalog, { recursive: true });
  await cp(sourceCatalog, targetCatalog, { recursive: true });
  console.log(`[catalog] Copied catalog assets to ${targetCatalog}`);
}

main().catch((error) => {
  console.error('[catalog] Failed to prepare catalog bundle:', error instanceof Error ? error.message : error);
  process.exit(1);
});
