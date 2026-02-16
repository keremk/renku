import { fal } from '@fal-ai/client';
import type { SecretResolver, ProviderLogger } from '../../types.js';
import { normalizeFalOutput } from './output.js';

/**
 * Status returned when checking a fal.ai job.
 */
export type FalJobStatus = 'completed' | 'in_progress' | 'in_queue' | 'failed' | 'unknown';

/**
 * Result of checking a fal.ai job status.
 */
export interface FalJobCheckResult {
  /** Current status of the job */
  status: FalJobStatus;
  /** The output data if completed */
  output?: unknown;
  /** Normalized URLs if completed and output contains media */
  urls?: string[];
  /** Error message if failed */
  error?: string;
  /** Queue position if in queue */
  queuePosition?: number;
}

/**
 * Options for checking fal.ai job status.
 */
export interface FalJobCheckOptions {
  /** Secret resolver to get FAL_KEY */
  secretResolver: SecretResolver;
  /** Logger for debug output */
  logger?: ProviderLogger;
}

/**
 * Check the status of a fal.ai job using its request ID.
 *
 * This is useful for recovering from client-side timeouts where the job
 * may have completed on fal.ai's servers but the client connection dropped.
 *
 * @param requestId - The fal.ai request ID from a previous job
 * @param model - The model identifier (e.g., 'fal-ai/kling-video')
 * @param options - Check options
 * @returns The current status and output if completed
 */
export async function checkFalJobStatus(
  requestId: string,
  model: string,
  options: FalJobCheckOptions,
): Promise<FalJobCheckResult> {
  const { secretResolver, logger } = options;

  // Ensure client is configured
  const key = await secretResolver.getSecret('FAL_KEY');
  if (!key) {
    throw new Error('FAL_KEY is required to check fal.ai job status.');
  }
  fal.config({ credentials: key });

  logger?.debug?.('providers.fal-ai.recovery.checkStatus', {
    requestId,
    model,
  });

  try {
    // Check job status
    const status = await fal.queue.status(model, {
      requestId,
      logs: false,
    });

    logger?.debug?.('providers.fal-ai.recovery.statusResult', {
      requestId,
      model,
      status: status.status,
    });

    if (status.status === 'IN_QUEUE') {
      return {
        status: 'in_queue',
        queuePosition: 'queue_position' in status ? status.queue_position : undefined,
      };
    }

    if (status.status === 'IN_PROGRESS') {
      return {
        status: 'in_progress',
      };
    }

    if (status.status === 'COMPLETED') {
      // Fetch the actual result
      const result = await fal.queue.result(model, {
        requestId,
      });

      logger?.debug?.('providers.fal-ai.recovery.resultFetched', {
        requestId,
        model,
        hasData: !!result.data,
      });

      const urls = normalizeFalOutput(result.data);

      return {
        status: 'completed',
        output: result.data,
        urls: urls.length > 0 ? urls : undefined,
      };
    }

    return { status: 'unknown' };
  } catch (error) {
    logger?.error?.('providers.fal-ai.recovery.error', {
      requestId,
      model,
      error: error instanceof Error ? error.message : String(error),
    });

    // Check if this is a "not found" or "failed" response
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes('not found') ||
      errorMessage.includes('404') ||
      errorMessage.includes('does not exist')
    ) {
      return {
        status: 'unknown',
        error: `Request ${requestId} not found. It may have expired or been cancelled.`,
      };
    }

    return {
      status: 'failed',
      error: errorMessage,
    };
  }
}

/**
 * Attempt to recover a timed-out fal.ai job.
 *
 * This checks if the job completed on fal.ai's side and retrieves the result.
 * If still running, returns the current status for polling.
 *
 * @param requestId - The fal.ai request ID
 * @param model - The model identifier
 * @param options - Recovery options
 * @returns The check result with output if completed
 */
export async function recoverFalJob(
  requestId: string,
  model: string,
  options: FalJobCheckOptions,
): Promise<FalJobCheckResult> {
  const { logger } = options;

  logger?.info?.(`Attempting to recover fal.ai job ${requestId} for model ${model}`);

  const result = await checkFalJobStatus(requestId, model, options);

  if (result.status === 'completed') {
    logger?.info?.(`Successfully recovered fal.ai job ${requestId}`);
  } else if (result.status === 'in_progress' || result.status === 'in_queue') {
    logger?.info?.(`fal.ai job ${requestId} is still ${result.status}`);
  } else {
    logger?.warn?.(`fal.ai job ${requestId} recovery failed: ${result.error ?? result.status}`);
  }

  return result;
}
