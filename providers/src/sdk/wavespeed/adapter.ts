import type { ProviderAdapter, ClientOptions, ProviderClient } from '../unified/provider-adapter.js';
import { normalizeWavespeedOutput } from './output.js';
import { pollForCompletion } from './polling.js';
import type { WavespeedResult } from './client.js';

const BASE_URL = 'https://api.wavespeed.ai/api/v3';

interface WavespeedClient {
  apiKey: string;
  mode: ClientOptions['mode'];
  schemaRegistry?: ClientOptions['schemaRegistry'];
  logger?: ClientOptions['logger'];
}

/**
 * Wavespeed-ai provider adapter for the unified handler.
 * Uses direct HTTP calls with polling (no SDK).
 */
export const wavespeedAdapter: ProviderAdapter = {
  name: 'wavespeed-ai',
  secretKey: 'WAVESPEED_API_KEY',

  async createClient(options: ClientOptions): Promise<ProviderClient> {
    if (options.mode === 'simulated') {
      return {
        apiKey: 'mock-api-key',
        mode: options.mode,
        schemaRegistry: options.schemaRegistry,
        logger: options.logger,
      } as WavespeedClient;
    }

    const key = await options.secretResolver.getSecret('WAVESPEED_API_KEY');
    if (!key) {
      throw new Error('WAVESPEED_API_KEY is required to use the wavespeed-ai provider.');
    }
    return {
      apiKey: key,
      mode: options.mode,
      schemaRegistry: options.schemaRegistry,
      logger: options.logger,
    } as WavespeedClient;
  },

  formatModelIdentifier(model: string): string {
    // Wavespeed uses the model name directly
    return model;
  },

  async invoke(client: ProviderClient, model: string, input: Record<string, unknown>): Promise<unknown> {
    const wavespeedClient = client as WavespeedClient;

    if (wavespeedClient.mode === 'simulated') {
      return createMockResult(wavespeedClient.schemaRegistry, model, input);
    }

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

function createMockResult(
  schemaRegistry: ClientOptions['schemaRegistry'],
  model: string,
  input: Record<string, unknown>,
): WavespeedResult {
  if (schemaRegistry) {
    const entry = schemaRegistry.get('wavespeed-ai', model);
    if (entry && entry.sdkMapping) {
      validateInput(input, entry.sdkMapping);
    }
  }

  return {
    data: {
      id: 'mock-request-id',
      status: 'completed',
      outputs: ['https://mock.wavespeed.ai/output.png'],
    },
  };
}

function validateInput(
  input: Record<string, unknown>,
  mapping: Record<string, { field: string; required?: boolean; type?: string }>,
) {
  for (const [key, rule] of Object.entries(mapping)) {
    const value = input[rule.field];

    if (rule.required && (value === undefined || value === null || value === '')) {
      throw new Error(`Missing required input field: ${rule.field} (mapped from ${key})`);
    }

    if (value !== undefined && value !== null && rule.type) {
      if (rule.type === 'string' && typeof value !== 'string') {
        throw new Error(`Invalid type for field ${rule.field}. Expected string, got ${typeof value}`);
      }
      if (rule.type === 'number' && typeof value !== 'number') {
        throw new Error(`Invalid type for field ${rule.field}. Expected number, got ${typeof value}`);
      }
      if (rule.type === 'boolean' && typeof value !== 'boolean') {
        throw new Error(`Invalid type for field ${rule.field}. Expected boolean, got ${typeof value}`);
      }
    }
  }
}
