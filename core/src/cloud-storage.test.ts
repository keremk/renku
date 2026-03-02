import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDryRunCloudStorageContext,
  loadCloudStorageEnv,
  resolveExecutionCloudStorage,
} from './cloud-storage.js';

const ORIGINAL_ENV = process.env;

describe('cloud-storage helpers', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    delete process.env.S3_REGION;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reports missing required cloud storage env vars', () => {
    const result = loadCloudStorageEnv();
    expect(result.isConfigured).toBe(false);
    expect(result.config).toBeNull();
    expect(result.missingVars).toEqual([
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_ENDPOINT',
      'S3_BUCKET',
    ]);
  });

  it('resolves cloud storage context in live mode when env vars are set', () => {
    process.env.S3_ACCESS_KEY_ID = 'access-key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret-key';
    process.env.S3_ENDPOINT = 'https://account.r2.cloudflarestorage.com';
    process.env.S3_BUCKET = 'renku-bucket';
    process.env.S3_REGION = 'auto';

    const cloudStorage = resolveExecutionCloudStorage({
      dryRun: false,
      rootDir: '/tmp/workspace',
      basePath: 'builds',
      movieId: 'movie-abc123',
    });

    expect(cloudStorage).toBeDefined();
    expect(typeof cloudStorage?.temporaryUrl).toBe('function');
  });

  it('returns undefined in live mode when env vars are not configured', () => {
    const cloudStorage = resolveExecutionCloudStorage({
      dryRun: false,
      rootDir: '/tmp/workspace',
      basePath: 'builds',
      movieId: 'movie-abc123',
    });

    expect(cloudStorage).toBeUndefined();
  });

  it('creates dry-run cloud storage context that validates blob path format', async () => {
    const cloudStorage = createDryRunCloudStorageContext(
      '/tmp/workspace',
      'builds',
      'movie-abc123'
    );
    const temporaryUrl = cloudStorage.temporaryUrl;
    expect(temporaryUrl).toBeDefined();

    await expect(temporaryUrl!('blobs/ab/example-hash.png')).resolves.toBe(
      'https://dry-run.invalid/blobs/ab/example-hash.png'
    );

    await expect(temporaryUrl!('runs/rev-0001-plan.json')).rejects.toThrow(
      'Invalid blob path for dry-run'
    );
  });

  it('prefers dry-run cloud storage even when live env vars are configured', async () => {
    process.env.S3_ACCESS_KEY_ID = 'access-key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret-key';
    process.env.S3_ENDPOINT = 'https://account.r2.cloudflarestorage.com';
    process.env.S3_BUCKET = 'renku-bucket';

    const cloudStorage = resolveExecutionCloudStorage({
      dryRun: true,
      rootDir: '/tmp/workspace',
      basePath: 'builds',
      movieId: 'movie-abc123',
    });
    const temporaryUrl = cloudStorage?.temporaryUrl;
    expect(temporaryUrl).toBeDefined();

    await expect(temporaryUrl!('blobs/ab/example-hash.png')).resolves.toBe(
      'https://dry-run.invalid/blobs/ab/example-hash.png'
    );
  });
});
