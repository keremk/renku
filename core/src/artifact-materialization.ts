import { copyFile, lstat, mkdir, rm, symlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Console } from 'node:console';
import { formatBlobFileName, inferBlobExtension } from './blob-utils.js';
import {
  isCanonicalArtifactId,
  isCanonicalProducerId,
  parseCanonicalArtifactId,
  parseCanonicalProducerId,
} from './canonical-ids.js';
import type { MovieMetadataService } from './movie-metadata.js';
import type { BuildState } from './types.js';
import type { ArtifactMaterializationMode } from './workspace.js';

export interface MaterializedArtifactInfo {
  artifactId: string;
  artifactPath: string;
  sourcePath: string;
  hash: string;
  producedBy: string;
  mimeType?: string;
}

export interface MaterializeBuildStateArtifactsResult {
  artifactsRoot: string;
  artifacts: MaterializedArtifactInfo[];
}

export interface MaterializeBuildStateArtifactsOptions {
  storageRoot: string;
  storageBasePath: string;
  movieId: string;
  artifactsMovieFolderName: string;
  buildState: BuildState;
  manifest?: BuildState;
  mode: ArtifactMaterializationMode;
  logger?: Pick<Console, 'warn'>;
}

export async function materializeBuildStateArtifacts(
  options: MaterializeBuildStateArtifactsOptions
): Promise<MaterializeBuildStateArtifactsResult> {
  const buildState = options.buildState ?? options.manifest;
  const artifactsRoot = resolveArtifactsMovieRoot(
    options.storageRoot,
    options.storageBasePath,
    options.artifactsMovieFolderName
  );

  await rm(artifactsRoot, { recursive: true, force: true });
  await mkdir(artifactsRoot, { recursive: true });

  const artifacts: MaterializedArtifactInfo[] = [];
  for (const [artifactId, entry] of Object.entries(
    buildState.artifacts
  )) {
    if (!entry.blob) {
      continue;
    }

    const artifactName = toArtifactFileName(artifactId, entry.blob.mimeType);
    const producerFolder = producerFolderNameFromCanonicalProducerId(
      entry.producedBy
    );
    const artifactPath = resolve(artifactsRoot, producerFolder, artifactName);
    await mkdir(dirname(artifactPath), { recursive: true });

    const sourcePath = resolveBlobPath({
      storageRoot: options.storageRoot,
      storageBasePath: options.storageBasePath,
      movieId: options.movieId,
      hash: entry.blob.hash,
      mimeType: entry.blob.mimeType,
    });

    if (!(await pathExists(sourcePath))) {
      options.logger?.warn?.(
        `Warning: blob missing for ${artifactId} at ${sourcePath}. Artifact output not materialized.`
      );
      continue;
    }

    await materializeArtifactFile({
      sourcePath,
      targetPath: artifactPath,
      mode: options.mode,
    });

    artifacts.push({
      artifactId,
      artifactPath,
      sourcePath,
      hash: entry.hash,
      producedBy: entry.producedBy,
      mimeType: entry.blob.mimeType,
    });
  }

  return { artifactsRoot, artifacts };
}

export const materializeManifestArtifacts = materializeBuildStateArtifacts;

export async function materializeArtifactFile(args: {
  sourcePath: string;
  targetPath: string;
  mode: ArtifactMaterializationMode;
}): Promise<void> {
  await rm(args.targetPath, { force: true });
  await mkdir(dirname(args.targetPath), { recursive: true });

  if (args.mode === 'copy') {
    await copyFile(args.sourcePath, args.targetPath);
    return;
  }

  await symlink(args.sourcePath, args.targetPath);
}

export async function resolveArtifactsMovieFolderName(args: {
  movieId: string;
  metadataService: MovieMetadataService;
}): Promise<string> {
  const metadata = await args.metadataService.read(args.movieId);
  if (metadata?.artifactFolderName && metadata.artifactFolderName.length > 0) {
    return metadata.artifactFolderName;
  }

  const folderName = deriveArtifactsMovieFolderName({
    movieId: args.movieId,
    displayName: metadata?.displayName,
  });

  await args.metadataService.merge(args.movieId, {
    artifactFolderName: folderName,
  });
  return folderName;
}

