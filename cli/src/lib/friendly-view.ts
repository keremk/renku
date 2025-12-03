import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createManifestService,
  createStorageContext,
  type BlobRef,
  type Manifest,
} from '@renku/core';
import type { PendingArtefactDraft } from './planner.js';
import type { CliConfig } from './cli-config.js';

const log = globalThis.console;

interface FriendlyArtefactInfo {
  artefactId: string;
  friendlyPath: string;
  sourcePath: string;
  hash: string;
  producedBy: string;
  mimeType?: string;
  kind: 'blob';
}

export interface FriendlyViewContext {
  friendlyRoot: string;
  artefacts: FriendlyArtefactInfo[];
  inputsPath: string;
}

export interface FriendlyPreflightResult {
  pendingArtefacts: PendingArtefactDraft[];
  changed: boolean;
  friendly: FriendlyViewContext;
}

export async function loadCurrentManifest(cliConfig: CliConfig, movieId: string): Promise<{ manifest: Manifest; hash: string | null }>
{
  const storage = createStorageContext({ kind: 'local', rootDir: cliConfig.storage.root, basePath: cliConfig.storage.basePath });
  const manifestService = createManifestService(storage);
  return manifestService.loadCurrent(movieId);
}

export async function buildFriendlyView(args: {
  cliConfig: CliConfig;
  movieId: string;
  manifest: Manifest;
}): Promise<FriendlyViewContext> {
  const { cliConfig, movieId, manifest } = args;
  const friendlyRoot = resolve(cliConfig.storage.root, 'movies', movieId);
  await rm(friendlyRoot, { recursive: true, force: true });
  await mkdir(friendlyRoot, { recursive: true });

  const inputsPath = resolve(cliConfig.storage.root, cliConfig.storage.basePath, movieId, 'inputs.yaml');

  const artefacts: FriendlyArtefactInfo[] = [];
  for (const [artefactId, entry] of Object.entries(manifest.artefacts)) {
    const friendlyName = toFriendlyFileName(artefactId, entry.blob?.mimeType);
    const producer = normalizeProducer(entry.producedBy);
    const friendlyPath = resolve(friendlyRoot, producer, friendlyName);
    await mkdir(dirname(friendlyPath), { recursive: true });

    if (!entry.blob) {
      continue;
    }

    const shardedPath = shardedBlobPath(cliConfig, movieId, entry.blob.hash, entry.blob.mimeType);
    if (!(await pathExists(shardedPath))) {
      log.warn(
        `Warning: blob missing for ${artefactId} at ${shardedPath}. Friendly link not created.`,
      );
      continue;
    }
    await ensureSymlink(shardedPath, friendlyPath, { overwrite: true });
    artefacts.push({
      artefactId,
      friendlyPath,
      sourcePath: shardedPath,
      hash: entry.hash,
      producedBy: entry.producedBy,
      mimeType: entry.blob.mimeType,
      kind: 'blob',
    });
  }

  return { friendlyRoot, artefacts, inputsPath };
}

export async function prepareFriendlyPreflight(args: {
  cliConfig: CliConfig;
  movieId: string;
  manifest: Manifest;
  allowShardedBlobs?: boolean;
}): Promise<FriendlyPreflightResult> {
  const friendly = await collectFriendlyContext(args);
  const pending: PendingArtefactDraft[] = [];
  let changed = false;

  for (const entry of friendly.artefacts) {
    const nextHash = await hashFile(entry.friendlyPath);
    if (nextHash === entry.hash) {
      continue;
    }
    changed = true;

    const buffer = await readFile(entry.friendlyPath);
    const blobRef = await persistBlobSharded(buffer, entry.mimeType, args.cliConfig, args.movieId);

    const shardedPath = shardedBlobPath(args.cliConfig, args.movieId, blobRef.hash, blobRef.mimeType);
    await ensureSymlink(shardedPath, entry.friendlyPath, { overwrite: true });

    pending.push({
      artefactId: entry.artefactId,
      producedBy: entry.producedBy,
      output: { blob: blobRef },
      diagnostics: { source: 'friendly-edit' },
    });
  }

  return { pendingArtefacts: pending, changed, friendly };
}

