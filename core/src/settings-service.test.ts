import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initWorkspace,
  readCliConfig,
  writeCliConfig,
  type CliConfig,
} from './workspace.js';
import {
  mapProviderTokenPayloadToApiKeyValues,
  persistProviderTokenPayload,
  readSettingsApiTokens,
  readSettingsSnapshot,
  updateWorkspaceConcurrency,
  updateWorkspaceStorageRoot,
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

  it('resolves catalog source from current config when catalogPath is omitted', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    const currentRoot = join(tempDir, 'workspace-a');
    const nextRoot = join(tempDir, 'workspace-b');
    const catalogSource = join(tempDir, 'catalog-source');

    await mkdir(join(catalogSource, 'blueprints'), { recursive: true });
    await mkdir(join(catalogSource, 'models'), { recursive: true });
    await mkdir(join(catalogSource, 'producers'), { recursive: true });
    await writeFile(
      join(catalogSource, 'blueprints', 'sample.yaml'),
      'name: sample',
      'utf8'
    );

    await initWorkspace({
      rootFolder: currentRoot,
      catalogSourceRoot: catalogSource,
      configPath,
    });

    const result = await updateWorkspaceStorageRoot({
      storageRoot: nextRoot,
      migrateContent: false,
      configPath,
    });

    expect(result.storageRoot).toBe(nextRoot);

    const updated = await readCliConfig(configPath);
    expect(updated?.storage.root).toBe(nextRoot);
  });

  it('falls back to storageRoot/catalog when config catalog root is absent', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    const currentRoot = join(tempDir, 'workspace-a');
    const nextRoot = join(tempDir, 'workspace-b');
    const catalogSource = join(tempDir, 'catalog-source');

    await mkdir(join(catalogSource, 'blueprints'), { recursive: true });
    await mkdir(join(catalogSource, 'models'), { recursive: true });
    await mkdir(join(catalogSource, 'producers'), { recursive: true });
    await writeFile(
      join(catalogSource, 'blueprints', 'sample.yaml'),
      'name: sample',
      'utf8'
    );

    await initWorkspace({
      rootFolder: currentRoot,
      catalogSourceRoot: catalogSource,
      configPath,
    });

    await writeCliConfig(
      {
        storage: { root: currentRoot, basePath: 'builds' },
      },
      configPath
    );

    const result = await updateWorkspaceStorageRoot({
      storageRoot: nextRoot,
      migrateContent: false,
      configPath,
    });

    expect(result.storageRoot).toBe(nextRoot);
  });

  it('switches between initialized workspaces after adopting a non-empty folder', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    const workspaceA = join(tempDir, 'workspace-a');
    const workspaceB = join(tempDir, 'workspace-b');
    const catalogSource = join(tempDir, 'catalog-source');

    await mkdir(join(catalogSource, 'blueprints'), { recursive: true });
    await mkdir(join(catalogSource, 'models'), { recursive: true });
    await mkdir(join(catalogSource, 'producers'), { recursive: true });
    await writeFile(
      join(catalogSource, 'blueprints', 'sample.yaml'),
      'name: sample',
      'utf8'
    );

    await initWorkspace({
      rootFolder: workspaceA,
      catalogSourceRoot: catalogSource,
      configPath,
    });

    await mkdir(workspaceB, { recursive: true });
    await writeFile(join(workspaceB, 'README.md'), 'keep-me', 'utf8');

    const firstSwitch = await updateWorkspaceStorageRoot({
      storageRoot: workspaceB,
      migrateContent: false,
      allowNonEmptyTarget: true,
      configPath,
    });

    expect(firstSwitch.mode).toBe('initialized');

    const adoptedCatalog = await readFile(
      join(workspaceB, 'catalog', 'blueprints', 'sample.yaml'),
      'utf8'
    );
    expect(adoptedCatalog).toBe('name: sample');

    const preservedFile = await readFile(join(workspaceB, 'README.md'), 'utf8');
    expect(preservedFile).toBe('keep-me');

    const secondSwitch = await updateWorkspaceStorageRoot({
      storageRoot: workspaceA,
      migrateContent: false,
      configPath,
    });

    expect(secondSwitch.mode).toBe('switched-existing');

    const updated = await readCliConfig(configPath);
    expect(updated?.storage.root).toBe(workspaceA);
  });
});
