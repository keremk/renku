import { fal } from '@fal-ai/client';
import type { ProviderAdapter, ClientOptions, ProviderClient, ModelContext } from '../unified/provider-adapter.js';
import { normalizeFalOutput } from './output.js';

type FalClient = typeof fal;

/**
 * Fal.ai provider adapter for the unified handler.
 *
 * Note: In simulated mode, the unified handler generates output from schema
 * and doesn't call adapter.invoke(). This adapter is only used for live API calls.
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

  async invoke(client: ProviderClient, model: string, input: Record<string, unknown>): Promise<unknown> {
    const falClient = client as FalClient;
    return falClient.run(model, { input });
  },

  normalizeOutput(response: unknown): string[] {
    return normalizeFalOutput(response);
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
  } as unknown as ProviderClient;
}
