import Replicate from 'replicate';
import type { ProviderAdapter, ClientOptions, ProviderClient } from '../unified/provider-adapter.js';
import { normalizeReplicateOutput } from './output.js';
import { createReplicateRetryWrapper } from './retry.js';

/**
 * Replicate provider adapter for the unified handler.
 */
export const replicateAdapter: ProviderAdapter = {
  name: 'replicate',
  secretKey: 'REPLICATE_API_TOKEN',

  async createClient(options: ClientOptions): Promise<ProviderClient> {
    if (options.mode === 'simulated') {
      return createMockReplicateClient(options.schemaRegistry);
    }

    const token = await options.secretResolver.getSecret('REPLICATE_API_TOKEN');
    if (!token) {
      throw new Error('REPLICATE_API_TOKEN is required to use the Replicate provider.');
    }
    return new Replicate({ auth: token });
  },

  formatModelIdentifier(model: string): string {
    // Replicate uses owner/model or owner/model:version format
    return model;
  },

  async invoke(client: ProviderClient, model: string, input: Record<string, unknown>): Promise<unknown> {
    const replicate = client as Replicate;
    return replicate.run(model as `${string}/${string}` | `${string}/${string}:${string}`, { input });
  },

  normalizeOutput(response: unknown): string[] {
    return normalizeReplicateOutput(response);
  },

  createRetryWrapper(options) {
    return createReplicateRetryWrapper(options);
  },
};

function createMockReplicateClient(schemaRegistry?: ClientOptions['schemaRegistry']) {
  return {
    async run(identifier: string, options: { input: Record<string, unknown> }) {
      const [owner, modelName] = identifier.split('/');
      const cleanModelName = modelName ? modelName.split(':')[0] : '';
      const fullModelName = `${owner}/${cleanModelName}`;

      if (schemaRegistry) {
        const entry = schemaRegistry.get('replicate', fullModelName);
        if (entry && entry.sdkMapping) {
          validateInput(options.input, entry.sdkMapping);
        }
      }

      return ['https://mock.replicate.com/output.png'];
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
