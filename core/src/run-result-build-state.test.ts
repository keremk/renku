import { describe, expect, it } from 'vitest';
import { createEventLog, hashInputPayload } from './event-log.js';
import { buildRunResultBuildStateSnapshot } from './run-result-build-state.js';
import { createRunLifecycleService } from './run-lifecycle.js';
import { createStorageContext, initializeMovieStorage } from './storage.js';
import { hashPayload } from './hashing.js';
import type { BuildState } from './types.js';

function memoryContext() {
  return createStorageContext({ kind: 'memory', basePath: 'builds' });
}

describe('buildRunResultBuildStateSnapshot', () => {
  it('rebuilds the snapshot from events at the completed revision', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const runLifecycleService = createRunLifecycleService(ctx);

    await runLifecycleService.appendStarted('demo', {
      type: 'run-started',
      revision: 'rev-0001',
      startedAt: '2025-01-01T00:00:00.000Z',
      inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash',
      planPath: 'runs/rev-0001-plan.json',
      runConfig: { concurrency: 2 },
    });
    await eventLog.appendInput('demo', {
      id: 'Input:InquiryPrompt',
      revision: 'rev-0001',
      hash: hashInputPayload({ prompt: 'first' }),
      payload: { prompt: 'first' },
      editedBy: 'user',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    await eventLog.appendInput('demo', {
      id: 'Input:InquiryPrompt',
      revision: 'rev-0002',
      hash: hashInputPayload({ prompt: 'second' }),
      payload: { prompt: 'second' },
      editedBy: 'user',
      createdAt: '2025-01-02T00:00:00.000Z',
    });

    const baselineBuildState: BuildState = {
      revision: 'rev-0000',
      baseRevision: null,
      createdAt: '2024-12-31T00:00:00.000Z',
      inputs: {},
      artifacts: {},
      timeline: { persisted: true },
      runConfig: { concurrency: 1 },
    };

    const snapshot = await buildRunResultBuildStateSnapshot({
      movieId: 'demo',
      eventLog,
      buildState: baselineBuildState,
      revision: 'rev-0001',
      completedAt: '2025-01-01T00:05:00.000Z',
    });

    expect(snapshot.revision).toBe('rev-0001');
    expect(snapshot.inputs['Input:InquiryPrompt']).toEqual({
      hash: hashInputPayload({ prompt: 'first' }),
      payloadDigest: hashPayload({ prompt: 'first' }).canonical,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    expect(snapshot.timeline).toEqual({ persisted: true });
  });

  it('uses the completed revision run config instead of the baseline build state config', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const runLifecycleService = createRunLifecycleService(ctx);

    await runLifecycleService.appendStarted('demo', {
      type: 'run-started',
      revision: 'rev-0001',
      startedAt: '2025-01-01T00:01:00.000Z',
      inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash',
      planPath: 'runs/rev-0001-plan.json',
      runConfig: {
        regenerateIds: ['Artifact:SceneImage[0]'],
        concurrency: 8,
        upToLayer: 1,
      },
    });
    await eventLog.appendInput('demo', {
      id: 'Input:InquiryPrompt',
      revision: 'rev-0001',
      hash: hashInputPayload({ prompt: 'first' }),
      payload: { prompt: 'first' },
      editedBy: 'user',
      createdAt: '2025-01-01T00:00:00.000Z',
    });

    const baselineBuildState: BuildState = {
      revision: 'rev-0000',
      baseRevision: null,
      createdAt: '2024-12-31T00:00:00.000Z',
      inputs: {},
      artifacts: {},
      timeline: {},
      runConfig: {
        concurrency: 1,
        dryRun: true,
      },
    };

    const snapshot = await buildRunResultBuildStateSnapshot({
      movieId: 'demo',
      eventLog,
      buildState: baselineBuildState,
      revision: 'rev-0001',
      completedAt: '2025-01-01T00:05:00.000Z',
    });

    expect(snapshot.runConfig).toEqual({
      regenerateIds: ['Artifact:SceneImage[0]'],
      concurrency: 8,
      upToLayer: 1,
    });
  });
});
