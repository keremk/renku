import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type {
  BlueprintTreeNode,
  ProducerCatalog,
  ProducerCatalogEntry,
  ProducerConfig,
  ProducerModelVariant,
  BlueprintProducerOutputDefinition,
  BlueprintProducerSdkMappingField,
} from '@gorenku/core';
import { formatProducerAlias } from '@gorenku/core';
import type {
  ProviderAttachment,
  ProviderEnvironment,
} from '@gorenku/providers';

// Re-export ModelSelection from core for consumers
export type { ModelSelection } from '@gorenku/core';
import type { ModelSelection } from '@gorenku/core';

interface PromptConfig {
  model?: string;
  textFormat?: string;
  variables?: string[];
  systemPrompt?: string;
  userPrompt?: string;
  config?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

export interface LoadedProducerOption {
  priority: 'main';
  provider: string;
  model: string;
  environment: ProviderEnvironment;
  config?: Record<string, unknown>;
  attachments: ProviderAttachment[];
  sourcePath?: string;
  customAttributes?: Record<string, unknown>;
  sdkMapping?: Record<string, BlueprintProducerSdkMappingField>;
  outputs?: Record<string, BlueprintProducerOutputDefinition>;
  inputSchema?: string;
  outputSchema?: string;
  selectionInputKeys: string[];
  configInputPaths: string[];
  configDefaults: Record<string, unknown>;
}

export type ProducerOptionsMap = Map<string, LoadedProducerOption[]>;

export interface BuildProducerOptionsContext {
  /** Base directory for resolving relative paths (typically the input file directory) */
  baseDir: string;
}

export async function buildProducerOptionsFromBlueprint(
  blueprint: BlueprintTreeNode,
  selections: ModelSelection[] = [],
  allowAmbiguousDefault = false,
  context?: BuildProducerOptionsContext,
): Promise<ProducerOptionsMap> {
  const map: ProducerOptionsMap = new Map();
  const selectionMap = new Map<string, ModelSelection>();
  for (const selection of selections) {
    selectionMap.set(selection.producerId, selection);
  }
  await collectProducers(blueprint, map, selectionMap, allowAmbiguousDefault, context?.baseDir);
  return map;
}

async function collectProducers(
  node: BlueprintTreeNode,
  map: ProducerOptionsMap,
  selectionMap: Map<string, ModelSelection>,
  allowAmbiguousDefault: boolean,
  baseDir?: string,
): Promise<void> {
  for (const producer of node.document.producers) {
    const namespacedName = formatProducerAlias(node.namespacePath, producer.name);
    const selection = selectionMap.get(namespacedName);
    const variants = collectVariants(producer);
    const chosen = await chooseVariant(namespacedName, variants, selection, allowAmbiguousDefault, baseDir);
    const option = toLoadedOption(namespacedName, chosen, selection);
    registerProducerOption(map, namespacedName, option);
  }
  for (const child of node.children.values()) {
    await collectProducers(child, map, selectionMap, allowAmbiguousDefault, baseDir);
  }
}

function registerProducerOption(
  map: ProducerOptionsMap,
  key: string,
  option: LoadedProducerOption,
): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(option);
  } else {
    map.set(key, [option]);
  }
}

function toLoadedOption(
  namespacedName: string,
  variant: {
    provider: string;
    model: string;
    config?: Record<string, unknown>;
    sdkMapping?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    inputSchema?: string;
    outputSchema?: string;
    configInputPaths: string[];
    configDefaults: Record<string, unknown>;
  },
  selection?: ModelSelection,
): LoadedProducerOption {
  const mergedConfig = deepMergeConfig(variant.config ?? {}, selection?.config ?? {});
  const configPayload = Object.keys(mergedConfig).length > 0 ? mergedConfig : undefined;
  const selectionConfigPaths = selection?.config ? flattenConfigKeys(selection.config) : [];
  const configInputPaths = Array.from(new Set([...(variant.configInputPaths ?? []), ...selectionConfigPaths]));

  return {
    priority: 'main',
    provider: variant.provider,
    model: variant.model,
    environment: 'local',
    config: configPayload,
    attachments: [],
    sourcePath: namespacedName,
    customAttributes: undefined,
    sdkMapping: variant.sdkMapping as Record<string, BlueprintProducerSdkMappingField> | undefined,
    outputs: variant.outputs as Record<string, BlueprintProducerOutputDefinition> | undefined,
    inputSchema: variant.inputSchema,
    outputSchema: variant.outputSchema,
    selectionInputKeys: ['provider', 'model'],
    configInputPaths,
    configDefaults: variant.configDefaults,
  };
}

