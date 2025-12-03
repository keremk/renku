import { createProviderRegistry, type ProviderDescriptor } from '@renku/providers';
import { loadBlueprintBundle } from '../lib/blueprint-loader/index.js';
import { buildProducerOptionsFromBlueprint } from '../lib/producer-options.js';
import { expandPath } from '../lib/path.js';

export interface ProvidersListOptions {
  blueprintPath: string;
}

export interface ProviderListEntry {
  producer: string;
  provider: string;
  model: string;
  environment: string;
  status: 'ready' | 'error';
  message?: string;
}

export interface ProvidersListResult {
  entries: ProviderListEntry[];
}

export async function runProvidersList(options: ProvidersListOptions): Promise<ProvidersListResult> {
  const normalizedBlueprint = options.blueprintPath?.trim();
  if (!normalizedBlueprint) {
    throw new Error('Blueprint path is required for providers:list. Provide --blueprint=/path/to/blueprint.yaml.');
  }
  const blueprintPath = expandPath(normalizedBlueprint);
  const { root } = await loadBlueprintBundle(blueprintPath);
  const providerOptions = buildProducerOptionsFromBlueprint(root, [], true);

  const registry = createProviderRegistry({ mode: 'live' });
  const entries: ProviderListEntry[] = [];

  for (const [producer, variants] of providerOptions) {
    for (const variant of variants) {
      const descriptor: ProviderDescriptor = {
        provider: variant.provider as ProviderDescriptor['provider'],
        model: variant.model,
        environment: variant.environment,
      };

      let status: ProviderListEntry['status'] = 'ready';
      let message: string | undefined;

      try {
        const handler = registry.resolve(descriptor);
        await handler.warmStart?.({});
      } catch (error) {
        status = 'error';
        message = error instanceof Error ? error.message : String(error);
      }

      entries.push({
        producer,
        provider: variant.provider,
        model: variant.model,
        environment: variant.environment,
        status,
        message,
      });
    }
  }

  return { entries };
}
