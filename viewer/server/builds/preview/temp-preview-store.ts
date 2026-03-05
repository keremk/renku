import { randomBytes } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { inferExtension } from '../../shared/stream-utils.js';

const TEMP_PREVIEW_NAMESPACE = 'image-edit-previews';
const TEMP_PREVIEW_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const TEMP_ID_PATTERN = /^[a-z0-9-]+$/;

export interface TempPreviewMetadata {
  tempId: string;
  artifactId: string;
  mimeType: string;
  size: number;
  fileName: string;
  createdAt: string;
}

export interface TempPreviewRecord {
  metadata: TempPreviewMetadata;
  filePath: string;
}

function getTempPreviewDir(blueprintFolder: string, movieId: string): string {
  return path.join(
    blueprintFolder,
    'builds',
    movieId,
    'temp',
    TEMP_PREVIEW_NAMESPACE
  );
}

function getTempMetadataPath(
  blueprintFolder: string,
  movieId: string,
  tempId: string
): string {
  return path.join(
    getTempPreviewDir(blueprintFolder, movieId),
    `${tempId}.json`
  );
}

function assertSafeTempPath(filePath: string, blueprintFolder: string): void {
  const resolvedFile = path.resolve(filePath);
  const resolvedRoot = path.resolve(blueprintFolder);
  if (
    !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`) &&
    resolvedFile !== resolvedRoot
  ) {
    throw new Error('Invalid temporary preview path.');
  }
}

function validateTempId(tempId: string): void {
  if (!TEMP_ID_PATTERN.test(tempId)) {
    throw new Error(`Invalid temp preview id: ${tempId}`);
  }
}

function createTempId(): string {
  return `tmp-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
}

export async function createTempPreview(
  blueprintFolder: string,
  movieId: string,
  artifactId: string,
  data: Buffer,
  mimeType: string
): Promise<TempPreviewRecord> {
  const tempDir = getTempPreviewDir(blueprintFolder, movieId);
  assertSafeTempPath(tempDir, blueprintFolder);

  await fs.mkdir(tempDir, { recursive: true });

  const tempId = createTempId();
  const extension = inferExtension(mimeType);
  const fileName = extension ? `${tempId}.${extension}` : tempId;
  const filePath = path.join(tempDir, fileName);
  const metadataPath = getTempMetadataPath(blueprintFolder, movieId, tempId);

  assertSafeTempPath(filePath, blueprintFolder);
  assertSafeTempPath(metadataPath, blueprintFolder);

  const metadata: TempPreviewMetadata = {
    tempId,
    artifactId,
    mimeType,
    size: data.byteLength,
    fileName,
    createdAt: new Date().toISOString(),
  };

  await fs.writeFile(filePath, data);
  await fs.writeFile(metadataPath, JSON.stringify(metadata), 'utf8');

  return { metadata, filePath };
}

export async function readTempPreview(
  blueprintFolder: string,
  movieId: string,
  tempId: string
): Promise<TempPreviewRecord> {
  validateTempId(tempId);

  const metadataPath = getTempMetadataPath(blueprintFolder, movieId, tempId);
  assertSafeTempPath(metadataPath, blueprintFolder);

  if (!existsSync(metadataPath)) {
    throw new Error(`Preview ${tempId} not found.`);
  }

  const raw = await fs.readFile(metadataPath, 'utf8');
  const parsed = JSON.parse(raw) as TempPreviewMetadata;
  if (!parsed.fileName || !parsed.mimeType) {
    throw new Error(`Preview ${tempId} metadata is invalid.`);
  }

  const filePath = path.join(
    getTempPreviewDir(blueprintFolder, movieId),
    parsed.fileName
  );
  assertSafeTempPath(filePath, blueprintFolder);
  if (!existsSync(filePath)) {
    throw new Error(`Preview file for ${tempId} not found.`);
  }

  return { metadata: parsed, filePath };
}

export async function deleteTempPreview(
  blueprintFolder: string,
  movieId: string,
  tempId: string
): Promise<void> {
  validateTempId(tempId);

  const metadataPath = getTempMetadataPath(blueprintFolder, movieId, tempId);
  assertSafeTempPath(metadataPath, blueprintFolder);

  if (!existsSync(metadataPath)) {
    return;
  }

  const raw = await fs.readFile(metadataPath, 'utf8');
  const parsed = JSON.parse(raw) as TempPreviewMetadata;
  const filePath = path.join(
    getTempPreviewDir(blueprintFolder, movieId),
    parsed.fileName
  );
  assertSafeTempPath(filePath, blueprintFolder);

  await fs.rm(metadataPath, { force: true });
  await fs.rm(filePath, { force: true });
}

export async function cleanupStaleTempPreviews(
  blueprintFolder: string,
  movieId: string
): Promise<void> {
  const tempDir = getTempPreviewDir(blueprintFolder, movieId);
  assertSafeTempPath(tempDir, blueprintFolder);

  if (!existsSync(tempDir)) {
    return;
  }

  const entries = await fs.readdir(tempDir, { withFileTypes: true });
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const metadataPath = path.join(tempDir, entry.name);
    assertSafeTempPath(metadataPath, blueprintFolder);

    try {
      const raw = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(raw) as TempPreviewMetadata;
      const createdAt = new Date(metadata.createdAt).getTime();
      if (!Number.isFinite(createdAt)) {
        continue;
      }
      if (now - createdAt < TEMP_PREVIEW_MAX_AGE_MS) {
        continue;
      }

      if (metadata.tempId && TEMP_ID_PATTERN.test(metadata.tempId)) {
        await deleteTempPreview(blueprintFolder, movieId, metadata.tempId);
      }
    } catch {
      // Ignore stale cleanup failures for malformed files.
    }
  }
}

export function buildPreviewUrl(
  blueprintFolder: string,
  movieId: string,
  tempId: string
): string {
  const url = new URL(
    '/viewer-api/blueprints/builds/artifacts/preview-file',
    'http://viewer.local'
  );
  url.searchParams.set('folder', blueprintFolder);
  url.searchParams.set('movieId', movieId);
  url.searchParams.set('tempId', tempId);
  return `${url.pathname}${url.search}`;
}
