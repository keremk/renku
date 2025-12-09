import type { SecretResolver, ProviderLogger, ProviderMode } from '../../types.js';
import type { SchemaRegistry } from '../../schema-registry.js';

const BASE_URL = 'https://api.wavespeed.ai/api/v3';

export interface WavespeedResult {
  data: {
    id: string;
    status: 'completed' | 'failed' | 'processing' | 'pending';
    outputs?: string[];
    error?: string;
  };
}

export interface WavespeedClientManager {
  submitTask(model: string, input: Record<string, unknown>): Promise<string>;
  pollResult(requestId: string): Promise<WavespeedResult>;
}

export function createWavespeedClientManager(
  secretResolver: SecretResolver,
  logger?: ProviderLogger,
  mode: ProviderMode = 'live',
  schemaRegistry?: SchemaRegistry,
): WavespeedClientManager {
  let apiKey: string | null = null;

  async function ensureApiKey(): Promise<string> {
    if (apiKey) {
      return apiKey;
    }

    if (mode === 'simulated') {
      apiKey = 'mock-api-key';
      return apiKey;
    }

    const key = await secretResolver.getSecret('WAVESPEED_API_KEY');
    if (!key) {
      throw new Error('WAVESPEED_API_KEY is required to use the wavespeed-ai provider.');
    }
    apiKey = key;
    return apiKey;
  }

  if (mode === 'simulated') {
    return createMockWavespeedClient(schemaRegistry);
  }

  return {
    async submitTask(model: string, input: Record<string, unknown>): Promise<string> {
      const key = await ensureApiKey();
      const url = `${BASE_URL}/${model}`;

      logger?.debug?.('providers.wavespeed.client.submitTask', {
        model,
        url,
        inputKeys: Object.keys(input),
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Wavespeed API error (${response.status}): ${errorText}`);
      }

      const result = await response.json() as { data: { id: string } };
      return result.data.id;
    },

    async pollResult(requestId: string): Promise<WavespeedResult> {
      const key = await ensureApiKey();
      const url = `${BASE_URL}/predictions/${requestId}/result`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${key}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Wavespeed API error (${response.status}): ${errorText}`);
      }

      return await response.json() as WavespeedResult;
    },
  };
}

function createMockWavespeedClient(schemaRegistry?: SchemaRegistry): WavespeedClientManager {
  return {
    async submitTask(model: string, input: Record<string, unknown>): Promise<string> {
      if (schemaRegistry) {
        const entry = schemaRegistry.get('wavespeed-ai', model);
        if (entry && entry.sdkMapping) {
          validateInput(input, entry.sdkMapping);
        }
      }
      return 'mock-request-id';
    },

    async pollResult(_requestId: string): Promise<WavespeedResult> {
      return {
        data: {
          id: _requestId,
          status: 'completed',
          outputs: ['https://mock.wavespeed.ai/output.png'],
        },
      };
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
