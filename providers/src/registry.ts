import { providerImplementations } from './mappings.js';
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

export function createProviderRegistry(options: ProviderRegistryOptions = {}): ProviderRegistry {
  const mode: ProviderMode = options.mode ?? 'mock';
  const logger = options.logger;
  const notifications = options.notifications;
  const secretResolver = options.secretResolver ?? createEnvSecretResolver();
  const handlerCache = new Map<string, ProducerHandler>();

  function resolve(descriptor: ProviderDescriptor): ProducerHandler {
    const cacheKey = toCacheKey(mode, descriptor);
    const cached = handlerCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const implementation = findImplementation(providerImplementations, descriptor, mode);
    if (!implementation) {
      throw new Error(
        `No provider handler registered for provider ${descriptor.provider}/${descriptor.model} (${descriptor.environment}) in ${mode} mode.`,
      );
    }

    const handler = implementation.factory({
      descriptor,
      mode,
      secretResolver,
      logger,
      schemaRegistry: options.schemaRegistry,
      notifications,
      cloudStorage: options.cloudStorage,
    });
    handlerCache.set(cacheKey, handler);
    return handler;
  }

  function resolveMany(descriptors: ProviderDescriptor[]): ResolvedProviderHandler[] {
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

function findImplementation(
  implementations: ProviderImplementation[],
  descriptor: ProviderDescriptor,
  mode: ProviderMode,
): ProviderImplementation | undefined {
  return implementations.find(
    (implementation) => implementation.mode === mode && matchesDescriptor(descriptor, implementation.match),
  );
}

function matchesDescriptor(descriptor: ProviderDescriptor, match: ProviderVariantMatch): boolean {
  const providerMatches = match.provider === '*' || match.provider === descriptor.provider;
  const modelMatches = match.model === '*' || match.model === descriptor.model;
  const environmentMatches = match.environment === '*' || match.environment === descriptor.environment;
  return providerMatches && modelMatches && environmentMatches;
}

function toCacheKey(mode: ProviderMode, descriptor: ProviderDescriptor): string {
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
