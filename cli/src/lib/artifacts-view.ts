import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createManifestService,
  createStorageContext,
  isCanonicalArtifactId,
  isCanonicalProducerId,
  parseCanonicalArtifactId,
  parseCanonicalProducerId,
  type BlobRef,
  type Manifest,
} from '@gorenku/core';
import type { PendingArtefactDraft } from './planner.js';
import type { CliConfig } from './cli-config.js';

const log = globalThis.console;

interface ArtifactInfo {
  artefactId: string;
  artifactPath: string;
  sourcePath: string;
  hash: string;
  producedBy: string;
  mimeType?: string;
  kind: 'blob';
}

export interface ArtifactsViewContext {
  artifactsRoot: string;
  artefacts: ArtifactInfo[];
  inputsPath: string;
}

export interface ArtifactsPreflightResult {
  pendingArtefacts: PendingArtefactDraft[];
  changed: boolean;
  artifacts: ArtifactsViewContext;
}

export async function loadCurrentManifest(cliConfig: CliConfig, movieId: string): Promise<{ manifest: Manifest; hash: string | null }>
{
  const storage = createStorageContext({ kind: 'local', rootDir: cliConfig.storage.root, basePath: cliConfig.storage.basePath });
  const manifestService = createManifestService(storage);
  return manifestService.loadCurrent(movieId);
}

export async function buildArtifactsView(args: {
  cliConfig: CliConfig;
  movieId: string;
  manifest: Manifest;
}): Promise<ArtifactsViewContext> {
  const { cliConfig, movieId, manifest } = args;
  const artifactsRoot = resolve(cliConfig.storage.root, 'artifacts', movieId);
  await rm(artifactsRoot, { recursive: true, force: true });
  await mkdir(artifactsRoot, { recursive: true });

  const inputsPath = resolve(cliConfig.storage.root, cliConfig.storage.basePath, movieId, 'inputs.yaml');

  const artefacts: ArtifactInfo[] = [];
  for (const [artefactId, entry] of Object.entries(manifest.artefacts)) {
    const artifactName = toArtifactFileName(artefactId, entry.blob?.mimeType);
    const producer = normalizeProducer(entry.producedBy);
    const artifactPath = resolve(artifactsRoot, producer, artifactName);
    await mkdir(dirname(artifactPath), { recursive: true });

    if (!entry.blob) {
      continue;
    }

    const shardedPath = shardedBlobPath(cliConfig, movieId, entry.blob.hash, entry.blob.mimeType);
    if (!(await pathExists(shardedPath))) {
      log.warn(
        `Warning: blob missing for ${artefactId} at ${shardedPath}. Artifact link not created.`,
      );
      continue;
    }
    await ensureSymlink(shardedPath, artifactPath, { overwrite: true });
    artefacts.push({
      artefactId,
      artifactPath,
      sourcePath: shardedPath,
      hash: entry.hash,
      producedBy: entry.producedBy,
      mimeType: entry.blob.mimeType,
      kind: 'blob',
    });
  }

  return { artifactsRoot, artefacts, inputsPath };
}

export async function prepareArtifactsPreflight(args: {
  cliConfig: CliConfig;
  movieId: string;
  manifest: Manifest;
  allowShardedBlobs?: boolean;
}): Promise<ArtifactsPreflightResult> {
  const artifacts = await collectArtifactsContext(args);
  const pending: PendingArtefactDraft[] = [];
  let changed = false;

  for (const entry of artifacts.artefacts) {
    const nextHash = await hashFile(entry.artifactPath);
    if (nextHash === entry.hash) {
      continue;
    }
    changed = true;

    const buffer = await readFile(entry.artifactPath);
    const blobRef = await persistBlobSharded(buffer, entry.mimeType, args.cliConfig, args.movieId);

    const shardedPath = shardedBlobPath(args.cliConfig, args.movieId, blobRef.hash, blobRef.mimeType);
    await ensureSymlink(shardedPath, entry.artifactPath, { overwrite: true });

    pending.push({
      artefactId: entry.artefactId,
      producedBy: entry.producedBy,
      output: { blob: blobRef },
      diagnostics: { source: 'artifact-edit' },
    });
  }

  return { pendingArtefacts: pending, changed, artifacts };
}

async function collectArtifactsContext(args: {
  cliConfig: CliConfig;
  movieId: string;
  manifest: Manifest;
  allowShardedBlobs?: boolean;
}): Promise<ArtifactsViewContext> {
  const { cliConfig, movieId, manifest } = args;
  const artifactsRoot = resolve(cliConfig.storage.root, 'artifacts', movieId);
  await mkdir(artifactsRoot, { recursive: true });

  const inputsPath = resolve(cliConfig.storage.root, cliConfig.storage.basePath, movieId, 'inputs.yaml');

  const artefacts: ArtifactInfo[] = [];
  for (const [artefactId, entry] of Object.entries(manifest.artefacts)) {
    const artifactName = toArtifactFileName(artefactId, entry.blob?.mimeType);
    const producer = normalizeProducer(entry.producedBy);
    const artifactPath = resolve(artifactsRoot, producer, artifactName);

    await mkdir(dirname(artifactPath), { recursive: true });

    if (!entry.blob) {
      continue;
    }

    const shardedPath = shardedBlobPath(cliConfig, movieId, entry.blob.hash, entry.blob.mimeType);
    if (!(await pathExists(shardedPath))) {
      log.warn(
        `Warning: blob missing for ${artefactId} at ${shardedPath}. Artifact link not created.`,
      );
      continue;
    }
    await ensureSymlink(shardedPath, artifactPath, { overwrite: true });
    artefacts.push({
      artefactId,
      artifactPath,
      sourcePath: shardedPath,
      hash: entry.hash,
      producedBy: entry.producedBy,
      mimeType: entry.blob.mimeType,
      kind: 'blob',
    });
  }

  return { artifactsRoot, artefacts, inputsPath };
}

function normalizeProducer(producedBy: string | undefined): string {
  if (!producedBy) {
    throw new Error('Artifact missing producedBy information - this is a bug');
  }
  if (!isCanonicalProducerId(producedBy)) {
    throw new Error(`Expected canonical Producer ID (Producer:...), got "${producedBy}".`);
  }
  const parsed = parseCanonicalProducerId(producedBy);
  const segments = [...parsed.path, parsed.name].map((segment) => stripDimensionTokens(segment));
  const normalized = toKebabCase(segments.join('-'));
  if (!normalized) {
    throw new Error(`Unable to derive producer folder name from "${producedBy}".`);
  }
  return normalized;
}

function toArtifactFileName(artefactId: string, mimeType?: string): string {
  if (isCanonicalArtifactId(artefactId)) {
    const parsed = parseCanonicalArtifactId(artefactId);
    const baseName = toKebabCase(parsed.name);
    if (!baseName) {
      throw new Error(`Unable to derive artifact name from artifact id "${artefactId}".`);
    }
    const nameWithIndices = parsed.indices.length > 0
      ? `${baseName}-${parsed.indices.join('-')}`
      : baseName;
    const ext = inferExtension(mimeType);
    return ext ? `${nameWithIndices}.${ext}` : nameWithIndices;
  }
  throw new Error(`Expected canonical Artifact ID (Artifact:...), got "${artefactId}".`);
}

function stripDimensionTokens(segment: string): string {
  return segment.replace(/\[[^\]]+\]/g, '');
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
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
