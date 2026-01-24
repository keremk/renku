/**
 * Integration tests for status-handler.ts - Job listing and status endpoints.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Manifest, ExecutionPlan } from '@gorenku/core';
import type { PlanCostSummary } from '@gorenku/providers';
import { handleJobsListRequest, handleJobStatusRequest } from './status-handler.js';
import { getJobManager, resetJobManager } from './job-manager.js';
import {
  createMockRequestEmpty,
  createMockResponse,
  parseResponseJson,
} from './test-utils.js';
import type { JobsListResponse, JobStatusResponse, CachedPlan, BuildSummaryInfo } from './types.js';

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
    costSummary: { totalCost: 10 } as PlanCostSummary,
    persist: vi.fn().mockResolvedValue(undefined),
  };
}

describe('handleJobsListRequest', () => {
  beforeEach(() => {
    resetJobManager();
  });

  it('returns empty array when no jobs', async () => {
    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleJobsListRequest(req, res);

    expect(res.statusCode).toBe(200);
    const body = parseResponseJson<JobsListResponse>(res);
    expect(body.jobs).toEqual([]);
  });

  it('returns all jobs with status info', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job1 = manager.createJob('movie-1', cachedPlan.planId, 3);
    const job2 = manager.createJob('movie-2', cachedPlan.planId, 5);

    // Manually adjust timestamps for deterministic sorting
    job1.startedAt = new Date(Date.now() - 2000);
    job2.startedAt = new Date(Date.now() - 1000);

    manager.updateJobStatus(job1.jobId, 'running');
    manager.updateJobProgress(job1.jobId, 50, 1);

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleJobsListRequest(req, res);

    expect(res.statusCode).toBe(200);
    const body = parseResponseJson<JobsListResponse>(res);
    expect(body.jobs).toHaveLength(2);

    // Jobs are sorted by startedAt descending (most recent first)
    expect(body.jobs[0].movieId).toBe('movie-2');
    expect(body.jobs[1].movieId).toBe('movie-1');
    expect(body.jobs[1].status).toBe('running');
    expect(body.jobs[1].progress).toBe(50);
    expect(body.jobs[1].currentLayer).toBe(1);
    expect(body.jobs[1].totalLayers).toBe(3);
  });

  it('includes completed jobs with completedAt', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-1', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'completed');

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleJobsListRequest(req, res);

    const body = parseResponseJson<JobsListResponse>(res);
    expect(body.jobs[0].status).toBe('completed');
    expect(body.jobs[0].completedAt).toBeDefined();
  });
});

describe('handleJobStatusRequest', () => {
  beforeEach(() => {
    resetJobManager();
  });

  it('returns job details for valid jobId', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleJobStatusRequest(req, res, job.jobId);

    expect(res.statusCode).toBe(200);
    const body = parseResponseJson<JobStatusResponse>(res);
    expect(body.jobId).toBe(job.jobId);
    expect(body.movieId).toBe('movie-abc');
    expect(body.status).toBe('pending');
    expect(body.totalLayers).toBe(3);
  });

  it('returns 404 for unknown jobId', async () => {
    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleJobStatusRequest(req, res, 'job-unknown');

    expect(res.statusCode).toBe(404);
    const body = parseResponseJson<{ error: string; code: string }>(res);
    expect(body.error).toContain('Job not found');
  });

  it('includes jobDetails array', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

    manager.updateJobDetail(job.jobId, {
      jobId: 'detail-1',
      producer: 'VideoProducer',
      status: 'succeeded',
      layerIndex: 0,
    });
    manager.updateJobDetail(job.jobId, {
      jobId: 'detail-2',
      producer: 'AudioProducer',
      status: 'running',
      layerIndex: 1,
    });

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleJobStatusRequest(req, res, job.jobId);

    const body = parseResponseJson<JobStatusResponse>(res);
    expect(body.jobDetails).toHaveLength(2);
    expect(body.jobDetails?.[0].producer).toBe('VideoProducer');
    expect(body.jobDetails?.[1].producer).toBe('AudioProducer');
  });

  it('includes summary when completed', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

    const summary: BuildSummaryInfo = {
      status: 'succeeded',
      jobCount: 5,
      counts: { succeeded: 5, failed: 0, skipped: 0 },
      manifestRevision: 'rev2',
      manifestPath: '/path/to/manifest.json',
    };

    manager.updateJobStatus(job.jobId, 'completed');
    manager.setJobSummary(job.jobId, summary);

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleJobStatusRequest(req, res, job.jobId);

    const body = parseResponseJson<JobStatusResponse>(res);
    expect(body.status).toBe('completed');
    expect(body.summary).toEqual(summary);
  });

  it('includes error when failed', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

    manager.updateJobStatus(job.jobId, 'failed');
    manager.setJobError(job.jobId, 'Provider API rate limited');

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleJobStatusRequest(req, res, job.jobId);

    const body = parseResponseJson<JobStatusResponse>(res);
    expect(body.status).toBe('failed');
    expect(body.error).toBe('Provider API rate limited');
  });

  it('includes progress information', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 5);

    manager.updateJobStatus(job.jobId, 'running');
    manager.updateJobProgress(job.jobId, 60, 2);

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleJobStatusRequest(req, res, job.jobId);

    const body = parseResponseJson<JobStatusResponse>(res);
    expect(body.progress).toBe(60);
    expect(body.currentLayer).toBe(2);
    expect(body.totalLayers).toBe(5);
  });
});
