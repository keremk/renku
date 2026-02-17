/**
 * Handler for GET /viewer-api/generate/jobs/:jobId/stream
 * SSE stream for real-time progress events.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRenkuError } from '@gorenku/core';

import type { SSEEvent, JobStatusResponse } from './types.js';
import { getJobManager } from './job-manager.js';
import {
  setupSSE,
  sendSSEEvent,
  sendSSEComment,
  sendError,
} from './http-utils.js';

/**
 * Keep-alive interval in milliseconds.
 */
const KEEP_ALIVE_INTERVAL_MS = 15000;

/**
 * Handles GET /viewer-api/generate/jobs/:jobId/stream
 */
export async function handleStreamRequest(
  req: IncomingMessage,
  res: ServerResponse,
  jobId: string
): Promise<boolean> {
  const jobManager = getJobManager();

  try {
    // Get job (validates it exists)
    const job = jobManager.getJob(jobId);

    // Set up SSE headers
    setupSSE(res);

    // Send initial status event
    const initialStatus: JobStatusResponse = {
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

    sendSSEEvent(res, 'status', initialStatus);

    // If job is already completed, send completion event and close
    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      if (job.status === 'cancelled') {
        sendSSEEvent(res, 'execution-cancelled', {
          type: 'execution-cancelled',
          timestamp: new Date().toISOString(),
          message: `Execution cancelled for job ${jobId}`,
        });
      } else if (job.summary) {
        sendSSEEvent(res, 'execution-complete', {
          type: 'execution-complete',
          timestamp: new Date().toISOString(),
          status: job.summary.status,
          summary: job.summary,
        });
      }
      res.end();
      return true;
    }

    // Subscribe to job events
    const unsubscribe = jobManager.subscribeToJob(jobId, (event: SSEEvent) => {
      if (!res.writableEnded) {
        sendSSEEvent(res, event.type, event);

        // Close stream on completion
        if (
          event.type === 'execution-complete' ||
          event.type === 'execution-cancelled' ||
          event.type === 'error'
        ) {
          res.end();
        }
      }
    });

    // Set up keep-alive timer
    const keepAliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        sendSSEComment(res, 'keep-alive');
      }
    }, KEEP_ALIVE_INTERVAL_MS);

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(keepAliveTimer);
      unsubscribe();
    });

    // Clean up on response finish
    res.on('finish', () => {
      clearInterval(keepAliveTimer);
      unsubscribe();
    });

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
