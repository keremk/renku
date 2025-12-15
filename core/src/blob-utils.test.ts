import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { createStorageContext, initializeMovieStorage } from './storage.js';
import {
  persistBlobToStorage,
  ensureDirectoriesForPath,
  formatBlobFileName,
  inferMimeType,
  inferBlobExtension,
} from './blob-utils.js';
import { Buffer } from 'buffer';

function memoryContext(basePath?: string) {
  return createStorageContext({ kind: 'memory', basePath });
}

describe('persistBlobToStorage', () => {
  it('persists blob and returns BlobRef with correct hash', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const blobData = Buffer.from('hello world', 'utf8');
    const expectedHash = createHash('sha256').update(blobData).digest('hex');

    const blobRef = await persistBlobToStorage(ctx, 'movie-1', {
      data: blobData,
      mimeType: 'text/plain',
    });

    expect(blobRef.hash).toBe(expectedHash);
    expect(blobRef.size).toBe(blobData.byteLength);
    expect(blobRef.mimeType).toBe('text/plain');
  });

  it('stores blob at content-addressed path', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const blobData = Buffer.from('test content', 'utf8');
    const hash = createHash('sha256').update(blobData).digest('hex');
    const prefix = hash.slice(0, 2);

    await persistBlobToStorage(ctx, 'movie-1', {
      data: blobData,
      mimeType: 'text/plain',
    });

    const expectedPath = `builds/movie-1/blobs/${prefix}/${hash}.txt`;
    expect(await ctx.storage.fileExists(expectedPath)).toBe(true);

    const stored = await ctx.storage.readToUint8Array(expectedPath);
    expect(Buffer.from(stored).toString('utf8')).toBe('test content');
  });

  it('deduplicates blobs with same content', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const blobData = Buffer.from('duplicate content', 'utf8');

    const ref1 = await persistBlobToStorage(ctx, 'movie-1', {
      data: blobData,
      mimeType: 'text/plain',
    });

    const ref2 = await persistBlobToStorage(ctx, 'movie-1', {
      data: blobData,
      mimeType: 'text/plain',
    });

    expect(ref1.hash).toBe(ref2.hash);
    expect(ref1.size).toBe(ref2.size);
  });

  it('handles binary data correctly', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    // Create a small PNG-like header
    const blobData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    const blobRef = await persistBlobToStorage(ctx, 'movie-1', {
      data: blobData,
      mimeType: 'image/png',
    });

    expect(blobRef.size).toBe(8);
    expect(blobRef.mimeType).toBe('image/png');

    const prefix = blobRef.hash.slice(0, 2);
    const expectedPath = `builds/movie-1/blobs/${prefix}/${blobRef.hash}.png`;
    expect(await ctx.storage.fileExists(expectedPath)).toBe(true);
  });

  it('handles Uint8Array input', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const blobData = new Uint8Array([1, 2, 3, 4, 5]);

    const blobRef = await persistBlobToStorage(ctx, 'movie-1', {
      data: blobData,
      mimeType: 'application/octet-stream',
    });

    expect(blobRef.size).toBe(5);
    expect(blobRef.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles string input', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const blobRef = await persistBlobToStorage(ctx, 'movie-1', {
      data: 'string content',
      mimeType: 'text/plain',
    });

    expect(blobRef.size).toBe(Buffer.from('string content').byteLength);
  });
});

describe('ensureDirectoriesForPath', () => {
  it('creates parent directories for file path', async () => {
    const ctx = memoryContext('builds');

    await ensureDirectoriesForPath(ctx, 'builds/movie-1/blobs/ab/abcdef123.png');

    expect(await ctx.storage.directoryExists('builds')).toBe(true);
    expect(await ctx.storage.directoryExists('builds/movie-1')).toBe(true);
    expect(await ctx.storage.directoryExists('builds/movie-1/blobs')).toBe(true);
    expect(await ctx.storage.directoryExists('builds/movie-1/blobs/ab')).toBe(true);
  });

  it('handles empty segment path gracefully', async () => {
    const ctx = memoryContext('builds');
    // Should not throw for a filename without directories
    await ensureDirectoriesForPath(ctx, 'file.txt');
  });

  it('handles already existing directories', async () => {
    const ctx = memoryContext('builds');
    await ctx.storage.createDirectory('builds', {});
    await ctx.storage.createDirectory('builds/movie-1', {});

    // Should not throw when directories already exist
    await ensureDirectoriesForPath(ctx, 'builds/movie-1/blobs/ab/file.png');

    expect(await ctx.storage.directoryExists('builds/movie-1/blobs')).toBe(true);
    expect(await ctx.storage.directoryExists('builds/movie-1/blobs/ab')).toBe(true);
  });
});

describe('formatBlobFileName', () => {
  it('appends extension based on mimeType', () => {
    expect(formatBlobFileName('abc123', 'image/png')).toBe('abc123.png');
    expect(formatBlobFileName('abc123', 'image/jpeg')).toBe('abc123.jpg');
    expect(formatBlobFileName('abc123', 'video/mp4')).toBe('abc123.mp4');
    expect(formatBlobFileName('abc123', 'audio/mpeg')).toBe('abc123.mp3');
    expect(formatBlobFileName('abc123', 'text/plain')).toBe('abc123.txt');
    expect(formatBlobFileName('abc123', 'application/json')).toBe('abc123.json');
  });

  it('returns hash without extension for unknown mimeType', () => {
    expect(formatBlobFileName('abc123', 'application/octet-stream')).toBe('abc123');
    expect(formatBlobFileName('abc123', undefined)).toBe('abc123');
  });

  it('does not double-add extension', () => {
    expect(formatBlobFileName('abc123.png', 'image/png')).toBe('abc123.png');
  });
});

describe('inferMimeType', () => {
  it('infers mime type from extension', () => {
    expect(inferMimeType('png')).toBe('image/png');
    expect(inferMimeType('jpg')).toBe('image/jpeg');
    expect(inferMimeType('mp4')).toBe('video/mp4');
    expect(inferMimeType('mp3')).toBe('audio/mpeg');
    expect(inferMimeType('json')).toBe('application/json');
  });

  it('handles leading dots', () => {
    expect(inferMimeType('.png')).toBe('image/png');
    expect(inferMimeType('.MP4')).toBe('video/mp4');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(inferMimeType('unknown')).toBe('application/octet-stream');
    expect(inferMimeType('')).toBe('application/octet-stream');
  });
});

describe('inferBlobExtension', () => {
  it('infers extension from mimeType', () => {
    expect(inferBlobExtension('image/png')).toBe('png');
    expect(inferBlobExtension('image/jpeg')).toBe('jpg');
    expect(inferBlobExtension('video/mp4')).toBe('mp4');
    expect(inferBlobExtension('audio/mpeg')).toBe('mp3');
  });

  it('returns null for undefined mimeType', () => {
    expect(inferBlobExtension(undefined)).toBe(null);
  });
});
