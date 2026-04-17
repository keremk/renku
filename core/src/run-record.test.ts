import { describe, expect, it } from 'vitest';
import { createRunRecordService } from './run-record.js';
import { createStorageContext, initializeMovieStorage } from './storage.js';

describe('RunRecordService.finalize', () => {
  it('merges execution runConfig into the planned runConfig', async () => {
    const storage = createStorageContext({
      kind: 'memory',
      basePath: 'builds',
    });
    await initializeMovieStorage(storage, 'movie-test');

    const service = createRunRecordService(storage);
    await service.write('movie-test', {
      revision: 'rev-0001',
      createdAt: '2026-01-01T00:00:00.000Z',
      inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash',
      planPath: 'runs/rev-0001-plan.json',
      runConfig: {
        regenerateIds: ['Artifact:SceneImage[0]'],
        upToLayer: 3,
      },
      status: 'planned',
    });

    const finalized = await service.finalize({
      movieId: 'movie-test',
      revision: 'rev-0001',
      status: 'succeeded',
      runConfig: {
        concurrency: 4,
        dryRun: true,
      },
    });

    expect(finalized.runConfig).toEqual({
      regenerateIds: ['Artifact:SceneImage[0]'],
      upToLayer: 3,
      concurrency: 4,
      dryRun: true,
    });
  });
});
