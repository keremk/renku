/**
 * Unit tests for job-manager.ts - In-memory job tracking singleton.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Manifest, ExecutionPlan } from '@gorenku/core';
import type { PlanCostSummary } from '@gorenku/providers';
import { getJobManager, resetJobManager } from './job-manager.js';
import type {
  SSEEvent,
  CachedPlan,
  BuildSummaryInfo,
  JobDetailInfo,
} from './types.js';

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

describe('JobManager', () => {
  beforeEach(() => {
    resetJobManager();
  });

  describe('plan caching', () => {
    it('caches plan and returns planId', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();

      const cachedPlan = manager.cachePlan(planData);

      expect(cachedPlan.planId).toMatch(/^plan-/);
      expect(cachedPlan.movieId).toBe('movie-test');
      expect(cachedPlan.createdAt).toBeInstanceOf(Date);
    });

    it('retrieves cached plan by planId', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();

      const cachedPlan = manager.cachePlan(planData);
      const retrieved = manager.getPlan(cachedPlan.planId);

      expect(retrieved.planId).toBe(cachedPlan.planId);
      expect(retrieved.movieId).toBe('movie-test');
    });

    it('removes plan from cache', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();

      const cachedPlan = manager.cachePlan(planData);
      manager.removePlan(cachedPlan.planId);

      expect(() => manager.getPlan(cachedPlan.planId)).toThrow();
    });

    it('throws PLAN_NOT_FOUND for unknown planId', () => {
      const manager = getJobManager();

      expect(() => manager.getPlan('plan-unknown')).toThrowError(
        /Plan not found/
      );
    });
  });

  describe('job lifecycle', () => {
    it('creates job with initial state', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);

      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      expect(job.jobId).toMatch(/^job-/);
      expect(job.movieId).toBe('movie-abc');
      expect(job.planId).toBe(cachedPlan.planId);
      expect(job.status).toBe('pending');
      expect(job.progress).toBe(0);
      expect(job.currentLayer).toBe(0);
      expect(job.totalLayers).toBe(3);
      expect(job.jobDetails).toEqual([]);
      expect(job.startedAt).toBeInstanceOf(Date);
      expect(job.abortController).toBeInstanceOf(AbortController);
    });

    it('updates job status', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      manager.updateJobStatus(job.jobId, 'running');
      expect(manager.getJob(job.jobId).status).toBe('running');

      manager.updateJobStatus(job.jobId, 'completed');
      expect(manager.getJob(job.jobId).status).toBe('completed');
      expect(manager.getJob(job.jobId).completedAt).toBeInstanceOf(Date);
    });

    it('sets completedAt when status is terminal', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      // Test 'completed' status
      manager.updateJobStatus(job.jobId, 'completed');
      expect(manager.getJob(job.jobId).completedAt).toBeInstanceOf(Date);

      // Create another job to test 'failed' status
      const job2 = manager.createJob('movie-xyz', cachedPlan.planId, 3);
      manager.updateJobStatus(job2.jobId, 'failed');
      expect(manager.getJob(job2.jobId).completedAt).toBeInstanceOf(Date);

      // Create another job to test 'cancelled' status
      const job3 = manager.createJob('movie-123', cachedPlan.planId, 3);
      manager.updateJobStatus(job3.jobId, 'cancelled');
      expect(manager.getJob(job3.jobId).completedAt).toBeInstanceOf(Date);
    });

    it('updates job progress', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      manager.updateJobProgress(job.jobId, 50, 1);

      const updated = manager.getJob(job.jobId);
      expect(updated.progress).toBe(50);
      expect(updated.currentLayer).toBe(1);
    });

    it('lists all jobs', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);

      manager.createJob('movie-1', cachedPlan.planId, 3);
      manager.createJob('movie-2', cachedPlan.planId, 3);
      manager.createJob('movie-3', cachedPlan.planId, 3);

      const jobs = manager.listJobs();
      expect(jobs).toHaveLength(3);
    });

    it('lists jobs sorted by startedAt descending', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);

      // Create jobs with manually set startedAt times to ensure deterministic sorting
      const job1 = manager.createJob('movie-1', cachedPlan.planId, 3);
      const job2 = manager.createJob('movie-2', cachedPlan.planId, 3);
      const job3 = manager.createJob('movie-3', cachedPlan.planId, 3);

      // Manually adjust timestamps for deterministic sorting
      // (jobs created in quick succession may have identical timestamps)
      job1.startedAt = new Date(Date.now() - 3000);
      job2.startedAt = new Date(Date.now() - 2000);
      job3.startedAt = new Date(Date.now() - 1000);

      const jobs = manager.listJobs();

      // Most recent first
      expect(jobs[0].jobId).toBe(job3.jobId);
      expect(jobs[1].jobId).toBe(job2.jobId);
      expect(jobs[2].jobId).toBe(job1.jobId);
    });

    it('gets job by jobId', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      const retrieved = manager.getJob(job.jobId);
      expect(retrieved.jobId).toBe(job.jobId);
    });

    it('throws JOB_NOT_FOUND for unknown jobId', () => {
      const manager = getJobManager();

      expect(() => manager.getJob('job-unknown')).toThrowError(/Job not found/);
    });
  });

  describe('job details', () => {
    it('tracks individual job details', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      const detail: JobDetailInfo = {
        jobId: 'detail-1',
        producer: 'TestProducer',
        status: 'running',
        layerIndex: 0,
      };

      manager.updateJobDetail(job.jobId, detail);

      const updated = manager.getJob(job.jobId);
      expect(updated.jobDetails).toHaveLength(1);
      expect(updated.jobDetails[0].producer).toBe('TestProducer');
    });

    it('updates existing job detail', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      const detail1: JobDetailInfo = {
        jobId: 'detail-1',
        producer: 'TestProducer',
        status: 'running',
        layerIndex: 0,
      };

      const detail2: JobDetailInfo = {
        jobId: 'detail-1', // Same jobId
        producer: 'TestProducer',
        status: 'succeeded',
        layerIndex: 0,
      };

      manager.updateJobDetail(job.jobId, detail1);
      manager.updateJobDetail(job.jobId, detail2);

      const updated = manager.getJob(job.jobId);
      expect(updated.jobDetails).toHaveLength(1);
      expect(updated.jobDetails[0].status).toBe('succeeded');
    });

    it('sets job error message', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      manager.setJobError(job.jobId, 'Something went wrong');

      expect(manager.getJob(job.jobId).error).toBe('Something went wrong');
    });

    it('sets job summary on completion', () => {
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

      manager.setJobSummary(job.jobId, summary);

      expect(manager.getJob(job.jobId).summary).toEqual(summary);
    });
  });

  describe('SSE subscription', () => {
    it('subscribes to job events', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      const events: SSEEvent[] = [];
      const callback = (event: SSEEvent) => events.push(event);

      manager.subscribeToJob(job.jobId, callback);

      // Broadcast an event
      const event: SSEEvent = {
        type: 'layer-start',
        timestamp: new Date().toISOString(),
        layerIndex: 0,
        jobCount: 3,
      };
      manager.broadcastEvent(job.jobId, event);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('layer-start');
    });

    it('unsubscribes from job events', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      const events: SSEEvent[] = [];
      const callback = (event: SSEEvent) => events.push(event);

      const unsubscribe = manager.subscribeToJob(job.jobId, callback);

      // Unsubscribe
      unsubscribe();

      // Broadcast an event
      const event: SSEEvent = {
        type: 'layer-start',
        timestamp: new Date().toISOString(),
        layerIndex: 0,
        jobCount: 3,
      };
      manager.broadcastEvent(job.jobId, event);

      expect(events).toHaveLength(0);
    });

    it('broadcasts events to all subscribers', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      const events1: SSEEvent[] = [];
      const events2: SSEEvent[] = [];
      const events3: SSEEvent[] = [];

      manager.subscribeToJob(job.jobId, (e) => events1.push(e));
      manager.subscribeToJob(job.jobId, (e) => events2.push(e));
      manager.subscribeToJob(job.jobId, (e) => events3.push(e));

      const event: SSEEvent = {
        type: 'layer-start',
        timestamp: new Date().toISOString(),
        layerIndex: 0,
        jobCount: 3,
      };
      manager.broadcastEvent(job.jobId, event);

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events3).toHaveLength(1);
    });

    it('does not broadcast to unsubscribed', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      const events1: SSEEvent[] = [];
      const events2: SSEEvent[] = [];

      manager.subscribeToJob(job.jobId, (e) => events1.push(e));
      const unsub2 = manager.subscribeToJob(job.jobId, (e) => events2.push(e));

      // Unsubscribe second callback
      unsub2();

      const event: SSEEvent = {
        type: 'layer-start',
        timestamp: new Date().toISOString(),
        layerIndex: 0,
        jobCount: 3,
      };
      manager.broadcastEvent(job.jobId, event);

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(0);
    });

    it('handles errors in subscriber callbacks gracefully', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      const events: SSEEvent[] = [];

      // First callback throws error
      manager.subscribeToJob(job.jobId, () => {
        throw new Error('Subscriber error');
      });
      // Second callback should still work
      manager.subscribeToJob(job.jobId, (e) => events.push(e));

      const event: SSEEvent = {
        type: 'layer-start',
        timestamp: new Date().toISOString(),
        layerIndex: 0,
        jobCount: 3,
      };

      // Should not throw
      expect(() => manager.broadcastEvent(job.jobId, event)).not.toThrow();

      // Second subscriber should have received the event
      expect(events).toHaveLength(1);
    });

    it('does nothing when broadcasting to unknown job', () => {
      const manager = getJobManager();

      const event: SSEEvent = {
        type: 'layer-start',
        timestamp: new Date().toISOString(),
        layerIndex: 0,
        jobCount: 3,
      };

      // Should not throw
      expect(() => manager.broadcastEvent('job-unknown', event)).not.toThrow();
    });
  });

  describe('cancellation', () => {
    it('cancels job via AbortController', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      manager.updateJobStatus(job.jobId, 'running');
      manager.cancelJob(job.jobId);

      expect(manager.getJob(job.jobId).status).toBe('cancelled');
      expect(manager.getJob(job.jobId).completedAt).toBeUndefined();
    });

    it('finalizes cancelled job completion timestamp', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      manager.updateJobStatus(job.jobId, 'running');
      manager.cancelJob(job.jobId);

      manager.finalizeCancelledJob(job.jobId);

      expect(manager.getJob(job.jobId).status).toBe('cancelled');
      expect(manager.getJob(job.jobId).completedAt).toBeInstanceOf(Date);
    });

    it('isJobCancelled returns true after cancel', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      expect(manager.isJobCancelled(job.jobId)).toBe(false);

      manager.cancelJob(job.jobId);

      expect(manager.isJobCancelled(job.jobId)).toBe(true);
    });

    it('isJobCancelled returns false for unknown job', () => {
      const manager = getJobManager();

      expect(manager.isJobCancelled('job-unknown')).toBe(false);
    });

    it('does not cancel already completed job', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);
      const job = manager.createJob('movie-abc', cachedPlan.planId, 3);

      manager.updateJobStatus(job.jobId, 'completed');
      const completedAt = manager.getJob(job.jobId).completedAt;

      // Try to cancel
      manager.cancelJob(job.jobId);

      // Status should still be completed
      expect(manager.getJob(job.jobId).status).toBe('completed');
      expect(manager.getJob(job.jobId).completedAt).toEqual(completedAt);
    });
  });

  describe('stats', () => {
    it('returns correct statistics', () => {
      const manager = getJobManager();
      const planData = createMockPlanData();
      const cachedPlan = manager.cachePlan(planData);

      // Create some plans
      manager.cachePlan(createMockPlanData());
      manager.cachePlan(createMockPlanData());

      // Create some jobs
      const job1 = manager.createJob('movie-1', cachedPlan.planId, 3);
      const job2 = manager.createJob('movie-2', cachedPlan.planId, 3);
      // job3 is created but intentionally left pending (not completed)
      manager.createJob('movie-3', cachedPlan.planId, 3);

      // Complete some jobs
      manager.updateJobStatus(job1.jobId, 'completed');
      manager.updateJobStatus(job2.jobId, 'failed');

      const stats = manager.getStats();

      // 3 plans cached (original + 2 additional)
      expect(stats.plans).toBe(3);
      // 1 active (job3 which was not completed)
      expect(stats.activeJobs).toBe(1);
      // 2 completed (job1, job2)
      expect(stats.completedJobs).toBe(2);
    });
  });

  describe('singleton behavior', () => {
    it('returns same instance on multiple calls', () => {
      const manager1 = getJobManager();
      const manager2 = getJobManager();

      expect(manager1).toBe(manager2);
    });

    it('resetJobManager creates fresh instance', () => {
      const manager1 = getJobManager();
      const planData = createMockPlanData();
      manager1.cachePlan(planData);

      resetJobManager();

      const manager2 = getJobManager();
      expect(manager2.getStats().plans).toBe(0);
    });
  });
});
