import type { LoadedModelCatalog, ModelDefinition, ModelType } from './model-catalog.js';
import type { HandlerFactory, ProviderImplementation, ProviderMode, ProviderVariantMatch } from './types.js';
import { createMockProducerHandler } from './mock-producers.js';
import { createOpenAiLlmHandler } from './producers/llm/openai.js';
import { createVercelAiGatewayHandler } from './producers/llm/vercel-ai-gateway.js';
import { createMp4ExporterHandler } from './producers/export/mp4-exporter.js';
import { createTimelineProducerHandler } from './producers/timeline/ordered-timeline.js';
import { createUnifiedHandler } from './sdk/unified/index.js';
import { replicateAdapter } from './sdk/replicate/adapter.js';
import { falAdapter } from './sdk/fal/adapter.js';
import { wavespeedAdapter } from './sdk/wavespeed/adapter.js';
import type { ProviderAdapter } from './sdk/unified/index.js';

/**
 * Mapping of provider names to their unified adapters.
 */
const PROVIDER_ADAPTERS: Record<string, ProviderAdapter> = {
  'replicate': replicateAdapter,
  'fal-ai': falAdapter,
  'wavespeed-ai': wavespeedAdapter,
};

/**
 * Default output MIME types for each model type.
 * These are used as fallbacks when the model definition doesn't specify a MIME type.
 */
const TYPE_TO_MIME: Record<ModelType, string> = {
  'image': 'image/png',
  'video': 'video/mp4',
  'audio': 'audio/mpeg',
  'llm': 'text/plain',
  'text': 'text/plain',
  'internal': 'application/json',
  'json': 'application/json',
};

/**
 * Internal handler factories for renku-specific models.
 */
const INTERNAL_HANDLERS: Record<string, () => HandlerFactory> = {
  'timeline': createTimelineProducerHandler,
  'mp4-exporter': createMp4ExporterHandler,
};

/**
 * Generate provider implementations from a model catalog.
 * Each model gets entries for both 'live' and 'simulated' modes.
 */
export function generateProviderImplementations(
  catalog: LoadedModelCatalog
): ProviderImplementation[] {
  const implementations: ProviderImplementation[] = [];

  for (const [provider, models] of catalog.providers) {
    for (const [modelName, definition] of models) {
      const impl = createImplementation(provider, modelName, definition);
      if (impl) {
        // Add for both live and simulated modes
        implementations.push({ ...impl, mode: 'live' });
        implementations.push({ ...impl, mode: 'simulated' });

        // Internal handlers also need mock mode (used in tests)
        if (definition.handler) {
          implementations.push({ ...impl, mode: 'mock' });
        }
      }
    }
  }

  // Add static entries (OpenAI wildcard, mock fallback)
  implementations.push(...getStaticImplementations());

  return implementations;
}

/**
 * Create a single implementation entry for a model.
 */
function createImplementation(
  provider: string,
  model: string,
  definition: ModelDefinition
): Omit<ProviderImplementation, 'mode'> | null {
  const match: ProviderVariantMatch = {
    provider: provider as ProviderVariantMatch['provider'],
    model,
    environment: '*',
  };

  // Handle internal handlers (models with a handler field)
  // This takes precedence over type-based routing
  if (definition.handler) {
    const handlerFactory = INTERNAL_HANDLERS[definition.handler];
    if (!handlerFactory) {
      throw new Error(`Unknown internal handler: ${definition.handler}`);
    }
    return {
      match,
      factory: handlerFactory(),
    };
  }

  // Handle LLM/text models - skip here, they use wildcard matching via static entries
  if (definition.type === 'llm' || definition.type === 'text') {
    return null;
  }

  // Get the adapter for this provider
  const adapter = PROVIDER_ADAPTERS[provider];
  if (!adapter) {
    throw new Error(
      `No adapter configured for provider "${provider}". ` +
      `Add an adapter to PROVIDER_ADAPTERS in registry-generator.ts.`
    );
  }

  // Use MIME from model definition, falling back to type-based defaults
  const mimeType = definition.mime?.[0] ?? TYPE_TO_MIME[definition.type];

  return {
    match,
    factory: createUnifiedHandler({ adapter, outputMimeType: mimeType }),
  };
}

/**
 * Get static implementation entries that don't come from the catalog.
 */
function getStaticImplementations(): ProviderImplementation[] {
  const wildcard = '*' as const;

  return [
    // OpenAI wildcard (all models use same LLM handler)
    {
      match: { provider: 'openai', model: wildcard, environment: wildcard },
      mode: 'live' as ProviderMode,
      factory: createOpenAiLlmHandler(),
    },
    {
      match: { provider: 'openai', model: wildcard, environment: wildcard },
      mode: 'simulated' as ProviderMode,
      factory: createOpenAiLlmHandler(),
    },
    // Vercel AI Gateway wildcard (supports multiple providers via OpenAI-compatible API)
    {
      match: { provider: 'vercel', model: wildcard, environment: wildcard },
      mode: 'live' as ProviderMode,
      factory: createVercelAiGatewayHandler(),
    },
    {
      match: { provider: 'vercel', model: wildcard, environment: wildcard },
      mode: 'simulated' as ProviderMode,
      factory: createVercelAiGatewayHandler(),
    },
    // Mock fallback for all unmatched providers (only for mock mode)
    {
      match: { provider: wildcard, model: wildcard, environment: wildcard },
      mode: 'mock' as ProviderMode,
      factory: createMockProducerHandler(),
    },
  ];
}
