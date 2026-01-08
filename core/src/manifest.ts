import { createHash } from 'node:crypto';
import { FileStorage } from '@flystorage/file-storage';
import { createEventLog } from './event-log.js';
import type { EventLog } from './event-log.js';
import type { StorageContext } from './storage.js';
import type {
  ArtefactEvent,
  Clock,
  Manifest,
  ManifestPointer,
  ManifestArtefactEntry,
  ManifestInputEntry,
  RevisionId,
} from './types.js';
import { hashPayload } from './hashing.js';
import { RuntimeErrorCode, createRuntimeError, type RenkuError, type ErrorCategory, type ErrorSeverity } from './errors/index.js';

export class ManifestNotFoundError extends Error implements RenkuError {
  code = RuntimeErrorCode.MANIFEST_NOT_FOUND;
  category: ErrorCategory = 'runtime';
  severity: ErrorSeverity = 'error';

  constructor(movieId: string) {
    super(`No manifest found for movie "${movieId}"`);
    this.name = 'ManifestNotFoundError';
  }
}

export class ManifestConflictError extends Error implements RenkuError {
  code = RuntimeErrorCode.MANIFEST_HASH_CONFLICT;
  category: ErrorCategory = 'runtime';
  severity: ErrorSeverity = 'error';

  constructor(expected: string | null, actual: string | null) {
    super(
      `Manifest pointer hash mismatch (expected ${expected ?? 'null'}, found ${actual ?? 'null'})`,
    );
    this.name = 'ManifestConflictError';
  }
}

/* eslint-disable no-unused-vars */
export interface ManifestService {
  loadCurrent(
    movieId: string,
    deps?: { storage?: StorageContext },
  ): Promise<{ manifest: Manifest; hash: string }>;
  saveManifest(
    manifest: Manifest,
    deps: {
      movieId: string;
      previousHash: string | null;
      clock: Clock;
      storage?: StorageContext;
    },
  ): Promise<{ hash: string }>;
  buildFromEvents(args: {
    movieId: string;
    targetRevision: RevisionId;
    baseRevision?: RevisionId | null;
    eventLog?: EventLog;
    clock?: Clock;
  }): Promise<Manifest>;
}

export function createManifestService(storage: StorageContext): ManifestService {
  const manifestEventLog = createEventLog(storage);

  return {
    async loadCurrent(movieId) {
      const pointer = await readPointer(storage, movieId);
      if (!pointer.manifestPath || !pointer.revision || !pointer.hash) {
        throw new ManifestNotFoundError(movieId);
      }
      const manifestPath = storage.resolve(movieId, pointer.manifestPath);
      if (!(await storage.storage.fileExists(manifestPath))) {
        throw new ManifestNotFoundError(movieId);
      }
      const raw = await storage.storage.readToString(manifestPath);
      const manifest = JSON.parse(raw) as Manifest;
      const hash = hashManifest(raw);
      if (hash !== pointer.hash) {
        throw new ManifestConflictError(pointer.hash, hash);
      }
      return { manifest, hash };
    },

    async saveManifest(manifest, { movieId, previousHash, clock }) {
      const pointer = await readPointer(storage, movieId);
      if ((pointer.hash ?? null) !== (previousHash ?? null)) {
        throw new ManifestConflictError(previousHash ?? null, pointer.hash ?? null);
      }

      const manifestRelativePath = `manifests/${manifest.revision}.json`;
      const manifestPath = storage.resolve(movieId, manifestRelativePath);
      await ensureParentDirectories(storage.storage, manifestPath);

      const json = JSON.stringify(manifest, null, 2);
      await writeFileAtomic(storage.storage, manifestPath, json, 'application/json');

      const hash = hashManifest(json);
      const updatedPointer: ManifestPointer = {
        revision: manifest.revision,
        manifestPath: manifestRelativePath,
        hash,
        updatedAt: clock.now(),
      };

      await writePointer(storage, movieId, updatedPointer);
      return { hash };
    },

    async buildFromEvents({
      movieId,
      targetRevision,
      baseRevision = null,
      eventLog = manifestEventLog,
      clock,
    }) {
      const inputs = await collectLatestInputs(eventLog, movieId);
      const artefacts = await collectLatestArtefacts(eventLog, movieId);
      const createdAt = clock?.now() ?? new Date().toISOString();
      return {
        revision: targetRevision,
        baseRevision,
        createdAt,
        inputs,
        artefacts,
        timeline: {},
      };
    },
  };
}

