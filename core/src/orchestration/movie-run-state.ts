import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { formatBlobFileName } from '../blob-utils.js';
import { createEventLog } from '../event-log.js';
import type { StorageContext } from '../storage.js';

export function resolveStorageBasePathForBlueprint(
  storageRoot: string,
  blueprintFolder: string
): string {
  const buildsFolder = path.join(blueprintFolder, 'builds');
  const basePath = path.relative(storageRoot, buildsFolder);
  if (basePath.startsWith('..') || path.isAbsolute(basePath)) {
    throw new Error(
      `Blueprint folder ${blueprintFolder} is outside configured storage root ${storageRoot}.`
    );
  }

  return basePath;
}

export async function resolveMovieInputsPath(
  blueprintFolder: string,
  movieId: string,
  lastInputsPath?: string
): Promise<string> {
  const buildInputsPath = path.join(
    blueprintFolder,
    'builds',
    movieId,
    'inputs.yaml'
  );
  if (existsSync(buildInputsPath)) {
    return buildInputsPath;
  }

  if (lastInputsPath && existsSync(lastInputsPath)) {
    return lastInputsPath;
  }
  throw new Error(
    `Could not resolve inputs file for build ${movieId}. Expected build inputs at ${buildInputsPath} or a valid metadata.lastInputsPath.`
  );
}

export async function copyLatestSucceededArtifactBlobsToMemory(
  localStorageContext: StorageContext,
  memoryStorageContext: StorageContext,
  movieId: string
): Promise<void> {
  const localEventLog = createEventLog(localStorageContext);
  const latestBlobs = new Map<string, { hash: string; mimeType: string }>();

  for await (const event of localEventLog.streamArtefacts(movieId)) {
    if (
      event.status === 'succeeded' &&
      event.output.blob?.hash &&
      event.output.blob.mimeType
    ) {
      latestBlobs.set(event.artefactId, {
        hash: event.output.blob.hash,
        mimeType: event.output.blob.mimeType,
      });
    }
  }

  const copiedBlobs = new Set<string>();

  for (const blob of latestBlobs.values()) {
    const blobKey = `${blob.hash}:${blob.mimeType}`;
    if (copiedBlobs.has(blobKey)) {
      continue;
    }

    const prefix = blob.hash.slice(0, 2);
    const fileName = formatBlobFileName(blob.hash, blob.mimeType);
    const sourcePath = localStorageContext.resolve(
      movieId,
      'blobs',
      prefix,
      fileName
    );
    const legacySourcePath = localStorageContext.resolve(
      movieId,
      'blobs',
      prefix,
      blob.hash
    );

    const sourceBlobPath = await resolveBlobSourcePath(
      localStorageContext,
      sourcePath,
      legacySourcePath,
      movieId,
      blob.hash,
      blob.mimeType
    );

    const payload =
      await localStorageContext.storage.readToUint8Array(sourceBlobPath);
    const payloadBuffer = Buffer.from(payload);

    const destinationPath = memoryStorageContext.resolve(
      movieId,
      'blobs',
      prefix,
      fileName
    );
    await memoryStorageContext.storage.write(destinationPath, payloadBuffer, {
      mimeType: blob.mimeType,
    });

    copiedBlobs.add(blobKey);
  }
}

async function resolveBlobSourcePath(
  storage: StorageContext,
  sourcePath: string,
  legacySourcePath: string,
  movieId: string,
  hash: string,
  mimeType: string
): Promise<string> {
  if (await storage.storage.fileExists(sourcePath)) {
    return sourcePath;
  }
  if (await storage.storage.fileExists(legacySourcePath)) {
    return legacySourcePath;
  }

  throw new Error(
    `Blob ${hash} (${mimeType}) is missing from movie ${movieId}.`
  );
}
