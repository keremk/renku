import { readdir, readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ModelPriceConfig } from './producers/cost-functions.js';

/**
 * Model output type - determines which handler factory and output mime type to use.
 */
export type ModelType = 'image' | 'video' | 'audio' | 'llm' | 'internal';

/**
 * Model definition from YAML catalog.
 * Extends pricing info with handler metadata.
 */
export interface ModelDefinition {
  /** Model name (e.g., 'bytedance/seedream-4') */
  name: string;
  /** Output type - determines handler selection */
  type: ModelType;
  /** Custom handler identifier for 'internal' type */
  handler?: string;
  /** Pricing configuration */
  price?: ModelPriceConfig | number;
}

/**
 * Raw YAML structure for a provider's model catalog.
 */
export interface ProviderCatalogYaml {
  models: Array<{
    name: string;
    type?: ModelType;
    handler?: string;
    price?: ModelPriceConfig | number;
  }>;
}

/**
 * Loaded model catalog with all providers and their models.
 */
export interface LoadedModelCatalog {
  /** Map of provider name → Map of model name → ModelDefinition */
  providers: Map<string, Map<string, ModelDefinition>>;
}

/**
 * Load model catalog from a directory containing provider YAML files.
 * Each YAML file should be named after the provider (e.g., replicate.yaml).
 */
export async function loadModelCatalog(
  catalogModelsDir: string
): Promise<LoadedModelCatalog> {
  const catalog: LoadedModelCatalog = {
    providers: new Map(),
  };

  let files: string[];
  try {
    files = await readdir(catalogModelsDir);
  } catch {
    // Directory doesn't exist - return empty catalog
    return catalog;
  }

  const yamlFiles = files.filter((f) => f.endsWith('.yaml'));

  for (const file of yamlFiles) {
    const providerName = basename(file, '.yaml');
    const filePath = resolve(catalogModelsDir, file);

    try {
      const contents = await readFile(filePath, 'utf8');
      const data = parseYaml(contents) as ProviderCatalogYaml;

      if (!data.models || !Array.isArray(data.models)) {
        continue;
      }

      const modelMap = new Map<string, ModelDefinition>();
      for (const model of data.models) {
        if (!model.type) {
          // Skip models without type - they can't be used for handler generation
          // but may still be used for pricing
          continue;
        }
        modelMap.set(model.name, {
          name: model.name,
          type: model.type,
          handler: model.handler,
          price: model.price,
        });
      }
      catalog.providers.set(providerName, modelMap);
    } catch (error) {
      // Skip files that fail to parse
      console.warn(`Failed to load catalog file ${file}: ${error}`);
    }
  }

  return catalog;
}

/**
 * Look up a model definition in the catalog.
 */
export function lookupModel(
  catalog: LoadedModelCatalog,
  provider: string,
  model: string
): ModelDefinition | null {
  const providerMap = catalog.providers.get(provider);
  if (!providerMap) {
    return null;
  }
  return providerMap.get(model) ?? null;
}
