import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { createStorageContext, initializeMovieStorage } from './storage.js';
import { persistInputBlob, convertBlobInputToBlobRef } from './input-blob-storage.js';
import { isBlobRef } from './types.js';
import { Buffer } from 'buffer';

function memoryContext(basePath?: string) {
  return createStorageContext({ kind: 'memory', basePath });
}

describe('persistInputBlob', () => {
  it('persists BlobInput and returns BlobRef', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const blobInput = {
      data: Buffer.from('test input data', 'utf8'),
      mimeType: 'text/plain',
    };

    const blobRef = await persistInputBlob(ctx, 'movie-1', blobInput);

    expect(isBlobRef(blobRef)).toBe(true);
    expect(blobRef.mimeType).toBe('text/plain');
    expect(blobRef.size).toBe(blobInput.data.byteLength);
    expect(blobRef.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('computes correct SHA-256 hash', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const data = Buffer.from('deterministic content', 'utf8');
    const expectedHash = createHash('sha256').update(data).digest('hex');

    const blobRef = await persistInputBlob(ctx, 'movie-1', {
      data,
      mimeType: 'text/plain',
    });

    expect(blobRef.hash).toBe(expectedHash);
  });
});

describe('convertBlobInputToBlobRef', () => {
  it('converts single BlobInput to BlobRef', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const blobInput = {
      data: Buffer.from('image data', 'utf8'),
      mimeType: 'image/png',
    };

    const result = await convertBlobInputToBlobRef(ctx, 'movie-1', blobInput);

    expect(isBlobRef(result)).toBe(true);
    const blobRef = result as { hash: string; size: number; mimeType: string };
    expect(blobRef.mimeType).toBe('image/png');
  });

  it('converts array of BlobInputs', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const inputs = [
      { data: Buffer.from('image 1'), mimeType: 'image/png' },
      { data: Buffer.from('image 2'), mimeType: 'image/jpeg' },
    ];

    const result = await convertBlobInputToBlobRef(ctx, 'movie-1', inputs);

    expect(Array.isArray(result)).toBe(true);
    const blobRefs = result as Array<{ hash: string; size: number; mimeType: string }>;
    expect(blobRefs).toHaveLength(2);
    expect(isBlobRef(blobRefs[0])).toBe(true);
    expect(isBlobRef(blobRefs[1])).toBe(true);
    expect(blobRefs[0]?.mimeType).toBe('image/png');
    expect(blobRefs[1]?.mimeType).toBe('image/jpeg');
  });

  it('converts nested objects with BlobInputs', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const input = {
      prompt: 'A test prompt',
      image: {
        data: Buffer.from('nested image'),
        mimeType: 'image/png',
      },
      metadata: {
        count: 5,
      },
    };

    const result = (await convertBlobInputToBlobRef(ctx, 'movie-1', input)) as Record<
      string,
      unknown
    >;

    expect(result['prompt']).toBe('A test prompt');
    expect(isBlobRef(result['image'])).toBe(true);
    expect((result['metadata'] as Record<string, unknown>)['count']).toBe(5);
  });

  it('preserves primitive values', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    expect(await convertBlobInputToBlobRef(ctx, 'movie-1', 'string')).toBe('string');
    expect(await convertBlobInputToBlobRef(ctx, 'movie-1', 42)).toBe(42);
    expect(await convertBlobInputToBlobRef(ctx, 'movie-1', true)).toBe(true);
    expect(await convertBlobInputToBlobRef(ctx, 'movie-1', null)).toBe(null);
  });

  it('preserves Uint8Array without treating as object', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const uint8Array = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await convertBlobInputToBlobRef(ctx, 'movie-1', uint8Array);

    expect(result).toBe(uint8Array);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('preserves Buffer without treating as object', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const buffer = Buffer.from([1, 2, 3, 4, 5]);
    const result = await convertBlobInputToBlobRef(ctx, 'movie-1', buffer);

    expect(result).toBe(buffer);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('handles mixed arrays with blobs and primitives', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const input = [
      'text',
      { data: Buffer.from('blob'), mimeType: 'image/png' },
      42,
    ];

    const result = (await convertBlobInputToBlobRef(ctx, 'movie-1', input)) as unknown[];

    expect(result[0]).toBe('text');
    expect(isBlobRef(result[1])).toBe(true);
    expect(result[2]).toBe(42);
  });

  it('handles deeply nested structures', async () => {
    const ctx = memoryContext('builds');
    await initializeMovieStorage(ctx, 'movie-1');

    const input = {
      level1: {
        level2: {
          level3: {
            blob: {
              data: Buffer.from('deep blob'),
              mimeType: 'text/plain',
            },
          },
        },
      },
    };

    const result = (await convertBlobInputToBlobRef(ctx, 'movie-1', input)) as {
      level1: { level2: { level3: { blob: unknown } } };
    };

    expect(isBlobRef(result.level1.level2.level3.blob)).toBe(true);
  });
});