export function deriveArtifactsMovieFolderName(args: {
  movieId: string;
  displayName?: string;
}): string {
  if (!args.displayName || args.displayName.trim().length === 0) {
    return args.movieId;
  }

  const normalized = toKebabCase(args.displayName);
  if (normalized.length === 0) {
    return args.movieId;
  }

  return `${normalized}-${args.movieId}`;
}

export function resolveArtifactsBaseRoot(
  storageRoot: string,
  storageBasePath: string
): string {
  const buildsFolder = resolve(storageRoot, storageBasePath);
  return resolve(buildsFolder, '..', 'artifacts');
}

export function resolveArtifactsMovieRoot(
  storageRoot: string,
  storageBasePath: string,
  artifactsMovieFolderName: string
): string {
  return resolve(
    resolveArtifactsBaseRoot(storageRoot, storageBasePath),
    artifactsMovieFolderName
  );
}

export function resolveExpectedArtifactPath(args: {
  storageRoot: string;
  storageBasePath: string;
  artifactsMovieFolderName: string;
  artifactId: string;
  producedBy: string;
  mimeType?: string;
}): string {
  const artifactName = toArtifactFileName(args.artifactId, args.mimeType);
  const producerFolder = producerFolderNameFromCanonicalProducerId(
    args.producedBy
  );
  return resolve(
    resolveArtifactsMovieRoot(
      args.storageRoot,
      args.storageBasePath,
      args.artifactsMovieFolderName
    ),
    producerFolder,
    artifactName
  );
}

export function producerFolderNameFromProducerName(
  producerName: string
): string {
  const normalized = toKebabCase(stripDimensionTokens(producerName));
  if (!normalized) {
    throw new Error(
      `Unable to derive producer folder name from "${producerName}".`
    );
  }
  return normalized;
}

function producerFolderNameFromCanonicalProducerId(producedBy: string): string {
  if (!isCanonicalProducerId(producedBy)) {
    throw new Error(
      `Expected canonical Producer ID (Producer:...), got "${producedBy}".`
    );
  }
  const parsed = parseCanonicalProducerId(producedBy);
  const segments = [...parsed.path, parsed.name].map((segment) =>
    stripDimensionTokens(segment)
  );
  const normalized = toKebabCase(segments.join('-'));
  if (!normalized) {
    throw new Error(
      `Unable to derive producer folder name from "${producedBy}".`
    );
  }
  return normalized;
}

function toArtifactFileName(artifactId: string, mimeType?: string): string {
  if (!isCanonicalArtifactId(artifactId)) {
    throw new Error(
      `Expected canonical Artifact ID (Artifact:...), got "${artifactId}".`
    );
  }

  const parsed = parseCanonicalArtifactId(artifactId);
  const baseName = toKebabCase(parsed.name);
  if (!baseName) {
    throw new Error(
      `Unable to derive artifact name from artifact id "${artifactId}".`
    );
  }

  const nameWithIndices =
    parsed.indices.length > 0
      ? `${baseName}-${parsed.indices.join('-')}`
      : baseName;
  const ext = inferBlobExtension(mimeType);
  return ext ? `${nameWithIndices}.${ext}` : nameWithIndices;
}

function resolveBlobPath(args: {
  storageRoot: string;
  storageBasePath: string;
  movieId: string;
  hash: string;
  mimeType?: string;
}): string {
  const fileName = formatBlobFileName(args.hash, args.mimeType);
  const base = resolve(
    args.storageRoot,
    args.storageBasePath,
    args.movieId,
    'blobs'
  );
  return resolve(base, args.hash.slice(0, 2), fileName);
}

function stripDimensionTokens(segment: string): string {
  return segment.replace(/\[[^\]]+\]/g, '');
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_.\s]+/g, '-')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}
