import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBuild } from './create-handler.js';

const tempDirs: string[] = [];

async function createTempBlueprintFolder(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'renku-viewer-build-create-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('createBuild', () => {
  it('creates a build with copied inputs template', async () => {
    const blueprintFolder = await createTempBlueprintFolder();
    await writeFile(
      path.join(blueprintFolder, 'input-template.yaml'),
      'inputs:\n  Topic: test\nmodels: []\n',
      'utf8'
    );

    const result = await createBuild(blueprintFolder, 'Sample Build');

    expect(result.movieId).toMatch(/^movie-[a-z0-9]{6}$/);
    expect(result.inputsPath).toBe(
      path.join(blueprintFolder, 'builds', result.movieId, 'inputs.yaml')
    );

    const inputs = await readFile(result.inputsPath, 'utf8');
    expect(inputs).toBe('inputs:\n  Topic: test\nmodels: []\n');
  });

  it('fails fast when input-template.yaml is missing', async () => {
    const blueprintFolder = await createTempBlueprintFolder();

    await expect(createBuild(blueprintFolder)).rejects.toThrow(
      /Missing required template file/
    );
  });
});
