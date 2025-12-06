/* eslint-env node */
import process from 'node:process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runProvidersList } from './providers-list.js';
import { readCliConfig } from '../lib/cli-config.js';
import { getCliBlueprintsRoot } from '../lib/config-assets.js';

const tmpRoots: string[] = [];
const originalEnv = { ...process.env };
const originalConfigPath = process.env.RENKU_CLI_CONFIG;

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

afterEach(async () => {
  process.env.RENKU_CLI_CONFIG = originalConfigPath;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  while (tmpRoots.length) {
    const dir = tmpRoots.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createTempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'renku-providers-list-'));
  tmpRoots.push(dir);
  return dir;
}

describe('runProvidersList', () => {
  it('reports configured providers and readiness status', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });
    const cliConfig = await readCliConfig(cliConfigPath);
    expect(cliConfig).not.toBeNull();

    const blueprintPath = join(
      getCliBlueprintsRoot(root),
      'cut-scene-video',
      'video-audio-music.yaml',
    );
    const result = await runProvidersList({ blueprintPath });
    expect(result.entries.length).toBeGreaterThan(0);

    const openAiEntry = result.entries.find((entry) => entry.provider === 'openai');
    expect(openAiEntry).toBeDefined();
    expect(openAiEntry?.status).toBe('ready');
  });
});
