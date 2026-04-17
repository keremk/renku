import { createHash } from 'node:crypto';
import { createEventLog } from './event-log.js';
import {
  buildBuildStateFromEventLogState,
  readEventLogState,
} from './event-log-state.js';
import {
  RuntimeErrorCode,
  type ErrorCategory,
  type ErrorSeverity,
  type RenkuError,
} from './errors/index.js';
import { latestRevisionId } from './revisions.js';
import { createRunRecordService } from './run-record.js';
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
  const runRecordService = createRunRecordService(storage);

  return {
    async loadCurrent(movieId) {
      const eventLogState = await readEventLogState({
        eventLog,
        movieId,
      });
      const latestRunRecord = await runRecordService.loadLatest(movieId);

      if (
        !eventLogState.latestRevision &&
        !latestRunRecord &&
        eventLogState.latestInputsById.size === 0 &&
        eventLogState.latestArtifactsById.size === 0
      ) {
        throw new BuildStateNotFoundError(movieId);
      }

      const revision =
        latestRevisionId(
          eventLogState.latestRevision,
          latestRunRecord?.revision
        ) ?? 'rev-0000';
      const createdAt = latestRunRecord?.createdAt ?? new Date().toISOString();
      const buildState = buildBuildStateFromEventLogState({
        eventLogState,
        targetRevision: revision,
        createdAt,
        runConfig: latestRunRecord?.runConfig,
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
      const eventLogState = await readEventLogState({
        eventLog,
        movieId,
      });
      const latestRunRecord = await runRecordService.loadLatest(movieId);
      const createdAt =
        latestRunRecord?.createdAt ?? clock?.now() ?? new Date().toISOString();

      return buildBuildStateFromEventLogState({
        eventLogState,
        targetRevision,
        baseRevision,
        createdAt,
        runConfig: latestRunRecord?.runConfig,
      });
    },
  };
}

function hashBuildState(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
