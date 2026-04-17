import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMovieMetadataService } from './movie-metadata.js';
import { createStorageContext } from './storage.js';
import {
  createBlueprintBuild,
  generateBlueprintBuildMovieId,
} from './blueprint-build.js';
import { RuntimeErrorCode, isRenkuError } from './errors/index.js';

const tempDirs: string[] = [];

async function createTempBlueprintDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'renku-blueprint-build-'));
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

describe('generateBlueprintBuildMovieId', () => {
  it('creates movie-prefixed ids with six lowercase alpha-numeric chars', () => {
    const id = generateBlueprintBuildMovieId();
    expect(id).toMatch(/^movie-[a-z0-9]{6}$/);
  });
});

describe('createBlueprintBuild', () => {
  it('creates build structure, inputs.yaml, and metadata', async () => {
    const blueprintFolder = await createTempBlueprintDir();
    const blueprintPath = join(blueprintFolder, 'demo-blueprint.yaml');
    await writeFile(
      join(blueprintFolder, 'input-template.yaml'),
      'inputs:\n  Theme: Test\nmodels: []\n',
      'utf8'
    );

    const result = await createBlueprintBuild({
      blueprintFolder,
      blueprintPath,
      displayName: '  Friendly Name  ',
    });

    expect(result.movieId).toMatch(/^movie-[a-z0-9]{6}$/);
    expect(result.buildDir).toBe(join(blueprintFolder, 'builds', result.movieId));
    expect(result.inputsPath).toBe(join(result.buildDir, 'inputs.yaml'));

    const inputsContents = await readFile(result.inputsPath, 'utf8');
    expect(inputsContents).toBe('inputs:\n  Theme: Test\nmodels: []\n');

    const storage = createStorageContext({
      kind: 'local',
      rootDir: blueprintFolder,
      basePath: 'builds',
    });

    expect(await storage.storage.fileExists(storage.resolve(result.movieId, 'current.json'))).toBe(false);
    expect(
      await storage.storage.fileExists(storage.resolve(result.movieId, 'events', 'inputs.log'))
    ).toBe(true);
    expect(
      await storage.storage.fileExists(storage.resolve(result.movieId, 'events', 'artifacts.log'))
    ).toBe(true);

    const metadataService = createMovieMetadataService(storage);
    const metadata = await metadataService.read(result.movieId);
    expect(metadata).not.toBeNull();
    expect(metadata?.displayName).toBe('Friendly Name');
    expect(metadata?.blueprintPath).toBe(blueprintPath);
    expect(metadata?.createdAt).toBeTypeOf('string');
  });

  it('throws when input-template.yaml is missing', async () => {
    const blueprintFolder = await createTempBlueprintDir();

    await expect(
      createBlueprintBuild({
        blueprintFolder,
      })
    ).rejects.toMatchObject({
      code: RuntimeErrorCode.MISSING_REQUIRED_INPUT,
    });
  });

  it('omits blank optional metadata fields', async () => {
    const blueprintFolder = await createTempBlueprintDir();
    await writeFile(
      join(blueprintFolder, 'input-template.yaml'),
      'inputs: {}\nmodels: []\n',
      'utf8'
    );

    const result = await createBlueprintBuild({
      blueprintFolder,
      displayName: '   ',
      blueprintPath: '   ',
    });

    const storage = createStorageContext({
      kind: 'local',
      rootDir: blueprintFolder,
      basePath: 'builds',
    });
    const metadataService = createMovieMetadataService(storage);
    const metadata = await metadataService.read(result.movieId);

    expect(metadata?.displayName).toBeUndefined();
    expect(metadata?.blueprintPath).toBeUndefined();
  });

  it('returns a structured renku error when blueprint folder is empty', async () => {
    try {
      await createBlueprintBuild({ blueprintFolder: '   ' });
      expect.fail('Expected createBlueprintBuild to throw');
    } catch (error) {
      expect(isRenkuError(error)).toBe(true);
      if (isRenkuError(error)) {
        expect(error.code).toBe(RuntimeErrorCode.MISSING_REQUIRED_INPUT);
      }
    }
  });
});
