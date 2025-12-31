import { FileStorage } from '@flystorage/file-storage';
import { AwsS3StorageAdapter } from '@flystorage/aws-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { InMemoryStorageAdapter } from '@flystorage/in-memory';
import { LocalStorageAdapter } from '@flystorage/local-fs';
import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';
import { posix as path } from 'node:path';
import type { ExecutionPlan, ManifestPointer, RevisionId } from './types.js';

export type StorageConfig =
  | (BaseStorageConfig & {
      kind: 'local';
      /** Absolute path on the local filesystem that will house all movie builds. */
      rootDir: string;
    })
  | (BaseStorageConfig & {
      kind: 'memory';
    })
  | (BaseStorageConfig & {
      kind: 'cloud';
      /** Configuration for S3-compatible cloud storage. */
      cloudConfig: CloudStorageConfig;
    });

interface BaseStorageConfig {
  /** Optional prefix inside the storage adapter (defaults to "builds"). */
  basePath?: string;
}

/** Configuration for S3-compatible cloud storage (e.g., CloudFlare R2). */
export interface CloudStorageConfig {
  /** S3-compatible endpoint URL (e.g., https://<account-id>.r2.cloudflarestorage.com) */
  endpoint: string;
  /** Bucket name */
  bucket: string;
  /** Access key ID */
  accessKeyId: string;
  /** Secret access key */
  secretAccessKey: string;
  /** Region (defaults to 'auto' for CloudFlare R2) */
  region?: string;
}

/* eslint-disable no-unused-vars */
export interface StorageContext {
  storage: FileStorage;
  basePath: string;
  /** Resolve a storage-relative path (POSIX separators). */
  resolve(movieId: string, ...segments: string[]): string;
  /** Append a UTF-8 string to a storage-relative file, creating it if needed. */
  append(relativePath: string, data: string, mimeType?: string): Promise<void>;
  /** Get a time-limited signed URL for a file (only available for 'cloud' storage). */
  temporaryUrl?(path: string, expiresInSecs?: number): Promise<string>;
}

const DEFAULT_BASE_PATH = 'builds';

export function createStorageContext(config: StorageConfig): StorageContext {
  const basePath = normalizeSegment(config.basePath ?? DEFAULT_BASE_PATH);
  const storage = new FileStorage(resolveAdapter(config));
  const appendQueues = new Map<string, Promise<void>>();

  async function enqueueAppend(key: string, task: () => Promise<void>): Promise<void> {
    const previous = appendQueues.get(key) ?? Promise.resolve();
    // Chain task after previous, ensuring sequential execution
    // Errors will propagate to callers via the awaited promise
    const next = previous.catch(() => {}).then(task);
    appendQueues.set(key, next);
    try {
      await next;
    } finally {
      if (appendQueues.get(key) === next) {
        appendQueues.delete(key);
      }
    }
  }

  const context: StorageContext = {
    storage,
    basePath,
    resolve(movieId, ...segments) {
      const cleanMovieId = normalizeSegment(movieId);
      const cleanedSegments = segments.map(normalizeSegment).filter(Boolean);
      const allSegments = [basePath, cleanMovieId, ...cleanedSegments].filter(
        Boolean
      );
      return allSegments.length ? path.join(...allSegments) : '';
    },
    append(relativePath, data, mimeType = 'application/json') {
      const normalizedPath = normalizeSegment(relativePath);
      return enqueueAppend(normalizedPath, async () => {
        if (config.kind === 'local') {
          await appendLocalFile(config.rootDir, normalizedPath, data);
          return;
        }
        // Fallback for in-memory adapter or other drivers: read-modify-write.
        const exists = await storage.fileExists(normalizedPath);
        const current = exists
          ? await storage.readToString(normalizedPath)
          : '';
        const nextPayload = current ? current + data : data;
        await writeString(storage, normalizedPath, nextPayload, mimeType);
      });
    },
  };

  // Add temporaryUrl method for cloud storage
  if (config.kind === 'cloud') {
    context.temporaryUrl = async (filePath: string, expiresInSecs = 3600) => {
      const expiresAt = Date.now() + expiresInSecs * 1000;
      return storage.temporaryUrl(filePath, { expiresAt });
    };
  }

  return context;
}

function resolveAdapter(config: StorageConfig) {
  switch (config.kind) {
    case 'local':
      return new LocalStorageAdapter(config.rootDir);
    case 'memory':
      return new InMemoryStorageAdapter();
    case 'cloud': {
      const client = new S3Client({
        endpoint: config.cloudConfig.endpoint,
        region: config.cloudConfig.region ?? 'auto',
        credentials: {
          accessKeyId: config.cloudConfig.accessKeyId,
          secretAccessKey: config.cloudConfig.secretAccessKey,
        },
        forcePathStyle: true, // Required for CloudFlare R2 compatibility
      });
      return new AwsS3StorageAdapter(client, {
        bucket: config.cloudConfig.bucket,
      });
    }
    default: {
      const neverCase: never = config;
      throw new Error(
        `Unsupported storage config: ${JSON.stringify(neverCase)}`
      );
    }
  }
}

