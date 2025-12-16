import { createOpenAI } from '@ai-sdk/openai';
import type { SecretResolver, ProviderLogger } from '../../types.js';
import type { SchemaRegistry } from '../../schema-registry.js';

export interface OpenAiClientManager {
  ensure(): Promise<ReturnType<typeof createOpenAI>>;
  getModel(modelName: string): ReturnType<ReturnType<typeof createOpenAI>>;
}

/**
 * Creates an OpenAI client manager with lazy initialization.
 *
 * This manager is only used for live mode. In simulated mode (dry-run),
 * the handler skips client initialization and callOpenAi returns mock data.
 */
export function createOpenAiClientManager(
  secretResolver: SecretResolver,
  _logger?: ProviderLogger,
  _schemaRegistry?: SchemaRegistry,
): OpenAiClientManager {
  let client: ReturnType<typeof createOpenAI> | null = null;

  return {
    async ensure(): Promise<ReturnType<typeof createOpenAI>> {
      if (client) {
        return client;
      }

      const apiKey = await secretResolver.getSecret('OPENAI_API_KEY');
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required to use the OpenAI provider.');
      }

      client = createOpenAI({ apiKey });
      return client;
    },

    getModel(modelName: string) {
      if (!client) {
        throw new Error('OpenAI client not initialized. Call ensure() first.');
      }
      return client(modelName);
    },
  };
}
