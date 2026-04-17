import { describe, expect, it } from 'vitest';
import { isRenkuError, RuntimeErrorCode } from './errors/index.js';
import { createRunLifecycleService } from './run-lifecycle.js';
import { createStorageContext, initializeMovieStorage } from './storage.js';

function memoryContext() {
  return createStorageContext({ kind: 'memory', basePath: 'builds' });
}

describe('RunLifecycleService', () => {
  it('builds projections from planned, started, and completed events', async () => {
    const storage = memoryContext();
    await initializeMovieStorage(storage, 'movie-test');

    const service = createRunLifecycleService(storage);
    await service.appendStarted('movie-test', {
      type: 'run-started',
      revision: 'rev-0001',
      startedAt: '2026-01-01T00:01:00.000Z',
      inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash',
      planPath: 'runs/rev-0001-plan.json',
      runConfig: {
        regenerateIds: ['Artifact:SceneImage[0]'],
      },
    });
    await service.appendCompleted('movie-test', {
      type: 'run-completed',
      revision: 'rev-0001',
      completedAt: '2026-01-01T00:02:00.000Z',
      status: 'succeeded',
      summary: {
        jobCount: 3,
        counts: {
          succeeded: 3,
          failed: 0,
          skipped: 0,
        },
        layers: 2,
      },
    });

    const projection = await service.load('movie-test', 'rev-0001');
    expect(projection).toEqual({
      revision: 'rev-0001',
      createdAt: '2026-01-01T00:01:00.000Z',
      inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash',
      planPath: 'runs/rev-0001-plan.json',
      runConfig: {
        regenerateIds: ['Artifact:SceneImage[0]'],
      },
      status: 'succeeded',
      startedAt: '2026-01-01T00:01:00.000Z',
      completedAt: '2026-01-01T00:02:00.000Z',
      summary: {
        jobCount: 3,
        counts: {
          succeeded: 3,
          failed: 0,
          skipped: 0,
        },
        layers: 2,
      },
    });
  });

  it('returns the numerically latest projection', async () => {
    const storage = memoryContext();
    await initializeMovieStorage(storage, 'movie-test');

    const service = createRunLifecycleService(storage);
    await service.appendStarted('movie-test', {
      type: 'run-started',
      revision: 'rev-9999',
      startedAt: '2026-01-01T00:00:00.000Z',
      inputSnapshotPath: 'runs/rev-9999-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash-1',
      planPath: 'runs/rev-9999-plan.json',
      runConfig: {},
    });
    await service.appendStarted('movie-test', {
      type: 'run-started',
      revision: 'rev-10000',
      startedAt: '2026-01-02T00:00:00.000Z',
      inputSnapshotPath: 'runs/rev-10000-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash-2',
      planPath: 'runs/rev-10000-plan.json',
      runConfig: {},
    });

    const latest = await service.loadLatest('movie-test');
    expect(latest?.revision).toBe('rev-10000');
  });

  it('returns the latest projection at or before a revision', async () => {
    const storage = memoryContext();
    await initializeMovieStorage(storage, 'movie-test');

    const service = createRunLifecycleService(storage);
    await service.appendStarted('movie-test', {
      type: 'run-started',
      revision: 'rev-0001',
      startedAt: '2026-01-01T00:00:00.000Z',
      inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash-1',
      planPath: 'runs/rev-0001-plan.json',
      runConfig: {},
    });
    await service.appendStarted('movie-test', {
      type: 'run-started',
      revision: 'rev-0003',
      startedAt: '2026-01-03T00:00:00.000Z',
      inputSnapshotPath: 'runs/rev-0003-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash-3',
      planPath: 'runs/rev-0003-plan.json',
      runConfig: {},
    });

    const matching = await service.loadLatestAtOrBefore('movie-test', 'rev-0002');
    const earliest = await service.loadLatestAtOrBefore('movie-test', 'rev-0001');
    const missing = await service.loadLatestAtOrBefore('movie-test', 'rev-0000');

    expect(matching?.revision).toBe('rev-0001');
    expect(earliest?.revision).toBe('rev-0001');
    expect(missing).toBeNull();
  });

  it('rejects invalid lifecycle transitions', async () => {
    const storage = memoryContext();
    await initializeMovieStorage(storage, 'movie-test');

    const service = createRunLifecycleService(storage);
    await service.appendCompleted('movie-test', {
      type: 'run-completed',
      revision: 'rev-0001',
      completedAt: '2026-01-01T00:02:00.000Z',
      status: 'failed',
      summary: {
        jobCount: 1,
        counts: {
          succeeded: 0,
          failed: 1,
          skipped: 0,
        },
        layers: 1,
      },
    });

    await expect(service.list('movie-test')).rejects.toSatisfy((error) => {
      expect(isRenkuError(error)).toBe(true);
      if (isRenkuError(error)) {
        expect(error.code).toBe(RuntimeErrorCode.INVALID_RUN_LIFECYCLE_EVENT);
      }
      return true;
    });
  });

  it('requires a started run before terminal lifecycle events', async () => {
    const storage = memoryContext();
    await initializeMovieStorage(storage, 'movie-test');

    const service = createRunLifecycleService(storage);
    await service.appendCancelled('movie-test', {
      type: 'run-cancelled',
      revision: 'rev-0001',
      completedAt: '2026-01-01T00:02:00.000Z',
    });

    await expect(service.list('movie-test')).rejects.toSatisfy((error) => {
      expect(isRenkuError(error)).toBe(true);
      if (isRenkuError(error)) {
        expect(error.code).toBe(RuntimeErrorCode.INVALID_RUN_LIFECYCLE_EVENT);
      }
      return true;
    });
  });
});
