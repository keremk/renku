/**
 * Unit tests for paths.ts - Blueprint/inputs path resolution helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import * as fs from 'node:fs/promises';
import {
  generateMovieId,
  normalizeMovieId,
  resolveBlueprintPaths,
  resolveMovieDir,
  resolveBlueprintMovieDir,
} from './paths.js';
import type { CliConfig } from './config.js';

// Mock fs/promises
vi.mock('node:fs/promises');

const mockConfig: CliConfig = {
  storage: {
    root: '/test/storage',
    basePath: 'movies',
  },
};

describe('generateMovieId', () => {
  it('generates ID with default "movie" prefix', () => {
    const id = generateMovieId();
    expect(id).toMatch(/^movie-[a-z0-9]{6}$/);
  });

  it('generates ID with custom prefix', () => {
    const id = generateMovieId('custom');
    expect(id).toMatch(/^custom-[a-z0-9]{6}$/);
  });

  it('generates unique IDs on successive calls', () => {
    const id1 = generateMovieId();
    const id2 = generateMovieId();
    const id3 = generateMovieId();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  it('generates IDs with valid characters only', () => {
    // Generate multiple IDs to test randomness
    for (let i = 0; i < 100; i++) {
      const id = generateMovieId();
      expect(id).toMatch(/^movie-[a-z0-9]{6}$/);
    }
  });
});

describe('normalizeMovieId', () => {
  it('returns ID unchanged if already has movie- prefix', () => {
    const result = normalizeMovieId('movie-abc123');
    expect(result).toBe('movie-abc123');
  });

  it('adds movie- prefix if not present', () => {
    const result = normalizeMovieId('abc123');
    expect(result).toBe('movie-abc123');
  });

  it('handles empty string', () => {
    const result = normalizeMovieId('');
    expect(result).toBe('movie-');
  });

  it('does not double-prefix', () => {
    const result = normalizeMovieId('movie-movie-abc');
    expect(result).toBe('movie-movie-abc');
  });
});

describe('resolveBlueprintPaths', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('resolves blueprint path from name with default inputs', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);

    const result = await resolveBlueprintPaths('my-blueprint', undefined, mockConfig);

    // Blueprint folder is directly under storage.root/<name>
    expect(result.blueprintFolder).toBe(
      resolve('/test/storage', 'my-blueprint')
    );
    // Blueprint file is <name>/<name>.yaml
    expect(result.blueprintPath).toBe(
      join(resolve('/test/storage', 'my-blueprint'), 'my-blueprint.yaml')
    );
    // First default inputs filename is inputs.yaml
    expect(result.inputsPath).toBe(
      join(resolve('/test/storage', 'my-blueprint'), 'inputs.yaml')
    );
    expect(result.buildsFolder).toBe(
      join(resolve('/test/storage', 'my-blueprint'), 'builds')
    );
  });

  it('uses custom inputs filename when provided', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);

    const result = await resolveBlueprintPaths('my-blueprint', 'custom-inputs.yaml', mockConfig);

    expect(result.inputsPath).toBe(
      join(resolve('/test/storage', 'my-blueprint'), 'custom-inputs.yaml')
    );
  });

  it('throws CATALOG_BLUEPRINT_NOT_FOUND when blueprint missing', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));

    await expect(
      resolveBlueprintPaths('missing-blueprint', undefined, mockConfig)
    ).rejects.toMatchObject({
      code: 'R100',
      message: 'Blueprint not found: missing-blueprint',
    });
  });

  it('throws MISSING_REQUIRED_INPUT when inputs missing', async () => {
    // First call succeeds (blueprint exists)
    // Then all default inputs filenames fail (inputs.yaml, input-template.yaml, input.yaml)
    vi.mocked(fs.access)
      .mockResolvedValueOnce(undefined) // blueprint exists
      .mockRejectedValueOnce(new Error('ENOENT')) // inputs.yaml missing
      .mockRejectedValueOnce(new Error('ENOENT')) // input-template.yaml missing
      .mockRejectedValueOnce(new Error('ENOENT')); // input.yaml missing

    await expect(
      resolveBlueprintPaths('my-blueprint', undefined, mockConfig)
    ).rejects.toMatchObject({
      code: 'R042',
      message: 'Inputs file not found. Tried: inputs.yaml, input-template.yaml, input.yaml',
    });
  });

  it('throws MISSING_REQUIRED_INPUT with custom filename when inputs missing', async () => {
    vi.mocked(fs.access)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('ENOENT'));

    await expect(
      resolveBlueprintPaths('my-blueprint', 'custom.yaml', mockConfig)
    ).rejects.toMatchObject({
      code: 'R042',
      message: 'Inputs file not found: custom.yaml',
    });
  });
});

describe('resolveMovieDir', () => {
  it('resolves movie directory from config', () => {
    const result = resolveMovieDir('movie-abc123', mockConfig);
    expect(result).toBe(resolve('/test/storage', 'movies', 'movie-abc123'));
  });

  it('works with different storage paths', () => {
    const customConfig: CliConfig = {
      storage: {
        root: '/custom/root',
        basePath: 'output',
      },
    };
    const result = resolveMovieDir('movie-xyz', customConfig);
    expect(result).toBe(resolve('/custom/root', 'output', 'movie-xyz'));
  });
});

describe('resolveBlueprintMovieDir', () => {
  it('resolves movie directory within blueprint builds folder', () => {
    const result = resolveBlueprintMovieDir('/test/storage/blueprints/my-bp', 'movie-abc');
    expect(result).toBe(join('/test/storage/blueprints/my-bp', 'builds', 'movie-abc'));
  });
});
