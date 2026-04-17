import { isCanonicalArtifactId, isCanonicalInputId } from './canonical-ids.js';
import type { EventLog } from './event-log.js';
import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';
import { hashPayload } from './hashing.js';
import { compareRevisionIds, latestRevisionId } from './revisions.js';
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
  return readEventLogStateWithinRevisionWindow(args);
}

export async function readEventLogStateAtRevision(args: {
  eventLog: EventLog;
  movieId: string;
  targetRevision: RevisionId;
}): Promise<EventLogState> {
  return readEventLogStateWithinRevisionWindow(args);
}

async function readEventLogStateWithinRevisionWindow(args: {
  eventLog: EventLog;
  movieId: string;
  targetRevision?: RevisionId;
}): Promise<EventLogState> {
  const latestInputsById = new Map<string, InputEvent>();
  const revisionCreatedAtByRevision = new Map<RevisionId, string>();
  let latestRevision: RevisionId | null = null;

  for await (const event of args.eventLog.streamInputs(args.movieId)) {
    if (isAfterTargetRevision(event.revision, args.targetRevision)) {
      continue;
    }
    if (!isCanonicalInputId(event.id)) {
      throw createRuntimeError(
        RuntimeErrorCode.NON_CANONICAL_INPUT_ID,
        `Event log input id "${event.id}" is not canonical.`,
        { context: args.movieId }
      );
    }
    latestInputsById.set(event.id, event);
    recordRevisionCreatedAt(
      revisionCreatedAtByRevision,
      event.revision,
      event.createdAt
    );
    latestRevision = latestRevisionId(latestRevision, event.revision);
  }

  const latestArtifactsById = new Map<string, ArtifactEvent>();
  const latestSucceededArtifactIds = new Set<string>();
  const latestFailedArtifactIds = new Set<string>();

  for await (const event of args.eventLog.streamArtifacts(args.movieId)) {
    if (isAfterTargetRevision(event.revision, args.targetRevision)) {
      continue;
    }
    if (!isCanonicalArtifactId(event.artifactId)) {
      throw createRuntimeError(
        RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
        `Event log artifact id "${event.artifactId}" is not canonical.`,
        { context: args.movieId }
      );
    }
    latestArtifactsById.set(event.artifactId, event);
    recordRevisionCreatedAt(
      revisionCreatedAtByRevision,
      event.revision,
      event.createdAt
    );
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
    revisionCreatedAtByRevision,
    latestInputsById,
    latestArtifactsById,
    latestSucceededArtifactIds,
    latestFailedArtifactIds,
  };
}

function isAfterTargetRevision(
  revision: RevisionId,
  targetRevision?: RevisionId
): boolean {
  if (!targetRevision) {
    return false;
  }

  return compareRevisionIds(revision, targetRevision) > 0;
}

function recordRevisionCreatedAt(
  revisionCreatedAtByRevision: Map<RevisionId, string>,
  revision: RevisionId,
  createdAt: string
): void {
  const existing = revisionCreatedAtByRevision.get(revision);
  if (!existing || createdAt < existing) {
    revisionCreatedAtByRevision.set(revision, createdAt);
  }
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
