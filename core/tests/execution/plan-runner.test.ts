/* eslint-env node */
import { describe, expect, it } from 'vitest';
import {
  createEventLog,
  createManifestService,
  createStorageContext,
  initializeMovieStorage,
  isRenkuError,
  RuntimeErrorCode,
  executePlanWithConcurrency,
  type ExecutionPlan,
  type Manifest,
  type ProduceFn,
  type JobDescriptor,
  type ProviderName,
} from '../../src/index.js';

async function createRunnerContext() {
  const movieId = 'movie-test';
  const storage = createStorageContext({ kind: 'memory' });
  await initializeMovieStorage(storage, movieId);
  const eventLog = createEventLog(storage);
  const manifestService = createManifestService(storage);
  const manifest: Manifest = {
    revision: 'rev-0000',
    baseRevision: null,
    createdAt: new Date().toISOString(),
    inputs: {},
    artefacts: {},
  };
  return { movieId, storage, eventLog, manifestService, manifest };
}

const makeJob = (jobId: string): JobDescriptor => ({
  jobId,
  producer: jobId,
  inputs: [],
  produces: [`Artifact:${jobId}`],
  provider: 'openai' as ProviderName,
  providerModel: 'test-model',
  rateKey: 'openai:test-model',
});

describe('executePlanWithConcurrency', () => {
  it('runs layer jobs in parallel up to the limit and keeps layers sequential', async () => {
    const { movieId, storage, eventLog, manifestService, manifest } = await createRunnerContext();

    const layerOne = ['job-1', 'job-2', 'job-3'].map(makeJob);
    const layerTwo = [makeJob('job-4')];
    const plan: ExecutionPlan = {
      revision: 'rev-0001',
      manifestBaseHash: 'hash',
      layers: [layerOne, layerTwo],
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 2,
    };

    const durations = new Map<string, number>([
      ['job-1', 30],
      ['job-2', 10],
      ['job-3', 20],
      ['job-4', 5],
    ]);

    let active = 0;
    let peak = 0;
    let completedLayerOne = 0;
    let layerTwoStartedAfter = 0;
    const starts: string[] = [];

    const produce: ProduceFn = async ({ job }) => {
      const duration = durations.get(job.jobId) ?? 0;
      starts.push(job.jobId);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => globalThis.setTimeout(resolve, duration));
      active -= 1;
      if (layerOne.some((entry) => entry.jobId === job.jobId)) {
        completedLayerOne += 1;
      } else {
        layerTwoStartedAfter = completedLayerOne;
      }
      return { jobId: job.jobId, status: 'succeeded', artefacts: [] };
    };

    const result = await executePlanWithConcurrency(
      plan,
      {
        movieId,
        manifest,
        storage,
        eventLog,
        manifestService,
        produce,
      },
      { concurrency: 2 },
    );

    expect(peak).toBeLessThanOrEqual(2);
    expect(layerTwoStartedAfter).toBe(layerOne.length);
    expect(starts.slice(0, layerOne.length)).toEqual(layerOne.map((job) => job.jobId));
    expect(starts[layerOne.length]).toBe('job-4');
    expect(result.jobs).toHaveLength(4);
  });

  it('stops executing after reaching the requested layer', async () => {
    const { movieId, storage, eventLog, manifestService, manifest } = await createRunnerContext();
    const layers: ExecutionPlan['layers'] = [
      [makeJob('layer-0-job')],
      [makeJob('layer-1-job')],
      [makeJob('layer-2-job')],
    ];
    const plan: ExecutionPlan = {
      revision: 'rev-0002',
      manifestBaseHash: 'hash',
      layers,
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 3,
    };
    const executed: string[] = [];
    const produce: ProduceFn = async ({ job }) => {
      executed.push(job.jobId);
      return { jobId: job.jobId, status: 'succeeded', artefacts: [] };
    };

    const result = await executePlanWithConcurrency(
      plan,
      { movieId, manifest, storage, eventLog, manifestService, produce },
      { concurrency: 2, upToLayer: 1 },
    );

    expect(executed).toEqual(['layer-0-job', 'layer-1-job']);
    expect(result.jobs).toHaveLength(2);
  });

  it('rejects negative upToLayer values', async () => {
    const { movieId, storage, eventLog, manifestService, manifest } = await createRunnerContext();
    const plan: ExecutionPlan = {
      revision: 'rev-0003',
      manifestBaseHash: 'hash',
      layers: [[makeJob('job-a')]],
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 1,
    };
    const produce: ProduceFn = async ({ job }) => ({
      jobId: job.jobId,
      status: 'succeeded',
      artefacts: [],
    });

    await expect(
      executePlanWithConcurrency(
        plan,
        { movieId, manifest, storage, eventLog, manifestService, produce },
        { concurrency: 1, upToLayer: -1 },
      ),
    ).rejects.toThrow(/upToLayer/);
  });

  it('skips layers before reRunFrom and executes layers from that point', async () => {
    const { movieId, storage, eventLog, manifestService, manifest } = await createRunnerContext();
    const layers: ExecutionPlan['layers'] = [
      [makeJob('layer-0-job')],
      [makeJob('layer-1-job')],
      [makeJob('layer-2-job')],
      [makeJob('layer-3-job')],
    ];
    const plan: ExecutionPlan = {
      revision: 'rev-0004',
      manifestBaseHash: 'hash',
      layers,
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 4,
    };
    const executed: string[] = [];
    const produce: ProduceFn = async ({ job }) => {
      executed.push(job.jobId);
      return { jobId: job.jobId, status: 'succeeded', artefacts: [] };
    };

    const result = await executePlanWithConcurrency(
      plan,
      { movieId, manifest, storage, eventLog, manifestService, produce },
      { concurrency: 2, reRunFrom: 2 },
    );

    // Only layers 2 and 3 should have been executed
    expect(executed).toEqual(['layer-2-job', 'layer-3-job']);
    // All jobs should be in results (skipped + executed)
    expect(result.jobs).toHaveLength(4);
    // Layers 0 and 1 should be marked as skipped
    expect(result.jobs[0]?.status).toBe('skipped');
    expect(result.jobs[1]?.status).toBe('skipped');
    expect(result.jobs[2]?.status).toBe('succeeded');
    expect(result.jobs[3]?.status).toBe('succeeded');
  });

  it('combines reRunFrom with upToLayer correctly', async () => {
    const { movieId, storage, eventLog, manifestService, manifest } = await createRunnerContext();
    const layers: ExecutionPlan['layers'] = [
      [makeJob('layer-0-job')],
      [makeJob('layer-1-job')],
      [makeJob('layer-2-job')],
      [makeJob('layer-3-job')],
      [makeJob('layer-4-job')],
    ];
    const plan: ExecutionPlan = {
      revision: 'rev-0005',
      manifestBaseHash: 'hash',
      layers,
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 5,
    };
    const executed: string[] = [];
    const produce: ProduceFn = async ({ job }) => {
      executed.push(job.jobId);
      return { jobId: job.jobId, status: 'succeeded', artefacts: [] };
    };

    const result = await executePlanWithConcurrency(
      plan,
      { movieId, manifest, storage, eventLog, manifestService, produce },
      { concurrency: 2, reRunFrom: 1, upToLayer: 3 },
    );

    // Only layers 1, 2, and 3 should have been executed
    expect(executed).toEqual(['layer-1-job', 'layer-2-job', 'layer-3-job']);
    // Layers 0 is skipped, 1-3 executed, 4 not included
    expect(result.jobs).toHaveLength(4);
    expect(result.jobs[0]?.status).toBe('skipped');
    expect(result.jobs[1]?.status).toBe('succeeded');
    expect(result.jobs[2]?.status).toBe('succeeded');
    expect(result.jobs[3]?.status).toBe('succeeded');
  });

  it('rejects reRunFrom greater than total layers', async () => {
    const { movieId, storage, eventLog, manifestService, manifest } = await createRunnerContext();
    const plan: ExecutionPlan = {
      revision: 'rev-0006',
      manifestBaseHash: 'hash',
      layers: [[makeJob('job-a')], [makeJob('job-b')]],
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 2,
    };
    const produce: ProduceFn = async ({ job }) => ({
      jobId: job.jobId,
      status: 'succeeded',
      artefacts: [],
    });

    await expect(
      executePlanWithConcurrency(
        plan,
        { movieId, manifest, storage, eventLog, manifestService, produce },
        { concurrency: 1, reRunFrom: 5 },
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isRenkuError(error) && error.code === RuntimeErrorCode.RERUN_FROM_EXCEEDS_LAYERS,
    );
  });

  it('rejects reRunFrom greater than upToLayer', async () => {
    const { movieId, storage, eventLog, manifestService, manifest } = await createRunnerContext();
    const plan: ExecutionPlan = {
      revision: 'rev-0007',
      manifestBaseHash: 'hash',
      layers: [[makeJob('job-a')], [makeJob('job-b')], [makeJob('job-c')]],
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 3,
    };
    const produce: ProduceFn = async ({ job }) => ({
      jobId: job.jobId,
      status: 'succeeded',
      artefacts: [],
    });

    await expect(
      executePlanWithConcurrency(
        plan,
        { movieId, manifest, storage, eventLog, manifestService, produce },
        { concurrency: 1, reRunFrom: 2, upToLayer: 1 },
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isRenkuError(error) && error.code === RuntimeErrorCode.RERUN_FROM_GREATER_THAN_UPTO,
    );
  });

  it('rejects negative reRunFrom values', async () => {
    const { movieId, storage, eventLog, manifestService, manifest } = await createRunnerContext();
    const plan: ExecutionPlan = {
      revision: 'rev-0008',
      manifestBaseHash: 'hash',
      layers: [[makeJob('job-a')]],
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 1,
    };
    const produce: ProduceFn = async ({ job }) => ({
      jobId: job.jobId,
      status: 'succeeded',
      artefacts: [],
    });

    await expect(
      executePlanWithConcurrency(
        plan,
        { movieId, manifest, storage, eventLog, manifestService, produce },
        { concurrency: 1, reRunFrom: -1 },
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isRenkuError(error) && error.code === RuntimeErrorCode.INVALID_RERUN_FROM_VALUE,
    );
  });

  it('executes all layers when reRunFrom is 0', async () => {
    const { movieId, storage, eventLog, manifestService, manifest } = await createRunnerContext();
    const layers: ExecutionPlan['layers'] = [
      [makeJob('layer-0-job')],
      [makeJob('layer-1-job')],
    ];
    const plan: ExecutionPlan = {
      revision: 'rev-0009',
      manifestBaseHash: 'hash',
      layers,
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 2,
    };
    const executed: string[] = [];
    const produce: ProduceFn = async ({ job }) => {
      executed.push(job.jobId);
      return { jobId: job.jobId, status: 'succeeded', artefacts: [] };
    };

    const result = await executePlanWithConcurrency(
      plan,
      { movieId, manifest, storage, eventLog, manifestService, produce },
      { concurrency: 2, reRunFrom: 0 },
    );

    // All layers should be executed (reRunFrom: 0 means start from beginning)
    expect(executed).toEqual(['layer-0-job', 'layer-1-job']);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.every((j) => j.status === 'succeeded')).toBe(true);
  });

  it('emits progress events during execution', async () => {
    const { movieId, storage, eventLog, manifestService, manifest } = await createRunnerContext();
    const layers: ExecutionPlan['layers'] = [
      [makeJob('layer-0-job')],
      [makeJob('layer-1-job')],
    ];
    const plan: ExecutionPlan = {
      revision: 'rev-0010',
      manifestBaseHash: 'hash',
      layers,
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 2,
    };
    const produce: ProduceFn = async ({ job }) => ({
      jobId: job.jobId,
      status: 'succeeded',
      artefacts: [],
    });

    const events: Array<{ type: string; layerIndex?: number }> = [];

    await executePlanWithConcurrency(
      plan,
      { movieId, manifest, storage, eventLog, manifestService, produce },
      {
        concurrency: 1,
        onProgress: (event) => {
          events.push({ type: event.type, layerIndex: event.layerIndex });
        },
      },
    );

    // Should have layer-start, job-start, job-complete, layer-complete for each layer
    expect(events.filter((e) => e.type === 'layer-start')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'job-start')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'job-complete')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'layer-complete')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'execution-complete')).toHaveLength(1);
  });

  it('supports cancellation via AbortSignal', async () => {
    const { movieId, storage, eventLog, manifestService, manifest } = await createRunnerContext();
    const layers: ExecutionPlan['layers'] = [
      [makeJob('layer-0-job')],
      [makeJob('layer-1-job')],
      [makeJob('layer-2-job')],
    ];
    const plan: ExecutionPlan = {
      revision: 'rev-0011',
      manifestBaseHash: 'hash',
      layers,
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 3,
    };

    const abortController = new AbortController();
    const executed: string[] = [];

    const produce: ProduceFn = async ({ job }) => {
      executed.push(job.jobId);
      // Cancel after layer 0
      if (job.jobId === 'layer-0-job') {
        abortController.abort();
      }
      return { jobId: job.jobId, status: 'succeeded', artefacts: [] };
    };

    const result = await executePlanWithConcurrency(
      plan,
      { movieId, manifest, storage, eventLog, manifestService, produce },
      { concurrency: 1, signal: abortController.signal },
    );

    // Only layer 0 should have been executed before cancellation
    expect(executed).toEqual(['layer-0-job']);
    expect(result.status).toBe('failed');
  });
});
