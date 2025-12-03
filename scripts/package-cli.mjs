#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = resolve(repoRoot, 'release');

const steps = [
  {
    name: 'Bundle viewer assets into CLI',
    command: ['pnpm', 'bundle:viewer'],
  },
  {
    name: 'Build CLI',
    command: ['pnpm', '--filter', 'renku', 'build'],
  },
];

function runStep(step) {
  console.log(`\n[package-cli] ${step.name}`);
  const result = spawnSync(step.command[0], step.command.slice(1), {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Step "${step.name}" failed with exit code ${result.status ?? 'null'}`);
  }
}

function packCli() {
  console.log('\n[package-cli] Packing renku workspace');
  const result = spawnSync(
    'pnpm',
    ['--filter', 'renku', 'pack', '--pack-destination', releaseDir],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`pnpm pack failed with exit code ${result.status ?? 'null'}`);
  }
}

try {
  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(releaseDir, { recursive: true });
  for (const step of steps) {
    runStep(step);
  }
  packCli();
  console.log(`\n[package-cli] Done. Find the tarball under ${releaseDir}`);
} catch (error) {
  console.error('\n[package-cli] Packaging failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
