import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

/**
 * A model option available for an asset producer.
 */
export interface AssetModelOption {
  provider: string;
  model: string;
}

/**
 * Load available models for an asset producer from its YAML file.
 * Reads the `mappings` section to extract provider/model combinations.
 *
 * @param producerRef - Producer reference path (e.g., "asset/text-to-image")
 * @param catalogRoot - Path to the catalog root directory
 * @returns Array of available provider/model combinations
 */
export async function loadAssetProducerModels(
  producerRef: string,
  catalogRoot: string,
): Promise<AssetModelOption[]> {
  const producerPath = resolve(catalogRoot, 'producers', producerRef + '.yaml');

  let content: string;
  try {
    content = await readFile(producerPath, 'utf8');
  } catch {
    // Producer file not found, return empty
    return [];
  }

  const parsed = parse(content) as { mappings?: Record<string, Record<string, unknown>> };
  const models: AssetModelOption[] = [];

  if (parsed.mappings) {
    for (const [provider, modelMap] of Object.entries(parsed.mappings)) {
      if (modelMap && typeof modelMap === 'object') {
        for (const modelName of Object.keys(modelMap)) {
          models.push({ provider, model: modelName });
        }
      }
    }
  }

  return models;
}

/**
 * Load models for multiple asset producers.
 *
 * @param producerRefs - Array of producer reference paths
 * @param catalogRoot - Path to the catalog root directory
 * @returns Map of producer ref to available models
 */
export async function loadAllAssetModels(
  producerRefs: string[],
  catalogRoot: string,
): Promise<Map<string, AssetModelOption[]>> {
  const result = new Map<string, AssetModelOption[]>();

  // Load all producers in parallel
  const loadPromises = producerRefs.map(async (ref) => {
    const models = await loadAssetProducerModels(ref, catalogRoot);
    return { ref, models };
  });

  const loaded = await Promise.all(loadPromises);

  for (const { ref, models } of loaded) {
    result.set(ref, models);
  }

  return result;
}
