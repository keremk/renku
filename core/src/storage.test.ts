import { describe, expect, it } from 'vitest';
import {
  createStorageContext,
  initializeMovieStorage,
  deleteMovieStorage,
  planStore,
} from './storage.js';
import { isRenkuError, RuntimeErrorCode } from './errors/index.js';
import type { ExecutionPlan } from './types.js';

function memoryContext(basePath?: string) {
  return createStorageContext({ kind: 'memory', basePath });
}

describe('createStorageContext', () => {
  it('resolves paths relative to base and movie id', () => {
    const ctx = memoryContext('videos');
    expect(ctx.resolve('movie-alpha')).toBe('videos/movie-alpha');
    expect(ctx.resolve('movie-alpha', 'runs', 'rev-0001-plan.json')).toBe(
      'videos/movie-alpha/runs/rev-0001-plan.json'
    );
  });
});

describe('initializeMovieStorage', () => {
  it('creates directories and seed files', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'demo');

    const storage = ctx.storage;
    const expectedDirs = [
      'builds',
      'builds/demo',
      'builds/demo/manifests',
      'builds/demo/events',
      'builds/demo/runs',
      'builds/demo/blobs',
    ];
    for (const dir of expectedDirs) {
      expect(await storage.directoryExists(dir)).toBe(true);
    }

    expect(await storage.fileExists('builds/demo/events/inputs.log')).toBe(
      true
    );
    expect(await storage.fileExists('builds/demo/events/artefacts.log')).toBe(
      true
    );
    expect(await storage.fileExists('builds/demo/current.json')).toBe(true);

    const pointer = JSON.parse(
      await storage.readToString('builds/demo/current.json')
    );
    expect(pointer).toEqual({
      revision: null,
      manifestPath: null,
      hash: null,
      updatedAt: null,
    });
  });
});

describe('deleteMovieStorage', () => {
  it('deletes an initialized movie directory', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-to-delete');

    // Verify the movie directory exists
    expect(await ctx.storage.directoryExists('builds/movie-to-delete')).toBe(
      true
    );

    await deleteMovieStorage(ctx, 'movie-to-delete');

    // Verify the movie directory is gone
    expect(await ctx.storage.directoryExists('builds/movie-to-delete')).toBe(
      false
    );
  });

  it('throws MOVIE_NOT_FOUND for non-existent movie', async () => {
    const ctx = memoryContext('builds');

    try {
      await deleteMovieStorage(ctx, 'movie-ghost');
      expect.fail('Expected an error to be thrown');
    } catch (error) {
      expect(isRenkuError(error)).toBe(true);
      if (isRenkuError(error)) {
        expect(error.code).toBe(RuntimeErrorCode.MOVIE_NOT_FOUND);
      }
    }
  });

  it('throws INVALID_MOVIE_ID for invalid movie IDs', async () => {
    const ctx = memoryContext('builds');

    try {
      await deleteMovieStorage(ctx, '..');
      expect.fail('Expected an error to be thrown');
    } catch (error) {
      expect(isRenkuError(error)).toBe(true);
      if (isRenkuError(error)) {
        expect(error.code).toBe(RuntimeErrorCode.INVALID_MOVIE_ID);
      }
    }
  });
});

describe('planStore', () => {
  it('persists and loads execution plans', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo', { seedCurrentJson: false });

    const plan: ExecutionPlan = {
      revision: 'rev-0001',
      manifestBaseHash: 'sha:123',
      layers: [],
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 0,
    };

    await planStore.save(plan, { movieId: 'demo', storage: ctx });
    const stored = await planStore.load('demo', 'rev-0001', ctx);

    expect(stored).toEqual(plan);
  });
});
