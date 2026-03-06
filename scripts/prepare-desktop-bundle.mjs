#!/usr/bin/env node
/**
 * Prepares the desktop app resources by copying built artifacts
 * into desktop/resources/ for Electron packaging.
 *
 * Copies:
 *   viewer/dist/         → desktop/resources/viewer-dist/
 *   catalog/             → desktop/resources/catalog/
 *   cli/dist/            → desktop/resources/cli/
 *
 * Bundles (via esbuild, to eliminate bare imports):
 *   viewer/server-dist/runtime.js → desktop/resources/viewer-server/runtime.mjs
 *
 * Copies binary:
 *   ffmpeg-static binary → desktop/resources/ffmpeg
 */
import { cp, mkdir, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const targetRoot = resolve(repoRoot, 'desktop', 'resources');

const copies = [
  {
    src: resolve(repoRoot, 'viewer', 'dist'),
    dest: resolve(targetRoot, 'viewer-dist'),
    description: 'viewer dist build',
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

async function bundleViewerServer() {
  const serverDistDir = resolve(repoRoot, 'viewer', 'server-dist');
  const entryPoint = resolve(serverDistDir, 'runtime.js');
  const outFile = resolve(targetRoot, 'viewer-server', 'runtime.mjs');

  assertExists(entryPoint, 'viewer server runtime');

  await mkdir(resolve(targetRoot, 'viewer-server'), { recursive: true });

  // Use esbuild JS API — resolve from repo root
  const require = createRequire(resolve(repoRoot, 'package.json'));
  const esbuild = require('esbuild');

  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: outFile,
    target: 'node20',
    external: ['node:*'],
    banner: {
      js: "import { createRequire as __esbuildCreateRequire } from 'node:module';\nconst require = __esbuildCreateRequire(import.meta.url);",
    },
  });

  console.log(`[desktop-bundle] Bundled viewer server → ${outFile}`);
}

async function copyFfBinaries() {
  const ffmpegSrc = resolve(repoRoot, 'desktop', 'node_modules', 'ffmpeg-static', 'ffmpeg');
  const ffmpegDest = resolve(targetRoot, 'ffmpeg');

  if (!existsSync(ffmpegSrc)) {
    console.warn(`[desktop-bundle] ffmpeg-static binary not found at ${ffmpegSrc}, skipping.`);
  } else {
    await copyFile(ffmpegSrc, ffmpegDest);
    console.log(`[desktop-bundle] Copied ffmpeg binary → ${ffmpegDest}`);
  }

  // ffprobe-static stores the binary under bin/<platform>/<arch>/ffprobe
  const ffprobeSrc = resolve(repoRoot, 'desktop', 'node_modules', 'ffprobe-static', 'bin', process.platform, process.arch, 'ffprobe');
  const ffprobeDest = resolve(targetRoot, 'ffprobe');

  if (!existsSync(ffprobeSrc)) {
    console.warn(`[desktop-bundle] ffprobe-static binary not found at ${ffprobeSrc}, skipping.`);
  } else {
    await copyFile(ffprobeSrc, ffprobeDest);
    console.log(`[desktop-bundle] Copied ffprobe binary → ${ffprobeDest}`);
  }
}

async function main() {
  // Verify all source directories exist
  for (const { src, description } of copies) {
    assertExists(src, description);
  }

  // Clean and recreate target
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });

  // Copy static resources
  for (const { src, dest, description } of copies) {
    await cp(src, dest, { recursive: true });
    console.log(`[desktop-bundle] Copied ${description} → ${dest}`);
  }

  // Bundle viewer-server with all dependencies inlined
  await bundleViewerServer();

  // Copy ffmpeg and ffprobe binaries
  await copyFfBinaries();

  console.log(`[desktop-bundle] Desktop resources prepared at ${targetRoot}`);
}

main().catch((error) => {
  console.error('[desktop-bundle] Failed to prepare desktop bundle:', error);
  process.exit(1);
});
