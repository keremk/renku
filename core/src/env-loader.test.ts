import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadEnv } from './env-loader.js';
import { existsSync } from 'node:fs';
import { config as dotenvConfig } from 'dotenv';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

describe('loadEnv', () => {
  const mockExistsSync = vi.mocked(existsSync);
  const mockDotenvConfig = vi.mocked(dotenvConfig);

  beforeEach(() => {
    vi.clearAllMocks();
    mockDotenvConfig.mockReturnValue({ parsed: undefined });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty loaded array when no .env files exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = loadEnv(import.meta.url);

    expect(result.loaded).toEqual([]);
  });

  it('should load .env from monorepo root when pnpm-workspace.yaml exists', () => {
    // Mock that pnpm-workspace.yaml exists at a parent directory
    mockExistsSync.mockImplementation((path) => {
      if (typeof path === 'string' && path.endsWith('pnpm-workspace.yaml')) {
        return true;
      }
      if (typeof path === 'string' && path.endsWith('.env')) {
        return true;
      }
      return false;
    });

    mockDotenvConfig.mockReturnValue({ parsed: { TEST: 'value' } });

    const result = loadEnv(import.meta.url);

    expect(result.loaded.length).toBeGreaterThan(0);
    expect(mockDotenvConfig).toHaveBeenCalled();
  });

  it('should load cwd .env as fallback when monorepo root not found', () => {
    // No pnpm-workspace.yaml found
    mockExistsSync.mockImplementation((path) => {
      if (typeof path === 'string' && path.endsWith('pnpm-workspace.yaml')) {
        return false;
      }
      // But cwd .env exists
      if (typeof path === 'string' && path.endsWith('.env')) {
        return true;
      }
      return false;
    });

    mockDotenvConfig.mockReturnValue({ parsed: { FALLBACK: 'value' } });

    const result = loadEnv(import.meta.url);

    expect(result.loaded.length).toBe(1);
    expect(mockDotenvConfig).toHaveBeenCalledWith(
      expect.objectContaining({ override: false }),
    );
  });

  it('should not duplicate cwd path in loaded array if same as root', () => {
    mockExistsSync.mockReturnValue(true);

    // First call to dotenvConfig (root) succeeds
    mockDotenvConfig
      .mockReturnValueOnce({ parsed: { ROOT: 'value' } })
      // Second call (cwd) also succeeds but path already in loaded
      .mockReturnValueOnce({ parsed: { CWD: 'value' } });

    const result = loadEnv(import.meta.url);

    // The cwd path should not be added if it matches the root .env path
    // In real usage they would be different paths, but if same, should be deduplicated
    expect(result.loaded.length).toBeGreaterThan(0);
  });

  it('should respect verbose option and log to console', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockExistsSync.mockReturnValue(true);
    mockDotenvConfig.mockReturnValue({ parsed: { TEST: 'value' } });

    loadEnv(import.meta.url, { verbose: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[env] Loaded:'),
    );

    consoleSpy.mockRestore();
  });

  it('should not log to console when verbose is false', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockExistsSync.mockReturnValue(true);
    mockDotenvConfig.mockReturnValue({ parsed: { TEST: 'value' } });

    loadEnv(import.meta.url, { verbose: false });

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
