/**
 * Handler for POST /viewer-api/generate/jobs/:jobId/cancel
 * Cancels an active job.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRenkuError } from '@gorenku/core';

import type { JobStatusResponse } from './types.js';
import { getJobManager } from './job-manager.js';
import { sendJson, sendError } from './http-utils.js';

/**
 * Handles POST /viewer-api/generate/jobs/:jobId/cancel
 * Cancels an active job via AbortController.
 */
export async function handleCancelRequest(
  _req: IncomingMessage,
  res: ServerResponse,
  jobId: string
): Promise<boolean> {
  try {
    const jobManager = getJobManager();

    // Get job (validates it exists)
    const job = jobManager.getJob(jobId);

    // Check if job can be cancelled
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      sendError(res, 400, `Job ${jobId} is already ${job.status} and cannot be cancelled`);
      return true;
    }

    // Cancel the job
    jobManager.cancelJob(jobId);

    // Get updated job status
    const updatedJob = jobManager.getJob(jobId);

    const response: JobStatusResponse = {
      jobId: updatedJob.jobId,
      movieId: updatedJob.movieId,
      status: updatedJob.status,
      startedAt: updatedJob.startedAt.toISOString(),
      completedAt: updatedJob.completedAt?.toISOString(),
      progress: updatedJob.progress,
      currentLayer: updatedJob.currentLayer,
      totalLayers: updatedJob.totalLayers,
      jobDetails: updatedJob.jobDetails,
      error: updatedJob.error,
      summary: updatedJob.summary,
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
