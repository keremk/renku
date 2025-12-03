import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createManifestService,
  createStorageContext,
  ManifestNotFoundError,
  type BlobRef,
  type Manifest,
} from '@renku/core';
import type { CliConfig } from './cli-config.js';
import { mergeMovieMetadata, readMovieMetadata } from './movie-metadata.js';
import { INPUT_FILE_NAME, WORKSPACE_INPUTS_RELATIVE_PATH } from './input-files.js';

const console = globalThis.console;

export interface WorkspaceState {
  movieId: string;
  storageMovieId: string;
  manifestRevision: string;
  manifestHash: string | null;
  blueprintPath?: string;
  inputs: {
    file: string;
    hash: string;
  };
  artefacts: WorkspaceArtefactEntry[];
  exportedAt: string;
}

export interface WorkspaceArtefactEntry {
  id: string;
  file: string;
  hash: string;
  kind: 'blob';
  mimeType?: string;
  producedBy: string;
  blob?: BlobRef;
}

export interface WorkspaceExportResult {
  workspaceDir: string;
  state: WorkspaceState;
}

export interface WorkspaceDiffResult {
  inputsChanged: boolean;
  artefacts: WorkspaceArtefactChange[];
}

export interface WorkspaceArtefactChange {
  entry: WorkspaceArtefactEntry;
  nextHash: string;
  absolutePath: string;
  kind: 'blob';
  mimeType?: string;
}

const WORKSPACES_DIR = 'workspaces';
const WORKSPACE_STATE_FILE = 'workspace-state.json';
const BLUEPRINT_COPY_RELATIVE_PATH = 'config/blueprint.toml';

export async function exportWorkspace(args: {
  cliConfig: CliConfig;
  movieId: string;
  blueprintOverride?: string;
}): Promise<WorkspaceExportResult> {
  const { cliConfig, movieId, blueprintOverride } = args;
  const storageRoot = cliConfig.storage.root;
  const storageBase = cliConfig.storage.basePath;
  const movieDir = resolve(storageRoot, storageBase, movieId);

  const workspaceDir = resolve(storageRoot, WORKSPACES_DIR, movieId);
  await prepareWorkspaceDirs(workspaceDir);

  const storageContext = createStorageContext({
    kind: 'local',
    rootDir: storageRoot,
    basePath: storageBase,
  });
  const manifestService = createManifestService(storageContext);
  let manifestHash: string | null = null;
  let manifest;
  try {
    const result = await manifestService.loadCurrent(movieId);
    manifest = result.manifest;
    manifestHash = result.hash;
  } catch (error) {
    if (error instanceof ManifestNotFoundError) {
      throw new Error(`No manifest found for movie ${movieId}. Run "renku query" first.`);
    }
    throw error;
  }

  const metadata = (await readMovieMetadata(movieDir)) ?? {};
  const blueprintPath = blueprintOverride ?? metadata.blueprintPath;

  if (!blueprintPath) {
    console.warn('Warning: Could not locate blueprint path. Provide --blueprint when exporting.');
  } else {
    await copyBlueprintFile(blueprintPath, workspaceDir);
  }

  const inputsSrc = resolve(movieDir, INPUT_FILE_NAME);
  const inputsDest = resolve(workspaceDir, WORKSPACE_INPUTS_RELATIVE_PATH);
  await mkdir(dirname(inputsDest), { recursive: true });
  await copyFile(inputsSrc, inputsDest);
  const inputsHash = await hashFile(inputsDest);

  const artefactEntries = await copyArtefactsToWorkspace({
    workspaceDir,
    storageRoot,
    storageBase,
    movieId,
    manifest,
  });

  const state: WorkspaceState = {
    movieId,
    storageMovieId: movieId,
    manifestRevision: manifest.revision,
    manifestHash,
    blueprintPath,
    inputs: {
      file: WORKSPACE_INPUTS_RELATIVE_PATH,
      hash: inputsHash,
    },
    artefacts: artefactEntries,
    exportedAt: new Date().toISOString(),
  };

  await writeWorkspaceState(workspaceDir, state);
  await mergeMovieMetadata(movieDir, {
    workspace: { lastExportedAt: state.exportedAt },
  });

  return { workspaceDir, state };
}

export async function readWorkspaceState(workspaceDir: string): Promise<WorkspaceState> {
  const targetPath = resolve(workspaceDir, WORKSPACE_STATE_FILE);
  const contents = await readFile(targetPath, 'utf8');
  return JSON.parse(contents) as WorkspaceState;
}

export async function diffWorkspace(state: WorkspaceState, workspaceDir: string): Promise<WorkspaceDiffResult> {
  const inputsPath = resolve(workspaceDir, state.inputs.file);
  const nextInputsHash = await hashFile(inputsPath);
  const inputsChanged = nextInputsHash !== state.inputs.hash;

  const artefactChanges: WorkspaceArtefactChange[] = [];
  for (const entry of state.artefacts) {
    const absolutePath = resolve(workspaceDir, entry.file);
    const { nextHash } = await hashArtefactFile(entry, absolutePath);
    if (nextHash !== entry.hash) {
      artefactChanges.push({
        entry,
        nextHash,
        absolutePath,
        kind: entry.kind,
        mimeType: entry.mimeType,
      });
    }
  }

  return {
    inputsChanged,
    artefacts: artefactChanges,
  };
}

