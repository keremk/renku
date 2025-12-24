import Replicate from 'replicate';
import type { ProviderAdapter, ClientOptions, ProviderClient } from '../unified/provider-adapter.js';
import { normalizeReplicateOutput } from './output.js';
import { createReplicateRetryWrapper } from './retry.js';

/**
 * Replicate provider adapter for the unified handler.
 *
 * Note: In simulated mode, the unified handler generates output from schema
 * and doesn't call adapter.invoke(). This adapter is only used for live API calls.
 */
export const replicateAdapter: ProviderAdapter = {
  name: 'replicate',
  secretKey: 'REPLICATE_API_TOKEN',

  async createClient(options: ClientOptions): Promise<ProviderClient> {
    // In simulated mode, client is not used (handler generates output from schema)
    // Return a stub that will throw if accidentally called
    if (options.mode === 'simulated') {
      return createSimulatedStub();
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

/**
 * Creates a stub client for simulated mode.
 * This should never be called - the unified handler generates output from schema instead.
 */
function createSimulatedStub(): ProviderClient {
  return {
    run() {
      throw new Error(
        'Replicate stub client was called in simulated mode. ' +
        'This indicates a bug - the unified handler should generate output from schema.'
      );
    },
  } as unknown as ProviderClient;
}