async function collectFriendlyContext(args: {
  cliConfig: CliConfig;
  movieId: string;
  manifest: Manifest;
  allowShardedBlobs?: boolean;
}): Promise<FriendlyViewContext> {
  const { cliConfig, movieId, manifest } = args;
  const friendlyRoot = resolve(cliConfig.storage.root, 'movies', movieId);
  await mkdir(friendlyRoot, { recursive: true });

  const inputsPath = resolve(cliConfig.storage.root, cliConfig.storage.basePath, movieId, 'inputs.yaml');

  const artefacts: FriendlyArtefactInfo[] = [];
  for (const [artefactId, entry] of Object.entries(manifest.artefacts)) {
    const friendlyName = toFriendlyFileName(artefactId, entry.blob?.mimeType);
    const producer = normalizeProducer(entry.producedBy);
    const friendlyPath = resolve(friendlyRoot, producer, friendlyName);

    await mkdir(dirname(friendlyPath), { recursive: true });

    if (!entry.blob) {
      continue;
    }

    const shardedPath = shardedBlobPath(cliConfig, movieId, entry.blob.hash, entry.blob.mimeType);
    if (!(await pathExists(shardedPath))) {
      log.warn(
        `Warning: blob missing for ${artefactId} at ${shardedPath}. Friendly link not created.`,
      );
      continue;
    }
    await ensureSymlink(shardedPath, friendlyPath, { overwrite: true });
    artefacts.push({
      artefactId,
      friendlyPath,
      sourcePath: shardedPath,
      hash: entry.hash,
      producedBy: entry.producedBy,
      mimeType: entry.blob.mimeType,
      kind: 'blob',
    });
  }

  return { friendlyRoot, artefacts, inputsPath };
}

function normalizeProducer(producedBy: string | undefined): string {
  if (!producedBy) {
    return 'unknown-producer';
  }
  const parts = producedBy.split(':');
  const candidate = parts[parts.length - 1] ?? producedBy;
  return candidate.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/--+/g, '-').toLowerCase();
}

function toFriendlyFileName(artefactId: string, mimeType?: string): string {
  const trimmed = artefactId.replace(/^Artifact:/, '').trim();
  const withoutNamespace = trimmed.includes('.')
    ? trimmed.slice(trimmed.lastIndexOf('.') + 1)
    : trimmed;
  const sanitized = withoutNamespace
    .replace(/\[/g, '-')
    .replace(/\]/g, '')
    .replace(/[:=]/g, '-')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/--+/g, '-')
    .toLowerCase();
  const ext = inferExtension(mimeType);
  return ext ? `${sanitized}.${ext}` : sanitized;
}

function inferExtension(mimeType?: string): string | null {
  if (!mimeType) {
    return null;
  }
  const map: Record<string, string> = {
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
    'image/gif': 'gif',
  };
  const normalized = mimeType.toLowerCase();
  if (map[normalized]) {
    return map[normalized];
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

function shardedBlobPath(cliConfig: CliConfig, movieId: string, hash: string, mimeType?: string): string {
  const fileName = formatBlobFileName(hash, mimeType);
  const base = resolve(cliConfig.storage.root, cliConfig.storage.basePath, movieId, 'blobs');
  return resolve(base, hash.slice(0, 2), fileName);
}

async function ensureSymlink(target: string, linkPath: string, options: { overwrite?: boolean } = {}): Promise<void> {
  const exists = await pathExists(linkPath);
  if (exists && !options.overwrite) {
    return;
  }
  try {
    await rm(linkPath, { force: true });
  } catch {
    // noop
  }
  await mkdir(dirname(linkPath), { recursive: true });
  await symlink(target, linkPath);
}

async function hashFile(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function persistBlobSharded(
  data: Buffer,
  mimeType: string | undefined,
  cliConfig: CliConfig,
  movieId: string,
): Promise<BlobRef> {
  const hash = createHash('sha256').update(data).digest('hex');
  const destination = shardedBlobPath(cliConfig, movieId, hash, mimeType);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, data);
  return { hash, size: data.byteLength, mimeType: mimeType ?? 'application/octet-stream' };
}

function formatBlobFileName(hash: string, mimeType?: string): string {
  const extension = inferBlobExtension(mimeType);
  if (!extension) {
    return hash;
  }
  if (hash.endsWith(`.${extension}`)) {
    return hash;
  }
  return `${hash}.${extension}`;
}

function inferBlobExtension(mimeType?: string): string | null {
  if (!mimeType) {
    return null;
  }
  const map: Record<string, string> = {
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
    'image/gif': 'gif',
    'text/plain': 'txt',
    'application/json': 'json',
  };
  const normalized = mimeType.toLowerCase();
  if (map[normalized]) {
    return map[normalized];
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
/* eslint-disable no-console */
