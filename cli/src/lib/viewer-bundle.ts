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
  const bundledRoot = resolve(cliRoot, 'viewer-bundle');
  const bundled = getBundleForRoot(bundledRoot);
  if (existsSync(bundled.assetsDir) && existsSync(bundled.serverEntry)) {
    return bundled;
  }

  throw new Error(
    'Viewer bundle not found. Set RENKU_VIEWER_BUNDLE_ROOT to a built viewer (dist/ and server-dist/bin.js) or use a packaged CLI with cli/viewer-bundle present.',
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
