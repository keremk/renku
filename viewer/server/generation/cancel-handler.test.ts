/**
 * Integration tests for cancel-handler.ts - Job cancellation endpoint.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Manifest, ExecutionPlan } from '@gorenku/core';
import type { PlanCostSummary } from '@gorenku/providers';
import { handleCancelRequest } from './cancel-handler.js';
import { getJobManager, resetJobManager } from './job-manager.js';
import {
  createMockRequestEmpty,
  createMockResponse,
  parseResponseJson,
} from './test-utils.js';
import type { JobStatusResponse, CachedPlan } from './types.js';

// Helper to create a mock cached plan
function createMockPlanData(): Omit<CachedPlan, 'planId' | 'createdAt'> {
  return {
    movieId: 'movie-test',
    plan: { layers: [] } as unknown as ExecutionPlan,
    manifest: { revision: 'rev1' } as unknown as Manifest,
    manifestHash: 'hash123',
    resolvedInputs: { input1: 'value1' },
    providerOptions: new Map(),
    blueprintPath: '/test/blueprint.yaml',
    basePath: 'test-project/builds',
    costSummary: { totalCost: 10 } as PlanCostSummary,
    persist: vi.fn().mockResolvedValue(undefined),
  };
}

describe('handleCancelRequest', () => {
  beforeEach(() => {
    resetJobManager();
  });

  it('cancels running job', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'running');

    const req = createMockRequestEmpty('POST');
    const res = createMockResponse();

    await handleCancelRequest(req, res, job.jobId);

    expect(res.statusCode).toBe(200);
    const body = parseResponseJson<JobStatusResponse>(res);
    expect(body.status).toBe('cancelled');
    expect(body.completedAt).toBeUndefined();
  });

  it('cancels pending job', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    // Status is 'pending' by default

    const req = createMockRequestEmpty('POST');
    const res = createMockResponse();

    await handleCancelRequest(req, res, job.jobId);

    expect(res.statusCode).toBe(200);
    const body = parseResponseJson<JobStatusResponse>(res);
    expect(body.status).toBe('cancelled');
  });

  it('cancels planning job', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'planning');

    const req = createMockRequestEmpty('POST');
    const res = createMockResponse();

    await handleCancelRequest(req, res, job.jobId);

    expect(res.statusCode).toBe(200);
    const body = parseResponseJson<JobStatusResponse>(res);
    expect(body.status).toBe('cancelled');
  });

  it('returns 404 for unknown jobId', async () => {
    const req = createMockRequestEmpty('POST');
    const res = createMockResponse();

    await handleCancelRequest(req, res, 'job-unknown');

    expect(res.statusCode).toBe(404);
    const body = parseResponseJson<{ error: string; code: string }>(res);
    expect(body.error).toContain('Job not found');
  });

  it('returns 400 for already completed job', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'completed');

    const req = createMockRequestEmpty('POST');
    const res = createMockResponse();

    await handleCancelRequest(req, res, job.jobId);

    expect(res.statusCode).toBe(400);
    const body = parseResponseJson<{ error: string }>(res);
    expect(body.error).toContain('already completed');
  });

  it('returns 400 for already failed job', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'failed');

    const req = createMockRequestEmpty('POST');
    const res = createMockResponse();

    await handleCancelRequest(req, res, job.jobId);

    expect(res.statusCode).toBe(400);
    const body = parseResponseJson<{ error: string }>(res);
    expect(body.error).toContain('already failed');
  });

  it('returns 400 for already cancelled job', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.cancelJob(job.jobId); // Cancel via manager

    const req = createMockRequestEmpty('POST');
    const res = createMockResponse();

    await handleCancelRequest(req, res, job.jobId);

    expect(res.statusCode).toBe(400);
    const body = parseResponseJson<{ error: string }>(res);
    expect(body.error).toContain('already cancelled');
  });

  it('returns updated job status after cancellation', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'running');
    manager.updateJobProgress(job.jobId, 50, 1);

    const req = createMockRequestEmpty('POST');
    const res = createMockResponse();

    await handleCancelRequest(req, res, job.jobId);

    const body = parseResponseJson<JobStatusResponse>(res);
    expect(body.jobId).toBe(job.jobId);
    expect(body.movieId).toBe('movie-abc');
    expect(body.status).toBe('cancelled');
    expect(body.progress).toBe(50);
    expect(body.currentLayer).toBe(1);
    expect(body.totalLayers).toBe(3);
  });

  it('signals abort controller on cancellation', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'running');

    // Before cancellation
    expect(manager.isJobCancelled(job.jobId)).toBe(false);

    const req = createMockRequestEmpty('POST');
    const res = createMockResponse();

    await handleCancelRequest(req, res, job.jobId);

    // After cancellation
    expect(manager.isJobCancelled(job.jobId)).toBe(true);
  });

  it('broadcasts execution-cancelled event', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'running');

    const events: Array<{ type: string; message?: string }> = [];
    manager.subscribeToJob(job.jobId, (event) => {
      events.push({
        type: event.type,
        message: 'message' in event ? event.message : undefined,
      });
    });

    const req = createMockRequestEmpty('POST');
    const res = createMockResponse();

    await handleCancelRequest(req, res, job.jobId);

    expect(events.some((event) => event.type === 'execution-cancelled')).toBe(
      true
    );
  });
});
