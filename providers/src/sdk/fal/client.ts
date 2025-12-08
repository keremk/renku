import { fal } from '@fal-ai/client';
import type { SecretResolver, ProviderLogger, ProviderMode } from '../../types.js';
import type { SchemaRegistry } from '../../schema-registry.js';

type FalClient = typeof fal;

export interface FalClientManager {
  ensure(): Promise<FalClient>;
}

export function createFalClientManager(
  secretResolver: SecretResolver,
  logger?: ProviderLogger,
  mode: ProviderMode = 'live',
  schemaRegistry?: SchemaRegistry,
): FalClientManager {
  let configured = false;

  return {
    async ensure(): Promise<FalClient> {
      if (configured) {
        return fal;
      }

      if (mode === 'simulated') {
        configured = true;
        return createMockFalClient(schemaRegistry) as unknown as FalClient;
      }

      const key = await secretResolver.getSecret('FAL_KEY');
      if (!key) {
        throw new Error('FAL_KEY is required to use the fal.ai provider.');
      }
      fal.config({ credentials: key });
      configured = true;
      return fal;
    },
  };
}

function createMockFalClient(schemaRegistry?: SchemaRegistry) {
  return {
    async run(identifier: string, options: { input: Record<string, unknown> }) {
      // Extract model from fal-ai/model format (API uses fal-ai prefix)
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
