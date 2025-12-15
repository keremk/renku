import type { BlobInput, BlobRef } from './types.js';
import { isBlobInput } from './types.js';
import type { StorageContext } from './storage.js';
import { persistBlobToStorage } from './blob-utils.js';
import { Buffer } from 'buffer';

/**
 * Persist a single input blob to storage and return a BlobRef.
 * Reuses existing blobs if hash matches (content-addressed storage).
 */
export async function persistInputBlob(
  storage: StorageContext,
  movieId: string,
  blob: BlobInput,
): Promise<BlobRef> {
  return persistBlobToStorage(storage, movieId, blob);
}

/**
 * Recursively convert BlobInput objects to BlobRef objects by persisting blobs.
 */
export async function convertBlobInputToBlobRef(
  storage: StorageContext,
  movieId: string,
  value: unknown,
): Promise<unknown> {
  if (isBlobInput(value)) {
    return await persistInputBlob(storage, movieId, value);
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(v => convertBlobInputToBlobRef(storage, movieId, v)));
  }
  // Skip binary data types - don't treat them as plain objects
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = await convertBlobInputToBlobRef(storage, movieId, v);
    }
    return result;
  }
  return value;
}
