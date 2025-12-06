#!/usr/bin/env node
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const viewerDist = resolve(repoRoot, 'viewer', 'dist');
const viewerServerDist = resolve(repoRoot, 'viewer', 'server-dist');
const targetRoot = resolve(repoRoot, 'cli', 'viewer-bundle');
const targetDist = resolve(targetRoot, 'dist');
const targetServerDist = resolve(targetRoot, 'server-dist');

function assertExists(path, description) {
  if (!existsSync(path)) {
    console.error(`[bundle] Missing ${description} at ${path}. Run "pnpm --filter viewer build" first.`);
    process.exit(1);
  }
}

async function main() {
  assertExists(viewerDist, 'viewer dist build');
  assertExists(viewerServerDist, 'viewer server build');

  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });

  await cp(viewerDist, targetDist, { recursive: true });
  await cp(viewerServerDist, targetServerDist, { recursive: true });

  console.log(`[bundle] Copied viewer assets to ${targetRoot}`);
}

main().catch((error) => {
  console.error('[bundle] Failed to prepare viewer bundle:', error);
  process.exit(1);
});