export interface InitializeMovieOptions {
  seedCurrentJson?: boolean;
}

export async function initializeMovieStorage(
  ctx: StorageContext,
  movieId: string,
  options: InitializeMovieOptions = {}
): Promise<void> {
  const storage = ctx.storage;
  const root = ctx.resolve(movieId);
  await ensureDirectoryChain(storage, ctx.basePath);
  await ensureDirectoryChain(storage, root);

  const manifestsDir = ctx.resolve(movieId, 'manifests');
  const eventsDir = ctx.resolve(movieId, 'events');
  const runsDir = ctx.resolve(movieId, 'runs');
  const blobsDir = ctx.resolve(movieId, 'blobs');

  await ensureDirectoryChain(storage, manifestsDir);
  await ensureDirectoryChain(storage, eventsDir);
  await ensureDirectoryChain(storage, runsDir);
  await ensureDirectoryChain(storage, blobsDir);

  await ensureFile(storage, path.join(eventsDir, 'inputs.log'), '');
  await ensureFile(storage, path.join(eventsDir, 'artefacts.log'), '');

  if (options.seedCurrentJson !== false) {
    await ensureFile(
      storage,
      path.join(root, 'current.json'),
      JSON.stringify(emptyManifestPointer(), null, 2)
    );
  }
}

export const planStore = {
  async save(
    plan: ExecutionPlan,
    ctx: { movieId: string; storage: StorageContext }
  ): Promise<void> {
    const fileName = `${plan.revision}-plan.json`;
    const runsDir = ctx.storage.resolve(ctx.movieId, 'runs');
    await ensureDirectoryChain(ctx.storage.storage, runsDir);
    const finalPath = path.join(runsDir, fileName);
    await writeJson(ctx.storage.storage, finalPath, plan);
  },

  async load(
    movieId: string,
    revision: RevisionId,
    ctx: StorageContext
  ): Promise<ExecutionPlan | null> {
    const planPath = ctx.resolve(movieId, 'runs', `${revision}-plan.json`);
    if (!(await ctx.storage.fileExists(planPath))) {
      return null;
    }
    const raw = await ctx.storage.readToString(planPath);
    return JSON.parse(raw) as ExecutionPlan;
  },
};

async function ensureDirectoryChain(
  storage: FileStorage,
  targetPath: string
): Promise<void> {
  if (!targetPath) {
    return;
  }
  const segments = targetPath.split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current = current ? path.join(current, segment) : segment;
    if (!(await storage.directoryExists(current))) {
      await storage.createDirectory(current, {});
    }
  }
}

async function ensureFile(
  storage: FileStorage,
  targetPath: string,
  contents: string
): Promise<void> {
  if (await storage.fileExists(targetPath)) {
    return;
  }
  const mime = targetPath.endsWith('.json') ? 'application/json' : 'text/plain';
  await writeString(storage, targetPath, contents, mime);
}

async function writeJson(
  storage: FileStorage,
  targetPath: string,
  payload: unknown
): Promise<void> {
  const data = JSON.stringify(payload, null, 2);
  await writeString(storage, targetPath, data);
}

async function writeString(
  storage: FileStorage,
  targetPath: string,
  data: string,
  mimeType: string = 'application/json'
): Promise<void> {
  const tmpPath = `${targetPath}.tmp-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  await storage.write(tmpPath, data, { mimeType });
  await storage.moveFile(tmpPath, targetPath);
}

function normalizeSegment(segment: string): string {
  return segment.replace(/^\/+/, '').replace(/\/+$/, '');
}

function emptyManifestPointer(): ManifestPointer {
  return {
    revision: null,
    manifestPath: null,
    hash: null,
    updatedAt: null,
  };
}

async function appendLocalFile(
  rootDir: string,
  relativePath: string,
  data: string
): Promise<void> {
  const absolutePath = toAbsolutePath(rootDir, relativePath);
  await fs.mkdir(nodePath.dirname(absolutePath), { recursive: true });
  const handle = await fs.open(absolutePath, 'a');
  try {
    await handle.write(data);
  } finally {
    await handle.close();
  }
}

function toAbsolutePath(rootDir: string, relativePath: string): string {
  if (!relativePath) {
    return rootDir;
  }
  const segments = relativePath.split('/').filter(Boolean);
  return nodePath.join(rootDir, ...segments);
}
