import type { ProviderLogger } from '../../types.js';

interface RunArgs {
  replicate: { run: (id: string, opts: { input: Record<string, unknown> }) => Promise<unknown> };
  modelIdentifier: string;
  input: Record<string, unknown>;
  logger?: ProviderLogger;
  jobId: string;
  model: string;
  plannerContext: Record<string, unknown>;
  maxAttempts?: number;
  defaultRetryMs?: number;
}

export async function runReplicateWithRetries(args: RunArgs): Promise<unknown> {
  const {
    replicate,
    modelIdentifier,
    input,
    logger,
    jobId,
    model,
    plannerContext,
    maxAttempts = 3,
    defaultRetryMs = 10_000,
  } = args;

  let attempt = 0;
  let lastError: unknown;
  let sawThrottle = false;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await replicate.run(modelIdentifier, { input });
    } catch (error: unknown) {
      lastError = error;
      const status = parseStatus(error);
      const retryAfterSec = parseRetryAfterSeconds(error);
      const retryMs = retryAfterSec !== undefined ? (retryAfterSec + 1) * 1000 : defaultRetryMs;

      const isThrottled = status === 429 || /429|Too Many Requests/i.test(String(error ?? ''));
      const shouldRetry = isThrottled && attempt < maxAttempts;
      if (!isThrottled) {
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(String((error as any)?.message ?? error ?? 'Replicate prediction failed.'));
      }
      if (shouldRetry) {
        sawThrottle = true;
        logger?.info?.(`Replicate provider will retry after ${retryMs}ms for the job ${jobId}. Attempt #${attempt}`);
        logger?.debug?.('providers.replicate.retry', {
          producer: jobId,
          model,
          plannerContext,
          status,
          attempt,
          maxAttempts,
          retryAfterMs: retryMs,
          error: error instanceof Error ? error.message : String(error),
        });
        const before = Date.now();
        await new Promise((resolve) => setTimeout(resolve, retryMs));
        const waitedMs = Date.now() - before;
        logger?.info?.(`Replicate provider for job ${jobId} using model ${model} waited for ${waitedMs}ms`);
        logger?.debug?.('providers.replicate.retry.waited', {
          producer: jobId,
          model,
          attempt,
          waitedMs: waitedMs,
        });
        continue;
      }

      break;
    }
  }

  const message =
    'Replicate rate limit hit (429); retries exhausted. Lower concurrency, wait, or add credit.';
  if (sawThrottle) {
    throw createProviderRateLimitError(message, lastError);
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(String((lastError as any)?.message ?? lastError ?? 'Replicate prediction failed.'));
}

function createProviderRateLimitError(message: string, raw: unknown): Error {
  const err = new Error(message);
  (err as any).status = 429;
  (err as any).raw = raw;
  return err;
}

function parseStatus(error: unknown): number | undefined {
  const candidate =
    (error as any)?.status
    ?? (error as any)?.httpStatus
    ?? (error as any)?.response?.status
    ?? (error as any)?.body?.status;
  if (typeof candidate === 'number') {
    return candidate;
  }
  const message = String((error as any)?.message ?? error ?? '');
  const match = /status[:\s]+(\d{3})/i.exec(message) || /(\d{3})\s+Too Many Requests/i.exec(message);
  if (match) {
    return Number(match[1]);
  }
  if (/429/.test(message) || /Too Many Requests/i.test(message)) {
    return 429;
  }
  return undefined;
}

function parseRetryAfterSeconds(error: unknown): number | undefined {
  const bodyVal = (error as any)?.body?.retry_after;
  if (typeof bodyVal === 'number') {
    return bodyVal;
  }
  const message = (error as any)?.message ?? '';
  let match = /retry[_-]after['"]?\s*[:=]\s*(\d+)/i.exec(String(message));
  if (match) {
    return Number(match[1]);
  }
  match = /resets in ~(\d+)s/i.exec(String(message));
  if (match) {
    return Number(match[1]);
  }
  return undefined;
}

/**
 * Creates a generic retry wrapper using Replicate's retry logic.
 * This wraps any async function with rate limit handling.
 */
export interface ReplicateRetryOptions {
  logger?: ProviderLogger;
  jobId: string;
  model: string;
  plannerContext: Record<string, unknown>;
  maxAttempts?: number;
  defaultRetryMs?: number;
}

export function createReplicateRetryWrapper(options: ReplicateRetryOptions): {
  execute: <T>(fn: () => Promise<T>) => Promise<T>;
} {
  const { logger, jobId, model, plannerContext, maxAttempts = 3, defaultRetryMs = 10_000 } = options;

  return {
    async execute<T>(fn: () => Promise<T>): Promise<T> {
      let attempt = 0;
      let lastError: unknown;
      let sawThrottle = false;

      while (attempt < maxAttempts) {
        attempt += 1;
        try {
          return await fn();
        } catch (error: unknown) {
          lastError = error;
          const status = parseStatus(error);
          const retryAfterSec = parseRetryAfterSeconds(error);
          const retryMs = retryAfterSec !== undefined ? (retryAfterSec + 1) * 1000 : defaultRetryMs;

          const isThrottled = status === 429 || /429|Too Many Requests/i.test(String(error ?? ''));
          const shouldRetry = isThrottled && attempt < maxAttempts;

          if (!isThrottled) {
            if (error instanceof Error) {
              throw error;
            }
            throw new Error(String((error as any)?.message ?? error ?? 'Replicate prediction failed.'));
          }

          if (shouldRetry) {
            sawThrottle = true;
            logger?.info?.(
              `Replicate provider will retry after ${retryMs}ms for the job ${jobId}. Attempt #${attempt}`,
            );
            logger?.debug?.('providers.replicate.retry', {
              producer: jobId,
              model,
              plannerContext,
              status,
              attempt,
              maxAttempts,
              retryAfterMs: retryMs,
              error: error instanceof Error ? error.message : String(error),
            });

            const before = Date.now();
            await new Promise((resolve) => setTimeout(resolve, retryMs));
            const waitedMs = Date.now() - before;

            logger?.info?.(`Replicate provider for job ${jobId} using model ${model} waited for ${waitedMs}ms`);
            logger?.debug?.('providers.replicate.retry.waited', {
              producer: jobId,
              model,
              attempt,
              waitedMs,
            });
            continue;
          }

          break;
        }
      }

      const message =
        'Replicate rate limit hit (429); retries exhausted. Lower concurrency, wait, or add credit.';
      if (sawThrottle) {
        throw createProviderRateLimitError(message, lastError);
      }
      if (lastError instanceof Error) {
        throw lastError;
      }
      throw new Error(String((lastError as any)?.message ?? lastError ?? 'Replicate prediction failed.'));
    },
  };
}
