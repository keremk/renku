import process from 'node:process';
import type {
  ProducerHandler,
  ProviderDescriptor,
  ProviderImplementation,
  ProviderMode,
  ProviderRegistry,
  ProviderRegistryOptions,
  ProviderVariantMatch,
  ResolvedProviderHandler,
  SecretResolver,
} from './types.js';
import {
  loadModelInputSchema,
  lookupModel,
  type LoadedModelCatalog,
} from './model-catalog.js';
import { generateProviderImplementations } from './registry-generator.js';
import { createSimulatedFallbackProducerHandler } from './simulated-fallback-producers.js';
import { createTimelineProducerHandler } from './producers/timeline/ordered-timeline.js';

/**
 * Extended options for creating a provider registry.
 */
export interface CreateProviderRegistryOptions extends ProviderRegistryOptions {
  /** Pre-loaded model catalog. If provided, implementations are generated from it. */
  catalog?: LoadedModelCatalog;
  /** Path to the catalog models directory. Required for schema loading in delegation. */
  catalogModelsDir?: string;
}

/**
 * Create a provider registry that resolves handlers for provider/model combinations.
 *
 * @param options - Registry options including mode, logger, and optional catalog
 * @returns A provider registry instance
 *
 * When a catalog is provided, implementations are generated dynamically from the
 * YAML model definitions. This is the recommended approach for production use.
 *
 * When no catalog is provided (e.g., in lightweight unit tests), the registry
 * defaults to simulated mode and exposes only the internal handlers plus a
 * generic simulated fallback.
 */
export function createProviderRegistry(
  options: CreateProviderRegistryOptions = {}
): ProviderRegistry {
  const mode: ProviderMode = options.mode ?? 'simulated';
  const logger = options.logger;
  const notifications = options.notifications;
  const secretResolver = options.secretResolver ?? createEnvSecretResolver();
  const handlerCache = new Map<string, ProducerHandler>();

  // Generate implementations from catalog if provided, otherwise use minimal defaults
  const implementations = options.catalog
    ? generateProviderImplementations(options.catalog)
    : getMinimalDefaultImplementations();

  function resolve(descriptor: ProviderDescriptor): ProducerHandler {
    const cacheKey = toCacheKey(mode, descriptor);
    const cached = handlerCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const implementation = findImplementation(
      implementations,
      descriptor,
      mode
    );
    if (!implementation) {
      // Provide helpful error message with guidance on how to fix
      const errorMessage =
        `No handler configured for ${descriptor.provider}/${descriptor.model}. ` +
        `Add the model to catalog/models/${descriptor.provider}.yaml with a 'type' field:\n\n` +
        `  - name: ${descriptor.model}\n` +
        `    type: video  # or image, audio, llm, internal\n` +
        `    price:\n` +
        `      function: costByImage\n` +
        `      pricePerImage: 0.03\n`;
      throw new Error(errorMessage);
    }

    // Create schema loader function if catalog is available
    const getModelSchema =
      options.catalog && options.catalogModelsDir
        ? async (provider: string, model: string) =>
            loadModelInputSchema(
              options.catalogModelsDir!,
              options.catalog!,
              provider,
              model
            )
        : undefined;
    const getModelDefinition =
      options.catalog
        ? (provider: string, model: string) =>
            lookupModel(options.catalog!, provider, model)
        : undefined;

    const handler = implementation.factory({
      descriptor,
      mode,
      secretResolver,
      logger,
      schemaRegistry: options.schemaRegistry,
      notifications,
      // Allow internal handlers to resolve and invoke other handlers
      handlerResolver: (subDescriptor) => resolve(subDescriptor),
      // Allow internal handlers to load schemas for delegation
      getModelSchema,
      getModelDefinition,
    });
    handlerCache.set(cacheKey, handler);
    return handler;
  }

  function resolveMany(
    descriptors: ProviderDescriptor[]
  ): ResolvedProviderHandler[] {
    return descriptors.map((descriptor) => ({
      descriptor,
      handler: resolve(descriptor),
    }));
  }

  async function warmStart(bindings: ResolvedProviderHandler[]): Promise<void> {
    for (const binding of bindings) {
      await binding.handler.warmStart?.({ logger });
    }
  }

  return {
    mode,
    resolve,
    resolveMany,
    warmStart,
  };
}

/**
 * Find an implementation that matches the descriptor and mode.
 * Implementations are checked in order, so more specific matches should come first.
 */
function findImplementation(
  implementations: ProviderImplementation[],
  descriptor: ProviderDescriptor,
  mode: ProviderMode
): ProviderImplementation | undefined {
  return implementations.find(
    (implementation) =>
      implementation.mode === mode &&
      matchesDescriptor(descriptor, implementation.match)
  );
}

/**
 * Check if a descriptor matches an implementation's match pattern.
 * Wildcards ('*') match any value.
 */
function matchesDescriptor(
  descriptor: ProviderDescriptor,
  match: ProviderVariantMatch
): boolean {
  const providerMatches =
    match.provider === '*' || match.provider === descriptor.provider;
  const modelMatches = match.model === '*' || match.model === descriptor.model;
  const environmentMatches =
    match.environment === '*' || match.environment === descriptor.environment;
  return providerMatches && modelMatches && environmentMatches;
}

function toCacheKey(
  mode: ProviderMode,
  descriptor: ProviderDescriptor
): string {
  return [
    mode,
    descriptor.provider,
    descriptor.model,
    descriptor.environment,
  ].join('|');
}

function createEnvSecretResolver(): SecretResolver {
  return {
    async getSecret(key: string): Promise<string | null> {
      return process.env[key] ?? null;
    },
  };
}

/**
 * Get minimal default implementations for when no catalog is provided.
 * This is used for unit tests that don't need a full catalog.
 */
function getMinimalDefaultImplementations(): ProviderImplementation[] {
  const wildcard = '*' as const;

  return [
    // Timeline handler for simulated mode (used in registry.test.ts)
    {
      match: {
        provider: 'renku',
        model: 'OrderedTimeline',
        environment: wildcard,
      },
      mode: 'simulated' as ProviderMode,
      factory: createTimelineProducerHandler(),
    },
    // Generic fallback for simulated mode when tests don't provide a catalog.
    {
      match: { provider: wildcard, model: wildcard, environment: wildcard },
      mode: 'simulated' as ProviderMode,
      factory: createSimulatedFallbackProducerHandler(),
    },
  ];
}
