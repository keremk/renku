import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import {
  readCliConfig,
  writeCliConfig,
  isWorkspaceInitialized,
  initWorkspace,
  updateWorkspaceCatalog,
  readApiKeysEnvFile,
  writeApiKeysEnvFile,
  getUserEnvFilePath,
  getDefaultCliConfigPath,
  type CliConfig,
} from './workspace.js';

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'renku-workspace-test-'));
}

describe('readCliConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns null when file does not exist', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    const result = await readCliConfig(configPath);
    expect(result).toBeNull();
  });

  it('returns null when file has no storage key', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    await writeFile(configPath, JSON.stringify({ foo: 'bar' }), 'utf8');
    const result = await readCliConfig(configPath);
    expect(result).toBeNull();
  });

  it('returns config when file is valid', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    const config: CliConfig = {
      storage: { root: '/some/root', basePath: 'builds' },
      catalog: { root: '/some/root/catalog' },
      concurrency: 2,
    };
    await writeFile(configPath, JSON.stringify(config), 'utf8');
    const result = await readCliConfig(configPath);
    expect(result).toMatchObject({
      storage: { root: '/some/root', basePath: 'builds' },
      catalog: { root: '/some/root/catalog' },
      concurrency: 2,
      artifacts: { enabled: true, mode: 'copy' },
    });
  });

  it('clips concurrency to max when config is hand-edited above range', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        storage: { root: '/some/root', basePath: 'builds' },
        concurrency: 13,
      }),
      'utf8'
    );

    const result = await readCliConfig(configPath);
    expect(result?.concurrency).toBe(10);
  });

  it('clips concurrency to min when config is hand-edited below range', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        storage: { root: '/some/root', basePath: 'builds' },
        concurrency: 0,
      }),
      'utf8'
    );

    const result = await readCliConfig(configPath);
    expect(result?.concurrency).toBe(1);
  });

  it('returns null when concurrency is not an integer', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        storage: { root: '/some/root', basePath: 'builds' },
        concurrency: 2.5,
      }),
      'utf8'
    );

    const result = await readCliConfig(configPath);
    expect(result).toBeNull();
  });

  it('returns null when artifacts mode is invalid', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        storage: { root: '/some/root', basePath: 'builds' },
        artifacts: { enabled: true, mode: 'hardlink' },
      }),
      'utf8'
    );

    const result = await readCliConfig(configPath);
    expect(result).toBeNull();
  });
});

describe('writeCliConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes config to file and returns path', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    const config: CliConfig = {
      storage: { root: '/some/root', basePath: 'builds' },
    };
    const returnedPath = await writeCliConfig(config, configPath);
    expect(returnedPath).toBe(resolve(configPath));
    const contents = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(contents);
    expect(parsed.storage.root).toBe('/some/root');
  });

  it('creates parent directories as needed', async () => {
    const configPath = join(tempDir, 'nested', 'deep', 'cli-config.json');
    const config: CliConfig = {
      storage: { root: '/root', basePath: 'builds' },
    };
    await writeCliConfig(config, configPath);
    const contents = await readFile(configPath, 'utf8');
    expect(JSON.parse(contents).storage.root).toBe('/root');
  });

  it('clips concurrency to max when writing config', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    const config: CliConfig = {
      storage: { root: '/root', basePath: 'builds' },
      concurrency: 99,
    };

    await writeCliConfig(config, configPath);

    const contents = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(contents);
    expect(parsed.concurrency).toBe(10);
  });
});

describe('isWorkspaceInitialized', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns false when config does not exist', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    const result = await isWorkspaceInitialized(configPath);
    expect(result).toBe(false);
  });

  it('returns false when catalog root does not exist on disk', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    const config: CliConfig = {
      storage: { root: tempDir, basePath: 'builds' },
      catalog: { root: join(tempDir, 'catalog') },
    };
    await writeFile(configPath, JSON.stringify(config), 'utf8');
    const result = await isWorkspaceInitialized(configPath);
    expect(result).toBe(false);
  });

  it('returns true when config and catalog root both exist', async () => {
    const configPath = join(tempDir, 'cli-config.json');
    const catalogRoot = join(tempDir, 'catalog');
    await mkdir(catalogRoot, { recursive: true });
    const config: CliConfig = {
      storage: { root: tempDir, basePath: 'builds' },
      catalog: { root: catalogRoot },
    };
    await writeFile(configPath, JSON.stringify(config), 'utf8');
    const result = await isWorkspaceInitialized(configPath);
    expect(result).toBe(true);
  });
});