async function readPointer(storage: StorageContext, movieId: string): Promise<ManifestPointer> {
  const pointerPath = storage.resolve(movieId, 'current.json');
  if (!(await storage.storage.fileExists(pointerPath))) {
    return emptyPointer();
  }
  const raw = await storage.storage.readToString(pointerPath);
  try {
    const pointer = JSON.parse(raw) as Partial<ManifestPointer>;
    return {
      revision: pointer.revision ?? null,
      manifestPath: pointer.manifestPath ?? null,
      hash: pointer.hash ?? null,
      updatedAt: pointer.updatedAt ?? null,
    };
  } catch {
    throw createRuntimeError(
      RuntimeErrorCode.CORRUPTED_POINTER_FILE,
      `Manifest pointer file is corrupted: ${pointerPath}. ` +
        `Please delete this file to reset the manifest state.`,
      { filePath: pointerPath },
    );
  }
}

async function writePointer(
  storage: StorageContext,
  movieId: string,
  pointer: ManifestPointer,
): Promise<void> {
  const pointerPath = storage.resolve(movieId, 'current.json');
  const json = JSON.stringify(pointer, null, 2);
  await writeFileAtomic(storage.storage, pointerPath, json, 'application/json');
}

async function ensureParentDirectories(storage: FileStorage, targetPath: string): Promise<void> {
  const segments = targetPath.split('/').slice(0, -1);
  if (!segments.length) {
    return;
  }
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!(await storage.directoryExists(current))) {
      await storage.createDirectory(current, {});
    }
  }
}

async function writeFileAtomic(
  storage: FileStorage,
  targetPath: string,
  data: string,
  mimeType: string,
): Promise<void> {
  const tmpPath = `${targetPath}.tmp-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  await storage.write(tmpPath, data, { mimeType });
  await storage.moveFile(tmpPath, targetPath);
}

function hashManifest(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function emptyPointer(): ManifestPointer {
  return {
    revision: null,
    manifestPath: null,
    hash: null,
    updatedAt: null,
  };
}

async function collectLatestInputs(eventLog: EventLog, movieId: string): Promise<Record<string, ManifestInputEntry>> {
  const latest = new Map<string, ManifestInputEntry>();
  for await (const event of eventLog.streamInputs(movieId)) {
    latest.set(event.id, {
      hash: event.hash,
      payloadDigest: hashPayload(event.payload).canonical,
      createdAt: event.createdAt,
    });
  }
  return Object.fromEntries(latest.entries());
}

async function collectLatestArtefacts(
  eventLog: EventLog,
  movieId: string,
): Promise<Record<string, ManifestArtefactEntry>> {
  const latest = new Map<string, ManifestArtefactEntry>();
  for await (const event of eventLog.streamArtefacts(movieId)) {
    if (event.status !== 'succeeded') {
      continue;
    }
    latest.set(event.artefactId, {
      hash: deriveArtefactHash(event),
      blob: event.output.blob,
      producedBy: event.producedBy,
      status: event.status,
      diagnostics: event.diagnostics,
      createdAt: event.createdAt,
    });
  }
  return Object.fromEntries(latest.entries());
}

export function deriveArtefactHash(event: ArtefactEvent): string {
  if (event.output.blob?.hash) {
    return event.output.blob.hash;
  }
  return hashPayload({
    artefactId: event.artefactId,
    revision: event.revision,
  }).hash;
}
