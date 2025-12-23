import { createGateway } from 'ai';
import type { LanguageModel } from 'ai';
import type { SecretResolver, ProviderLogger } from '../../types.js';

/** Default environment variable for Vercel AI Gateway API key */
const DEFAULT_API_KEY_ENV = 'AI_GATEWAY_API_KEY';

export interface VercelGatewayClientManager {
  /**
   * Initialize the client for the Vercel AI Gateway.
   * @param apiKeyName Optional override for the API key secret name (defaults to AI_GATEWAY_API_KEY)
   */
  ensure(apiKeyName?: string): Promise<ReturnType<typeof createGateway>>;

  /**
   * Get a model instance from the initialized client.
   * @param modelName Model name to use (e.g., 'anthropic/claude-sonnet-4', 'google/gemini-3-flash')
   */
  getModel(modelName: string): LanguageModel;
}

/**
 * Creates a Vercel AI Gateway client manager with lazy initialization.
 * Requires AI_GATEWAY_API_KEY environment variable (or custom via apiKeyName).
 */
export function createVercelGatewayClientManager(
  secretResolver: SecretResolver,
  logger?: ProviderLogger
): VercelGatewayClientManager {
  let client: ReturnType<typeof createGateway> | null = null;

  return {
    async ensure(apiKeyName?: string): Promise<ReturnType<typeof createGateway>> {
      if (client) {
        return client;
      }

      // Get API key - use override if provided, otherwise use default
      const secretName = apiKeyName ?? DEFAULT_API_KEY_ENV;
      const apiKey = await secretResolver.getSecret(secretName);

      if (!apiKey) {
        throw new Error(
          `API key "${secretName}" not found. ` +
            `Set the ${secretName} environment variable.`
        );
      }

      logger?.debug?.('providers.vercel-gateway.client.init', {
        secretName,
      });

      // Create Vercel AI Gateway client using createGateway from 'ai' package
      client = createGateway({
        apiKey,
      });

      return client;
    },

    getModel(modelName: string): LanguageModel {
      if (!client) {
        throw new Error('Client not initialized. Call ensure() first.');
      }

      // Use the gateway client to get a model
      // Model names are like 'anthropic/claude-sonnet-4', 'google/gemini-3-flash'
      return client.languageModel(modelName);
    },
  };
}
