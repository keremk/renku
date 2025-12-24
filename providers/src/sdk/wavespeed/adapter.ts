import type { ProviderAdapter, ClientOptions, ProviderClient } from '../unified/provider-adapter.js';
import { normalizeWavespeedOutput } from './output.js';
import { pollForCompletion } from './polling.js';
import type { WavespeedResult } from './client.js';

const BASE_URL = 'https://api.wavespeed.ai/api/v3';

interface WavespeedClient {
  apiKey: string;
  logger?: ClientOptions['logger'];
}

/**
 * Wavespeed-ai provider adapter for the unified handler.
 * Uses direct HTTP calls with polling (no SDK).
 *
 * Note: In simulated mode, the unified handler generates output from schema
 * and doesn't call adapter.invoke(). This adapter is only used for live API calls.
 */
export const wavespeedAdapter: ProviderAdapter = {
  name: 'wavespeed-ai',
  secretKey: 'WAVESPEED_API_KEY',

  async createClient(options: ClientOptions): Promise<ProviderClient> {
    // In simulated mode, client is not used (handler generates output from schema)
    // Return a stub that will throw if accidentally called
    if (options.mode === 'simulated') {
      return createSimulatedStub();
    }

    const key = await options.secretResolver.getSecret('WAVESPEED_API_KEY');
    if (!key) {
      throw new Error('WAVESPEED_API_KEY is required to use the wavespeed-ai provider.');
    }
    return {
      apiKey: key,
      logger: options.logger,
    } as WavespeedClient;
  },

  formatModelIdentifier(model: string): string {
    // Wavespeed uses the model name directly
    return model;
  },

  async invoke(client: ProviderClient, model: string, input: Record<string, unknown>): Promise<unknown> {
    const wavespeedClient = client as WavespeedClient;

    // Submit task
    const submitUrl = `${BASE_URL}/${model}`;
    const submitResponse = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${wavespeedClient.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(`Wavespeed API error (${submitResponse.status}): ${errorText}`);
    }

    const submitResult = await submitResponse.json() as { data: { id: string } };
    const requestId = submitResult.data.id;

    // Poll for completion
    const result = await pollForCompletion(
      {
        submitTask: async () => requestId,
        pollResult: async (id: string) => {
          const pollUrl = `${BASE_URL}/predictions/${id}/result`;
          const response = await fetch(pollUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${wavespeedClient.apiKey}`,
            },
          });
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Wavespeed API error (${response.status}): ${errorText}`);
          }
          return await response.json() as WavespeedResult;
        },
      },
      requestId,
      { logger: wavespeedClient.logger },
    );

    return result;
  },

  normalizeOutput(response: unknown): string[] {
    return normalizeWavespeedOutput(response as WavespeedResult);
  },
};

/**
 * Creates a stub client for simulated mode.
 * This should never be called - the unified handler generates output from schema instead.
 */
function createSimulatedStub(): ProviderClient {
  return {
    apiKey: 'simulated-stub',
    invoke() {
      throw new Error(
        'Wavespeed stub client was called in simulated mode. ' +
        'This indicates a bug - the unified handler should generate output from schema.'
      );
    },
  } as unknown as ProviderClient;
}
