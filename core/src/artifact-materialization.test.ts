import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  lstat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMovieMetadataService } from './movie-metadata.js';
import { formatBlobFileName } from './blob-utils.js';
import { createStorageContext, initializeMovieStorage } from './storage.js';
import type { BuildState } from './types.js';
import {
  deriveArtifactsMovieFolderName,
  materializeBuildStateArtifacts,
  resolveArtifactsBaseRoot,
  resolveArtifactsMovieFolderName,
} from './artifact-materialization.js';

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'renku-artifact-materialization-test-'));
}

describe('artifact materialization', () => {
  it('derives stable movie folder names from display names', () => {
    expect(
      deriveArtifactsMovieFolderName({
        movieId: 'movie-abc123',
        displayName: 'Simple Documentary',
      })
    ).toBe('simple-documentary-movie-abc123');

    expect(
      deriveArtifactsMovieFolderName({
        movieId: 'movie-abc123',
        displayName: '',
      })
    ).toBe('movie-abc123');
  });

  it('avoids collisions for identical display names', () => {
    const first = deriveArtifactsMovieFolderName({
      movieId: 'movie-one',
      displayName: 'Draft',
    });
    const second = deriveArtifactsMovieFolderName({
      movieId: 'movie-two',
      displayName: 'Draft',
    });

    expect(first).toBe('draft-movie-one');
    expect(second).toBe('draft-movie-two');
    expect(first).not.toBe(second);
  });

  it('resolves artifacts root next to builds root', () => {
    expect(resolveArtifactsBaseRoot('/workspace', 'builds')).toBe(
      '/workspace/artifacts'
    );
    expect(
      resolveArtifactsBaseRoot('/workspace', 'simple-documentary/builds')
    ).toBe('/workspace/simple-documentary/artifacts');
  });

  it('materializes build-state artifacts in copy mode', async () => {
    const rootDir = await makeTempDir();
    try {
      const movieId = 'movie-test';
      const blobHash = 'abc123';
      const blobMimeType = 'image/png';
      const blobFileName = formatBlobFileName(blobHash, blobMimeType);
      const blobPath = resolve(
        rootDir,
        'builds',
        movieId,
        'blobs',
        blobHash.slice(0, 2),
        blobFileName
      );
      await mkdir(resolve(blobPath, '..'), { recursive: true });
      await writeFile(blobPath, Buffer.from('image-data'));

      const buildState: BuildState = {
        revision: 'rev-1',
        baseRevision: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        inputs: {},
        artifacts: {
          'Artifact:CharacterImageProducer.GeneratedImage[0]': {
            hash: 'digest-1',
            blob: {
              hash: blobHash,
              size: 10,
              mimeType: blobMimeType,
            },
            producedBy: 'Producer:CharacterImageProducer',
            status: 'succeeded',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      };

      const result = await materializeBuildStateArtifacts({
        storageRoot: rootDir,
        storageBasePath: 'builds',
        movieId,
        artifactsMovieFolderName: 'my-movie',
        buildState,
        mode: 'copy',
      });

      const artifactPath = resolve(
        result.artifactsRoot,
        'character-image-producer',
        'generated-image-0.png'
      );
      expect(await readFile(artifactPath, 'utf8')).toBe('image-data');
      expect((await lstat(artifactPath)).isSymbolicLink()).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('materializes build-state artifacts in symlink mode', async () => {
    const rootDir = await makeTempDir();
    try {
      const movieId = 'movie-test';
      const blobHash = 'fefefe';
      const blobMimeType = 'audio/mpeg';
      const blobFileName = formatBlobFileName(blobHash, blobMimeType);
      const blobPath = resolve(
        rootDir,
        'builds',
        movieId,
        'blobs',
        blobHash.slice(0, 2),
        blobFileName
      );
      await mkdir(resolve(blobPath, '..'), { recursive: true });
      await writeFile(blobPath, Buffer.from('audio-data'));

      const buildState: BuildState = {
        revision: 'rev-1',
        baseRevision: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        inputs: {},
        artifacts: {
          'Artifact:AudioProducer.GeneratedAudio[0]': {
            hash: 'digest-2',
            blob: {
              hash: blobHash,
              size: 10,
              mimeType: blobMimeType,
            },
            producedBy: 'Producer:AudioProducer',
            status: 'succeeded',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      };

      const result = await materializeBuildStateArtifacts({
        storageRoot: rootDir,
        storageBasePath: 'builds',
        movieId,
        artifactsMovieFolderName: 'my-movie',
        buildState,
        mode: 'symlink',
      });

      const artifactPath = resolve(
        result.artifactsRoot,
        'audio-producer',
        'generated-audio-0.mp3'
      );
      expect((await lstat(artifactPath)).isSymbolicLink()).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('locks artifact folder name after first resolution', async () => {
    const rootDir = await makeTempDir();
    try {
      const movieId = 'movie-stable';
      const storage = createStorageContext({
        kind: 'local',
        rootDir,
        basePath: 'builds',
      });
      await initializeMovieStorage(storage, movieId);

      const metadataService = createMovieMetadataService(storage);
      await metadataService.merge(movieId, { displayName: 'Original Name' });

      const first = await resolveArtifactsMovieFolderName({
        movieId,
        metadataService,
      });
      expect(first).toBe('original-name-movie-stable');

      await metadataService.merge(movieId, { displayName: 'Updated Name' });
      const second = await resolveArtifactsMovieFolderName({
        movieId,
        metadataService,
      });
      expect(second).toBe('original-name-movie-stable');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