describe('initWorkspace', () => {
  let tempDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    sourceDir = await makeTempDir();
    // Create a minimal catalog source
    await mkdir(join(sourceDir, 'blueprints'), { recursive: true });
    await mkdir(join(sourceDir, 'models'), { recursive: true });
    await mkdir(join(sourceDir, 'producers'), { recursive: true });
    await writeFile(
      join(sourceDir, 'blueprints', 'sample.yaml'),
      'name: sample',
      'utf8'
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  });

  it('creates workspace structure and writes config', async () => {
    const rootFolder = join(tempDir, 'workspace');
    const configPath = join(tempDir, 'cli-config.json');

    const result = await initWorkspace({
      rootFolder,
      catalogSourceRoot: sourceDir,
      configPath,
    });

    expect(result.rootFolder).toBe(rootFolder);
    expect(result.cliConfigPath).toBe(resolve(configPath));
    expect(result.gitignoreCreated).toBe(true);

    const config = await readCliConfig(configPath);
    expect(config).not.toBeNull();
    expect(config?.storage.root).toBe(rootFolder);
    expect(config?.catalog?.root).toBe(join(rootFolder, 'catalog'));

    // Catalog files should be copied
    const blueprintContent = await readFile(
      join(rootFolder, 'catalog', 'blueprints', 'sample.yaml'),
      'utf8'
    );
    expect(blueprintContent).toBe('name: sample');

    // .gitignore should exist
    const gitignore = await readFile(join(rootFolder, '.gitignore'), 'utf8');
    expect(gitignore).toContain('builds/');
  });

  it('does not overwrite existing .gitignore', async () => {
    const rootFolder = join(tempDir, 'workspace2');
    const configPath = join(tempDir, 'cli-config2.json');
    await mkdir(rootFolder, { recursive: true });
    await writeFile(join(rootFolder, '.gitignore'), '# custom', 'utf8');

    const result = await initWorkspace({
      rootFolder,
      catalogSourceRoot: sourceDir,
      configPath,
    });

    expect(result.gitignoreCreated).toBe(false);
    const gitignore = await readFile(join(rootFolder, '.gitignore'), 'utf8');
    expect(gitignore).toBe('# custom');
  });

  it('replaces existing catalog files using catalog update flow', async () => {
    const rootFolder = join(tempDir, 'workspace3');
    const configPath = join(tempDir, 'cli-config3.json');
    const catalogBlueprints = join(rootFolder, 'catalog', 'blueprints');
    await mkdir(catalogBlueprints, { recursive: true });
    await writeFile(
      join(catalogBlueprints, 'sample.yaml'),
      '# existing',
      'utf8'
    );

    await initWorkspace({
      rootFolder,
      catalogSourceRoot: sourceDir,
      configPath,
    });

    const content = await readFile(
      join(catalogBlueprints, 'sample.yaml'),
      'utf8'
    );
    expect(content).toBe('name: sample');
  });
});

