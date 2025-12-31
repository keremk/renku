import { Buffer } from 'node:buffer';
import type { EventLog } from './event-log.js';
import type { StorageContext } from './storage.js';
import type { BlobRef, ArtefactEvent } from './types.js';
import { formatBlobFileName } from './blob-utils.js';

/**
 * Resolves artifact IDs to their actual data by streaming the event log
 * and reading blobs from storage.
 *
 * This is used during execution to provide artifacts from previous steps
 * as inputs to subsequent steps.
 *
 * @param args Configuration with artifact IDs to resolve, event log, storage, and movie ID
 * @returns Map of artifact kinds to their resolved data (Uint8Array for binary blobs, string for decoded text blobs)
 *
 * @example
 * const resolved = await resolveArtifactsFromEventLog({
 *   artifactIds: ['Artifact:SegmentImage[segment=0]', 'Input:Topic'],
 *   eventLog,
 *   storage,
 *   movieId: 'movie-123',
 * });
 * // Returns: { SegmentImage: Uint8Array(...), Topic: 'marine life' }
 */
export async function resolveArtifactsFromEventLog(args: {
  artifactIds: string[];
  eventLog: EventLog;
  storage: StorageContext;
  movieId: string;
}): Promise<Record<string, unknown>> {
  if (args.artifactIds.length === 0) {
    return {};
  }

  // Map to store latest event for each artifact ID
  // We keep the latest in case there are multiple events for the same artifact
  const latestEvents = new Map<string, ArtefactEvent>();

  // Stream events and collect latest succeeded events for requested artifacts
  for await (const event of args.eventLog.streamArtefacts(args.movieId)) {
    if (event.status === 'succeeded' && args.artifactIds.includes(event.artefactId)) {
      latestEvents.set(event.artefactId, event);
    }
  }

  const resolvedById = new Map<string, unknown>();
  const resolvedByKind = new Map<string, unknown>();

  for (const [artifactId, event] of latestEvents) {
    const kind = extractArtifactKind(artifactId);

    if (event.output.blob) {
      const decoded = await readBlob(args.storage, args.movieId, event.output.blob);
      resolvedByKind.set(kind, decoded);
      resolvedById.set(artifactId, decoded);
      resolvedById.set(formatResolvedKey(artifactId), decoded);
    }
  }

  return Object.fromEntries([
    ...resolvedByKind.entries(),
    ...resolvedById.entries(),
  ]);
}

/**
 * Extracts the artifact kind from a full artifact ID.
 *
 * Removes the prefix (Artifact: or Input:) and any dimensional indices.
 *
 * @param artifactId Full artifact identifier
 * @returns The artifact kind without prefix or dimensions
 *
 * @example
 * extractArtifactKind('Artifact:SegmentImage[segment=0][image=0]') // 'SegmentImage'
 * extractArtifactKind('Artifact:NarrationScript') // 'NarrationScript'
 * extractArtifactKind('Input:Topic') // 'Topic'
 */
export function extractArtifactKind(artifactId: string): string {
  // Remove prefix (Artifact: or Input:)
  const withoutPrefix = artifactId.replace(/^(Artifact|Input):/, '');

  // Remove dimensions like [segment=0][image=0]
  const kind = withoutPrefix.replace(/\[.*?\]/g, '');

  return kind;
}

/**
 * Reads a blob from FlyStorage using its hash reference.
 *
 * Blobs are stored at: blobs/{prefix}/{hash}
 * where prefix is the first 2 characters of the hash.
 *
 * @param storage Storage context with FlyStorage instance
 * @param movieId Movie identifier for path resolution
 * @param blobRef Blob reference with hash, size, and mimeType
 * @returns The blob data as Uint8Array
 */
export async function readBlob(
  storage: StorageContext,
  movieId: string,
  blobRef: BlobRef,
): Promise<unknown> {
  const prefix = blobRef.hash.slice(0, 2);
  const fileName = formatBlobFileName(blobRef.hash, blobRef.mimeType);
  const primaryPath = storage.resolve(movieId, 'blobs', prefix, fileName);
  try {
    const payload = await storage.storage.readToUint8Array(primaryPath);
    return decodePayload(payload, blobRef.mimeType);
  } catch {
    throw new Error(
      `Blob not found at ${primaryPath}. ` +
        `If this is a legacy project, blobs may need to be migrated.`,
    );
  }
}

function decodePayload(payload: Uint8Array, mimeType?: string): unknown {
  const type = mimeType?.toLowerCase() ?? '';
  if (type.startsWith('text/') || type === 'application/json') {
    const text = Buffer.from(payload).toString('utf8');
    if (type === 'application/json') {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(
          `Invalid JSON in artifact: expected valid JSON but got: ${text.slice(0, 100)}...`,
        );
      }
    }
    return text;
  }
  // Return proper Buffer for binary types to ensure compatibility with streams
  return Buffer.from(payload);
}

function formatResolvedKey(artifactId: string): string {
  return artifactId.replace(/^Artifact:/, '');
}
