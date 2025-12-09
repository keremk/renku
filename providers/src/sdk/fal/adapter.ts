import { fal } from '@fal-ai/client';
import type { ProviderAdapter, ClientOptions, ProviderClient } from '../unified/provider-adapter.js';
import { normalizeFalOutput } from './output.js';

type FalClient = typeof fal;

/**
 * Fal.ai provider adapter for the unified handler.
 */
export const falAdapter: ProviderAdapter = {
  name: 'fal-ai',
  secretKey: 'FAL_KEY',

  async createClient(options: ClientOptions): Promise<ProviderClient> {
    if (options.mode === 'simulated') {
      return createMockFalClient(options.schemaRegistry);
    }

    const key = await options.secretResolver.getSecret('FAL_KEY');
    if (!key) {
      throw new Error('FAL_KEY is required to use the fal.ai provider.');
    }
    fal.config({ credentials: key });
    return fal;
  },

  formatModelIdentifier(model: string): string {
    // Fal.ai uses fal-ai/{model} format for API calls
    return `fal-ai/${model}`;
  },

  async invoke(client: ProviderClient, model: string, input: Record<string, unknown>): Promise<unknown> {
    const falClient = client as FalClient;
    return falClient.run(model, { input });
  },

  normalizeOutput(response: unknown): string[] {
    return normalizeFalOutput(response);
  },
};

function createMockFalClient(schemaRegistry?: ClientOptions['schemaRegistry']) {
  return {
    async run(identifier: string, options: { input: Record<string, unknown> }) {
      // Extract model from fal-ai/model format
      const model = identifier.replace(/^fal-ai\//, '');

      if (schemaRegistry) {
        const entry = schemaRegistry.get('fal-ai', model);
        if (entry && entry.sdkMapping) {
          validateInput(options.input, entry.sdkMapping);
        }
      }

      // Return mock output in fal.ai format
      return {
        images: [{ url: 'https://mock.fal.media/output.png' }],
        video: { url: 'https://mock.fal.media/output.mp4' },
        audio: { url: 'https://mock.fal.media/output.mp3' },
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
