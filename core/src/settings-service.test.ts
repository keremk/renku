import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCliConfig, writeCliConfig, type CliConfig } from './workspace.js';
import {
  mapProviderTokenPayloadToApiKeyValues,
  persistProviderTokenPayload,
  readSettingsApiTokens,
  readSettingsSnapshot,
  updateWorkspaceConcurrency,
} from './settings-service.js';

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'renku-settings-service-test-'));
}

describe('settings-service', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('maps provider token payload to api key values', () => {
    const mapped = mapProviderTokenPayloadToApiKeyValues({
      providers: {
        fal: { apiKey: 'fal-key' },
        replicate: { apiKey: 'replicate-key' },
      },
      promptProviders: {
        openai: { apiKey: 'openai-key' },
      },
    });

    expect(mapped).toEqual({
      FAL_KEY: 'fal-key',
      REPLICATE_API_TOKEN: 'replicate-key',
      ELEVENLABS_API_KEY: undefined,
      OPENAI_API_KEY: 'openai-key',
      AI_GATEWAY_API_KEY: undefined,
    });
  });

  it('persists and reads settings api tokens', async () => {
    const envFilePath = join(tempDir, '.env');

    await persistProviderTokenPayload(
      {
        providers: {
          fal: { apiKey: 'fal-token' },
          elevenlabs: { apiKey: 'elevenlabs-token' },
        },
        promptProviders: {
          vercelGateway: { apiKey: 'gateway-token' },
        },
      },
      envFilePath
    );

    const tokens = await readSettingsApiTokens(envFilePath);
    expect(tokens).toEqual({
      fal: 'fal-token',
      replicate: '',
      elevenlabs: 'elevenlabs-token',
      openai: '',
      vercelGateway: 'gateway-token',
    });
  });

  it('reads settings snapshot and clips hand-edited concurrency to max', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    const envFilePath = join(tempDir, '.env');
    const storageRoot = join(tempDir, 'workspace');
    await mkdir(storageRoot, { recursive: true });

    await writeFile(
      configPath,
      JSON.stringify(
        {
          storage: { root: storageRoot, basePath: 'builds' },
          artifacts: { enabled: false, mode: 'symlink' },
          concurrency: 13,
        },
        null,
        2
      ),
      'utf8'
    );

    await persistProviderTokenPayload(
      {
        promptProviders: {
          openai: { apiKey: 'openai-token' },
        },
      },
      envFilePath
    );

    const snapshot = await readSettingsSnapshot({ configPath, envFilePath });
    expect(snapshot.storageRoot).toBe(storageRoot);
    expect(snapshot.artifacts).toEqual({ enabled: false, mode: 'symlink' });
    expect(snapshot.concurrency).toBe(10);
    expect(snapshot.apiTokens.openai).toBe('openai-token');
  });

  it('updates workspace concurrency and persists clipped value', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    const cliConfig: CliConfig = {
      storage: { root: join(tempDir, 'workspace'), basePath: 'builds' },
      concurrency: 1,
    };
    await writeCliConfig(cliConfig, configPath);

    const concurrency = await updateWorkspaceConcurrency({
      concurrency: 42,
      configPath,
    });

    expect(concurrency).toBe(10);
    const updated = await readCliConfig(configPath);
    expect(updated?.concurrency).toBe(10);
  });
});