export async function writeWorkspaceState(workspaceDir: string, state: WorkspaceState): Promise<void> {
  const targetPath = resolve(workspaceDir, WORKSPACE_STATE_FILE);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(state, null, 2), 'utf8');
}

async function prepareWorkspaceDirs(workspaceDir: string): Promise<void> {
  await mkdir(workspaceDir, { recursive: true });
  await rm(resolve(workspaceDir, 'artefacts'), { recursive: true, force: true });
  await rm(resolve(workspaceDir, 'inputs'), { recursive: true, force: true });
  await rm(resolve(workspaceDir, 'prompts'), { recursive: true, force: true });
  await rm(resolve(workspaceDir, 'config'), { recursive: true, force: true });
}

async function copyBlueprintFile(sourcePath: string, workspaceDir: string): Promise<void> {
  try {
    const absolute = resolve(sourcePath);
    const dest = resolve(workspaceDir, BLUEPRINT_COPY_RELATIVE_PATH);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(absolute, dest);
  } catch (error) {
    console.warn(`Warning: Unable to copy blueprint file (${sourcePath}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function copyArtefactsToWorkspace(args: {
  workspaceDir: string;
  storageRoot: string;
  storageBase: string;
  movieId: string;
  manifest: Manifest;
}): Promise<WorkspaceArtefactEntry[]> {
  const { workspaceDir, storageRoot, storageBase, movieId, manifest } = args;
  const artefactsDir = resolve(workspaceDir, 'artefacts');
  await mkdir(artefactsDir, { recursive: true });

  const entries: WorkspaceArtefactEntry[] = [];

  for (const [artefactId, record] of Object.entries(manifest.artefacts)) {
    const friendlyName = toFriendlyFileName(artefactId, record.blob?.mimeType);
    const destination = resolve(artefactsDir, friendlyName);

    if (!record.blob) {
      throw new Error(`Artefact ${artefactId} is missing blob metadata; inline artefacts are not supported.`);
    }

    const prefix = record.blob.hash.slice(0, 2);
    const blobAbsolute = resolve(
      storageRoot,
      storageBase,
      movieId,
      'blobs',
      prefix,
      formatBlobFileName(record.blob.hash, record.blob.mimeType),
    );
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(blobAbsolute, destination);
    entries.push({
      id: artefactId,
      file: `artefacts/${friendlyName}`,
      hash: record.hash,
      kind: 'blob',
      mimeType: record.blob.mimeType,
      producedBy: record.producedBy,
      blob: record.blob,
    });
  }

  return entries;
}

async function hashFile(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

async function hashArtefactFile(entry: WorkspaceArtefactEntry, absolutePath: string): Promise<{ nextHash: string }> {
  if (!entry.blob) {
    throw new Error(`Artefact ${entry.id} is missing blob metadata; inline artefacts are not supported.`);
  }
  const buffer =
    entry.mimeType && entry.mimeType.startsWith('text/')
      ? Buffer.from(await readFile(absolutePath, 'utf8'), 'utf8')
      : await readFile(absolutePath);
  const nextHash = createHash('sha256').update(buffer).digest('hex');
  return { nextHash };
}

export async function persistWorkspaceBlob(args: {
  cliConfig: CliConfig;
  movieId: string;
  data: Buffer;
  mimeType?: string;
}): Promise<BlobRef> {
  const { cliConfig, movieId, data, mimeType } = args;
  const hash = createHash('sha256').update(data).digest('hex');
  const prefix = hash.slice(0, 2);
  const fileName = formatBlobFileName(hash, mimeType);
  const absolutePath = resolve(
    cliConfig.storage.root,
    cliConfig.storage.basePath,
    movieId,
    'blobs',
    prefix,
    fileName,
  );
  await mkdir(dirname(absolutePath), { recursive: true });
  if (!(await fileExists(absolutePath))) {
    await writeFile(absolutePath, data);
  }
  return {
    hash,
    size: data.byteLength,
    mimeType: mimeType ?? 'application/octet-stream',
  };
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function toFriendlyFileName(artefactId: string, mimeType?: string): string {
  const base = artefactId
    .replace(/^Artifact:/, '')
    .replace(/\[/g, '-')
    .replace(/\]/g, '')
    .replace(/[:=]/g, '-')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/--+/g, '-')
    .toLowerCase();
  const extension = inferExtension(mimeType);
  return extension ? `${base}.${extension}` : base;
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

export function formatBlobFileName(hash: string, mimeType?: string): string {
  const extension = inferExtension(mimeType);
  if (!extension) {
    return hash;
  }
  if (hash.endsWith(`.${extension}`)) {
    return hash;
  }
  return `${hash}.${extension}`;
}
