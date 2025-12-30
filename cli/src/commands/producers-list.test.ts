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
  it('returns empty entries for interface-only producers', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });
    const cliConfig = await readCliConfig(cliConfigPath);
    expect(cliConfig).not.toBeNull();

    // Use audio-only which has simpler producers
    const blueprintPath = join(
      getCliBlueprintsRoot(root),
      'audio-only',
      'audio-only.yaml',
    );
    const result = await runProducersList({ blueprintPath });

    // Interface-only producers have no models defined, so entries are empty
    // Models are now specified in input templates, not in producer definitions
    expect(result.entries).toEqual([]);

    // missingTokens should still be a Map
    expect(result.missingTokens).toBeInstanceOf(Map);
  });
});
