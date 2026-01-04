import type {
  LoadedModelCatalog,
  ModelType,
} from '@gorenku/providers';
import type { ProviderRegistry, ProviderDescriptor } from '@gorenku/providers';

/**
 * Result of API key detection for providers.
 */
export interface ProviderAvailability {
  /** Set of provider names that have valid API keys */
  availableProviders: Set<string>;
  /** Map of provider name to error message for unavailable providers */
  unavailableReasons: Map<string, string>;
}

/**
 * Check which providers have valid API keys by attempting warmStart.
 * This uses the same pattern as producers-list.ts for consistency.
 */
export async function detectAvailableProviders(
  catalog: LoadedModelCatalog,
  registry: ProviderRegistry,
): Promise<ProviderAvailability> {
  const availableProviders = new Set<string>();
  const unavailableReasons = new Map<string, string>();
  const checkedProviders = new Set<string>();

  for (const [provider, models] of catalog.providers) {
    if (checkedProviders.has(provider)) {
      continue;
    }
    checkedProviders.add(provider);

    // Get a sample model to test the provider
    const sampleModel = models.values().next().value;
    if (!sampleModel) {
      continue;
    }

    // Skip internal models - they don't require API keys
    if (sampleModel.type === 'internal') {
      availableProviders.add(provider);
      continue;
    }

    try {
      const descriptor: ProviderDescriptor = {
        provider: provider as ProviderDescriptor['provider'],
        model: sampleModel.name,
        environment: 'local',
      };
      const handler = registry.resolve(descriptor);
      await handler.warmStart?.({});
      availableProviders.add(provider);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      unavailableReasons.set(provider, message);
    }
  }

  return { availableProviders, unavailableReasons };
}

/**
 * Filter models from the catalog by available providers and model type.
 */
export function filterModelsByAvailability(
  catalog: LoadedModelCatalog,
  availableProviders: Set<string>,
  modelType?: ModelType,
): Array<{ provider: string; model: string; type: ModelType }> {
  const results: Array<{ provider: string; model: string; type: ModelType }> = [];

  for (const [provider, models] of catalog.providers) {
    if (!availableProviders.has(provider)) {
      continue;
    }

    for (const [modelName, definition] of models) {
      // Skip internal models - they're not user-selectable
      if (definition.type === 'internal') {
        continue;
      }

      // Filter by type if specified
      if (modelType && definition.type !== modelType) {
        continue;
      }

      results.push({
        provider,
        model: modelName,
        type: definition.type,
      });
    }
  }

  return results;
}

/**
 * Get models grouped by provider for display.
 */
export function groupModelsByProvider(
  models: Array<{ provider: string; model: string; type: ModelType }>,
): Map<string, Array<{ model: string; type: ModelType }>> {
  const grouped = new Map<string, Array<{ model: string; type: ModelType }>>();

  for (const { provider, model, type } of models) {
    const existing = grouped.get(provider) ?? [];
    existing.push({ model, type });
    grouped.set(provider, existing);
  }

  return grouped;
}