describe('updateWorkspaceCatalog', () => {
  let tempDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    sourceDir = await makeTempDir();
    await mkdir(join(sourceDir, 'blueprints'), { recursive: true });
    await mkdir(join(sourceDir, 'models'), { recursive: true });
    await mkdir(join(sourceDir, 'producers'), { recursive: true });
    await writeFile(
      join(sourceDir, 'blueprints', 'sample.yaml'),
      'name: sample-v2',
      'utf8'
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  });

  it('replaces existing catalog and removes stale files', async () => {
    const rootFolder = join(tempDir, 'workspace-update');
    const catalogRoot = join(rootFolder, 'catalog');
    const staleDir = join(catalogRoot, 'obsolete');
    const staleFile = join(staleDir, 'old.txt');

    await mkdir(staleDir, { recursive: true });
    await writeFile(staleFile, 'stale', 'utf8');
    await mkdir(join(catalogRoot, 'blueprints'), { recursive: true });
    await writeFile(
      join(catalogRoot, 'blueprints', 'sample.yaml'),
      'name: stale-v1',
      'utf8'
    );

    const result = await updateWorkspaceCatalog({
      rootFolder,
      catalogSourceRoot: sourceDir,
      configuredCatalogRoot: catalogRoot,
    });

    expect(result.catalogRoot).toBe(catalogRoot);
    await expect(readFile(staleFile, 'utf8')).rejects.toThrow();
    const blueprint = await readFile(
      join(catalogRoot, 'blueprints', 'sample.yaml'),
      'utf8'
    );
    expect(blueprint).toBe('name: sample-v2');
  });

  it('throws when configured catalog root is not canonical', async () => {
    const rootFolder = join(tempDir, 'workspace-invalid-catalog-root');
    const nonCanonicalCatalogRoot = join(rootFolder, 'custom-catalog');

    await expect(
      updateWorkspaceCatalog({
        rootFolder,
        catalogSourceRoot: sourceDir,
        configuredCatalogRoot: nonCanonicalCatalogRoot,
      })
    ).rejects.toThrow(/does not match canonical workspace catalog root/);
  });

  it('throws when catalog source root is missing required directories', async () => {
    const rootFolder = join(tempDir, 'workspace-invalid-source');
    const invalidSourceRoot = join(tempDir, 'invalid-source');

    await mkdir(join(invalidSourceRoot, 'blueprints'), { recursive: true });
    await mkdir(join(invalidSourceRoot, 'models'), { recursive: true });

    await expect(
      updateWorkspaceCatalog({
        rootFolder,
        catalogSourceRoot: invalidSourceRoot,
      })
    ).rejects.toThrow(/Missing required directories: producers/);
  });

  it('throws when workspace root is a filesystem root', async () => {
    const filesystemRoot = parse(tempDir).root;

    await expect(
      updateWorkspaceCatalog({
        rootFolder: filesystemRoot,
        catalogSourceRoot: sourceDir,
      })
    ).rejects.toThrow(/because it is a filesystem root/);
  });
});

