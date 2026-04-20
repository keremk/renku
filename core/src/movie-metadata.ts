/**
 * Movie metadata service for managing per-movie metadata.
 *
 * This service provides a storage-agnostic interface for reading and writing
 * movie metadata, supporting both local and cloud storage through StorageContext.
 */

import type { StorageContext } from './storage.js';

/**
 * Metadata associated with a movie build.
 */
export interface MovieMetadata {
  /** Path to the blueprint YAML file used for this movie. */
  blueprintPath?: string;
  /** Path to the last-used inputs YAML file. */
  lastInputsPath?: string;
  /** User-friendly display name for the build. */
  displayName?: string;
  /** Stable folder name used under blueprint/artifacts for this movie. */
  artifactFolderName?: string;
  /** ISO timestamp when the build was created. */
  createdAt?: string;
}

/**
 * Service interface for managing movie metadata.
 */
export interface MovieMetadataService {
  /**
   * Read metadata for a movie.
   * @param movieId - The movie ID
   * @returns The metadata, or null if not found
   */
  read(movieId: string): Promise<MovieMetadata | null>;

  /**
   * Write metadata for a movie (overwrites existing).
   * @param movieId - The movie ID
   * @param metadata - The metadata to write
   */
  write(movieId: string, metadata: MovieMetadata): Promise<void>;

  /**
   * Merge updates into existing metadata.
   * @param movieId - The movie ID
   * @param updates - Partial metadata to merge
   * @returns The merged metadata
   */
  merge(
    movieId: string,
    updates: Partial<MovieMetadata>
  ): Promise<MovieMetadata>;
}

/** Canonical filename for build metadata. */
const METADATA_FILE = 'metadata.json';

/**
 * Create a movie metadata service using the given storage context.
 *
 * @param storage - The storage context to use
 * @returns A MovieMetadataService instance
 */
export function createMovieMetadataService(
  storage: StorageContext
): MovieMetadataService {
  return {
    async read(movieId: string): Promise<MovieMetadata | null> {
      const metadataPath = storage.resolve(movieId, METADATA_FILE);
      if (await storage.storage.fileExists(metadataPath)) {
        const contents = await storage.storage.readToString(metadataPath);
        return JSON.parse(contents) as MovieMetadata;
      }

      return null;
    },

    async write(movieId: string, metadata: MovieMetadata): Promise<void> {
      const path = storage.resolve(movieId, METADATA_FILE);
      const contents = JSON.stringify(metadata, null, 2);
      await storage.storage.write(path, contents, {
        mimeType: 'application/json',
      });
    },

    async merge(
      movieId: string,
      updates: Partial<MovieMetadata>
    ): Promise<MovieMetadata> {
      const current = (await this.read(movieId)) ?? {};
      const next: MovieMetadata = { ...current, ...updates };
      await this.write(movieId, next);
      return next;
    },
  };
}
