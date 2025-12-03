import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export interface ViewerBundlePaths {
  assetsDir: string;
  serverEntry: string;
}

export function resolveViewerBundlePaths(): ViewerBundlePaths {
  const envRoot = process.env.RENKU_VIEWER_BUNDLE_ROOT;
  if (envRoot) {
    const bundle = getBundleForRoot(envRoot);
    assertBundleExists(bundle, envRoot);
    return bundle;
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const cliRoot = resolve(moduleDir, '..', '..');
  const searchRoots = [
    resolve(cliRoot, '..', '..', 'viewer'),
    resolve(cliRoot, 'config', 'viewer'),
  ];

  for (const root of searchRoots) {
    const bundle = getBundleForRoot(root);
    if (existsSync(bundle.assetsDir) && existsSync(bundle.serverEntry)) {
      return bundle;
    }
  }

  throw new Error(
    'Viewer bundle not found. Build the viewer package (pnpm --filter viewer build) or set RENKU_VIEWER_BUNDLE_ROOT.',
  );
}

function getBundleForRoot(root: string): ViewerBundlePaths {
  return {
    assetsDir: resolve(root, 'dist'),
    serverEntry: resolve(root, 'server-dist', 'bin.js'),
  };
}

function assertBundleExists(bundle: ViewerBundlePaths, root: string): void {
  if (!existsSync(bundle.assetsDir)) {
    throw new Error(`Viewer assets not found at ${bundle.assetsDir} (root=${root})`);
  }
  if (!existsSync(bundle.serverEntry)) {
    throw new Error(`Viewer server binary not found at ${bundle.serverEntry} (root=${root})`);
  }
}
