import { isCanonicalArtifactId, isCanonicalInputId } from './canonical-ids.js';
import type { EventLog } from './event-log.js';
import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';
import { hashPayload } from './hashing.js';
import { latestRevisionId } from './revisions.js';
import type {
  ArtifactEvent,
  BuildState,
  BuildStateArtifactEntry,
  BuildStateInputEntry,
  EventLogState,
  InputEvent,
  RevisionId,
  RunConfig,
} from './types.js';

export async function readEventLogState(args: {
  eventLog: EventLog;
  movieId: string;
}): Promise<EventLogState> {
  const latestInputsById = new Map<string, InputEvent>();
  let latestRevision: RevisionId | null = null;

  for await (const event of args.eventLog.streamInputs(args.movieId)) {
    if (!isCanonicalInputId(event.id)) {
      throw createRuntimeError(
        RuntimeErrorCode.NON_CANONICAL_INPUT_ID,
        `Event log input id "${event.id}" is not canonical.`,
        { context: args.movieId }
      );
    }
    latestInputsById.set(event.id, event);
    latestRevision = latestRevisionId(latestRevision, event.revision);
  }

  const latestArtifactsById = new Map<string, ArtifactEvent>();
  const latestSucceededArtifactIds = new Set<string>();
  const latestFailedArtifactIds = new Set<string>();

  for await (const event of args.eventLog.streamArtifacts(args.movieId)) {
    if (!isCanonicalArtifactId(event.artifactId)) {
      throw createRuntimeError(
        RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
        `Event log artifact id "${event.artifactId}" is not canonical.`,
        { context: args.movieId }
      );
    }
    latestArtifactsById.set(event.artifactId, event);
    latestRevision = latestRevisionId(latestRevision, event.revision);
  }

  for (const [artifactId, event] of latestArtifactsById) {
    if (event.status === 'succeeded') {
      latestSucceededArtifactIds.add(artifactId);
      continue;
    }
    if (event.status === 'failed') {
      latestFailedArtifactIds.add(artifactId);
    }
  }

  return {
    latestRevision,
    latestInputsById,
    latestArtifactsById,
    latestSucceededArtifactIds,
    latestFailedArtifactIds,
  };
}

export function buildBuildStateFromEventLogState(args: {
  eventLogState: EventLogState;
  targetRevision: RevisionId;
  baseRevision?: RevisionId | null;
  createdAt: string;
  runConfig?: RunConfig;
}): BuildState {
  const inputs = Object.fromEntries(
    Array.from(args.eventLogState.latestInputsById.entries()).map(([id, event]) => [
      id,
      toBuildStateInputEntry(event),
    ])
  );
  const artifacts = Object.fromEntries(
    Array.from(args.eventLogState.latestArtifactsById.entries())
      .filter(([, event]) => event.status === 'succeeded')
      .map(([artifactId, event]) => [artifactId, toBuildStateArtifactEntry(event)])
  );

  return {
    revision: args.targetRevision,
    baseRevision: args.baseRevision ?? null,
    createdAt: args.createdAt,
    inputs,
    artifacts,
    timeline: {},
    ...(args.runConfig ? { runConfig: args.runConfig } : {}),
  };
}

export function deriveArtifactHash(event: ArtifactEvent): string {
  if (event.output.blob?.hash) {
    return event.output.blob.hash;
  }
  return hashPayload({
    artifactId: event.artifactId,
    revision: event.revision,
  }).hash;
}

function toBuildStateInputEntry(event: InputEvent): BuildStateInputEntry {
  return {
    hash: event.hash,
    payloadDigest: hashPayload(event.payload).canonical,
    createdAt: event.createdAt,
  };
}

function toBuildStateArtifactEntry(
  event: ArtifactEvent
): BuildStateArtifactEntry {
  return {
    hash: deriveArtifactHash(event),
    blob: event.output.blob,
    producedBy: event.producedBy,
    producerId: event.producerId,
    status: event.status,
    diagnostics: event.diagnostics,
    createdAt: event.createdAt,
    editedBy: event.editedBy,
    originalHash: event.originalHash,
    inputsHash: event.inputsHash,
  };
}
