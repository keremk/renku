import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runUpdate } from './update.js';
import { runInit } from './init.js';
import { getCliBlueprintsRoot } from '../lib/config-assets.js';

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
  const dir = await mkdtemp(join(tmpdir(), 'renku-update-'));
  tmpRoots.push(dir);
  return dir;
}

describe('runUpdate', () => {
  it('updates catalog when workspace is initialized', async () => {
    const root = await createTempRoot();
    const configPath = resolve(root, 'cli-config.json');
    const envPath = resolve(root, 'env.sh');

    // Initialize workspace first
    await runInit({ rootFolder: root, configPath, envPath });

    // Modify a catalog file to verify it gets overwritten
    const blueprintPath = join(getCliBlueprintsRoot(root), 'audio-only', 'audio-only.yaml');
    const originalContent = await readFile(blueprintPath, 'utf8');
    await writeFile(blueprintPath, '# Modified content', 'utf8');

    // Run update
    const result = await runUpdate({ configPath });

    expect(result.catalogRoot).toBe(join(root, 'catalog'));

    // Verify the file was overwritten
    const updatedContent = await readFile(blueprintPath, 'utf8');
    expect(updatedContent).toBe(originalContent);
  });

  it('throws error when workspace is not initialized', async () => {
    const root = await createTempRoot();
    const configPath = resolve(root, 'cli-config.json');

    await expect(runUpdate({ configPath })).rejects.toThrow(
      /Renku CLI is not initialized/,
    );
  });
});