function buildVariantConfig(variant: ProducerModelVariant): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(variant.config ?? {}) };
  const textFormat =
    (variant.textFormat as string | undefined) ??
    (variant.config?.text_format as string | undefined) ??
    (variant.config?.textFormat as string | undefined);
  const outputSchemaText = variant.outputSchema;
  if (variant.systemPrompt) {
    base.systemPrompt = variant.systemPrompt;
  }
  if (variant.userPrompt) {
    base.userPrompt = variant.userPrompt;
  }
  if (variant.variables) {
    base.variables = variant.variables;
  }
  if (textFormat) {
    const type = textFormat === 'json_schema' ? 'json_schema' : 'text';
    if (type === 'json_schema') {
      if (!outputSchemaText) {
        throw new Error(`Model "${variant.model}" declared text_format=json_schema but is missing outputSchema.`);
      }
      const responseFormat: Record<string, unknown> = { type };
      if (variant.outputSchema) {
        try {
          responseFormat.schema = JSON.parse(variant.outputSchema);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Model "${variant.model}" has invalid outputSchema JSON: ${message}`);
        }
      }
      base.responseFormat = responseFormat;
    }
  }
  return base;
}

/**
 * A model variant collected from a producer configuration.
 */
export interface CollectedVariant {
  provider: string;
  model: string;
  config?: Record<string, unknown>;
  sdkMapping?: Record<string, BlueprintProducerSdkMappingField>;
  outputs?: Record<string, BlueprintProducerOutputDefinition>;
  inputSchema?: string;
  outputSchema?: string;
  configInputPaths: string[];
  configDefaults: Record<string, unknown>;
}

/**
 * Collect all model variants from a producer configuration.
 * Returns all available variants without selecting one.
 * For interface-only producers (no models section), returns an empty array.
 */
export function collectVariants(producer: ProducerConfig): CollectedVariant[] {
  if (Array.isArray(producer.models) && producer.models.length > 0) {
    return producer.models.map((variant) => ({
      provider: variant.provider,
      model: variant.model,
      config: buildVariantConfig(variant),
      sdkMapping: variant.inputs as Record<string, BlueprintProducerSdkMappingField> | undefined,
      outputs: variant.outputs as Record<string, BlueprintProducerOutputDefinition> | undefined,
      inputSchema: variant.inputSchema,
      outputSchema: variant.outputSchema,
      configInputPaths: flattenConfigKeys(buildVariantConfig(variant)),
      configDefaults: flattenConfigValues(buildVariantConfig(variant)),
    }));
  }
  // If producer has inline provider/model (legacy support)
  if (producer.provider && producer.model) {
    const producerConfig = producer.config as Record<string, unknown> | undefined;
    return [
      {
        provider: producer.provider,
        model: producer.model,
        config: producerConfig,
        sdkMapping: producer.sdkMapping,
        outputs: producer.outputs,
        inputSchema: producer.jsonSchema,
        configInputPaths: flattenConfigKeys(producerConfig ?? {}),
        configDefaults: flattenConfigValues(producerConfig ?? {}),
      },
    ];
  }
  // Interface-only producer - no models defined, must come from selection
  return [];
}

/**
 * Load prompt configuration from a TOML file.
 */
async function loadPromptConfig(promptPath: string): Promise<PromptConfig> {
  const contents = await readFile(promptPath, 'utf8');
  const parsed = parseToml(contents) as Record<string, unknown>;
  const prompt: PromptConfig = {};
  if (typeof parsed.model === 'string') {
    prompt.model = parsed.model;
  }
  if (typeof parsed.textFormat === 'string') {
    prompt.textFormat = parsed.textFormat;
  }
  if (Array.isArray(parsed.variables)) {
    prompt.variables = parsed.variables.map(String);
  }
  if (typeof parsed.systemPrompt === 'string') {
    prompt.systemPrompt = parsed.systemPrompt;
  }
  if (typeof parsed.userPrompt === 'string') {
    prompt.userPrompt = parsed.userPrompt;
  }
  if (parsed.config && typeof parsed.config === 'object') {
    prompt.config = parsed.config as Record<string, unknown>;
  }
  if (parsed.outputs && typeof parsed.outputs === 'object') {
    prompt.outputs = parsed.outputs as Record<string, unknown>;
  }
  return prompt;
}

/**
 * Load JSON schema from a file path.
 */
async function loadJsonSchema(schemaPath: string): Promise<string> {
  const contents = await readFile(schemaPath, 'utf8');
  // Validate it's valid JSON and return as string
  JSON.parse(contents);
  return contents;
}

/**
 * Convert a ModelSelection into a CollectedVariant.
 * Used when the selection provides all the model configuration (interface-only producers).
 * Loads promptFile and outputSchema if provided as paths.
 */
async function selectionToVariant(selection: ModelSelection, baseDir?: string): Promise<CollectedVariant> {
  // Load prompt config from file if specified
  let promptConfig: PromptConfig = {};
  if (selection.promptFile && baseDir) {
    const promptPath = resolve(baseDir, selection.promptFile);
    promptConfig = await loadPromptConfig(promptPath);
  }

  // Load output schema from file if specified
  let outputSchemaContent: string | undefined;
  if (selection.outputSchema && baseDir) {
    const schemaPath = resolve(baseDir, selection.outputSchema);
    outputSchemaContent = await loadJsonSchema(schemaPath);
  }

  // Load input schema from file if specified
  let inputSchemaContent: string | undefined;
  if (selection.inputSchema && baseDir) {
    const schemaPath = resolve(baseDir, selection.inputSchema);
    inputSchemaContent = await loadJsonSchema(schemaPath);
  }

  // Build config from selection's LLM config fields (prefer selection over prompt file)
  const config: Record<string, unknown> = { ...(promptConfig.config ?? {}), ...(selection.config ?? {}) };

  // Use inline values if provided, otherwise use prompt file values
  const systemPrompt = selection.systemPrompt ?? promptConfig.systemPrompt;
  const userPrompt = selection.userPrompt ?? promptConfig.userPrompt;
  const variables = selection.variables ?? promptConfig.variables;
  const textFormat = selection.textFormat ?? (selection.config?.text_format as string | undefined) ?? promptConfig.textFormat;

  if (systemPrompt) {
    config.systemPrompt = systemPrompt;
  }
  if (userPrompt) {
    config.userPrompt = userPrompt;
  }
  if (variables) {
    config.variables = variables;
  }

  // Handle responseFormat for json_schema text format
  if (textFormat) {
    const type = textFormat === 'json_schema' ? 'json_schema' : 'text';
    if (type === 'json_schema' && outputSchemaContent) {
      try {
        config.responseFormat = { type, schema: JSON.parse(outputSchemaContent) };
      } catch {
        throw new Error(`Failed to parse output schema for model ${selection.model}`);
      }
    }
  }

  return {
    provider: selection.provider,
    model: selection.model,
    config: Object.keys(config).length > 0 ? config : undefined,
    sdkMapping: selection.inputs,
    outputs: selection.outputs ?? (promptConfig.outputs as Record<string, BlueprintProducerOutputDefinition> | undefined),
    inputSchema: inputSchemaContent,
    outputSchema: outputSchemaContent,
    configInputPaths: flattenConfigKeys(config),
    configDefaults: flattenConfigValues(config),
  };
}

async function chooseVariant(
  producerName: string,
  variants: CollectedVariant[],
  selection: ModelSelection | undefined,
  allowAmbiguousDefault: boolean,
  baseDir?: string,
): Promise<CollectedVariant> {
  // If producer has no variants (interface-only), must have selection
  if (variants.length === 0) {
    if (!selection) {
      throw new Error(
        `Producer "${producerName}" has no model configuration. ` +
        `Provide model selection in input template.`,
      );
    }
    // Convert selection directly to a variant
    return selectionToVariant(selection, baseDir);
  }

  // Producer has variants - try to match selection or use default
  if (selection) {
    const match = variants.find(
      (variant) =>
        variant.provider.toLowerCase() === selection.provider.toLowerCase() &&
        variant.model === selection.model,
    );
    if (match) {
      // Merge selection's SDK mapping with variant's (selection takes precedence)
      return {
        ...match,
        sdkMapping: selection.inputs ?? match.sdkMapping,
        outputs: selection.outputs ?? match.outputs,
        inputSchema: selection.inputSchema ?? match.inputSchema,
        outputSchema: selection.outputSchema ?? match.outputSchema,
      };
    }
    // Selection specifies a model not in producer's variants - use selection directly
    return selectionToVariant(selection, baseDir);
  }
  if (variants.length === 1) {
    return variants[0]!;
  }
  if (allowAmbiguousDefault) {
    return variants[0]!;
  }
  const available = variants.map((variant) => `${variant.provider}/${variant.model}`).join(', ');
  throw new Error(
    `Multiple model variants defined for ${producerName}. Select one in inputs.yaml. Available: ${available}`,
  );
}

export function buildProducerCatalog(
  options: ProducerOptionsMap,
): ProducerCatalog {
  const catalog: Record<string, ProducerCatalogEntry> = {};
  for (const [producer, entries] of options) {
    if (!entries || entries.length === 0) {
      throw new Error(`No producer options defined for "${producer}".`);
    }
    const primary = entries[0]!;
    catalog[producer] = toCatalogEntry(primary);
  }
  return catalog as ProducerCatalog;
}

function toCatalogEntry(option: LoadedProducerOption): ProducerCatalogEntry {
  return {
    provider: option.provider as ProducerCatalogEntry['provider'],
    providerModel: option.model,
    rateKey: `${option.provider}:${option.model}`,
  };
}

function deepMergeConfig(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMergeConfig(existing as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function flattenConfigKeys(source: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (key === 'responseFormat') {
      keys.push(nextKey);
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenConfigKeys(value as Record<string, unknown>, nextKey));
    } else {
      keys.push(nextKey);
    }
  }
  return keys;
}

function flattenConfigValues(source: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (key === 'responseFormat') {
      result[nextKey] = value;
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenConfigValues(value as Record<string, unknown>, nextKey));
    } else {
      result[nextKey] = value;
    }
  }
  return result;
}
