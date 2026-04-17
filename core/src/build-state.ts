import { createHash } from 'node:crypto';
import { createEventLog } from './event-log.js';
import {
  buildBuildStateFromEventLogState,
  readEventLogStateAtRevision,
  readEventLogState,
} from './event-log-state.js';
import {
  RuntimeErrorCode,
  type ErrorCategory,
  type ErrorSeverity,
  type RenkuError,
} from './errors/index.js';
import { createRunLifecycleService } from './run-lifecycle.js';
import type { StorageContext } from './storage.js';
import type { BuildState, Clock, RevisionId } from './types.js';

export class BuildStateNotFoundError extends Error implements RenkuError {
  code = RuntimeErrorCode.BUILD_STATE_NOT_FOUND;
  category: ErrorCategory = 'runtime';
  severity: ErrorSeverity = 'error';

  constructor(movieId: string) {
    super(`No build state found for movie "${movieId}"`);
    this.name = 'BuildStateNotFoundError';
  }
}

/* eslint-disable no-unused-vars */
export interface BuildStateService {
  loadCurrent(movieId: string): Promise<{ buildState: BuildState; hash: string }>;
  buildFromEvents(args: {
    movieId: string;
    targetRevision: RevisionId;
    baseRevision?: RevisionId | null;
    clock?: Clock;
  }): Promise<BuildState>;
}

export function createBuildStateService(
  storage: StorageContext
): BuildStateService {
  const eventLog = createEventLog(storage);
  const runLifecycleService = createRunLifecycleService(storage);

  return {
    async loadCurrent(movieId) {
      const eventLogState = await readEventLogState({
        eventLog,
        movieId,
      });
      const latestRun = await runLifecycleService.loadLatest(movieId);

      if (
        !eventLogState.latestRevision &&
        !latestRun &&
        eventLogState.latestInputsById.size === 0 &&
        eventLogState.latestArtifactsById.size === 0
      ) {
        throw new BuildStateNotFoundError(movieId);
      }

      const revision = eventLogState.latestRevision ?? latestRun?.revision ?? 'rev-0000';
      const revisionRun =
        eventLogState.latestRevision
          ? await runLifecycleService.load(movieId, eventLogState.latestRevision)
          : latestRun;
      const createdAt =
        revisionRun?.createdAt ??
        eventLogState.revisionCreatedAtByRevision.get(revision) ??
        new Date().toISOString();
      const buildState = buildBuildStateFromEventLogState({
        eventLogState,
        targetRevision: revision,
        createdAt,
        runConfig: revisionRun?.runConfig,
      });

      return {
        buildState,
        hash: hashBuildState(JSON.stringify(buildState)),
      };
    },

    async buildFromEvents({
      movieId,
      targetRevision,
      baseRevision = null,
      clock,
    }) {
      const eventLogState = await readEventLogStateAtRevision({
        eventLog,
        movieId,
        targetRevision,
      });
      const runProjection = await runLifecycleService.load(movieId, targetRevision);
      const createdAt =
        runProjection?.createdAt ??
        eventLogState.revisionCreatedAtByRevision.get(targetRevision) ??
        clock?.now() ??
        new Date().toISOString();

      return buildBuildStateFromEventLogState({
        eventLogState,
        targetRevision,
        baseRevision,
        createdAt,
        runConfig: runProjection?.runConfig,
      });
    },
  };
}

function hashBuildState(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
