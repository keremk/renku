/* eslint-env node */
import process from 'node:process';
import './__testutils__/mock-providers.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runGenerate } from './generate.js';
import { runInspect } from './inspect.js';
import { createInputsFile } from './__testutils__/inputs.js';
import { getBundledBlueprintsRoot } from '../lib/config-assets.js';

const VIDEO_AUDIO_MUSIC_BLUEPRINT_PATH = resolve(
  getBundledBlueprintsRoot(),
  'video-audio-music.yaml',
);
const LOG_DEFAULTS = { mode: 'log' as const, logLevel: 'info' as const };

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
  const dir = await mkdtemp(join(tmpdir(), 'renku-inspect-'));
  tmpRoots.push(dir);
  return dir;
}

describe('runInspect', () => {
  beforeEach(() => {
    process.env.RENKU_CLI_CONFIG = undefined;
  });

  it('returns prompts in TOML format', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });
    const inputsPath = await createInputsFile({
      root,
      prompt: 'Describe the solar system',
      fileName: 'query-inputs.yaml',
    });
    const queryResult = await runGenerate({
      ...LOG_DEFAULTS,
      inputsPath,
      nonInteractive: true,
      blueprint: VIDEO_AUDIO_MUSIC_BLUEPRINT_PATH,
    });

    const inspectResult = await runInspect({ movieId: queryResult.movieId, prompts: true });
    expect(inspectResult.promptsToml).toBeDefined();
    expect(inspectResult.promptsToml).toContain('Describe the solar system');
  });
});
