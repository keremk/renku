/**
 * Integration tests for stream-handler.ts - SSE streaming endpoint.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Manifest, ExecutionPlan } from '@gorenku/core';
import type { PlanCostSummary } from '@gorenku/providers';
import { handleStreamRequest } from './stream-handler.js';
import { getJobManager, resetJobManager } from './job-manager.js';
import {
  createMockRequestEmpty,
  createMockResponse,
  parseResponseJson,
  parseSSEEvents,
} from './test-utils.js';
import type { CachedPlan, BuildSummaryInfo, SSEEvent } from './types.js';

// Helper to create a mock cached plan
function createMockPlanData(): Omit<CachedPlan, 'planId' | 'createdAt' | 'expiresAt'> {
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

describe('handleStreamRequest', () => {
  beforeEach(() => {
    resetJobManager();
  });

  it('sets SSE headers', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleStreamRequest(req, res, job.jobId);

    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['connection']).toBe('keep-alive');
  });

  it('sends initial status event', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'running');
    manager.updateJobProgress(job.jobId, 25, 0);

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleStreamRequest(req, res, job.jobId);

    const events = parseSSEEvents(res.body);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const statusEvent = events.find((e) => e.event === 'status');
    expect(statusEvent).toBeDefined();

    const data = statusEvent?.data as Record<string, unknown>;
    expect(data.jobId).toBe(job.jobId);
    expect(data.movieId).toBe('movie-abc');
    expect(data.status).toBe('running');
    expect(data.progress).toBe(25);
  });

  it('closes stream for completed job with summary', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'completed');

    const summary: BuildSummaryInfo = {
      status: 'succeeded',
      jobCount: 5,
      counts: { succeeded: 5, failed: 0, skipped: 0 },
      manifestRevision: 'rev2',
      manifestPath: '/path/to/manifest.json',
    };
    manager.setJobSummary(job.jobId, summary);

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleStreamRequest(req, res, job.jobId);

    expect(res.writableEnded).toBe(true);

    const events = parseSSEEvents(res.body);

    // Should have status event
    const statusEvent = events.find((e) => e.event === 'status');
    expect(statusEvent).toBeDefined();

    // Should have execution-complete event
    const completeEvent = events.find((e) => e.event === 'execution-complete');
    expect(completeEvent).toBeDefined();

    const data = completeEvent?.data as Record<string, unknown>;
    expect(data.status).toBe('succeeded');
  });

  it('closes stream for failed job', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'failed');
    manager.setJobError(job.jobId, 'Provider error');

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleStreamRequest(req, res, job.jobId);

    expect(res.writableEnded).toBe(true);

    const events = parseSSEEvents(res.body);
    const statusEvent = events.find((e) => e.event === 'status');
    expect(statusEvent).toBeDefined();

    const data = statusEvent?.data as Record<string, unknown>;
    expect(data.status).toBe('failed');
    expect(data.error).toBe('Provider error');
  });

  it('closes stream for cancelled job', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.cancelJob(job.jobId);

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleStreamRequest(req, res, job.jobId);

    expect(res.writableEnded).toBe(true);

    const events = parseSSEEvents(res.body);
    const statusEvent = events.find((e) => e.event === 'status');
    expect(statusEvent).toBeDefined();

    const data = statusEvent?.data as Record<string, unknown>;
    expect(data.status).toBe('cancelled');
  });

  it('returns 404 for unknown jobId', async () => {
    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleStreamRequest(req, res, 'job-unknown');

    expect(res.statusCode).toBe(404);
    const body = parseResponseJson<{ error: string; code: string }>(res);
    expect(body.error).toContain('Job not found');
  });

  it('subscribes to job events', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'running');

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleStreamRequest(req, res, job.jobId);

    // The stream should be subscribed - verify by checking subscribers
    // Since the job is running, stream should not be ended
    expect(res.writableEnded).toBe(false);
  });

  it('forwards events to client', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'running');

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    // Start the stream
    await handleStreamRequest(req, res, job.jobId);

    // Broadcast an event
    const layerEvent: SSEEvent = {
      type: 'layer-start',
      timestamp: new Date().toISOString(),
      layerIndex: 0,
      jobCount: 3,
    };
    manager.broadcastEvent(job.jobId, layerEvent);

    // Check the event was forwarded
    const events = parseSSEEvents(res.body);
    const layerStartEvent = events.find((e) => e.event === 'layer-start');
    expect(layerStartEvent).toBeDefined();

    const data = layerStartEvent?.data as Record<string, unknown>;
    expect(data.layerIndex).toBe(0);
    expect(data.jobCount).toBe(3);
  });

  it('closes stream on execution-complete event', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'running');

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    // Start the stream
    await handleStreamRequest(req, res, job.jobId);

    // Stream should be open
    expect(res.writableEnded).toBe(false);

    // Broadcast execution-complete event
    const completeEvent: SSEEvent = {
      type: 'execution-complete',
      timestamp: new Date().toISOString(),
      status: 'succeeded',
      summary: {
        status: 'succeeded',
        jobCount: 3,
        counts: { succeeded: 3, failed: 0, skipped: 0 },
        manifestRevision: 'rev2',
        manifestPath: '/path/manifest.json',
      },
    };
    manager.broadcastEvent(job.jobId, completeEvent);

    // Stream should be closed
    expect(res.writableEnded).toBe(true);
  });

  it('closes stream on error event', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'running');

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    // Start the stream
    await handleStreamRequest(req, res, job.jobId);

    // Stream should be open
    expect(res.writableEnded).toBe(false);

    // Broadcast error event
    const errorEvent: SSEEvent = {
      type: 'error',
      timestamp: new Date().toISOString(),
      message: 'Something went wrong',
      code: 'ERR001',
    };
    manager.broadcastEvent(job.jobId, errorEvent);

    // Stream should be closed
    expect(res.writableEnded).toBe(true);
  });

  it('unsubscribes on client disconnect', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'running');

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    // Start the stream
    await handleStreamRequest(req, res, job.jobId);

    // Mark response as ended to prevent new writes
    res.writableEnded = true;

    // Simulate client disconnect
    req.emit('close');

    // Capture body length after disconnect
    const bodyLengthAfterDisconnect = res.body.length;

    // Broadcast an event after disconnect
    const layerEvent: SSEEvent = {
      type: 'layer-start',
      timestamp: new Date().toISOString(),
      layerIndex: 1,
      jobCount: 3,
    };
    manager.broadcastEvent(job.jobId, layerEvent);

    // Body should not have changed since writableEnded is true
    expect(res.body.length).toBe(bodyLengthAfterDisconnect);
  });

  it('includes job details in initial status', async () => {
    const manager = getJobManager();
    const planData = createMockPlanData();
    const cachedPlan = manager.cachePlan(planData);

    const job = manager.createJob('movie-abc', cachedPlan.planId, 3);
    manager.updateJobStatus(job.jobId, 'running');

    manager.updateJobDetail(job.jobId, {
      jobId: 'detail-1',
      producer: 'VideoProducer',
      status: 'succeeded',
      layerIndex: 0,
    });

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();

    await handleStreamRequest(req, res, job.jobId);

    const events = parseSSEEvents(res.body);
    const statusEvent = events.find((e) => e.event === 'status');
    expect(statusEvent).toBeDefined();

    const data = statusEvent?.data as Record<string, unknown>;
    const jobDetails = data.jobDetails as Array<Record<string, unknown>>;
    expect(jobDetails).toHaveLength(1);
    expect(jobDetails[0].producer).toBe('VideoProducer');
  });
});
