import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runUse } from './use.js';
import { runInit } from './init.js';
import { readCliConfig } from '../lib/cli-config.js';

const tmpRoots: string[] = [];

afterEach(async () => {
  while (tmpRoots.length) {
    const dir = tmpRoots.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createTempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'renku-use-'));
  tmpRoots.push(dir);
  return dir;
}

describe('runUse', () => {
  it('switches to a valid workspace', async () => {
    const root1 = await createTempRoot();
    const root2 = await createTempRoot();
    const configPath = resolve(root1, 'cli-config.json');
    const envPath = resolve(root1, 'env.sh');

    // Initialize first workspace
    await runInit({ rootFolder: root1, configPath, envPath });

    // Initialize second workspace (this will update the config to point to root2)
    const configPath2 = resolve(root2, 'cli-config.json');
    const envPath2 = resolve(root2, 'env.sh');
    await runInit({ rootFolder: root2, configPath: configPath2, envPath: envPath2 });

    // Now use the shared config and switch back to root1
    // First we need to set up root1 as an existing workspace
    // Since root1 is already initialized, we can use runUse to switch to it
    const result = await runUse({ rootFolder: root1, configPath: configPath2 });

    expect(result.rootFolder).toBe(root1);
    expect(result.catalogRoot).toBe(join(root1, 'catalog'));

    // Verify config was updated
    const config = await readCliConfig(configPath2);
    expect(config?.storage.root).toBe(root1);
  });

  it('throws error for non-existent folder', async () => {
    const root = await createTempRoot();
    const configPath = resolve(root, 'cli-config.json');

    await expect(
      runUse({ rootFolder: '/non/existent/path', configPath }),
    ).rejects.toThrow(/Not a valid Renku workspace/);
  });

  it('throws error for folder without catalog', async () => {
    const root = await createTempRoot();
    const emptyFolder = await createTempRoot();
    const configPath = resolve(root, 'cli-config.json');

    // emptyFolder exists but has no catalog
    await expect(
      runUse({ rootFolder: emptyFolder, configPath }),
    ).rejects.toThrow(/Not a valid Renku workspace/);
  });

  it('throws error when root folder is not provided', async () => {
    const root = await createTempRoot();
    const configPath = resolve(root, 'cli-config.json');

    await expect(
      runUse({ rootFolder: '', configPath }),
    ).rejects.toThrow(/--root is required/);
  });
});
