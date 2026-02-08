import { describe, it, expect, beforeEach } from 'vitest';
import {
  createStorageContext,
  initializeMovieStorage,
  createMovieMetadataService,
  type MovieMetadata,
} from './index.js';

describe('MovieMetadataService', () => {
  let storage: ReturnType<typeof createStorageContext>;
  let metadataService: ReturnType<typeof createMovieMetadataService>;
  const testMovieId = 'movie-test123';

  beforeEach(async () => {
    // Use in-memory storage for tests
    storage = createStorageContext({ kind: 'memory', basePath: 'builds' });
    await initializeMovieStorage(storage, testMovieId);
    metadataService = createMovieMetadataService(storage);
  });

  describe('read()', () => {
    it('should return null when no metadata exists', async () => {
      const result = await metadataService.read(testMovieId);
      expect(result).toBeNull();
    });

    it('should read metadata from new filename', async () => {
      const metadata: MovieMetadata = {
        blueprintPath: '/path/to/blueprint.yaml',
        displayName: 'Test Movie',
        createdAt: '2024-01-01T00:00:00Z',
      };

      // Write using the new filename
      const path = storage.resolve(testMovieId, 'metadata.json');
      await storage.storage.write(path, JSON.stringify(metadata), { mimeType: 'application/json' });

      const result = await metadataService.read(testMovieId);
      expect(result).toEqual(metadata);
    });

    it('should read metadata from legacy filename for backwards compatibility', async () => {
      const metadata: MovieMetadata = {
        blueprintPath: '/old/blueprint.yaml',
        displayName: 'Legacy Movie',
      };

      // Write using the legacy filename
      const legacyPath = storage.resolve(testMovieId, 'movie-metadata.json');
      await storage.storage.write(legacyPath, JSON.stringify(metadata), { mimeType: 'application/json' });

      const result = await metadataService.read(testMovieId);
      expect(result).toEqual(metadata);
    });

    it('should prefer new filename over legacy filename', async () => {
      const newMetadata: MovieMetadata = { displayName: 'New' };
      const legacyMetadata: MovieMetadata = { displayName: 'Legacy' };

      // Write both files
      const newPath = storage.resolve(testMovieId, 'metadata.json');
      const legacyPath = storage.resolve(testMovieId, 'movie-metadata.json');
      await storage.storage.write(newPath, JSON.stringify(newMetadata), { mimeType: 'application/json' });
      await storage.storage.write(legacyPath, JSON.stringify(legacyMetadata), { mimeType: 'application/json' });

      const result = await metadataService.read(testMovieId);
      expect(result).toEqual(newMetadata);
    });
  });

  describe('write()', () => {
    it('should write metadata to storage', async () => {
      const metadata: MovieMetadata = {
        blueprintPath: '/path/to/blueprint.yaml',
        displayName: 'Test Movie',
        createdAt: '2024-01-01T00:00:00Z',
      };

      await metadataService.write(testMovieId, metadata);

      // Verify the file was written with new filename
      const path = storage.resolve(testMovieId, 'metadata.json');
      expect(await storage.storage.fileExists(path)).toBe(true);

      const contents = await storage.storage.readToString(path);
      expect(JSON.parse(contents)).toEqual(metadata);
    });

    it('should overwrite existing metadata', async () => {
      const initial: MovieMetadata = { displayName: 'Initial' };
      const updated: MovieMetadata = { displayName: 'Updated' };

      await metadataService.write(testMovieId, initial);
      await metadataService.write(testMovieId, updated);

      const result = await metadataService.read(testMovieId);
      expect(result).toEqual(updated);
    });
  });

  describe('merge()', () => {
    it('should create new metadata when none exists', async () => {
      const updates: Partial<MovieMetadata> = {
        blueprintPath: '/path/to/blueprint.yaml',
      };

      const result = await metadataService.merge(testMovieId, updates);

      expect(result).toEqual(updates);
      expect(await metadataService.read(testMovieId)).toEqual(updates);
    });

    it('should merge updates with existing metadata', async () => {
      const initial: MovieMetadata = {
        blueprintPath: '/path/to/blueprint.yaml',
        displayName: 'Original Name',
        createdAt: '2024-01-01T00:00:00Z',
      };

      await metadataService.write(testMovieId, initial);

      const updates: Partial<MovieMetadata> = {
        displayName: 'Updated Name',
        lastInputsPath: '/path/to/inputs.yaml',
      };

      const result = await metadataService.merge(testMovieId, updates);

      expect(result).toEqual({
        blueprintPath: '/path/to/blueprint.yaml',
        displayName: 'Updated Name',
        createdAt: '2024-01-01T00:00:00Z',
        lastInputsPath: '/path/to/inputs.yaml',
      });
    });

    it('should override fields with new values', async () => {
      await metadataService.write(testMovieId, { displayName: 'Old' });

      const result = await metadataService.merge(testMovieId, { displayName: 'New' });

      expect(result.displayName).toBe('New');
    });

    it('should merge from legacy file and write to new file', async () => {
      const legacyMetadata: MovieMetadata = {
        blueprintPath: '/legacy/path.yaml',
        displayName: 'Legacy',
      };

      // Write to legacy filename
      const legacyPath = storage.resolve(testMovieId, 'movie-metadata.json');
      await storage.storage.write(legacyPath, JSON.stringify(legacyMetadata), { mimeType: 'application/json' });

      // Merge updates
      const result = await metadataService.merge(testMovieId, { displayName: 'Updated' });

      // Should have merged with legacy data
      expect(result).toEqual({
        blueprintPath: '/legacy/path.yaml',
        displayName: 'Updated',
      });

      // Should now have new filename
      const newPath = storage.resolve(testMovieId, 'metadata.json');
      expect(await storage.storage.fileExists(newPath)).toBe(true);
    });
  });

  describe('with different movie IDs', () => {
    it('should isolate metadata by movie ID', async () => {
      const movieA = 'movie-aaa';
      const movieB = 'movie-bbb';

      await initializeMovieStorage(storage, movieA);
      await initializeMovieStorage(storage, movieB);

      await metadataService.write(movieA, { displayName: 'Movie A' });
      await metadataService.write(movieB, { displayName: 'Movie B' });

      expect((await metadataService.read(movieA))?.displayName).toBe('Movie A');
      expect((await metadataService.read(movieB))?.displayName).toBe('Movie B');
    });
  });
});
