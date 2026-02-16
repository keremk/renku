/**
 * Build manifest handler.
 */

import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { extractModelSelectionsFromInputs } from '@gorenku/core';
import type { ArtifactInfo, BuildManifestResponse } from './types.js';

const TIMELINE_ARTEFACT_ID = 'Artifact:TimelineComposer.Timeline';

/**
 * ArtefactEvent structure for reading from event log.
 */
interface ArtefactEvent {
  artefactId: string;
  output: {
    blob?: {
      hash: string;
      size: number;
      mimeType?: string;
    };
  };
  status: 'succeeded' | 'failed' | 'skipped';
  createdAt: string;
  editedBy?: 'producer' | 'user';
  originalHash?: string;
  /** Diagnostics from provider (may include recovery info) */
  diagnostics?: {
    provider?: string;
    model?: string;
    providerRequestId?: string;
    recoverable?: boolean;
    reason?: string;
  };
  /** Skip reason if status is 'skipped' */
  skipReason?: 'conditions_not_met' | 'upstream_failure';
  /** Human-readable skip message */
  skipMessage?: string;
}

/**
 * Extract recovery info from an artifact event for the ArtifactInfo response.
 */
function extractRecoveryInfo(event?: ArtefactEvent): Partial<ArtifactInfo> {
  if (!event) return {};

  const result: Partial<ArtifactInfo> = {};

  // Extract from diagnostics
  if (event.diagnostics) {
    if (event.diagnostics.provider) {
      result.provider = event.diagnostics.provider;
    }
    if (event.diagnostics.model) {
      result.model = event.diagnostics.model;
    }
    if (event.diagnostics.providerRequestId) {
      result.providerRequestId = event.diagnostics.providerRequestId;
      if (typeof event.diagnostics.recoverable === 'boolean') {
        result.recoverable = event.diagnostics.recoverable;
      }
    }
    if (event.diagnostics.reason) {
      // Map diagnostic reason to ArtifactFailureReason
      const reason = event.diagnostics.reason;
      if (reason === 'timeout' || reason === 'connection_error') {
        result.failureReason = reason;
      }
    }
  }

  // Handle skip info
  if (event.status === 'skipped') {
    result.failureReason = event.skipReason ?? 'conditions_not_met';
    if (event.skipMessage) {
      result.skipMessage = event.skipMessage;
    }
  }

  return result;
}

/**
 * Read latest artifact events from the event log.
 * Returns a map of artifactId -> latest event info.
 * Includes succeeded, failed, and skipped events (latest state wins).
 */
async function readLatestArtifactEvents(
  movieDir: string
): Promise<Map<string, ArtefactEvent>> {
  const logPath = path.join(movieDir, 'events', 'artefacts.log');
  const latest = new Map<string, ArtefactEvent>();

  if (!existsSync(logPath)) {
    return latest;
  }

  try {
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.split(/\r?\n/).filter((line) => line.trim());

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as ArtefactEvent;
        // Keep all statuses - the latest event for each artifact wins
        // This allows us to track failed/skipped artifacts for recovery
        latest.set(event.artefactId, event);
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Return empty map on error
  }

  return latest;
}

/**
 * Gets the manifest data for a specific build.
 */
