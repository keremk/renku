/**
 * Unit tests for config.ts - CLI config loading.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  readCliConfig,
  requireCliConfig,
  normalizeConcurrency,
  getCatalogModelsDir,
  getDefaultCliConfigPath,
  DEFAULT_CONCURRENCY,
} from './config.js';
import type { CliConfig } from './config.js';

// Mock fs/promises
vi.mock('node:fs/promises');

describe('getDefaultCliConfigPath', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.RENKU_CLI_CONFIG;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns env path when RENKU_CLI_CONFIG is set', () => {
    process.env.RENKU_CLI_CONFIG = '/custom/path/config.json';
    const path = getDefaultCliConfigPath();
    expect(path).toContain('custom/path/config.json');
  });

  it('returns default path when RENKU_CLI_CONFIG is not set', () => {
    const path = getDefaultCliConfigPath();
    expect(path).toContain('.config/renku/cli-config.json');
  });
});

describe('readCliConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null when config file does not exist', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

    const result = await readCliConfig('/nonexistent/config.json');
    expect(result).toBeNull();
  });

  it('loads and parses valid config', async () => {
    const validConfig = {
      storage: {
        root: '/test/storage',
        basePath: 'movies',
      },
      catalog: {
        root: '/test/catalog',
      },
      concurrency: 3,
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(validConfig));

    const result = await readCliConfig('/test/config.json');

    expect(result).not.toBeNull();
    expect(result?.storage.root).toBe('/test/storage');
    expect(result?.storage.basePath).toBe('movies');
    expect(result?.catalog?.root).toBe('/test/catalog');
    expect(result?.concurrency).toBe(3);
  });

  it('returns null when storage property is missing', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ foo: 'bar' }));

    const result = await readCliConfig('/test/config.json');
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('not valid json {{{');

    const result = await readCliConfig('/test/config.json');
    expect(result).toBeNull();
  });

  it('normalizes concurrency value', async () => {
    const config = {
      storage: { root: '/test', basePath: 'movies' },
      concurrency: -5,
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config));

    const result = await readCliConfig('/test/config.json');
    expect(result?.concurrency).toBe(DEFAULT_CONCURRENCY);
  });
});

describe('requireCliConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns config when file exists', async () => {
    const validConfig = {
      storage: {
        root: '/test/storage',
        basePath: 'movies',
      },
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(validConfig));

    const result = await requireCliConfig('/test/config.json');
    expect(result.storage.root).toBe('/test/storage');
  });

  it('throws VIEWER_CONFIG_MISSING when config file does not exist', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

    await expect(requireCliConfig('/test/config.json')).rejects.toMatchObject({
      code: 'R114',
      message: 'Renku CLI is not initialized. Run "renku init" first.',
    });
  });

  it('throws VIEWER_CONFIG_MISSING when config is invalid', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('invalid json');

    await expect(requireCliConfig('/test/config.json')).rejects.toMatchObject({
      code: 'R114',
    });
  });
});

describe('normalizeConcurrency', () => {
  it('returns DEFAULT_CONCURRENCY when undefined is passed', () => {
    const result = normalizeConcurrency(undefined);
    expect(result).toBe(DEFAULT_CONCURRENCY);
  });

  it('returns value when within valid range', () => {
    expect(normalizeConcurrency(1)).toBe(1);
    expect(normalizeConcurrency(5)).toBe(5);
    expect(normalizeConcurrency(10)).toBe(10);
  });

  it('returns DEFAULT_CONCURRENCY when value is 0', () => {
    expect(normalizeConcurrency(0)).toBe(DEFAULT_CONCURRENCY);
  });

  it('returns DEFAULT_CONCURRENCY when value is negative', () => {
    expect(normalizeConcurrency(-1)).toBe(DEFAULT_CONCURRENCY);
    expect(normalizeConcurrency(-100)).toBe(DEFAULT_CONCURRENCY);
  });

  it('returns DEFAULT_CONCURRENCY when value is not an integer', () => {
    expect(normalizeConcurrency(1.5)).toBe(DEFAULT_CONCURRENCY);
    expect(normalizeConcurrency(2.9)).toBe(DEFAULT_CONCURRENCY);
  });

  it('accepts large positive integers', () => {
    expect(normalizeConcurrency(100)).toBe(100);
  });
});

describe('getCatalogModelsDir', () => {
  it('returns models path when catalog.root is set', () => {
    const config: CliConfig = {
      storage: { root: '/storage', basePath: 'movies' },
      catalog: { root: '/catalog' },
    };

    const result = getCatalogModelsDir(config);
    expect(result).toContain('catalog');
    expect(result).toContain('models');
  });

  it('returns null when catalog is not configured', () => {
    const config: CliConfig = {
      storage: { root: '/storage', basePath: 'movies' },
    };

    const result = getCatalogModelsDir(config);
    expect(result).toBeNull();
  });

  it('returns null when catalog.root is not set', () => {
    const config: CliConfig = {
      storage: { root: '/storage', basePath: 'movies' },
      catalog: undefined,
    };

    const result = getCatalogModelsDir(config);
    expect(result).toBeNull();
  });
});
