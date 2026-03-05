/**
 * Artifact edit handler for the outputs panel.
 * Handles editing artifacts (replacing content) and restoring originals.
 */

import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import busboy from 'busboy';
import {
  detectRequiredExtractions,
  extractDerivedArtefacts,
} from '@gorenku/providers';

/** Maximum file size for artifact uploads (100MB) */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** MIME type to file extension mapping */
const EXTENSION_MAP: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'text/plain': 'txt',
  'application/json': 'json',
};

const DERIVED_VIDEO_ARTIFACT_BASE_NAMES = new Set([
  'FirstFrame',
  'LastFrame',
  'AudioTrack',
]);

/**
 * Response from artifact edit operation.
 */
export interface ArtifactEditResponse {
  success: boolean;
  newHash: string;
  originalHash?: string;
  editedBy: 'user';
}

/**
 * Response from artifact restore operation.
 */
export interface ArtifactRestoreResponse {
  success: boolean;
  restoredHash: string;
}

/**
 * Request for text artifact edit (JSON body).
 */
export interface TextArtifactEditRequest {
  blueprintFolder: string;
  movieId: string;
  artifactId: string;
  content: string;
  mimeType: string;
}

/**
 * Request for artifact restore (JSON body).
 */
export interface ArtifactRestoreRequest {
  blueprintFolder: string;
  movieId: string;
  artifactId: string;
}

/**
 * ArtefactEvent structure matching core types.
 */
export interface ArtefactEvent {
  artefactId: string;
  revision: string;
  inputsHash: string;
  output: {
    blob?: {
      hash: string;
      size: number;
      mimeType: string;
    };
  };
  status: 'succeeded' | 'failed' | 'skipped';
  producedBy: string;
  diagnostics?: Record<string, unknown>;
  createdAt: string;
  editedBy?: 'producer' | 'user';
  originalHash?: string;
}

/**
 * Get the blobs directory path for a build.
 */
function getBlobsDir(blueprintFolder: string, movieId: string): string {
  return path.join(blueprintFolder, 'builds', movieId, 'blobs');
}

/**
 * Get the events directory path for a build.
 */
function getEventsDir(blueprintFolder: string, movieId: string): string {
  return path.join(blueprintFolder, 'builds', movieId, 'events');
}

/**
 * Get file extension from MIME type.
 */
function getExtensionFromMimeType(mimeType: string): string | null {
  const normalized = mimeType.toLowerCase();
  return EXTENSION_MAP[normalized] ?? null;
}

/**
 * Format blob filename with optional extension.
 */
function formatBlobFileName(hash: string, mimeType?: string): string {
  const ext = mimeType ? getExtensionFromMimeType(mimeType) : null;
  return ext ? `${hash}.${ext}` : hash;
}

/**
 * Validate path is within expected directory (prevents path traversal).
 */
function isPathWithinDirectory(filePath: string, directory: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedDir = path.resolve(directory);
  return (
    resolvedFile.startsWith(resolvedDir + path.sep) ||
    resolvedFile === resolvedDir
  );
}

/**
 * Read the latest artefact event for a specific artifact ID from the event log.
 */
export async function readLatestArtifactEvent(
  blueprintFolder: string,
  movieId: string,
  artifactId: string
): Promise<ArtefactEvent | null> {
  const eventsDir = getEventsDir(blueprintFolder, movieId);
  const logPath = path.join(eventsDir, 'artefacts.log');

  if (!existsSync(logPath)) {
    return null;
  }

  const content = await fs.readFile(logPath, 'utf8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim());

  let latest: ArtefactEvent | null = null;
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as ArtefactEvent;
      if (event.artefactId === artifactId && event.status === 'succeeded') {
        latest = event;
      }
    } catch {
      // Skip malformed lines
    }
  }

  return latest;
}

