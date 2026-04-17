import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  handleExecuteRequest,
  finalizeCancelledRunRecord,
} from './execute-handler.js';
import { getJobManager, resetJobManager } from './job-manager.js';
import {
  createMockRequest,
  createMockResponse,
  parseResponseJson,
} from './test-utils.js';
import {
  createRunRecordService,
  createStorageContext,
  initializeMovieStorage,
} from '@gorenku/core';

describe('handleExecuteRequest', () => {
  beforeEach(() => {
    resetJobManager();
  });

  it('returns 400 when concurrency is not an integer', async () => {
    const req = createMockRequest({ planId: 'plan-test', concurrency: 1.5 });
    const res = createMockResponse();

    const handled = await handleExecuteRequest(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(parseResponseJson<{ error: string }>(res)).toEqual({
      error: 'concurrency must be an integer',
    });
    expect(getJobManager().listJobs()).toHaveLength(0);
  });

  it('returns 400 when concurrency is a string value', async () => {
    const req = createMockRequest({
      planId: 'plan-test',
      concurrency: '2',
    });
    const res = createMockResponse();

    const handled = await handleExecuteRequest(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(parseResponseJson<{ error: string }>(res)).toEqual({
      error: 'concurrency must be an integer',
    });
    expect(getJobManager().listJobs()).toHaveLength(0);
  });

  it('marks a persisted planned run as cancelled on disk', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'viewer-execute-'));

    try {
      const storage = createStorageContext({
        kind: 'local',
        rootDir: tempRoot,
        basePath: 'builds',
      });
      const movieId = 'movie-cancelled';
      const revision = 'rev-0007';
      await initializeMovieStorage(storage, movieId);

      const runRecords = createRunRecordService(storage);
      await runRecords.write(movieId, {
        revision,
        createdAt: '2026-01-01T00:00:00.000Z',
        inputSnapshotPath: `runs/${revision}-inputs.yaml`,
        inputSnapshotHash: 'snapshot-hash',
        planPath: `runs/${revision}-plan.json`,
        runConfig: {},
        status: 'planned',
      });

      await finalizeCancelledRunRecord({
        cliConfig: {
          storage: {
            root: tempRoot,
          },
        },
        cachedPlan: {
          movieId,
          basePath: 'builds',
          plan: {
            revision,
          },
        },
      });

      const record = await runRecords.load(movieId, revision);
      expect(record?.status).toBe('cancelled');
      expect(record?.completedAt).toBeDefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
