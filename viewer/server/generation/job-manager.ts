/**
 * In-memory job manager for tracking execution jobs and cached plans.
 * Singleton pattern ensures consistent state across all API requests.
 */

import { createRuntimeError, RuntimeErrorCode } from '@gorenku/core';
import type {
  CachedPlan,
  ExecutionJob,
  JobStatus,
  JobDetailInfo,
  BuildSummaryInfo,
  SSEEvent,
} from './types.js';

/**
 * Plan cache expiration time in milliseconds (10 minutes).
 */
const PLAN_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Completed job retention time in milliseconds (1 hour).
 */
const JOB_RETENTION_MS = 60 * 60 * 1000;

/**
 * Pruning interval in milliseconds (5 minutes).
 */
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Generates a unique ID with the given prefix.
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Job manager class for tracking plans and execution jobs.
 */
class JobManager {
  private plans: Map<string, CachedPlan> = new Map();
  private jobs: Map<string, ExecutionJob> = new Map();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start periodic pruning
    this.startPruning();
  }

  /**
   * Starts the periodic pruning of expired plans and old jobs.
   */
  private startPruning(): void {
    if (this.pruneTimer) {
      return;
    }
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
    // Don't prevent Node.js from exiting
    if (this.pruneTimer.unref) {
      this.pruneTimer.unref();
    }
  }

  /**
   * Stops the periodic pruning.
   */
  stopPruning(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  /**
   * Prunes expired plans and old completed jobs.
   */
  private prune(): void {
    const now = Date.now();

    // Remove expired plans
    for (const [planId, plan] of this.plans) {
      if (plan.expiresAt.getTime() < now) {
        this.plans.delete(planId);
      }
    }

    // Remove old completed/failed/cancelled jobs
    for (const [jobId, job] of this.jobs) {
      if (job.completedAt) {
        const age = now - job.completedAt.getTime();
        if (age > JOB_RETENTION_MS) {
          this.jobs.delete(jobId);
        }
      }
    }
  }

  // ==========================================================================
  // Plan Management
  // ==========================================================================

  /**
   * Caches a plan and returns its ID.
   */
  cachePlan(plan: Omit<CachedPlan, 'planId' | 'createdAt' | 'expiresAt'>): CachedPlan {
    const planId = generateId('plan');
    const now = new Date();
    const cachedPlan: CachedPlan = {
      ...plan,
      planId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + PLAN_CACHE_TTL_MS),
    };
    this.plans.set(planId, cachedPlan);
    return cachedPlan;
  }

  /**
   * Retrieves a cached plan by ID.
   * Throws if not found or expired.
   */
  getPlan(planId: string): CachedPlan {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw createRuntimeError(
        RuntimeErrorCode.PLAN_NOT_FOUND,
        `Plan not found: ${planId}`,
        { suggestion: 'The plan may have expired. Create a new plan using POST /viewer-api/generate/plan' }
      );
    }

    // Check if expired
    if (plan.expiresAt.getTime() < Date.now()) {
      this.plans.delete(planId);
      throw createRuntimeError(
        RuntimeErrorCode.PLAN_EXPIRED,
        `Plan expired: ${planId}`,
        { suggestion: 'Plans expire after 10 minutes. Create a new plan using POST /viewer-api/generate/plan' }
      );
    }

    return plan;
  }

  /**
   * Removes a cached plan.
   */
  removePlan(planId: string): void {
    this.plans.delete(planId);
  }

  // ==========================================================================
  // Job Management
  // ==========================================================================

  /**
   * Creates a new execution job.
   */
  createJob(movieId: string, planId: string, totalLayers: number): ExecutionJob {
    const jobId = generateId('job');
    const job: ExecutionJob = {
      jobId,
      movieId,
      planId,
      status: 'pending',
      startedAt: new Date(),
      progress: 0,
      currentLayer: 0,
      totalLayers,
      jobDetails: [],
      abortController: new AbortController(),
      subscribers: new Set(),
    };
    this.jobs.set(jobId, job);
    return job;
  }

  /**
   * Retrieves a job by ID.
   * Throws if not found.
   */
  getJob(jobId: string): ExecutionJob {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw createRuntimeError(
        RuntimeErrorCode.JOB_NOT_FOUND,
        `Job not found: ${jobId}`,
        { suggestion: 'The job may have been completed and pruned. Check /viewer-api/generate/jobs for active jobs.' }
      );
    }
    return job;
  }

  /**
   * Lists all jobs (active and recent).
   */
  listJobs(): ExecutionJob[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
    );
  }

  /**
   * Updates job status.
   */
  updateJobStatus(jobId: string, status: JobStatus): void {
    const job = this.getJob(jobId);
    job.status = status;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      job.completedAt = new Date();
    }
  }

  /**
   * Updates job progress.
   */
  updateJobProgress(jobId: string, progress: number, currentLayer: number): void {
    const job = this.getJob(jobId);
    job.progress = progress;
    job.currentLayer = currentLayer;
  }

  /**
   * Adds or updates a job detail entry.
   */
  updateJobDetail(jobId: string, detail: JobDetailInfo): void {
    const job = this.getJob(jobId);
    const existing = job.jobDetails.find((d) => d.jobId === detail.jobId);
    if (existing) {
      Object.assign(existing, detail);
    } else {
      job.jobDetails.push(detail);
    }
  }

  /**
   * Sets job error.
   */
  setJobError(jobId: string, error: string): void {
    const job = this.getJob(jobId);
    job.error = error;
  }

  /**
   * Sets job summary.
   */
  setJobSummary(jobId: string, summary: BuildSummaryInfo): void {
    const job = this.getJob(jobId);
    job.summary = summary;
  }

  /**
   * Cancels a job by signaling its AbortController.
   */
  cancelJob(jobId: string): void {
    const job = this.getJob(jobId);
    if (job.status === 'running' || job.status === 'pending' || job.status === 'planning') {
      job.abortController.abort();
      job.status = 'cancelled';
      job.completedAt = new Date();
    }
  }

  /**
   * Checks if a job is cancelled.
   */
  isJobCancelled(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    return job?.abortController.signal.aborted ?? false;
  }

  // ==========================================================================
  // SSE Subscription Management
  // ==========================================================================

  /**
   * Subscribes to SSE events for a job.
   */
  subscribeToJob(jobId: string, callback: (event: SSEEvent) => void): () => void {
    const job = this.getJob(jobId);
    job.subscribers.add(callback);
    return () => {
      job.subscribers.delete(callback);
    };
  }

  /**
   * Broadcasts an SSE event to all subscribers of a job.
   */
  broadcastEvent(jobId: string, event: SSEEvent): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    for (const callback of job.subscribers) {
      try {
        callback(event);
      } catch {
        // Ignore errors in individual subscribers
      }
    }
  }

  // ==========================================================================
  // Utility
  // ==========================================================================

  /**
   * Gets statistics about the job manager state.
   */
  getStats(): { plans: number; activeJobs: number; completedJobs: number } {
    let activeJobs = 0;
    let completedJobs = 0;
    for (const job of this.jobs.values()) {
      if (job.completedAt) {
        completedJobs++;
      } else {
        activeJobs++;
      }
    }
    return {
      plans: this.plans.size,
      activeJobs,
      completedJobs,
    };
  }
}

/**
 * Singleton job manager instance.
 */
let instance: JobManager | null = null;

/**
 * Gets the singleton job manager instance.
 */
export function getJobManager(): JobManager {
  if (!instance) {
    instance = new JobManager();
  }
  return instance;
}

/**
 * Resets the job manager (for testing).
 */
export function resetJobManager(): void {
  if (instance) {
    instance.stopPruning();
    instance = null;
  }
}