async function readLatestSucceededArtifactEvents(
  blueprintFolder: string,
  movieId: string
): Promise<Map<string, ArtefactEvent>> {
  const eventsDir = getEventsDir(blueprintFolder, movieId);
  const logPath = path.join(eventsDir, 'artefacts.log');

  const latest = new Map<string, ArtefactEvent>();
  if (!existsSync(logPath)) {
    return latest;
  }

  const content = await fs.readFile(logPath, 'utf8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim());

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as ArtefactEvent;
      if (event.status === 'succeeded') {
        latest.set(event.artefactId, event);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return latest;
}

function extractArtifactBaseName(artifactId: string): string {
  const withoutPrefix = artifactId.startsWith('Artifact:')
    ? artifactId.slice('Artifact:'.length)
    : artifactId;
  const withoutBrackets = withoutPrefix.replace(/\[[^\]]+\]/g, '');
  const segments = withoutBrackets.split('.');
  return segments[segments.length - 1] ?? withoutBrackets;
}

function collectDerivedVideoArtifactIdsForFamily(
  artifactId: string,
  sourceProducedBy: string,
  latestEvents: Map<string, ArtefactEvent>
): string[] {
  const derivedIds: string[] = [];

  for (const [candidateArtifactId, event] of latestEvents) {
    if (candidateArtifactId === artifactId) {
      continue;
    }
    if (event.producedBy !== sourceProducedBy) {
      continue;
    }

    const baseName = extractArtifactBaseName(candidateArtifactId);
    if (!DERIVED_VIDEO_ARTIFACT_BASE_NAMES.has(baseName)) {
      continue;
    }

    derivedIds.push(candidateArtifactId);
  }

  const sortOrder = ['FirstFrame', 'LastFrame', 'AudioTrack'];
  return derivedIds.sort((a, b) => {
    const baseA = extractArtifactBaseName(a);
    const baseB = extractArtifactBaseName(b);
    const orderA = sortOrder.indexOf(baseA);
    const orderB = sortOrder.indexOf(baseB);

    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.localeCompare(b);
  });
}

async function extractDerivedVideoBuffers(args: {
  videoBuffer: Buffer;
  primaryArtifactId: string;
  derivedArtifactIds: string[];
}): Promise<Map<string, { data: Buffer; mimeType: string }>> {
  const { videoBuffer, primaryArtifactId, derivedArtifactIds } = args;
  const produces = [primaryArtifactId, ...derivedArtifactIds];
  const requiredExtractions = detectRequiredExtractions(produces);

  const extracted = await extractDerivedArtefacts({
    videoBuffer,
    primaryArtifactId,
    produces,
    mode: 'live',
  });

  const derivedBuffers = new Map<string, { data: Buffer; mimeType: string }>();

  const register = (
    artifactId: string | null,
    key: 'firstFrame' | 'lastFrame' | 'audioTrack'
  ) => {
    if (!artifactId) {
      return;
    }

    const artifact = extracted[key];
    if (!artifact) {
      throw new Error(
        `Derived artifact ${artifactId} extraction returned no result for ${key}.`
      );
    }
    if (artifact.status !== 'succeeded') {
      const diagnostic =
        artifact.diagnostics && typeof artifact.diagnostics === 'object'
          ? JSON.stringify(artifact.diagnostics)
          : String(artifact.diagnostics ?? 'none');
      throw new Error(
        `Derived artifact ${artifactId} extraction failed with status ${artifact.status}. diagnostics=${diagnostic}`
      );
    }
    if (!artifact.blob) {
      throw new Error(`Derived artifact ${artifactId} has no blob output.`);
    }
    if (typeof artifact.blob.data === 'string') {
      throw new Error(
        `Derived artifact ${artifactId} returned string data, expected binary.`
      );
    }

    const data = Buffer.isBuffer(artifact.blob.data)
      ? artifact.blob.data
      : Buffer.from(artifact.blob.data);
    derivedBuffers.set(artifactId, {
      data,
      mimeType: artifact.blob.mimeType,
    });
  };

  register(requiredExtractions.firstFrameId, 'firstFrame');
  register(requiredExtractions.lastFrameId, 'lastFrame');
  register(requiredExtractions.audioTrackId, 'audioTrack');

  return derivedBuffers;
}

/**
 * Append an artefact event to the event log.
 */
async function appendArtefactEvent(
  blueprintFolder: string,
  movieId: string,
  event: ArtefactEvent
): Promise<void> {
  const eventsDir = getEventsDir(blueprintFolder, movieId);
  const logPath = path.join(eventsDir, 'artefacts.log');

  await fs.mkdir(eventsDir, { recursive: true });

  const serialized = JSON.stringify(event) + '\n';
  await fs.appendFile(logPath, serialized, 'utf8');
}

/**
 * Save blob data to content-addressed storage.
 * Returns the hash and writes the file to blobs/{prefix}/{hash}.{ext}
 */
async function persistBlob(
  blueprintFolder: string,
  movieId: string,
  data: Buffer,
  mimeType: string
): Promise<{ hash: string; size: number }> {
  const hash = createHash('sha256').update(data).digest('hex');
  const prefix = hash.slice(0, 2);
  const fileName = formatBlobFileName(hash, mimeType);
  const blobsDir = getBlobsDir(blueprintFolder, movieId);
  const prefixDir = path.join(blobsDir, prefix);
  const filePath = path.join(prefixDir, fileName);

  // Ensure directories exist
  await fs.mkdir(prefixDir, { recursive: true });

  // Write atomically if not exists (content-addressed deduplication)
  if (!existsSync(filePath)) {
    const tmpPath = `${filePath}.tmp-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    await fs.writeFile(tmpPath, data);
    await fs.rename(tmpPath, filePath);
  }

  return { hash, size: data.byteLength };
}

/**
 * Generate a new revision ID.
 */
function generateRevisionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `rev-${timestamp}-${random}`;
}

/**
 * Handle artifact edit via file upload (multipart/form-data).
 * Expects: blueprintFolder, movieId, artifactId as query params, file in form data.
 */
export async function handleArtifactFileEdit(
  req: IncomingMessage,
  res: ServerResponse,
  blueprintFolder: string,
  movieId: string,
  artifactId: string
): Promise<void> {
  // Validate parameters
  if (!blueprintFolder || !movieId || !artifactId) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Missing required parameters' }));
    return;
  }

  // Validate path security
  const blobsDir = getBlobsDir(blueprintFolder, movieId);
  if (!isPathWithinDirectory(blobsDir, blueprintFolder)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Invalid path' }));
    return;
  }

  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('multipart/form-data')) {
    res.statusCode = 400;
    res.end(
      JSON.stringify({ error: 'Content-Type must be multipart/form-data' })
    );
    return;
  }

  try {
    const bb = busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1, // Only one file per edit
      },
    });

    let fileData: Buffer | null = null;
    let fileMimeType: string | null = null;
    let truncated = false;
    let parseError: string | null = null;

    const filePromise = new Promise<void>((resolve, reject) => {
      bb.on('file', (_fieldname, file, info) => {
        fileMimeType = info.mimeType;
        const chunks: Buffer[] = [];

        file.on('data', (data: Buffer) => {
          chunks.push(data);
        });

        file.on('limit', () => {
          truncated = true;
        });

        file.on('end', () => {
          if (!truncated) {
            fileData = Buffer.concat(chunks);
          }
        });

        file.on('error', (err: Error) => {
          reject(err);
        });
      });

      bb.on('error', (err: Error) => {
        parseError = err.message;
        reject(err);
      });

      bb.on('close', () => {
        resolve();
      });

      req.pipe(bb);
    });

    await filePromise;

    if (truncated) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          error: `File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
        })
      );
      return;
    }

    if (!fileData || !fileMimeType) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: parseError ?? 'No file uploaded' }));
      return;
    }

    // Process the edit
    const result = await applyArtifactEditWithDerivedArtifactsFromBuffer(
      blueprintFolder,
      movieId,
      artifactId,
      fileData,
      fileMimeType
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error('[artifact-edit-handler] Error:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Edit failed',
      })
    );
  }
}

