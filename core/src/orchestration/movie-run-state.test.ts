import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatBlobFileName } from '../blob-utils.js';
import { createEventLog } from '../event-log.js';
import { createStorageContext, initializeMovieStorage } from '../storage.js';
import type { ArtefactEvent } from '../types.js';
import {
  copyLatestSucceededArtifactBlobsToMemory,
  resolveMovieInputsPath,
  resolveStorageBasePathForBlueprint,
} from './movie-run-state.js';

describe('resolveMovieInputsPath', () => {
  it('prefers build-specific inputs.yaml when present', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'renku-rerun-inputs-'));

    try {
      const blueprintFolder = join(tempRoot, 'blueprint');
      const buildDir = join(blueprintFolder, 'builds', 'movie-test');
      const buildInputsPath = join(buildDir, 'inputs.yaml');

      await mkdir(buildDir, { recursive: true });
      await writeFile(buildInputsPath, 'inputs: {}', 'utf8');

      const resolved = await resolveMovieInputsPath(
        blueprintFolder,
        'movie-test'
      );

      expect(resolved).toBe(buildInputsPath);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('uses metadata.lastInputsPath when build inputs are missing', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'renku-rerun-inputs-'));

    try {
      const blueprintFolder = join(tempRoot, 'blueprint');
      const buildDir = join(blueprintFolder, 'builds', 'movie-test');
      const lastInputsPath = join(tempRoot, 'movie-test-inputs.yaml');

      await mkdir(buildDir, { recursive: true });
      await writeFile(lastInputsPath, 'inputs: {}', 'utf8');

      const resolved = await resolveMovieInputsPath(
        blueprintFolder,
        'movie-test',
        lastInputsPath
      );

      expect(resolved).toBe(lastInputsPath);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('throws when both build inputs and metadata.lastInputsPath are missing', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'renku-rerun-inputs-'));

    try {
      const blueprintFolder = join(tempRoot, 'blueprint');
      const buildDir = join(blueprintFolder, 'builds', 'movie-test');

      await mkdir(buildDir, { recursive: true });

      await expect(
        resolveMovieInputsPath(blueprintFolder, 'movie-test')
      ).rejects.toThrow(
        'Could not resolve inputs file for build movie-test. Expected build inputs'
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('resolveStorageBasePathForBlueprint', () => {
  it('returns builds path relative to storage root', () => {
    const storageRoot = '/tmp/renku-workspace';
    const blueprintFolder = '/tmp/renku-workspace/blueprints/example';

    expect(
      resolveStorageBasePathForBlueprint(storageRoot, blueprintFolder)
    ).toBe('blueprints/example/builds');
  });
});

describe('copyLatestSucceededArtifactBlobsToMemory', () => {
  it('copies latest succeeded blob payload into memory storage', async () => {
    const movieId = 'movie-test';
    const hash = 'ab1234567890';
    const mimeType = 'image/png';
    const payload = Buffer.from([1, 2, 3, 4]);

    const localStorageContext = createStorageContext({
      kind: 'memory',
      basePath: 'builds',
    });
    const memoryStorageContext = createStorageContext({
      kind: 'memory',
      basePath: 'builds',
    });

    await initializeMovieStorage(localStorageContext, movieId);
    await initializeMovieStorage(memoryStorageContext, movieId);

    const prefix = hash.slice(0, 2);
    const fileName = formatBlobFileName(hash, mimeType);
    const sourcePath = localStorageContext.resolve(
      movieId,
      'blobs',
      prefix,
      fileName
    );
    await localStorageContext.storage.write(sourcePath, payload, { mimeType });

    const eventLog = createEventLog(localStorageContext);
    const event: ArtefactEvent = {
      artefactId: 'Artifact:Image.Output',
      revision: 'rev-0001',
      inputsHash: 'inputs',
      output: {
        blob: {
          hash,
          size: payload.byteLength,
          mimeType,
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:ImageProducer',
      createdAt: new Date().toISOString(),
    };
    await eventLog.appendArtefact(movieId, event);

    await copyLatestSucceededArtifactBlobsToMemory(
      localStorageContext,
      memoryStorageContext,
      movieId
    );

    const destinationPath = memoryStorageContext.resolve(
      movieId,
      'blobs',
      prefix,
      fileName
    );
    const copied =
      await memoryStorageContext.storage.readToUint8Array(destinationPath);
    expect(Array.from(copied)).toEqual(Array.from(payload));
  });

  it('falls back to legacy hash-only blob filenames', async () => {
    const movieId = 'movie-test';
    const hash = 'cd1234567890';
    const mimeType = 'image/png';
    const payload = Buffer.from([7, 8, 9]);

    const localStorageContext = createStorageContext({
      kind: 'memory',
      basePath: 'builds',
    });
    const memoryStorageContext = createStorageContext({
      kind: 'memory',
      basePath: 'builds',
    });

    await initializeMovieStorage(localStorageContext, movieId);
    await initializeMovieStorage(memoryStorageContext, movieId);

    const prefix = hash.slice(0, 2);
    const legacySourcePath = localStorageContext.resolve(
      movieId,
      'blobs',
      prefix,
      hash
    );
    await localStorageContext.storage.write(legacySourcePath, payload, {
      mimeType,
    });

    const eventLog = createEventLog(localStorageContext);
    const event: ArtefactEvent = {
      artefactId: 'Artifact:Image.Output',
      revision: 'rev-0001',
      inputsHash: 'inputs',
      output: {
        blob: {
          hash,
          size: payload.byteLength,
          mimeType,
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:ImageProducer',
      createdAt: new Date().toISOString(),
    };
    await eventLog.appendArtefact(movieId, event);

    await copyLatestSucceededArtifactBlobsToMemory(
      localStorageContext,
      memoryStorageContext,
      movieId
    );

    const destinationPath = memoryStorageContext.resolve(
      movieId,
      'blobs',
      prefix,
      formatBlobFileName(hash, mimeType)
    );
    const copied =
      await memoryStorageContext.storage.readToUint8Array(destinationPath);
    expect(Array.from(copied)).toEqual(Array.from(payload));
  });
});