describe('writeApiKeysEnvFile', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes new env file with provided keys', async () => {
    const envPath = join(tempDir, '.env');
    await writeApiKeysEnvFile(
      { FAL_KEY: 'fal-test', OPENAI_API_KEY: 'sk-test' },
      envPath
    );
    const content = await readFile(envPath, 'utf8');
    expect(content).toContain('FAL_KEY=fal-test');
    expect(content).toContain('OPENAI_API_KEY=sk-test');
  });

  it('merges into existing env file without duplicating', async () => {
    const envPath = join(tempDir, '.env');
    await writeFile(envPath, 'REPLICATE_API_TOKEN=rep-existing\n', 'utf8');
    await writeApiKeysEnvFile({ FAL_KEY: 'fal-new' }, envPath);
    const content = await readFile(envPath, 'utf8');
    expect(content).toContain('REPLICATE_API_TOKEN=rep-existing');
    expect(content).toContain('FAL_KEY=fal-new');
  });

  it('overwrites existing key with new value', async () => {
    const envPath = join(tempDir, '.env');
    await writeFile(envPath, 'FAL_KEY=old-value\n', 'utf8');
    await writeApiKeysEnvFile({ FAL_KEY: 'new-value' }, envPath);
    const content = await readFile(envPath, 'utf8');
    expect(content).not.toContain('FAL_KEY=old-value');
    expect(content).toContain('FAL_KEY=new-value');
  });

  it('preserves comments and unknown lines when updating keys', async () => {
    const envPath = join(tempDir, '.env');
    await writeFile(
      envPath,
      [
        '# Existing config',
        'CUSTOM_NOTE=keep-me',
        '',
        'FAL_KEY=old-value',
      ].join('\n') + '\n',
      'utf8'
    );

    await writeApiKeysEnvFile({ FAL_KEY: 'new-value' }, envPath);

    const content = await readFile(envPath, 'utf8');
    expect(content).toContain('# Existing config');
    expect(content).toContain('CUSTOM_NOTE=keep-me');
    expect(content).toContain('FAL_KEY=new-value');
  });

  it('keeps export prefix for existing exported keys', async () => {
    const envPath = join(tempDir, '.env');
    await writeFile(envPath, 'export OPENAI_API_KEY=old\n', 'utf8');

    await writeApiKeysEnvFile({ OPENAI_API_KEY: 'new' }, envPath);

    const content = await readFile(envPath, 'utf8');
    expect(content).toContain('export OPENAI_API_KEY=new');
  });

  it('removes existing key when empty value is provided', async () => {
    const envPath = join(tempDir, '.env');
    await writeFile(
      envPath,
      ['FAL_KEY=existing-fal', 'OPENAI_API_KEY=sk-test'].join('\n') + '\n',
      'utf8'
    );

    await writeApiKeysEnvFile(
      { FAL_KEY: '', OPENAI_API_KEY: 'sk-test' },
      envPath
    );

    const content = await readFile(envPath, 'utf8');
    expect(content).not.toContain('FAL_KEY=existing-fal');
    expect(content).not.toContain('FAL_KEY=');
    expect(content).toContain('OPENAI_API_KEY=sk-test');
  });

  it('creates parent directories as needed', async () => {
    const envPath = join(tempDir, 'nested', 'dir', '.env');
    await writeApiKeysEnvFile({ FAL_KEY: 'test' }, envPath);
    const content = await readFile(envPath, 'utf8');
    expect(content).toContain('FAL_KEY=test');
  });

  it('returns path to written file', async () => {
    const envPath = join(tempDir, '.env');
    const returnedPath = await writeApiKeysEnvFile(
      { FAL_KEY: 'test' },
      envPath
    );
    expect(returnedPath).toBe(resolve(envPath));
  });
});

describe('readApiKeysEnvFile', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty object when env file does not exist', async () => {
    const envPath = join(tempDir, '.env');
    const result = await readApiKeysEnvFile(envPath);
    expect(result).toEqual({});
  });

  it('throws for read errors other than missing file', async () => {
    const envPath = join(tempDir, 'not-a-file');
    await mkdir(envPath, { recursive: true });

    await expect(readApiKeysEnvFile(envPath)).rejects.toThrow();
  });

  it('returns only known API key fields', async () => {
    const envPath = join(tempDir, '.env');
    await writeFile(
      envPath,
      [
        'FAL_KEY=fal-token',
        'REPLICATE_API_TOKEN=rep-token',
        'CUSTOM_KEY=ignore-me',
      ].join('\n') + '\n',
      'utf8'
    );

    const result = await readApiKeysEnvFile(envPath);
    expect(result).toEqual({
      FAL_KEY: 'fal-token',
      REPLICATE_API_TOKEN: 'rep-token',
    });
  });

  it('parses export-prefixed and quoted values', async () => {
    const envPath = join(tempDir, '.env');
    await writeFile(
      envPath,
      [
        'export OPENAI_API_KEY="sk-123"',
        "AI_GATEWAY_API_KEY='gateway-456'",
      ].join('\n') + '\n',
      'utf8'
    );

    const result = await readApiKeysEnvFile(envPath);
    expect(result).toEqual({
      OPENAI_API_KEY: 'sk-123',
      AI_GATEWAY_API_KEY: 'gateway-456',
    });
  });
});

describe('getDefaultCliConfigPath', () => {
  it('returns a path containing cli-config.json', () => {
    const path = getDefaultCliConfigPath();
    expect(path).toContain('cli-config.json');
  });
});

describe('getUserEnvFilePath', () => {
  it('returns a path ending in .env inside renku config dir', () => {
    const path = getUserEnvFilePath();
    expect(path).toContain('renku');
    expect(path).toMatch(/\.env$/);
  });
});