/**
 * Handle artifact edit via JSON body (for text content).
 */
export async function handleArtifactTextEdit(
  _req: IncomingMessage,
  res: ServerResponse,
  body: TextArtifactEditRequest
): Promise<void> {
  const { blueprintFolder, movieId, artifactId, content, mimeType } = body;

  // Validate parameters
  if (
    !blueprintFolder ||
    !movieId ||
    !artifactId ||
    content === undefined ||
    !mimeType
  ) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Missing required parameters' }));
    return;
  }

  // Validate path security
  const blobsDir = getBlobsDir(blueprintFolder, movieId);
  if (!isPathWithinDirectory(blobsDir, blueprintFolder)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Invalid path' }));
    return;
  }

  try {
    const data = Buffer.from(content, 'utf8');
    const result = await applyArtifactEditFromBuffer(
      blueprintFolder,
      movieId,
      artifactId,
      data,
      mimeType
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error('[artifact-edit-handler] Error:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Edit failed',
      })
    );
  }
}

/**
 * Process an artifact edit - save blob and create event.
 */
export async function applyArtifactEditFromBuffer(
  blueprintFolder: string,
  movieId: string,
  artifactId: string,
  data: Buffer,
  mimeType: string
): Promise<ArtifactEditResponse> {
  // Read the latest event for this artifact to get originalHash
  const latestEvent = await readLatestArtifactEvent(
    blueprintFolder,
    movieId,
    artifactId
  );

  // Determine the originalHash:
  // - If latest event has originalHash, preserve it (already edited before)
  // - If no originalHash, use the current blob hash (this is the first edit)
  let originalHash: string | undefined;
  if (latestEvent?.originalHash) {
    // Already edited before - preserve the original
    originalHash = latestEvent.originalHash;
  } else if (latestEvent?.output.blob?.hash) {
    // First edit - use the current producer-generated hash as original
    originalHash = latestEvent.output.blob.hash;
  }

  // Save the new blob
  const { hash: newHash, size } = await persistBlob(
    blueprintFolder,
    movieId,
    data,
    mimeType
  );

  // Create new artifact event
  const event: ArtefactEvent = {
    artefactId: artifactId,
    revision: generateRevisionId(),
    inputsHash: latestEvent?.inputsHash ?? 'user-edit',
    output: {
      blob: {
        hash: newHash,
        size,
        mimeType,
      },
    },
    status: 'succeeded',
    producedBy: latestEvent?.producedBy ?? 'user',
    createdAt: new Date().toISOString(),
    editedBy: 'user',
    originalHash,
  };

  // Append to event log
  await appendArtefactEvent(blueprintFolder, movieId, event);

  return {
    success: true,
    newHash,
    originalHash,
    editedBy: 'user',
  };
}

