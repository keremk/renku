import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  readCliConfig,
  writeCliConfig,
  isWorkspaceInitialized,
  initWorkspace,
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
    });
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

  it('does not overwrite existing catalog files', async () => {
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
    expect(content).toBe('# existing');
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

  it('skips empty values', async () => {
    const envPath = join(tempDir, '.env');
    await writeApiKeysEnvFile(
      { FAL_KEY: '', OPENAI_API_KEY: 'sk-test' },
      envPath
    );
    const content = await readFile(envPath, 'utf8');
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
