import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { FileStorage } from '@flystorage/file-storage';
import type { EventLog } from './event-log.js';
import { createEventLog } from './event-log.js';
import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';
import { compareRevisionIds } from './revisions.js';
import type { StorageContext } from './storage.js';
import type {
  RevisionId,
  RunCancelledEvent,
  RunCompletedEvent,
  RunLifecycleEvent,
  RunProjection,
  RunStartedEvent,
} from './types.js';

/* eslint-disable no-unused-vars */
export interface RunLifecycleService {
  appendStarted(movieId: string, event: RunStartedEvent): Promise<void>;
  appendCompleted(movieId: string, event: RunCompletedEvent): Promise<void>;
  appendCancelled(movieId: string, event: RunCancelledEvent): Promise<void>;
  load(movieId: string, revision: RevisionId): Promise<RunProjection | null>;
  loadLatest(movieId: string): Promise<RunProjection | null>;
  loadLatestAtOrBefore(
    movieId: string,
    revision: RevisionId
  ): Promise<RunProjection | null>;
  list(movieId: string): Promise<RunProjection[]>;
  writeInputSnapshot(
    movieId: string,
    revision: RevisionId,
    contents: Uint8Array
  ): Promise<{ path: string; hash: string }>;
}

export function createRunLifecycleService(
  storage: StorageContext
): RunLifecycleService {
  const eventLog = createEventLog(storage);

  return {
    async appendStarted(movieId, event) {
      await eventLog.appendRun(movieId, event);
    },

    async appendCompleted(movieId, event) {
      await eventLog.appendRun(movieId, event);
    },

    async appendCancelled(movieId, event) {
      await eventLog.appendRun(movieId, event);
    },

    async load(movieId, revision) {
      const projections = await this.list(movieId);
      return projections.find((entry) => entry.revision === revision) ?? null;
    },

    async loadLatest(movieId) {
      const projections = await this.list(movieId);
      return projections.length > 0 ? projections[projections.length - 1] ?? null : null;
    },

    async loadLatestAtOrBefore(movieId, revision) {
      const projections = await this.list(movieId);
      const eligible = projections.filter(
        (entry) => compareRevisionIds(entry.revision, revision) <= 0
      );
      return eligible.length > 0 ? eligible[eligible.length - 1] ?? null : null;
    },

    async list(movieId) {
      const projections = new Map<RevisionId, RunProjection>();

      for await (const event of eventLog.streamRuns(movieId)) {
        applyRunLifecycleEvent(movieId, projections, event);
      }

      return Array.from(projections.values()).sort((left, right) =>
        compareRevisionIds(left.revision, right.revision)
      );
    },

    async writeInputSnapshot(movieId, revision, contents) {
      const relativePath = buildInputSnapshotRelativePath(revision);
      const snapshotPath = storage.resolve(movieId, relativePath);
      await ensureParentDirectories(storage.storage, snapshotPath);
      await storage.storage.write(snapshotPath, Buffer.from(contents), {
        mimeType: 'application/x-yaml',
      });
      return {
        path: relativePath,
        hash: hashSnapshotBytes(contents),
      };
    },
  };
}

export async function readRunLifecycleProjectionFromEventLog(args: {
  eventLog: EventLog;
  movieId: string;
  revision: RevisionId;
}): Promise<RunProjection | null> {
  const projections = new Map<RevisionId, RunProjection>();

  for await (const event of args.eventLog.streamRuns(args.movieId)) {
    applyRunLifecycleEvent(args.movieId, projections, event);
  }

  return projections.get(args.revision) ?? null;
}

function buildInputSnapshotRelativePath(revision: RevisionId): string {
  return `runs/${revision}-inputs.yaml`;
}

function hashSnapshotBytes(contents: Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex');
}

function applyRunLifecycleEvent(
  movieId: string,
  projections: Map<RevisionId, RunProjection>,
  event: RunLifecycleEvent
): void {
  const existing = projections.get(event.revision);

  switch (event.type) {
    case 'run-started': {
      if (existing) {
        throw invalidRunEvent(movieId, event, 'Duplicate run-started event.');
      }
      projections.set(event.revision, {
        revision: event.revision,
        createdAt: event.startedAt,
        inputSnapshotPath: event.inputSnapshotPath,
        inputSnapshotHash: event.inputSnapshotHash,
        planPath: event.planPath,
        runConfig: event.runConfig,
        status: 'started',
        startedAt: event.startedAt,
      });
      return;
    }

    case 'run-completed': {
      if (!existing) {
        throw invalidRunEvent(
          movieId,
          event,
          'run-completed requires a prior run-started event.'
        );
      }
      if (existing.status !== 'started') {
        throw invalidRunEvent(
          movieId,
          event,
          `run-completed cannot follow status "${existing.status}".`
        );
      }
      projections.set(event.revision, {
        ...existing,
        status: event.status,
        completedAt: event.completedAt,
        summary: event.summary,
      });
      return;
    }

    case 'run-cancelled': {
      if (!existing) {
        throw invalidRunEvent(
          movieId,
          event,
          'run-cancelled requires a prior run-started event.'
        );
      }
      if (existing.status !== 'started') {
        throw invalidRunEvent(
          movieId,
          event,
          `run-cancelled cannot follow status "${existing.status}".`
        );
      }
      projections.set(event.revision, {
        ...existing,
        status: 'cancelled',
        completedAt: event.completedAt,
      });
    }
  }
}

function invalidRunEvent(
  movieId: string,
  event: RunLifecycleEvent,
  message: string
) {
  return createRuntimeError(
    RuntimeErrorCode.INVALID_RUN_LIFECYCLE_EVENT,
    `${message} Revision "${event.revision}" in build "${movieId}" is invalid.`,
    {
      context: movieId,
    }
  );
}

async function ensureParentDirectories(
  storage: FileStorage,
  targetPath: string
): Promise<void> {
  const segments = targetPath.split('/').slice(0, -1).filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!(await storage.directoryExists(current))) {
      await storage.createDirectory(current, {});
    }
  }
}
