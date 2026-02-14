/* eslint-disable no-unused-vars */
import { createHash } from 'crypto';
import { Buffer } from 'buffer';
import type { BlobRef, BlobInput } from './types.js';
import { isBlobRef } from './types.js';

/**
 * Blob data for persistence. Accepts various data formats.
 */
export interface BlobData {
  data: Buffer | Uint8Array | string;
  mimeType: string;
}

/**
 * StorageContext-like interface for blob persistence.
 * Allows the function to work with any storage that implements these methods.
 */

export interface BlobStorageContext {
  storage: {
    fileExists(path: string): Promise<boolean>;
    directoryExists(path: string): Promise<boolean>;
    createDirectory(path: string, options: Record<string, unknown>): Promise<void>;
    write(path: string, data: Buffer | Uint8Array, options: { mimeType?: string }): Promise<void>;
    moveFile(from: string, to: string): Promise<void>;
  };
  resolve(movieId: string, ...segments: string[]): string;
}

/**
 * Persist blob data to content-addressed storage and return a BlobRef.
 * Blobs are stored at: blobs/{prefix}/{hash}.{ext}
 * where prefix is the first 2 characters of the SHA-256 hash.
 *
 * @param storage - Storage context with FileStorage instance
 * @param movieId - Movie identifier for path resolution
 * @param blob - Blob data with content and mime type
 * @returns BlobRef with hash, size, and mimeType
 */
export async function persistBlobToStorage(
  storage: BlobStorageContext,
  movieId: string,
  blob: BlobData,
): Promise<BlobRef> {
  const buffer = toBuffer(blob.data);
  const hash = createHash('sha256').update(buffer).digest('hex');
  const prefix = hash.slice(0, 2);
  const fileName = formatBlobFileName(hash, blob.mimeType);
  const relativePath = storage.resolve(movieId, 'blobs', prefix, fileName);

  // Write atomically if not exists (content-addressed deduplication)
  if (!(await storage.storage.fileExists(relativePath))) {
    await ensureDirectoriesForPath(storage, relativePath);
    const tmpPath = `${relativePath}.tmp-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    await storage.storage.write(tmpPath, buffer, { mimeType: blob.mimeType });
    await storage.storage.moveFile(tmpPath, relativePath);
  }

  return {
    hash,
    size: buffer.byteLength,
    mimeType: blob.mimeType,
  };
}

function toBuffer(data: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  return typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
}

const MIME_TYPE_MAP: Record<string, string> = {
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'webm': 'video/webm',
  'mp4': 'video/mp4',
  'mov': 'video/quicktime',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'webp': 'image/webp',
  'avif': 'image/avif',
  'gif': 'image/gif',
  'json': 'application/json',
  'txt': 'text/plain',
};

export function inferMimeType(extension: string): string {
  const normalized = extension.toLowerCase().replace(/^\./, '');
  return MIME_TYPE_MAP[normalized] ?? 'application/octet-stream';
}

const EXTENSION_MAP: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'text/plain': 'txt',
  'application/json': 'json',
};

export function inferBlobExtension(mimeType?: string): string | null {
  if (!mimeType) {
    return null;
  }
  const normalized = mimeType.toLowerCase();
  if (EXTENSION_MAP[normalized]) {
    return EXTENSION_MAP[normalized];
  }
  if (normalized.startsWith('audio/')) {
    return normalized.slice('audio/'.length);
  }
  if (normalized.startsWith('video/')) {
    return normalized.slice('video/'.length);
  }
  if (normalized.startsWith('image/')) {
    return normalized.slice('image/'.length);
  }
  return null;
}

export function formatBlobFileName(hash: string, mimeType?: string): string {
  const extension = inferBlobExtension(mimeType);
  if (!extension) {
    return hash;
  }
  if (hash.endsWith(`.${extension}`)) {
    return hash;
  }
  return `${hash}.${extension}`;
}

/**
 * Ensure all parent directories exist for a given file path within a StorageContext.
 * Creates directories recursively from root to the parent of the target file.
 *
 * @param storage - StorageContext with FileStorage instance
 * @param fullPath - Full path to a file (directories will be created for all parents)
 */
export async function ensureDirectoriesForPath(
  storage: { storage: { directoryExists(path: string): Promise<boolean>; createDirectory(path: string, options: Record<string, unknown>): Promise<void> } },
  fullPath: string,
): Promise<void> {
  const segments = fullPath.split('/').slice(0, -1);
  if (!segments.length) {
    return;
  }
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!(await storage.storage.directoryExists(current))) {
      await storage.storage.createDirectory(current, {});
    }
  }
}

/**
 * StorageContext-like interface for blob reading.
 * Allows the function to work with any storage that implements these methods.
 */
export interface BlobReadStorageContext {
  storage: {
    readToUint8Array(path: string): Promise<Uint8Array>;
  };
  resolve(movieId: string, ...segments: string[]): string;
}

/**
 * Read blob data from content-addressed storage given a BlobRef.
 * Blobs are stored at: blobs/{prefix}/{hash}.{ext}
 *
 * @param storage - Storage context with FileStorage instance
 * @param movieId - Movie identifier for path resolution
 * @param blobRef - BlobRef with hash and mimeType
 * @returns BlobInput with actual data and mimeType
 */
export async function readBlobFromStorage(
  storage: BlobReadStorageContext,
  movieId: string,
  blobRef: BlobRef,
): Promise<BlobInput> {
  const prefix = blobRef.hash.slice(0, 2);
  const fileName = formatBlobFileName(blobRef.hash, blobRef.mimeType);
  const blobPath = storage.resolve(movieId, 'blobs', prefix, fileName);
  const data = await storage.storage.readToUint8Array(blobPath);
  return {
    data: Buffer.from(data),
    mimeType: blobRef.mimeType,
  };
}

/**
 * Recursively resolve BlobRef objects to BlobInput format for provider execution.
 * This allows providers to receive actual blob data instead of hash references.
 *
 * @param storage - Storage context for reading blobs
 * @param movieId - Movie identifier for path resolution
 * @param value - Input value that may contain BlobRef objects
 * @returns Value with BlobRefs resolved to BlobInputs
 */
export async function resolveBlobRefsToInputs(
  storage: BlobReadStorageContext,
  movieId: string,
  value: unknown,
): Promise<unknown> {
  if (isBlobRef(value)) {
    return await readBlobFromStorage(storage, movieId, value);
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(v => resolveBlobRefsToInputs(storage, movieId, v)));
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = await resolveBlobRefsToInputs(storage, movieId, v);
    }
    return result;
  }
  return value;
}
