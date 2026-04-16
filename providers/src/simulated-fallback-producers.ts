import { createSimulatedFallbackArtifacts } from './simulated-fallback-output.js';
import type {
  HandlerFactory,
  HandlerFactoryInit,
  ProducerHandler,
  ProviderJobContext,
  ProviderResult,
} from './types.js';

export function createSimulatedFallbackProducerHandler(): HandlerFactory {
  return ({ descriptor, mode }: HandlerFactoryInit): ProducerHandler => ({
    provider: descriptor.provider,
    model: descriptor.model,
    environment: descriptor.environment,
    mode,
    async invoke(request: ProviderJobContext): Promise<ProviderResult> {
      const artifacts = await createSimulatedFallbackArtifacts(request);
      return {
        status: 'succeeded',
        artifacts,
      };
    },
  });
}
