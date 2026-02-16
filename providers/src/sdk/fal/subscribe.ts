import { fal } from '@fal-ai/client';
import type { ProviderLogger } from '../../types.js';

/**
 * Result from fal.ai subscribe wrapper that includes request ID for recovery.
 */
export interface FalSubscribeResult {
  /** The output from the provider */
  output: unknown;
  /** The fal.ai request ID, useful for recovery on timeout */
  requestId: string;
}

/**
 * Options for the fal.ai subscribe wrapper.
 */
export interface FalSubscribeOptions {
  /** Polling interval in ms. Default 3000ms for video models, 1000ms otherwise */
  pollInterval?: number;
  /** Client-side timeout in ms. Default 600000ms (10 min) */
  timeout?: number;
  /** Logger for debug output */
  logger?: ProviderLogger;
  /** Job ID for logging */
  jobId?: string;
  /** Model name for logging */
  model?: string;
}

/**
 * Error thrown when a fal.ai request times out.
 * Contains the requestId for potential recovery.
 */
export class FalTimeoutError extends Error {
  readonly requestId: string;
  readonly provider = 'fal-ai';
  readonly recoverable = true;

  constructor(message: string, requestId: string) {
    super(message);
    this.name = 'FalTimeoutError';
    this.requestId = requestId;
  }
}

/**
 * Subscribes to a fal.ai model with request ID capture and timeout handling.
 *
 * Unlike fal.run(), this uses the queue-based subscribe API which:
 * - Captures the request ID immediately on enqueue
 * - Uses configurable polling intervals (better for long-running jobs)
 * - Provides the request ID even on timeout (for recovery)
 *
 * @param model - The model identifier (e.g., 'fal-ai/kling-video')
 * @param input - The input payload
 * @param options - Subscribe options
 * @returns Promise resolving to output and requestId
 * @throws FalTimeoutError if the request times out (includes requestId for recovery)
 */
export async function falSubscribe(
  model: string,
  input: Record<string, unknown>,
  options: FalSubscribeOptions = {}
): Promise<FalSubscribeResult> {
  const {
    pollInterval = 3000, // 3s default - better for video models
    timeout = 600_000, // 10 min default
    logger,
    jobId,
    model: _modelNameFromOptions, // Used only for logging context, we use the model param directly
  } = options;

  let capturedRequestId: string | undefined;
  const startTime = Date.now();

  logger?.debug?.('providers.fal-ai.subscribe.start', {
    model,
    jobId,
    pollInterval,
    timeout,
    inputKeys: Object.keys(input),
  });

  // Create an AbortController for timeout
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort();
  }, timeout);

  try {
    const result = await fal.subscribe(model, {
      input,
      pollInterval,
      onEnqueue: (requestId) => {
        capturedRequestId = requestId;
        logger?.debug?.('providers.fal-ai.subscribe.enqueued', {
          model,
          jobId,
          requestId,
        });
      },
      onQueueUpdate: (status) => {
        logger?.debug?.('providers.fal-ai.subscribe.queueUpdate', {
          model,
          jobId,
          requestId: capturedRequestId,
          status: status.status,
          elapsedMs: Date.now() - startTime,
        });
      },
      abortSignal: abortController.signal,
    });

    clearTimeout(timeoutHandle);

    const requestId = result.requestId ?? capturedRequestId;
    if (!requestId) {
      throw new Error(
        `fal.ai subscribe completed without requestId for model ${model}.`
      );
    }

    logger?.debug?.('providers.fal-ai.subscribe.completed', {
      model,
      jobId,
      requestId,
      elapsedMs: Date.now() - startTime,
    });

    return {
      output: result.data,
      requestId,
    };
  } catch (error) {
    clearTimeout(timeoutHandle);

    // Check if this was an abort due to timeout
    if (abortController.signal.aborted && capturedRequestId) {
      const elapsed = Date.now() - startTime;
      logger?.warn?.('providers.fal-ai.subscribe.timeout', {
        model,
        jobId,
        requestId: capturedRequestId,
        timeoutMs: timeout,
        elapsedMs: elapsed,
      });

      throw new FalTimeoutError(
        `fal.ai request timed out after ${elapsed}ms. Request ID: ${capturedRequestId}. ` +
          `The job may still complete on fal.ai servers - use the request ID to check status.`,
        capturedRequestId
      );
    }

    // If we have a request ID even on other errors, include it in the error
    if (capturedRequestId && error instanceof Error) {
      (error as Error & { falRequestId?: string }).falRequestId =
        capturedRequestId;
    }

    throw error;
  }
}

/**
 * Determines an appropriate poll interval for a model.
 * Video models benefit from longer intervals since they take minutes to complete.
 */
export function getPollIntervalForModel(model: string): number {
  const normalizedModel = model.toLowerCase();

  // Video generation models - long running, use longer poll interval
  if (
    normalizedModel.includes('kling') ||
    normalizedModel.includes('runway') ||
    normalizedModel.includes('video') ||
    normalizedModel.includes('minimax') ||
    normalizedModel.includes('luma')
  ) {
    return 5000; // 5 seconds
  }

  // Image models - moderate poll interval
  if (
    normalizedModel.includes('flux') ||
    normalizedModel.includes('sdxl') ||
    normalizedModel.includes('stable-diffusion')
  ) {
    return 2000; // 2 seconds
  }

  // Default for other models
  return 3000; // 3 seconds
}

/**
 * Determines an appropriate timeout for a model.
 * Video models can take 5+ minutes, while image models are faster.
 */
export function getTimeoutForModel(model: string): number {
  const normalizedModel = model.toLowerCase();

  // Video generation models - can take 5-10+ minutes
  if (
    normalizedModel.includes('kling') ||
    normalizedModel.includes('runway') ||
    normalizedModel.includes('video') ||
    normalizedModel.includes('minimax') ||
    normalizedModel.includes('luma')
  ) {
    return 15 * 60 * 1000; // 15 minutes
  }

  // Image models - typically 30-120 seconds
  if (
    normalizedModel.includes('flux') ||
    normalizedModel.includes('sdxl') ||
    normalizedModel.includes('stable-diffusion')
  ) {
    return 5 * 60 * 1000; // 5 minutes
  }

  // Default timeout
  return 10 * 60 * 1000; // 10 minutes
}
