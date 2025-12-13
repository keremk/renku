/* eslint-env node */
import process from 'node:process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runProducersList } from './producers-list.js';
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
  const dir = await mkdtemp(join(tmpdir(), 'renku-producers-list-'));
  tmpRoots.push(dir);
  return dir;
}

describe('runProducersList', () => {
  it('lists all available models for producers in a blueprint', async () => {
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
    const result = await runProducersList({ blueprintPath });
    expect(result.entries.length).toBeGreaterThan(0);

    // Should find OpenAI model(s) for script-related producers
    const openAiEntry = result.entries.find((entry) => entry.provider === 'openai');
    expect(openAiEntry).toBeDefined();

    // All entries should have producer and model info
    for (const entry of result.entries) {
      expect(entry.producer).toBeTruthy();
      expect(entry.provider).toBeTruthy();
      expect(entry.model).toBeTruthy();
    }

    // missingTokens should be a Map (may or may not have entries depending on env)
    expect(result.missingTokens).toBeInstanceOf(Map);
  });
});