export async function getBuildManifest(
  blueprintFolder: string,
  movieId: string
): Promise<BuildManifestResponse> {
  const movieDir = path.join(blueprintFolder, 'builds', movieId);
  const currentPath = path.join(movieDir, 'current.json');

  const emptyResponse: BuildManifestResponse = {
    movieId,
    revision: null,
    inputs: {},
    artefacts: [],
    createdAt: null,
  };

  try {
    // Step 1: Read current.json for revision & manifestPath (may not exist)
    let revision: string | null = null;
    let manifestPath: string | null = null;

    if (existsSync(currentPath)) {
      const currentContent = await fs.readFile(currentPath, 'utf8');
      const current = JSON.parse(currentContent) as {
        revision?: string;
        manifestPath?: string | null;
      };
      revision = current.revision ?? null;
      manifestPath = current.manifestPath
        ? path.join(movieDir, current.manifestPath)
        : null;
    }

    // Step 2: Try to read manifest file if path exists (may not exist yet)
    type ManifestData = {
      inputs?: Record<string, { payloadDigest?: unknown }>;
      artefacts?: Record<
        string,
        {
          hash?: string;
          blob?: { hash: string; size: number; mimeType?: string };
          status?: string;
          createdAt?: string;
        }
      >;
      createdAt?: string;
    };
    let manifest: ManifestData | null = null;
    let manifestMtime: string | null = null;

    if (manifestPath && existsSync(manifestPath)) {
      const manifestContent = await fs.readFile(manifestPath, 'utf8');
      manifest = JSON.parse(manifestContent) as ManifestData;
      const stat = await fs.stat(manifestPath);
      manifestMtime = stat.mtime.toISOString();
    }

    // Step 3: Always read event log (the key fix — this was previously unreachable
    // when manifestPath was null or the manifest file didn't exist yet)
    const latestEvents = await readLatestArtifactEvents(movieDir);

    // Step 4: Parse inputs from manifest (if available)
    const parsedInputs: Record<string, unknown> = {};
    if (manifest?.inputs) {
      for (const [key, entry] of Object.entries(manifest.inputs)) {
        // Remove "Input:" prefix if present
        const cleanName = key.startsWith('Input:') ? key.slice(6) : key;
        // Extract value from payloadDigest
        if (entry && typeof entry === 'object' && 'payloadDigest' in entry) {
          let value = entry.payloadDigest;
          // payloadDigest may contain JSON-encoded strings (e.g., "\"actual string\"")
          // Try to parse it if it's a string that looks like JSON
          if (typeof value === 'string') {
            try {
              value = JSON.parse(value);
            } catch {
              // If parsing fails, use the raw string
            }
          }
          parsedInputs[cleanName] = value;
        }
      }
    }

    // Extract model selections from inputs
    const { modelSelections } = extractModelSelectionsFromInputs(parsedInputs);

    // Step 5: Build artifacts — merge manifest data with event log data
    const parsedArtifacts: ArtifactInfo[] = [];
    const manifestArtifactIds = new Set<string>();

    // First pass: manifest artifacts (merged with event log for latest state)
    if (manifest?.artefacts) {
      for (const [key, entry] of Object.entries(manifest.artefacts)) {
        if (!entry || !entry.blob) continue;
        manifestArtifactIds.add(key);

        // Extract name from artifact ID (e.g., "Artifact:Producer.Output" -> "Producer.Output")
        const cleanName = key.startsWith('Artifact:') ? key.slice(9) : key;

        // Check event log for latest state (may have edits)
        const latestEvent = latestEvents.get(key);
        const hasEventLogData = latestEvent?.output?.blob?.hash;

        // Use event log data if available (includes user edits), otherwise fall back to manifest
        const currentHash = hasEventLogData
          ? latestEvent.output.blob!.hash
          : entry.blob.hash;
        const currentSize = hasEventLogData
          ? latestEvent.output.blob!.size
          : entry.blob.size;
        const currentMimeType = hasEventLogData
          ? (latestEvent.output.blob!.mimeType ?? 'application/octet-stream')
          : (entry.blob.mimeType ?? 'application/octet-stream');

        parsedArtifacts.push({
          id: key,
          name: cleanName,
          hash: currentHash,
          size: currentSize,
          mimeType: currentMimeType,
          status: latestEvent?.status ?? entry.status ?? 'unknown',
          createdAt: latestEvent?.createdAt ?? entry.createdAt ?? null,
          // Include edit tracking fields from event log
          editedBy: latestEvent?.editedBy,
          originalHash: latestEvent?.originalHash,
          // Include recovery info from diagnostics
          ...extractRecoveryInfo(latestEvent),
        });
      }
    }

    // Second pass: Include artifacts from event log that are NOT in the manifest.
    // This handles mid-execution artifacts that exist in artefacts.log but not yet
    // in the manifest file (which is only written after execution completes).
    for (const [artifactId, event] of latestEvents) {
      if (manifestArtifactIds.has(artifactId)) {
        // Already processed in first pass
        continue;
      }

      const cleanName = artifactId.startsWith('Artifact:')
        ? artifactId.slice(9)
        : artifactId;

      // For succeeded artifacts, we need blob info
      if (event.status === 'succeeded' && !event.output?.blob?.hash) {
        continue;
      }

      parsedArtifacts.push({
        id: artifactId,
        name: cleanName,
        hash: event.output?.blob?.hash ?? '',
        size: event.output?.blob?.size ?? 0,
        mimeType: event.output?.blob?.mimeType ?? 'application/octet-stream',
        status: event.status,
        createdAt: event.createdAt ?? null,
        editedBy: event.editedBy,
        originalHash: event.originalHash,
        // Include recovery info from diagnostics
        ...extractRecoveryInfo(event),
      });
    }

    return {
      movieId,
      revision,
      inputs: parsedInputs,
      models: modelSelections.length > 0 ? modelSelections : undefined,
      artefacts: parsedArtifacts,
      createdAt: manifest?.createdAt ?? manifestMtime ?? null,
    };
  } catch {
    return emptyResponse;
  }
}

/**
 * Gets the timeline data for a specific build.
 * Returns null if the timeline artifact is not available (e.g., build incomplete or TimelineComposer failed).
 */
export async function getBuildTimeline(
  blueprintFolder: string,
  movieId: string
): Promise<unknown | null> {
  const movieDir = path.join(blueprintFolder, 'builds', movieId);
  const currentPath = path.join(movieDir, 'current.json');

  if (!existsSync(currentPath)) {
    return null;
  }

  const currentContent = await fs.readFile(currentPath, 'utf8');
  const current = JSON.parse(currentContent) as {
    manifestPath?: string | null;
  };

  if (!current.manifestPath) {
    return null;
  }

  const manifestPath = path.join(movieDir, current.manifestPath);
  if (!existsSync(manifestPath)) {
    return null;
  }

  const manifestContent = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent) as {
    artefacts?: Record<
      string,
      {
        blob?: { hash: string; mimeType?: string };
      }
    >;
  };

  const artefact = manifest.artefacts?.[TIMELINE_ARTEFACT_ID];
  if (!artefact?.blob?.hash) {
    return null;
  }

  // Resolve the blob path
  const hash = artefact.blob.hash;
  const prefix = hash.slice(0, 2);
  const blobsDir = path.join(movieDir, 'blobs');

  // Try different file extensions
  const extensions = ['json', ''];
  let timelinePath: string | null = null;

  for (const ext of extensions) {
    const fileName = ext ? `${hash}.${ext}` : hash;
    const candidatePath = path.join(blobsDir, prefix, fileName);
    if (existsSync(candidatePath)) {
      timelinePath = candidatePath;
      break;
    }
  }

  if (!timelinePath) {
    return null;
  }

  const contents = await fs.readFile(timelinePath, 'utf8');
  return JSON.parse(contents);
}
