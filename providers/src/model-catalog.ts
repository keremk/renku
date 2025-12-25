import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ModelPriceConfig } from './producers/cost-functions.js';
import { parseSchemaFile, type SchemaFile } from './sdk/unified/schema-file.js';

/**
 * Model output type - determines which handler factory and output mime type to use.
 */
export type ModelType = 'image' | 'video' | 'audio' | 'llm' | 'text' | 'internal' | 'json';

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
  /** Supported MIME types for output */
  mime?: string[];
  /** Optional override path for input schema (relative to provider directory) */
  inputSchema?: string;
  /** Pricing configuration */
  price?: ModelPriceConfig | number;
  /** Secret name for BYOK (e.g., 'ANTHROPIC_API_KEY') - used by vercel gateway */
  apiKeyName?: string;
  /** Optional sub-provider (e.g., 'wan' for wan models hosted on fal-ai). When specified, model name is fully qualified. */
  subProvider?: string;
}

/**
 * Entry representing a model available for a producer.
 * Used for discovery/listing of all model options.
 */
export interface ProducerModelEntry {
  /** Producer name from blueprint */
  producer: string;
  /** Provider name (e.g., 'replicate', 'fal-ai', 'openai') */
  provider: string;
  /** Model identifier (e.g., 'bytedance/seedance-1-pro-fast') */
  model: string;
  /** Model type from catalog (image, video, audio, llm, internal) */
  modelType?: ModelType;
  /** Pricing configuration from catalog */
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
    mime?: string[];
    inputSchema?: string;
    price?: ModelPriceConfig | number;
    apiKeyName?: string;
    subProvider?: string;
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
 * Load model catalog from a directory containing provider subdirectories.
 * Each provider has a subdirectory with a YAML file named after the provider.
 * Structure: catalog/models/{provider}/{provider}.yaml
 */
export async function loadModelCatalog(
  catalogModelsDir: string
): Promise<LoadedModelCatalog> {
  const catalog: LoadedModelCatalog = {
    providers: new Map(),
  };

  let entries: string[];
  try {
    entries = await readdir(catalogModelsDir);
  } catch {
    // Directory doesn't exist - return empty catalog
    return catalog;
  }

  // Filter to only directories (provider subdirectories)
  const providerDirs: string[] = [];
  for (const entry of entries) {
    const entryPath = resolve(catalogModelsDir, entry);
    try {
      const stats = await stat(entryPath);
      if (stats.isDirectory()) {
        providerDirs.push(entry);
      }
    } catch {
      // Skip entries we can't stat
      continue;
    }
  }

  for (const providerName of providerDirs) {
    // Look for {provider}/{provider}.yaml
    const filePath = resolve(catalogModelsDir, providerName, `${providerName}.yaml`);

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
          mime: model.mime,
          inputSchema: model.inputSchema,
          price: model.price,
          apiKeyName: model.apiKeyName,
          subProvider: model.subProvider,
        });
      }
      catalog.providers.set(providerName, modelMap);
    } catch (error) {
      // Skip providers that fail to load
      console.warn(`Failed to load catalog for provider ${providerName}: ${error}`);
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

/**
 * Convert a model name to a filename by replacing slashes and dots with dashes.
 * e.g., 'bytedance/seedance-1-pro-fast' -> 'bytedance-seedance-1-pro-fast'
 * e.g., 'minimax/speech-2.6-hd' -> 'minimax-speech-2-6-hd'
 */
function modelNameToFilename(modelName: string): string {
  return modelName.replace(/[/.]/g, '-');
}

/**
 * Resolve the input schema path for a model.
 * Returns the path to the schema file, or null if the model is not found or doesn't have a type.
 */
export function resolveSchemaPath(
  catalogModelsDir: string,
  provider: string,
  model: string,
  modelDef: ModelDefinition
): string {
  // If model has a custom inputSchema path, use it
  if (modelDef.inputSchema) {
    return resolve(catalogModelsDir, provider, modelDef.inputSchema);
  }
  // Otherwise, use the convention: {provider}/{type}/{model-name-converted}.json
  const filename = `${modelNameToFilename(model)}.json`;
  return resolve(catalogModelsDir, provider, modelDef.type, filename);
}

/**
 * Load the input schema for a model from the catalog.
 * Returns the schema JSON string, or null if not found.
 */
export async function loadModelInputSchema(
  catalogModelsDir: string,
  catalog: LoadedModelCatalog,
  provider: string,
  model: string
): Promise<string | null> {
  const modelDef = lookupModel(catalog, provider, model);
  if (!modelDef) {
    return null;
  }

  // Skip LLM and internal types - they don't have input schemas in the catalog
  if (modelDef.type === 'llm' || modelDef.type === 'internal' || modelDef.type === 'text' || modelDef.type === 'json') {
    return null;
  }

  const schemaPath = resolveSchemaPath(catalogModelsDir, provider, model, modelDef);

  try {
    return await readFile(schemaPath, 'utf8');
  } catch {
    // Schema file doesn't exist - this is not an error for some model types
    return null;
  }
}

/**
 * Load and parse the full schema file for a model.
 * Returns the parsed SchemaFile with input schema, optional output schema, and definitions.
 *
 * This is the preferred method for loading schemas as it provides access to:
 * - Input schema for validation
 * - Output schema for simulation and response validation
 * - Type definitions for $ref resolution
 */
export async function loadModelSchemaFile(
  catalogModelsDir: string,
  catalog: LoadedModelCatalog,
  provider: string,
  model: string
): Promise<SchemaFile | null> {
  const modelDef = lookupModel(catalog, provider, model);
  if (!modelDef) {
    return null;
  }

  // Skip LLM and internal types - they don't have input schemas in the catalog
  if (modelDef.type === 'llm' || modelDef.type === 'internal' || modelDef.type === 'text' || modelDef.type === 'json') {
    return null;
  }

  const schemaPath = resolveSchemaPath(catalogModelsDir, provider, model, modelDef);

  try {
    const content = await readFile(schemaPath, 'utf8');
    return parseSchemaFile(content);
  } catch {
    // Schema file doesn't exist - this is not an error for some model types
    return null;
  }
}

// Re-export SchemaFile type for convenience
export type { SchemaFile };