/**
 * Process an artifact edit and keep derived video artifacts in sync.
 *
 * For non-video artifacts this delegates to applyArtifactEditFromBuffer.
 * For video artifacts, this regenerates FirstFrame/LastFrame/AudioTrack siblings
 * with the same source producer and applies those edits first.
 */
export async function applyArtifactEditWithDerivedArtifactsFromBuffer(
  blueprintFolder: string,
  movieId: string,
  artifactId: string,
  data: Buffer,
  mimeType: string
): Promise<ArtifactEditResponse> {
  const latestEvent = await readLatestArtifactEvent(
    blueprintFolder,
    movieId,
    artifactId
  );
  const latestMimeType = latestEvent?.output.blob?.mimeType;

  if (!latestMimeType?.startsWith('video/')) {
    return applyArtifactEditFromBuffer(
      blueprintFolder,
      movieId,
      artifactId,
      data,
      mimeType
    );
  }

  if (!mimeType.startsWith('video/')) {
    throw new Error(
      `Artifact ${artifactId} is a video artifact and must be replaced with video MIME type. Received ${mimeType}.`
    );
  }

  if (!latestEvent) {
    throw new Error(`Artifact ${artifactId} not found`);
  }

  const producedBy = latestEvent.producedBy;
  const latestEvents = await readLatestSucceededArtifactEvents(
    blueprintFolder,
    movieId
  );
  const derivedArtifactIds = collectDerivedVideoArtifactIdsForFamily(
    artifactId,
    producedBy,
    latestEvents
  );

  if (derivedArtifactIds.length === 0) {
    return applyArtifactEditFromBuffer(
      blueprintFolder,
      movieId,
      artifactId,
      data,
      mimeType
    );
  }

  const derivedBuffers = await extractDerivedVideoBuffers({
    videoBuffer: data,
    primaryArtifactId: artifactId,
    derivedArtifactIds,
  });

  for (const derivedArtifactId of derivedArtifactIds) {
    const derived = derivedBuffers.get(derivedArtifactId);
    if (!derived) {
      throw new Error(
        `Missing regenerated data for derived artifact ${derivedArtifactId}.`
      );
    }

    await applyArtifactEditFromBuffer(
      blueprintFolder,
      movieId,
      derivedArtifactId,
      derived.data,
      derived.mimeType
    );
  }

  return applyArtifactEditFromBuffer(
    blueprintFolder,
    movieId,
    artifactId,
    data,
    mimeType
  );
}

