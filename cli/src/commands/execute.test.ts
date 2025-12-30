/* eslint-env node */
import process from 'node:process';
import './__testutils__/mock-providers.js';
import { mkdtemp, rm, stat, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runGenerate } from './generate.js';
import { formatMovieId, runExecute } from './execute.js';
import { createInputsFile } from './__testutils__/inputs.js';
import { createCliLogger } from '../lib/logger.js';
import { CATALOG_BLUEPRINTS_ROOT } from '../../tests/test-catalog-paths.js';

const AUDIO_ONLY_BLUEPRINT_PATH = resolve(
  CATALOG_BLUEPRINTS_ROOT,
  'audio-only',
  'audio-only.yaml',
);
const AUDIO_ONLY_MODELS = [
  { producerId: 'ScriptProducer', provider: 'openai', model: 'gpt-5-mini' },
  { producerId: 'AudioProducer', provider: 'replicate', model: 'minimax/speech-2.6-hd' },
];
const AUDIO_ONLY_OVERRIDES = {
  Duration: 60,
  NumOfSegments: 3,
  VoiceId: 'default-voice',
  Audience: 'Adult',
  Emotion: 'neutral',
  Language: 'en',
};

const tmpRoots: string[] = [];
const originalEnvConfig = process.env.RENKU_CLI_CONFIG;

afterEach(async () => {
  process.env.RENKU_CLI_CONFIG = originalEnvConfig;
  while (tmpRoots.length) {
    const dir = tmpRoots.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createTempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'renku-execute-'));
  tmpRoots.push(dir);
  return dir;
}

async function createInputsFixture(root: string, prompt: string, fileName: string, overrides?: Record<string, string | number>): Promise<string> {
  return createInputsFile({
    root,
    prompt,
    fileName,
    overrides: {
      ...AUDIO_ONLY_OVERRIDES,
      ...(overrides ?? {}),
    },
    includeDefaults: false,
    models: AUDIO_ONLY_MODELS,
  });
}

describe('runExecute (edit flow)', () => {
  beforeEach(() => {
    process.env.RENKU_CLI_CONFIG = undefined;
  });

  it('updates prompts and generates a new plan revision', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });
    const queryInputsPath = await createInputsFixture(root, 'Describe the planets', 'query-inputs.yaml');
    const queryResult = await runGenerate({
      inputsPath: queryInputsPath,
      nonInteractive: true,
      blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
      logLevel: 'info',
    });

    const movieInputsPath = resolve(queryResult.storagePath, 'inputs.yaml');
    const editInputsPath = await createInputsFixture(root, 'Tell me about stars', 'edit-inputs.yaml');
    await copyFile(editInputsPath, movieInputsPath);

    const editResult = await runExecute({
      storageMovieId: formatMovieId(queryResult.movieId),
      isNew: false,
      inputsPath: movieInputsPath,
      nonInteractive: true,
      logger: createCliLogger({
          level: 'debug',
        })
    });

    expect(editResult.targetRevision).toBe('rev-0002');
    expect(editResult.isDryRun).toBeFalsy();
    expect(editResult.build?.status).toBe('succeeded');
    expect(editResult.manifestPath).toBeDefined();
    const manifestStats = await stat(editResult.manifestPath!);
    expect(manifestStats.isFile()).toBe(true);

  });

  it('supports dry run mode', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });
    const queryInputsPath = await createInputsFixture(root, 'Describe oceans', 'query-inputs.yaml');
    const queryResult = await runGenerate({
      inputsPath: queryInputsPath,
      nonInteractive: true,
      blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
      logLevel: 'info',
    });

    const movieInputsPath = resolve(queryResult.storagePath, 'inputs.yaml');
    const editInputsPath = await createInputsFixture(root, 'Describe oceans with drama', 'edit-inputs.yaml', {
      Emotion: 'dramatic',
    });
    await copyFile(editInputsPath, movieInputsPath);

    const editResult = await runExecute({
      storageMovieId: formatMovieId(queryResult.movieId),
      isNew: false,
      inputsPath: movieInputsPath,
      dryRun: true,
      logger: createCliLogger({
          level: 'debug',
        })
    });

    expect(editResult.isDryRun).toBe(true);
    expect(editResult.build?.jobCount).toBeGreaterThan(0);
    expect(editResult.build?.counts.succeeded).toBeGreaterThan(0);
  });
});
