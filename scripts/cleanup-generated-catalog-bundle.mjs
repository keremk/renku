#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const generatedCatalog = resolve(repoRoot, 'cli', 'catalog');

async function main() {
  if (!existsSync(generatedCatalog)) {
    return;
  }

  await rm(generatedCatalog, { recursive: true, force: true });
  console.log(`[catalog] Removed generated bundle at ${generatedCatalog}`);
}

main().catch((error) => {
  console.error(
    '[catalog] Failed to clean generated bundle:',
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
