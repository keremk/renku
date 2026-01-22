/**
 * Handler for GET /viewer-api/generate/jobs endpoints.
 * Lists jobs and retrieves job status.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRenkuError } from '@gorenku/core';

import type { JobsListResponse, JobInfo, JobStatusResponse } from './types.js';
import { getJobManager } from './job-manager.js';
import { sendJson, sendError } from './http-utils.js';

/**
 * Handles GET /viewer-api/generate/jobs
 * Lists all active and recent jobs.
 */
export async function handleJobsListRequest(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  try {
    const jobManager = getJobManager();
    const jobs = jobManager.listJobs();

    const jobInfos: JobInfo[] = jobs.map((job) => ({
      jobId: job.jobId,
      movieId: job.movieId,
      status: job.status,
      startedAt: job.startedAt.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      progress: job.progress,
      currentLayer: job.currentLayer,
      totalLayers: job.totalLayers,
    }));

    const response: JobsListResponse = { jobs: jobInfos };
    sendJson(res, response);
    return true;
  } catch (error) {
    if (error instanceof Error) {
      sendError(res, 500, error.message);
    } else {
      sendError(res, 500, 'Unknown error occurred');
    }
    return true;
  }
}

/**
 * Handles GET /viewer-api/generate/jobs/:jobId
 * Retrieves detailed status for a specific job.
 */
export async function handleJobStatusRequest(
  _req: IncomingMessage,
  res: ServerResponse,
  jobId: string
): Promise<boolean> {
  try {
    const jobManager = getJobManager();
    const job = jobManager.getJob(jobId);

    const response: JobStatusResponse = {
      jobId: job.jobId,
      movieId: job.movieId,
      status: job.status,
      startedAt: job.startedAt.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      progress: job.progress,
      currentLayer: job.currentLayer,
      totalLayers: job.totalLayers,
      jobDetails: job.jobDetails,
      error: job.error,
      summary: job.summary,
    };

    sendJson(res, response);
    return true;
  } catch (error) {
    if (isRenkuError(error)) {
      sendError(res, 404, error.message, error.code);
    } else if (error instanceof Error) {
      sendError(res, 500, error.message);
    } else {
      sendError(res, 500, 'Unknown error occurred');
    }
    return true;
  }
}
