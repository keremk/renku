import { fal } from '@fal-ai/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ProviderAdapter,
  ClientOptions,
  ProviderClient,
  ModelContext,
  RetryWrapperOptions,
  RetryWrapper,
} from '../unified/provider-adapter.js';
import { normalizeFalOutput } from './output.js';
import {
  falSubscribe,
  FalTimeoutError,
  getPollIntervalForModel,
  getTimeoutForModel,
} from './subscribe.js';
import type { ProviderLogger } from '../../types.js';

type SubscribeOptions = {
  logger?: ProviderLogger;
  jobId?: string;
  model?: string;
  pollInterval?: number;
  timeout?: number;
};

const subscribeOptionsStorage = new AsyncLocalStorage<SubscribeOptions>();

/**
 * Fal.ai provider adapter for the unified handler.
 *
 * Uses fal.subscribe() instead of fal.run() for better handling of long-running
 * jobs like video generation. This provides:
 * - Configurable poll intervals (longer for video models)
 * - Request ID capture for recovery on timeout
 * - Better timeout handling with recoverable errors
 */
export const falAdapter: ProviderAdapter = {
  name: 'fal-ai',
  secretKey: 'FAL_KEY',

  async createClient(options: ClientOptions): Promise<ProviderClient> {
    // In simulated mode, client is not used (handler generates output from schema)
    // Return a stub that will throw if accidentally called
    if (options.mode === 'simulated') {
      return createSimulatedStub();
    }

    const key = await options.secretResolver.getSecret('FAL_KEY');
    if (!key) {
      throw new Error('FAL_KEY is required to use the fal.ai provider.');
    }
    fal.config({ credentials: key });
    return fal;
  },

  formatModelIdentifier(model: string, context?: ModelContext): string {
    // If subProvider is specified, model name is already fully qualified
    if (context?.subProvider) {
      return model;
    }
    // Default: Fal.ai uses fal-ai/{model} format for API calls
    return `fal-ai/${model}`;
  },

  async invoke(
    client: ProviderClient,
    model: string,
    input: Record<string, unknown>
  ): Promise<unknown> {
    // Always use falSubscribe for better long-running job handling
    // This provides request ID capture for recovery on timeout
    const options = subscribeOptionsStorage.getStore();
    const pollInterval =
      options?.pollInterval ?? getPollIntervalForModel(model);
    const timeout = options?.timeout ?? getTimeoutForModel(model);

    try {
      const result = await falSubscribe(model, input, {
        pollInterval,
        timeout,
        logger: options?.logger,
        jobId: options?.jobId,
        model: options?.model ?? model,
      });

      // Return in fal.run() format: { data, requestId }
      return { data: result.output, requestId: result.requestId };
    } catch (error) {
      if (error instanceof FalTimeoutError) {
        // Enhance the error with recoverable info for diagnostics
        const enhancedError = new Error(error.message) as Error & {
          falRequestId: string;
          providerRequestId: string;
          recoverable: boolean;
          provider: string;
          model: string;
          reason: string;
        };
        enhancedError.falRequestId = error.requestId;
        enhancedError.providerRequestId = error.requestId;
        enhancedError.recoverable = true;
        enhancedError.provider = 'fal-ai';
        enhancedError.model = model;
        enhancedError.reason = 'timeout';
        throw enhancedError;
      }
      throw error;
    }
  },

  normalizeOutput(response: unknown): string[] {
    return normalizeFalOutput(response);
  },

  createRetryWrapper(options: RetryWrapperOptions): RetryWrapper {
    const { logger, jobId, model } = options;
    const pollInterval = getPollIntervalForModel(model);
    const timeout = getTimeoutForModel(model);

    return {
      async execute<T>(fn: () => Promise<T>): Promise<T> {
        const subscribeOptions: SubscribeOptions = {
          logger,
          jobId,
          model,
          pollInterval,
          timeout,
        };

        return subscribeOptionsStorage.run(subscribeOptions, fn);
      },
    };
  },
};

/**
 * Creates a stub client for simulated mode.
 * This should never be called - the unified handler generates output from schema instead.
 */
function createSimulatedStub(): ProviderClient {
  return {
    run() {
      throw new Error(
        'Fal.ai stub client was called in simulated mode. ' +
          'This indicates a bug - the unified handler should generate output from schema.'
      );
    },
    subscribe() {
      throw new Error(
        'Fal.ai stub client subscribe was called in simulated mode. ' +
          'This indicates a bug - the unified handler should generate output from schema.'
      );
    },
  } as unknown as ProviderClient;
}
