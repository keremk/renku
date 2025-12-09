import type { WavespeedClientManager, WavespeedResult } from './client.js';
import type { ProviderLogger } from '../../types.js';

export interface PollingOptions {
  maxAttempts?: number;
  intervalMs?: number;
  logger?: ProviderLogger;
  jobId?: string;
}

const DEFAULT_MAX_ATTEMPTS = 300; // 5 minutes with 1s interval
const DEFAULT_INTERVAL_MS = 1000;

/**
 * Poll for wavespeed task completion.
 * Throws if the task fails or times out.
 */
export async function pollForCompletion(
  client: WavespeedClientManager,
  requestId: string,
  options: PollingOptions = {},
): Promise<WavespeedResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await client.pollResult(requestId);

    options.logger?.debug?.('providers.wavespeed.polling.attempt', {
      requestId,
      attempt,
      status: result.data.status,
      jobId: options.jobId,
    });

    if (result.data.status === 'completed') {
      return result;
    }

    if (result.data.status === 'failed') {
      const errorMsg = result.data.error || 'Wavespeed task failed without error message';
      throw new Error(errorMsg);
    }

    // Still processing or pending, wait and retry
    await sleep(intervalMs);
  }

  throw new Error(`Wavespeed task timed out after ${maxAttempts} attempts (requestId: ${requestId})`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
