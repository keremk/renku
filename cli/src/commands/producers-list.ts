import { resolve } from 'node:path';
import {
  createProviderRegistry,
  loadModelCatalog,
  lookupModel,
  type ProviderDescriptor,
  type ProducerModelEntry,
} from '@renku/providers';
import { formatProducerAlias } from '@renku/core';
import { loadBlueprintBundle } from '../lib/blueprint-loader/index.js';
import { collectVariants } from '../lib/producer-options.js';
import { expandPath } from '../lib/path.js';
import { getDefaultCliConfigPath, readCliConfig } from '../lib/cli-config.js';

export interface ProducersListOptions {
  blueprintPath: string;
}

export interface ProducersListResult {
  entries: ProducerModelEntry[];
  missingTokens: Map<string, string>;
}

export async function runProducersList(options: ProducersListOptions): Promise<ProducersListResult> {
  const normalizedBlueprint = options.blueprintPath?.trim();
  if (!normalizedBlueprint) {
    throw new Error('Blueprint path is required for producers:list. Provide --blueprint=/path/to/blueprint.yaml.');
  }
  const blueprintPath = expandPath(normalizedBlueprint);
  const { root } = await loadBlueprintBundle(blueprintPath);

  // Load model catalog for pricing and type info
  const cliConfig = await readCliConfig(getDefaultCliConfigPath());
  const catalogModelsDir = cliConfig?.catalog?.root
    ? resolve(cliConfig.catalog.root, 'models')
    : undefined;
  const catalog = catalogModelsDir
    ? await loadModelCatalog(catalogModelsDir)
    : undefined;

  const registry = createProviderRegistry({ mode: 'live', catalog });
  const entries: ProducerModelEntry[] = [];
  const missingTokens = new Map<string, string>();
  const checkedProviders = new Set<string>();

  // Recursively collect producers from blueprint tree
  const collectFromNode = async (node: typeof root, namespacePath: string[] = []) => {
    for (const producer of node.document.producers) {
      const producerName = formatProducerAlias(namespacePath, producer.name);
      const variants = collectVariants(producer);

      for (const variant of variants) {
        // Look up catalog info for pricing and type
        const modelInfo = catalog ? lookupModel(catalog, variant.provider, variant.model) : null;

        // Try warm-start to check API token availability (once per provider)
        if (!checkedProviders.has(variant.provider)) {
          checkedProviders.add(variant.provider);
          try {
            const descriptor: ProviderDescriptor = {
              provider: variant.provider as ProviderDescriptor['provider'],
              model: variant.model,
              environment: 'local',
            };
            const handler = registry.resolve(descriptor);
            await handler.warmStart?.({});
          } catch (error) {
            missingTokens.set(variant.provider, error instanceof Error ? error.message : String(error));
          }
        }

        // Add entry for each variant
        entries.push({
          producer: producerName,
          provider: variant.provider,
          model: variant.model,
          modelType: modelInfo?.type,
          price: modelInfo?.price,
        });
      }
    }

    // Process child nodes recursively
    for (const [childName, childNode] of node.children) {
      await collectFromNode(childNode, [...namespacePath, childName]);
    }
  };

  await collectFromNode(root);

  return { entries, missingTokens };
}
