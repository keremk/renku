import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveViewerBundlePaths } from './viewer-bundle.js';
import process from 'node:process';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

const moduleDir = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(moduleDir, '..', '..');
const bundledAssets = resolve(cliRoot, 'viewer-bundle', 'dist');
const bundledServer = resolve(cliRoot, 'viewer-bundle', 'server-dist', 'bin.js');
const existsSyncMock = vi.mocked(existsSync);

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.RENKU_VIEWER_BUNDLE_ROOT;
});

afterEach(() => {
  delete process.env.RENKU_VIEWER_BUNDLE_ROOT;
});

describe('resolveViewerBundlePaths', () => {
  it('uses RENKU_VIEWER_BUNDLE_ROOT when provided', () => {
    process.env.RENKU_VIEWER_BUNDLE_ROOT = '/tmp/viewer';
    existsSyncMock.mockImplementation(
      (path) => path === '/tmp/viewer/dist' || path === '/tmp/viewer/server-dist/bin.js',
    );

    const bundle = resolveViewerBundlePaths();

    expect(bundle).toEqual({
      assetsDir: '/tmp/viewer/dist',
      serverEntry: '/tmp/viewer/server-dist/bin.js',
    });
  });

  it('uses the packaged cli/viewer-bundle when env is unset', () => {
    existsSyncMock.mockImplementation(
      (path) => path === bundledAssets || path === bundledServer,
    );

    const bundle = resolveViewerBundlePaths();

    expect(bundle).toEqual({
      assetsDir: bundledAssets,
      serverEntry: bundledServer,
    });
  });

  it('throws when no bundle is available', () => {
    existsSyncMock.mockReturnValue(false);

    expect(() => resolveViewerBundlePaths()).toThrow(
      /Set RENKU_VIEWER_BUNDLE_ROOT to a built viewer/,
    );
  });
});
