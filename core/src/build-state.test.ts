import { describe, expect, it } from 'vitest';
import { createEventLog, hashInputPayload } from './event-log.js';
import {
  createBuildStateService,
  BuildStateNotFoundError,
} from './build-state.js';
import { isRenkuError, RuntimeErrorCode } from './errors/index.js';
import { createRunRecordService } from './run-record.js';
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
    const runRecordService = createRunRecordService(ctx);

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
    await runRecordService.write('demo', {
      revision: 'rev-0001',
      createdAt: clock.now(),
      inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash',
      planPath: 'runs/rev-0001-plan.json',
      runConfig: {},
      status: 'planned',
    });

    const first = await buildStateService.loadCurrent('demo');
    const second = await buildStateService.loadCurrent('demo');

    expect(second.hash).toBe(first.hash);
  });

  it('loads current build state from event logs and latest run record', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const buildStateService = createBuildStateService(ctx);
    const eventLog = createEventLog(ctx);
    const runRecordService = createRunRecordService(ctx);

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
    await runRecordService.write('demo', {
      revision: 'rev-0001',
      createdAt: clock.now(),
      inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash',
      planPath: 'runs/rev-0001-plan.json',
      runConfig: { concurrency: 2 },
      status: 'planned',
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

  it('picks the numerically latest revision across event logs and run records', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const buildStateService = createBuildStateService(ctx);
    const eventLog = createEventLog(ctx);
    const runRecordService = createRunRecordService(ctx);

    await eventLog.appendInput('demo', {
      id: 'Input:InquiryPrompt',
      revision: 'rev-9999',
      hash: hashInputPayload({ prompt: 'before rollover' }),
      payload: { prompt: 'before rollover' },
      editedBy: 'user',
      createdAt: clock.now(),
    });
    await runRecordService.write('demo', {
      revision: 'rev-9999',
      createdAt: clock.now(),
      inputSnapshotPath: 'runs/rev-9999-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash-9999',
      planPath: 'runs/rev-9999-plan.json',
      runConfig: {},
      status: 'planned',
    });
    await runRecordService.write('demo', {
      revision: 'rev-10000',
      createdAt: clock.now(),
      inputSnapshotPath: 'runs/rev-10000-inputs.yaml',
      inputSnapshotHash: 'snapshot-hash-10000',
      planPath: 'runs/rev-10000-plan.json',
      runConfig: {},
      status: 'planned',
    });

    const { buildState } = await buildStateService.loadCurrent('demo');

    expect(buildState.revision).toBe('rev-10000');
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
    expect(buildState.createdAt).toBe(clock.now());
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

  it('errors when loading build state without event or run data', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo', { seedCurrentJson: false });
    const buildStateService = createBuildStateService(ctx);

    await expect(buildStateService.loadCurrent('demo')).rejects.toBeInstanceOf(
      BuildStateNotFoundError
    );
  });

  it('surfaces malformed run record JSON as a numbered runtime error', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo', { seedCurrentJson: false });
    await ctx.storage.write(
      ctx.resolve('demo', 'runs', 'rev-0001-run.json'),
      '{"revision":',
      { mimeType: 'application/json' }
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
});
