/**
 * Build-state handler.
 */

import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  canonicalizeAuthoredProducerId,
  createBuildStateService,
  createRunLifecycleService,
  createStorageContext,
  isRenkuError,
  loadYamlBlueprintTree,
  parseInputsForDisplay,
  resolveCurrentBuildContext,
  RuntimeErrorCode,
  type RevisionId,
} from '@gorenku/core';
import type { ArtifactInfo, BuildStateResponse } from './types.js';
import { normalizeNestedModelSelections } from './model-selection-normalizer.js';

const TIMELINE_ARTIFACT_ID = 'Artifact:TimelineComposer.Timeline';

function stripCanonicalArtifactPrefix(artifactId: string): string {
  if (!artifactId.startsWith('Artifact:')) {
    throw new Error(
      `Build-state artifact key must be canonical (Artifact:...), received "${artifactId}".`
    );
  }
  return artifactId.slice('Artifact:'.length);
}

/**
 * ArtifactEvent structure for reading from event log.
 */
interface ArtifactEvent {
  artifactId: string;
  producedBy?: string;
  producerId?: string;
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

interface ArtifactHistoryState {
  latestEvents: Map<string, ArtifactEvent>;
  latestSucceededEvents: Map<string, ArtifactEvent>;
}

/**
 * Extract recovery info from an artifact event for the ArtifactInfo response.
 */
function extractRecoveryInfo(event?: ArtifactEvent): Partial<ArtifactInfo> {
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
async function readArtifactHistoryState(
  movieDir: string
): Promise<ArtifactHistoryState> {
  const logPath = path.join(movieDir, 'events', 'artifacts.log');
  const latestEvents = new Map<string, ArtifactEvent>();
  const latestSucceededEvents = new Map<string, ArtifactEvent>();

  if (!existsSync(logPath)) {
    return {
      latestEvents,
      latestSucceededEvents,
    };
  }

  try {
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.split(/\r?\n/).filter((line) => line.trim());

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as ArtifactEvent;
        latestEvents.set(event.artifactId, event);
        if (event.status === 'succeeded') {
          latestSucceededEvents.set(event.artifactId, event);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Return empty map on error
  }

  return {
    latestEvents,
    latestSucceededEvents,
  };
}

function resolveProducerNodeId(args: {
  producerId?: string;
}): string | undefined {
  return args.producerId;
}

/**
 * Gets the build-state data for a specific build.
 */
export async function getBuildState(
  blueprintFolder: string,
  movieId: string,
  blueprintPath?: string,
  catalogRoot?: string
): Promise<BuildStateResponse> {
  const movieDir = path.join(blueprintFolder, 'builds', movieId);
  const storage = createStorageContext({
    kind: 'local',
    rootDir: blueprintFolder,
    basePath: 'builds',
  });
  const buildStateService = createBuildStateService(storage);
  const runLifecycleService = createRunLifecycleService(storage);

  try {
    let buildState: {
      revision: string;
      artifacts: Record<
        string,
        {
          hash: string;
          blob?: { hash: string; size: number; mimeType?: string };
          producedBy: string;
          producerId?: string;
          status: string;
          createdAt: string;
        }
      >;
      createdAt: string;
    } | null = null;
    try {
      const current = await buildStateService.loadCurrent(movieId);
      buildState = current.buildState;
    } catch (error) {
      if (
        isRenkuError(error) &&
        error.code === RuntimeErrorCode.BUILD_STATE_NOT_FOUND
      ) {
        buildState = null;
      } else {
        throw error;
      }
    }
    const { currentBuildRevision, snapshotSourceRun } =
      await resolveCurrentBuildContext({
        storage,
        movieId,
      });
    const revision: RevisionId | null = currentBuildRevision;
    const displayedRun =
      revision ? await runLifecycleService.load(movieId, revision) : null;

    const { latestEvents, latestSucceededEvents } =
      await readArtifactHistoryState(movieDir);

    let parsedInputs: Record<string, unknown> = {};
    let modelSelections: NonNullable<BuildStateResponse['models']> = [];
    const editableInputsPath = path.join(movieDir, 'inputs.yaml');
    const snapshotPath = snapshotSourceRun
      ? path.join(movieDir, snapshotSourceRun.inputSnapshotPath)
      : null;
    const authoredInputsPath = existsSync(editableInputsPath)
      ? editableInputsPath
      : snapshotPath && existsSync(snapshotPath)
        ? snapshotPath
        : null;

    if (authoredInputsPath) {
      const parsed = await parseInputsForDisplay(authoredInputsPath);
      parsedInputs = parsed.inputs;
      modelSelections = parsed.models;
    }

    const canonicalModelSelections =
      blueprintPath && modelSelections.length > 0
      ? await canonicalizeBuildStateModelSelections(
          blueprintPath,
          catalogRoot,
          movieId,
          modelSelections
        )
      : modelSelections;

    const parsedArtifacts: ArtifactInfo[] = [];
    for (const [artifactId, event] of latestEvents) {
      const cleanName = stripCanonicalArtifactPrefix(artifactId);
      const latestSucceededEvent = latestSucceededEvents.get(artifactId);
      const displayEvent =
        event.status === 'succeeded' ? event : latestSucceededEvent;

      if (!displayEvent?.output?.blob?.hash && event.status === 'succeeded') {
        continue;
      }

      const producerNodeId = resolveProducerNodeId({
        producerId: event.producerId,
      });
      parsedArtifacts.push({
        id: artifactId,
        name: cleanName,
        producedBy: event.producedBy,
        ...(producerNodeId ? { producerNodeId } : {}),
        hash: displayEvent?.output?.blob?.hash ?? '',
        size: displayEvent?.output?.blob?.size ?? 0,
        mimeType:
          displayEvent?.output?.blob?.mimeType ?? 'application/octet-stream',
        status: event.status,
        createdAt: event.createdAt ?? null,
        editedBy: displayEvent?.editedBy,
        originalHash: displayEvent?.originalHash,
        ...(event.status !== 'succeeded' && displayEvent?.output?.blob?.hash
          ? { showingPreviousOutput: true }
          : {}),
        // Include recovery info from diagnostics
        ...extractRecoveryInfo(event),
      });
    }

    return {
      movieId,
      revision,
      inputs: parsedInputs,
      models:
        canonicalModelSelections.length > 0
          ? canonicalModelSelections
          : undefined,
      artifacts: parsedArtifacts,
      createdAt: displayedRun?.createdAt ?? buildState?.createdAt ?? null,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error));
  }
}

async function canonicalizeBuildStateModelSelections(
  blueprintPath: string,
  catalogRoot: string | undefined,
  movieId: string,
  modelSelections: NonNullable<BuildStateResponse['models']>
): Promise<NonNullable<BuildStateResponse['models']>> {
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
  const normalizedSelections = normalizeNestedModelSelections(
    root,
    modelSelections,
    `build state for build "${movieId}"`
  );

  return normalizedSelections.map((selection) => {
    const canonicalProducerId = canonicalizeAuthoredProducerId(
      root,
      selection.producerId
    );
    if (!canonicalProducerId) {
      throw new Error(
        `Refusing to use unknown producer "${selection.producerId}" from build state for build "${movieId}".`
      );
    }

    return {
      ...selection,
      producerId: canonicalProducerId,
    };
  });
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
  const { latestSucceededEvents } = await readArtifactHistoryState(movieDir);
  const artifact = latestSucceededEvents.get(TIMELINE_ARTIFACT_ID);
  const blob = artifact?.output?.blob;
  if (!blob?.hash) {
    return null;
  }

  // Resolve the blob path
  const hash = blob.hash;
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
