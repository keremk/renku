#!/usr/bin/env node
/**
 * Prepares the desktop app resources by copying built artifacts
 * into desktop/resources/ for Electron packaging.
 *
 * Copies:
 *   viewer/dist/         → desktop/resources/viewer-dist/
 *   viewer/server-dist/  → desktop/resources/viewer-server/
 *   catalog/             → desktop/resources/catalog/
 *   cli/dist/            → desktop/resources/cli/
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const targetRoot = resolve(repoRoot, 'desktop', 'resources');

const sources = [
  {
    src: resolve(repoRoot, 'viewer', 'dist'),
    dest: resolve(targetRoot, 'viewer-dist'),
    description: 'viewer dist build',
  },
  {
    src: resolve(repoRoot, 'viewer', 'server-dist'),
    dest: resolve(targetRoot, 'viewer-server'),
    description: 'viewer server build',
  },
  {
    src: resolve(repoRoot, 'catalog'),
    dest: resolve(targetRoot, 'catalog'),
    description: 'model catalog',
  },
  {
    src: resolve(repoRoot, 'cli', 'dist'),
    dest: resolve(targetRoot, 'cli'),
    description: 'CLI dist build',
  },
];

function assertExists(path, description) {
  if (!existsSync(path)) {
    console.error(`[desktop-bundle] Missing ${description} at ${path}.`);
    console.error(`[desktop-bundle] Run "pnpm build" first to build all packages.`);
    process.exit(1);
  }
}

async function main() {
  // Verify all source directories exist
  for (const { src, description } of sources) {
    assertExists(src, description);
  }

  // Clean and recreate target
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });

  // Copy each source to its destination
  for (const { src, dest, description } of sources) {
    await cp(src, dest, { recursive: true });
    console.log(`[desktop-bundle] Copied ${description} → ${dest}`);
  }

  console.log(`[desktop-bundle] Desktop resources prepared at ${targetRoot}`);
}

main().catch((error) => {
  console.error('[desktop-bundle] Failed to prepare desktop bundle:', error);
  process.exit(1);
});
