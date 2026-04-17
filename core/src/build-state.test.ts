import { describe, expect, it } from 'vitest';
import { createEventLog, hashInputPayload } from './event-log.js';
import {
  createBuildStateService,
  BuildStateNotFoundError,
  resolveCurrentBuildContext,
} from './build-state.js';
import { isRenkuError, RuntimeErrorCode } from './errors/index.js';
import { createRunLifecycleService } from './run-lifecycle.js';
import { createStorageContext, initializeMovieStorage } from './storage.js';
import type {
  ArtifactEvent,
  Clock,
} from './types.js';
import { hashPayload } from './hashing.js';

function memoryContext() {
  return createStorageContext({ kind: 'memory', basePath: 'builds' });
}

const clock: Clock = {
  now: () => new Date('2025-01-01T00:00:00Z').toISOString(),
};

describe('BuildStateService', () => {
  it('returns a stable hash for the same current build state', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const buildStateService = createBuildStateService(ctx);
    const eventLog = createEventLog(ctx);
    const runLifecycleService = createRunLifecycleService(ctx);

    await eventLog.appendInput('demo', {
      id: 'Input:InquiryPrompt',
      revision: 'rev-0001',
      hash: hashInputPayload({ prompt: 'hello' }),
      payload: { prompt: 'hello' },
      editedBy: 'user',
      createdAt: clock.now(),
    });
    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:ScriptProducer.GeneratedScript[0]',
      revision: 'rev-0001',
      inputsHash: 'inputs:hash',
      output: {
        blob: {
          hash: 'script-v1-hash',
          size: 8,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:ScriptProducer[0]',
      producerId: 'Producer:ScriptProducer',
      createdAt: clock.now(),
    });
    await runLifecycleService.appendStarted('demo', {
      type: 'run-started',
      revision: 'rev-0001',
      startedAt: clock.now(),
      inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash',
      planPath: 'runs/rev-0001-plan.json',
      runConfig: {},
    });

    const first = await buildStateService.loadCurrent('demo');
    const second = await buildStateService.loadCurrent('demo');

    expect(second.hash).toBe(first.hash);
  });

  it('keeps artifact-only revisions deterministic when no matching run exists', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const buildStateService = createBuildStateService(ctx);
    const eventLog = createEventLog(ctx);
    const runLifecycleService = createRunLifecycleService(ctx);

    await eventLog.appendInput('demo', {
      id: 'Input:InquiryPrompt',
      revision: 'rev-0001',
      hash: hashInputPayload({ prompt: 'hello' }),
      payload: { prompt: 'hello' },
      editedBy: 'user',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:ScriptProducer.GeneratedScript[0]',
      revision: 'rev-0001',
      inputsHash: 'inputs:hash',
      output: {
        blob: {
          hash: 'script-v1-hash',
          size: 8,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:ScriptProducer[0]',
      producerId: 'Producer:ScriptProducer',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    await runLifecycleService.appendStarted('demo', {
      type: 'run-started',
      revision: 'rev-0001',
      startedAt: '2025-01-01T00:00:00.000Z',
      inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash',
      planPath: 'runs/rev-0001-plan.json',
      runConfig: {},
    });
    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:ScriptProducer.GeneratedScript[0]',
      revision: 'rev-0002',
      inputsHash: 'inputs:hash',
      output: {
        blob: {
          hash: 'script-v2-hash',
          size: 8,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:ScriptProducer[0]',
      producerId: 'Producer:ScriptProducer',
      createdAt: '2025-01-02T12:34:56.000Z',
      editedBy: 'user',
      originalHash: 'script-v1-hash',
    });

    const first = await buildStateService.loadCurrent('demo');
    const second = await buildStateService.loadCurrent('demo');

    expect(first.buildState.revision).toBe('rev-0002');
    expect(first.buildState.createdAt).toBe('2025-01-02T12:34:56.000Z');
    expect(second.buildState.createdAt).toBe('2025-01-02T12:34:56.000Z');
    expect(second.hash).toBe(first.hash);
  });

  it('loads current build state from event logs and matching run lifecycle metadata', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const buildStateService = createBuildStateService(ctx);
    const eventLog = createEventLog(ctx);
    const runLifecycleService = createRunLifecycleService(ctx);

    await eventLog.appendInput('demo', {
      id: 'Input:InquiryPrompt',
      revision: 'rev-0001',
      hash: hashInputPayload({ prompt: 'hello' }),
      payload: { prompt: 'hello' },
      editedBy: 'user',
      createdAt: clock.now(),
    });
    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:ScriptProducer.GeneratedScript[0]',
      revision: 'rev-0001',
      inputsHash: 'inputs:hash',
      output: {
        blob: {
          hash: 'script-v1-hash',
          size: 8,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:ScriptProducer[0]',
      producerId: 'Producer:ScriptProducer',
      createdAt: clock.now(),
    });
    await runLifecycleService.appendStarted('demo', {
      type: 'run-started',
      revision: 'rev-0001',
      startedAt: clock.now(),
      inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash',
      planPath: 'runs/rev-0001-plan.json',
      runConfig: { concurrency: 2 },
    });

    const { buildState, hash } = await buildStateService.loadCurrent('demo');
    expect(buildState.revision).toBe('rev-0001');
    expect(buildState.runConfig).toEqual({ concurrency: 2 });
    expect(buildState.inputs['Input:InquiryPrompt']?.hash).toBeDefined();
    expect(
      buildState.artifacts['Artifact:ScriptProducer.GeneratedScript[0]']?.hash
    ).toBe('script-v1-hash');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('keeps current build state pinned to the latest event-backed revision', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const buildStateService = createBuildStateService(ctx);
    const eventLog = createEventLog(ctx);
    const runLifecycleService = createRunLifecycleService(ctx);

    await eventLog.appendInput('demo', {
      id: 'Input:InquiryPrompt',
      revision: 'rev-9999',
      hash: hashInputPayload({ prompt: 'before rollover' }),
      payload: { prompt: 'before rollover' },
      editedBy: 'user',
      createdAt: clock.now(),
    });
    await runLifecycleService.appendStarted('demo', {
      type: 'run-started',
      revision: 'rev-9999',
      startedAt: clock.now(),
      inputSnapshotPath: 'runs/rev-9999-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash-9999',
      planPath: 'runs/rev-9999-plan.json',
      runConfig: {},
    });
    await runLifecycleService.appendStarted('demo', {
      type: 'run-started',
      revision: 'rev-10000',
      startedAt: clock.now(),
      inputSnapshotPath: 'runs/rev-10000-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash-10000',
      planPath: 'runs/rev-10000-plan.json',
      runConfig: { concurrency: 4 },
    });

    const { buildState } = await buildStateService.loadCurrent('demo');

    expect(buildState.revision).toBe('rev-9999');
    expect(buildState.runConfig).toEqual({});
  });

  it('derives build state from the event log', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const buildStateService = createBuildStateService(ctx);
    const eventLog = createEventLog(ctx);

    await eventLog.appendInput('demo', {
      id: 'Input:InquiryPrompt',
      revision: 'rev-0001',
      hash: hashInputPayload({ prompt: 'first' }),
      payload: { prompt: 'first' },
      editedBy: 'user',
      createdAt: new Date('2024-12-30T00:00:00Z').toISOString(),
    });
    await eventLog.appendInput('demo', {
      id: 'Input:InquiryPrompt',
      revision: 'rev-0002',
      hash: hashInputPayload({ prompt: 'second' }),
      payload: { prompt: 'second' },
      editedBy: 'user',
      createdAt: new Date('2024-12-31T00:00:00Z').toISOString(),
    });

    const artifactEvent: ArtifactEvent = {
      artifactId: 'Artifact:ScriptProducer.GeneratedScript[0]',
      revision: 'rev-0002',
      inputsHash: 'inputs:hash',
      output: {
        blob: {
          hash: 'script-v2-hash',
          size: 'Script v2'.length,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'script_producer',
      producerId: 'Producer:ScriptProducer',
      createdAt: new Date('2024-12-31T01:00:00Z').toISOString(),
    };
    await eventLog.appendArtifact('demo', artifactEvent);
    await eventLog.appendArtifact('demo', {
      ...artifactEvent,
      revision: 'rev-0003',
      status: 'failed',
      createdAt: new Date('2024-12-31T02:00:00Z').toISOString(),
    });

    const buildState = await buildStateService.buildFromEvents({
      movieId: 'demo',
      targetRevision: 'rev-0003',
      baseRevision: 'rev-0002',
      clock,
    });

    expect(buildState.inputs['Input:InquiryPrompt']?.hash).toBe(
      hashInputPayload({ prompt: 'second' })
    );
    expect(buildState.inputs['Input:InquiryPrompt']?.payloadDigest).toBe(
      hashPayload({ prompt: 'second' }).canonical
    );
    expect(Object.keys(buildState.artifacts)).toEqual([]);
    expect(buildState.revision).toBe('rev-0003');
    expect(buildState.baseRevision).toBe('rev-0002');
    expect(buildState.createdAt).toBe('2024-12-31T02:00:00.000Z');
  });

  it('rebuilds inputs from the requested revision instead of newer input events', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const buildStateService = createBuildStateService(ctx);
    const eventLog = createEventLog(ctx);

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

    const buildState = await buildStateService.buildFromEvents({
      movieId: 'demo',
      targetRevision: 'rev-0001',
      baseRevision: null,
    });

    expect(buildState.revision).toBe('rev-0001');
    expect(buildState.inputs['Input:InquiryPrompt']).toEqual({
      hash: hashInputPayload({ prompt: 'first' }),
      payloadDigest: hashPayload({ prompt: 'first' }).canonical,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
  });

  it('rebuilds artifacts from the requested revision instead of newer artifact events', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const buildStateService = createBuildStateService(ctx);
    const eventLog = createEventLog(ctx);

    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:ScriptProducer.GeneratedScript[0]',
      revision: 'rev-0001',
      inputsHash: 'inputs:hash',
      output: {
        blob: {
          hash: 'script-v1-hash',
          size: 8,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:ScriptProducer[0]',
      producerId: 'Producer:ScriptProducer',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:ScriptProducer.GeneratedScript[0]',
      revision: 'rev-0002',
      inputsHash: 'inputs:hash',
      output: {},
      status: 'failed',
      producedBy: 'Producer:ScriptProducer[0]',
      producerId: 'Producer:ScriptProducer',
      createdAt: '2025-01-02T00:00:00.000Z',
    });

    const buildState = await buildStateService.buildFromEvents({
      movieId: 'demo',
      targetRevision: 'rev-0001',
      baseRevision: null,
    });

    expect(buildState.revision).toBe('rev-0001');
    expect(buildState.artifacts['Artifact:ScriptProducer.GeneratedScript[0]']).toEqual({
      hash: 'script-v1-hash',
      blob: {
        hash: 'script-v1-hash',
        size: 8,
        mimeType: 'text/plain',
      },
      producedBy: 'Producer:ScriptProducer[0]',
      producerId: 'Producer:ScriptProducer',
      status: 'succeeded',
      diagnostics: undefined,
      createdAt: '2025-01-01T00:00:00.000Z',
      editedBy: undefined,
      originalHash: undefined,
      inputsHash: 'inputs:hash',
    });
  });

  it('excludes stale succeeded artifact when latest event is failed', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const buildStateService = createBuildStateService(ctx);
    const eventLog = createEventLog(ctx);

    const succeededEvent: ArtifactEvent = {
      artifactId: 'Artifact:ScriptProducer.GeneratedScript[0]',
      revision: 'rev-0001',
      inputsHash: 'inputs:hash',
      output: {
        blob: {
          hash: 'artifact-a-hash',
          size: 100,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:ScriptProducer[0]',
      createdAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    };
    await eventLog.appendArtifact('demo', succeededEvent);

    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:AudioProducer.GeneratedAudio[0]',
      revision: 'rev-0001',
      inputsHash: 'inputs:hash',
      output: {
        blob: {
          hash: 'artifact-b-hash',
          size: 200,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:AudioProducer[0]',
      createdAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    });

    await eventLog.appendArtifact('demo', {
      ...succeededEvent,
      revision: 'rev-0002',
      status: 'failed',
      createdAt: new Date('2025-01-02T00:00:00Z').toISOString(),
    });

    const buildState = await buildStateService.buildFromEvents({
      movieId: 'demo',
      targetRevision: 'rev-0002',
      baseRevision: 'rev-0001',
      clock,
    });

    expect(
      buildState.artifacts['Artifact:ScriptProducer.GeneratedScript[0]']
    ).toBeUndefined();
    expect(
      buildState.artifacts['Artifact:AudioProducer.GeneratedAudio[0]']
    ).toBeDefined();
    expect(
      buildState.artifacts['Artifact:AudioProducer.GeneratedAudio[0]']?.hash
    ).toBe('artifact-b-hash');
  });

  it('mirrors producerId from succeeded artifact events into the build state', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const buildStateService = createBuildStateService(ctx);
    const eventLog = createEventLog(ctx);

    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:AudioProducer.GeneratedAudio[0]',
      revision: 'rev-0001',
      inputsHash: 'inputs:hash',
      output: {
        blob: {
          hash: 'artifact-a-hash',
          size: 100,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:AudioProducer[0]',
      producerId: 'Producer:AudioProducer',
      createdAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    });

    const buildState = await buildStateService.buildFromEvents({
      movieId: 'demo',
      targetRevision: 'rev-0001',
      baseRevision: null,
      clock,
    });

    expect(
      buildState.artifacts['Artifact:AudioProducer.GeneratedAudio[0]']?.producerId
    ).toBe('Producer:AudioProducer');
  });

  it('uses the event timestamp when building an event-only revision without a run', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const buildStateService = createBuildStateService(ctx);
    const eventLog = createEventLog(ctx);

    await eventLog.appendInput('demo', {
      id: 'Input:InquiryPrompt',
      revision: 'rev-0001',
      hash: hashInputPayload({ prompt: 'hello' }),
      payload: { prompt: 'hello' },
      editedBy: 'user',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:ScriptProducer.GeneratedScript[0]',
      revision: 'rev-0002',
      inputsHash: 'inputs:hash',
      output: {
        blob: {
          hash: 'script-v2-hash',
          size: 8,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:ScriptProducer[0]',
      producerId: 'Producer:ScriptProducer',
      createdAt: '2025-01-02T12:34:56.000Z',
      editedBy: 'user',
    });

    const buildState = await buildStateService.buildFromEvents({
      movieId: 'demo',
      targetRevision: 'rev-0002',
      baseRevision: 'rev-0001',
    });

    expect(buildState.createdAt).toBe('2025-01-02T12:34:56.000Z');
  });

  it('errors when loading build state without event or run data', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo', { seedCurrentJson: false });
    const buildStateService = createBuildStateService(ctx);

    await expect(buildStateService.loadCurrent('demo')).rejects.toBeInstanceOf(
      BuildStateNotFoundError
    );
  });

  it('surfaces malformed run lifecycle JSON as a numbered runtime error', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo', { seedCurrentJson: false });
    await ctx.storage.write(
      ctx.resolve('demo', 'events', 'runs.log'),
      '{"type":"run-started"',
      { mimeType: 'application/x-ndjson' }
    );

    const buildStateService = createBuildStateService(ctx);

    try {
      await buildStateService.loadCurrent('demo');
      throw new Error('Expected loadCurrent() to reject for malformed JSON.');
    } catch (error) {
      expect(isRenkuError(error)).toBe(true);
      if (isRenkuError(error)) {
        expect(error.code).toBe(RuntimeErrorCode.INVALID_BUILD_HISTORY_JSON);
      }
    }
  });

  it('anchors editable snapshots to the current event-backed build revision', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const runLifecycleService = createRunLifecycleService(ctx);

    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:ScriptProducer.GeneratedScript[0]',
      revision: 'rev-0003',
      inputsHash: 'inputs:hash',
      output: {
        blob: {
          hash: 'script-v3-hash',
          size: 8,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:ScriptProducer[0]',
      producerId: 'Producer:ScriptProducer',
      createdAt: '2025-01-03T00:00:00.000Z',
    });
    await runLifecycleService.appendStarted('demo', {
      type: 'run-started',
      revision: 'rev-0003',
      startedAt: '2025-01-03T00:00:00.000Z',
      inputSnapshotPath: 'runs/rev-0003-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash-3',
      planPath: 'runs/rev-0003-plan.json',
      runConfig: {},
    });
    await runLifecycleService.appendCompleted('demo', {
      type: 'run-completed',
      revision: 'rev-0003',
      completedAt: '2025-01-03T00:05:00.000Z',
      status: 'succeeded',
      summary: {
        jobCount: 1,
        counts: { succeeded: 1, failed: 0, skipped: 0 },
        layers: 1,
      },
    });
    await runLifecycleService.appendStarted('demo', {
      type: 'run-started',
      revision: 'rev-0004',
      startedAt: '2025-01-04T00:00:00.000Z',
      inputSnapshotPath: 'runs/rev-0004-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash-4',
      planPath: 'runs/rev-0004-plan.json',
      runConfig: {},
    });
    await runLifecycleService.appendCancelled('demo', {
      type: 'run-cancelled',
      revision: 'rev-0004',
      completedAt: '2025-01-04T00:01:00.000Z',
    });

    const context = await resolveCurrentBuildContext({
      storage: ctx,
      movieId: 'demo',
    });

    expect(context.currentBuildRevision).toBe('rev-0003');
    expect(context.latestRunRevision).toBe('rev-0004');
    expect(context.snapshotSourceRun?.revision).toBe('rev-0003');
  });

  it('falls back to the latest started run when no event-backed build exists', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const runLifecycleService = createRunLifecycleService(ctx);

    await runLifecycleService.appendStarted('demo', {
      type: 'run-started',
      revision: 'rev-0001',
      startedAt: '2025-01-01T00:00:00.000Z',
      inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash-1',
      planPath: 'runs/rev-0001-plan.json',
      runConfig: {},
    });

    const context = await resolveCurrentBuildContext({
      storage: ctx,
      movieId: 'demo',
    });

    expect(context.currentBuildRevision).toBeNull();
    expect(context.latestRunRevision).toBe('rev-0001');
    expect(context.snapshotSourceRun?.revision).toBe('rev-0001');
  });
});