async function restoreArtifactToOriginalHash(args: {
  blueprintFolder: string;
  movieId: string;
  artifactId: string;
  failIfNotEdited: boolean;
}): Promise<{ restoredHash: string } | null> {
  const { blueprintFolder, movieId, artifactId, failIfNotEdited } = args;

  const latestEvent = await readLatestArtifactEvent(
    blueprintFolder,
    movieId,
    artifactId
  );
  if (!latestEvent) {
    if (failIfNotEdited) {
      throw new Error(`Artifact ${artifactId} not found`);
    }
    return null;
  }

  if (!latestEvent.originalHash) {
    if (failIfNotEdited) {
      throw new Error(`Artifact ${artifactId} has not been edited`);
    }
    return null;
  }

  const eventsDir = getEventsDir(blueprintFolder, movieId);
  const logPath = path.join(eventsDir, 'artefacts.log');
  const content = await fs.readFile(logPath, 'utf8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim());

  let originalMimeType =
    latestEvent.output.blob?.mimeType ?? 'application/octet-stream';
  let originalSize = latestEvent.output.blob?.size ?? 0;

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as ArtefactEvent;
      if (
        event.artefactId === artifactId &&
        event.output.blob?.hash === latestEvent.originalHash
      ) {
        originalMimeType = event.output.blob.mimeType;
        originalSize = event.output.blob.size;
        break;
      }
    } catch {
      // Skip malformed lines
    }
  }

  const event: ArtefactEvent = {
    artefactId: artifactId,
    revision: generateRevisionId(),
    inputsHash: latestEvent.inputsHash,
    output: {
      blob: {
        hash: latestEvent.originalHash,
        size: originalSize,
        mimeType: originalMimeType,
      },
    },
    status: 'succeeded',
    producedBy: latestEvent.producedBy,
    createdAt: new Date().toISOString(),
  };

  await appendArtefactEvent(blueprintFolder, movieId, event);

  return {
    restoredHash: latestEvent.originalHash,
  };
}

/**
 * Handle artifact restore to original.
 */
export async function handleArtifactRestore(
  res: ServerResponse,
  body: ArtifactRestoreRequest
): Promise<void> {
  const { blueprintFolder, movieId, artifactId } = body;

  // Validate parameters
  if (!blueprintFolder || !movieId || !artifactId) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Missing required parameters' }));
    return;
  }

  try {
    const latestEvent = await readLatestArtifactEvent(
      blueprintFolder,
      movieId,
      artifactId
    );

    if (!latestEvent) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Artifact not found' }));
      return;
    }

    if (!latestEvent.originalHash) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Artifact has not been edited' }));
      return;
    }

    const latestEvents = await readLatestSucceededArtifactEvents(
      blueprintFolder,
      movieId
    );

    const derivedArtifactIds = latestEvent.output.blob?.mimeType?.startsWith(
      'video/'
    )
      ? collectDerivedVideoArtifactIdsForFamily(
          artifactId,
          latestEvent.producedBy,
          latestEvents
        )
      : [];

    for (const derivedArtifactId of derivedArtifactIds) {
      await restoreArtifactToOriginalHash({
        blueprintFolder,
        movieId,
        artifactId: derivedArtifactId,
        failIfNotEdited: false,
      });
    }

    const restoredMain = await restoreArtifactToOriginalHash({
      blueprintFolder,
      movieId,
      artifactId,
      failIfNotEdited: true,
    });

    if (!restoredMain) {
      throw new Error(
        `Restore result for artifact ${artifactId} is unexpectedly empty.`
      );
    }

    const response: ArtifactRestoreResponse = {
      success: true,
      restoredHash: restoredMain.restoredHash,
    };

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response));
  } catch (error) {
    console.error('[artifact-edit-handler] Restore error:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Restore failed',
      })
    );
  }
}
