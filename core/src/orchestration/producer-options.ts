import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import { flattenConfigKeys, flattenConfigValues, deepMergeConfig } from './config-utils.js';
import { loadPromptFile, type PromptFileData } from './prompt-file.js';
import type {
  BlueprintMeta,
  BlueprintTreeNode,
  MappingFieldDefinition,
  ProducerCatalog,
  ProducerCatalogEntry,
  ProducerConfig,
  ProducerModelVariant,
  BlueprintProducerOutputDefinition,
  ProviderAttachment,
  ProviderEnvironment,
} from '../types.js';
import { formatProducerAlias } from '../parsing/canonical-ids.js';
import { resolveMappingsForModel } from '../resolution/mapping-resolver.js';
import type { ModelSelection } from '../parsing/input-loader.js';

interface PromptConfig {
  config: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

/**
 * Convert PromptFileData to a flat config dict + outputs.
 * Top-level fields (systemPrompt, userPrompt, etc.) become config keys;
 * nested `config` section is merged in (flat).
 */
function promptFileToConfig(data: PromptFileData): PromptConfig {
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'outputs' || key === 'config' || value === undefined) {
      continue;
    }
    config[key] = value;
  }
  if (data.config && typeof data.config === 'object') {
    Object.assign(config, data.config);
  }
  return { config, outputs: data.outputs };
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
  sdkMapping?: Record<string, MappingFieldDefinition>;
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
  /** Pre-resolved prompt file paths: producerAlias → absolute TOML path */
  resolvedPromptPaths?: Map<string, string>;
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
  await collectProducers(blueprint, blueprint, map, selectionMap, allowAmbiguousDefault, context?.resolvedPromptPaths);
  return map;
}

async function collectProducers(
  node: BlueprintTreeNode,
  rootBlueprint: BlueprintTreeNode,
  map: ProducerOptionsMap,
  selectionMap: Map<string, ModelSelection>,
  allowAmbiguousDefault: boolean,
  resolvedPromptPaths?: Map<string, string>,
): Promise<void> {
  for (const producer of node.document.producers) {
    const namespacedName = formatProducerAlias(node.namespacePath, producer.name);
    const selection = selectionMap.get(namespacedName);
    const variants = collectVariants(producer);
    // Pass the producer's meta and source path for loading promptFile/outputSchema
    const chosen = await chooseVariant(
      namespacedName,
      variants,
      selection,
      allowAmbiguousDefault,
      node.document.meta,
      node.sourcePath,
      rootBlueprint,
      resolvedPromptPaths,
    );
    const option = toLoadedOption(namespacedName, chosen, selection);
    registerProducerOption(map, namespacedName, option);
  }
  for (const child of node.children.values()) {
    await collectProducers(child, rootBlueprint, map, selectionMap, allowAmbiguousDefault, resolvedPromptPaths);
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
    sdkMapping?: Record<string, MappingFieldDefinition>;
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
    sdkMapping: variant.sdkMapping,
    outputs: variant.outputs as Record<string, BlueprintProducerOutputDefinition> | undefined,
    inputSchema: variant.inputSchema,
    outputSchema: variant.outputSchema,
    selectionInputKeys: ['provider', 'model'],
    configInputPaths,
    configDefaults: variant.configDefaults,
  };
}

/** Keys on ProducerModelVariant that are structural (not config values). */
const VARIANT_STRUCTURAL_KEYS = new Set([
  'provider', 'model', 'promptFile', 'inputSchema', 'outputSchema',
  'outputSchemaParsed', 'inputs', 'outputs', 'config',
]);

/**
 * Build a flat config dict from a variant. Merges variant.config with any
 * top-level non-structural fields (e.g., systemPrompt, userPrompt, variables).
 * This is provider-agnostic — it doesn't hardcode knowledge of specific fields.
 */
function buildVariantConfig(variant: ProducerModelVariant): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(variant.config ?? {}) };
  for (const [key, value] of Object.entries(variant)) {
    if (VARIANT_STRUCTURAL_KEYS.has(key) || value === undefined) {
      continue;
    }
    base[key] = value;
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
  sdkMapping?: Record<string, MappingFieldDefinition>;
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
      sdkMapping: variant.inputs as Record<string, MappingFieldDefinition> | undefined,
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
        sdkMapping: producer.sdkMapping as Record<string, MappingFieldDefinition> | undefined,
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
 * Loads promptFile and outputSchema from the producer's meta section (not from ModelSelection).
 */
async function selectionToVariant(
  selection: ModelSelection,
  producerMeta: BlueprintMeta,
  producerSourcePath: string,
  resolvedPath?: string,
): Promise<CollectedVariant> {
  const producerDir = dirname(producerSourcePath);

  let promptConfig: PromptConfig = { config: {} };
  // Use pre-resolved path if available (builds folder > blueprint template)
  const promptPath = resolvedPath
    ?? (producerMeta.promptFile ? resolve(producerDir, producerMeta.promptFile) : undefined);
  if (promptPath) {
    const promptData = await loadPromptFile(promptPath);
    promptConfig = promptFileToConfig(promptData);
  }

  let outputSchemaContent: string | undefined;
  if (producerMeta.outputSchema) {
    outputSchemaContent = await loadJsonSchema(resolve(producerDir, producerMeta.outputSchema));
  }

  // Deep merge: prompt file defaults, then selection overrides
  const config = deepMergeConfig(promptConfig.config, selection.config ?? {});

  return {
    provider: selection.provider,
    model: selection.model,
    config: Object.keys(config).length > 0 ? config : undefined,
    sdkMapping: undefined,
    outputs: selection.outputs ?? (promptConfig.outputs as Record<string, BlueprintProducerOutputDefinition> | undefined),
    inputSchema: undefined,
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
  producerMeta: BlueprintMeta,
  producerSourcePath: string,
  rootBlueprint: BlueprintTreeNode,
  resolvedPromptPaths?: Map<string, string>,
): Promise<CollectedVariant> {
  // If producer has no variants (interface-only), must have selection
  if (variants.length === 0) {
    if (!selection) {
      throw createRuntimeError(
        RuntimeErrorCode.NO_PRODUCER_OPTIONS,
        `Producer "${producerName}" has no model configuration. ` +
        `Provide model selection in input template.`,
      );
    }
    // Convert selection directly to a variant, loading promptFile/outputSchema from producer meta
    // Also resolve SDK mapping from producer YAML
    const variant = await selectionToVariant(selection, producerMeta, producerSourcePath, resolvedPromptPaths?.get(producerName));
    const resolvedMapping = resolveSdkMappingFromProducer(
      rootBlueprint,
      producerName,
      selection.provider,
      selection.model,
    );
    return {
      ...variant,
      sdkMapping: resolvedMapping ?? variant.sdkMapping,
    };
  }

  // Producer has variants - try to match selection or use default
  if (selection) {
    const match = variants.find(
      (variant) =>
        variant.provider.toLowerCase() === selection.provider.toLowerCase() &&
        variant.model === selection.model,
    );
    if (match) {
      // Resolve SDK mapping from producer YAML mappings section
      const resolvedMapping = resolveSdkMappingFromProducer(
        rootBlueprint,
        producerName,
        selection.provider,
        selection.model,
      );
      return {
        ...match,
        sdkMapping: resolvedMapping ?? match.sdkMapping,
        outputs: selection.outputs ?? match.outputs,
        inputSchema: match.inputSchema,
        outputSchema: match.outputSchema,
      };
    }
    // Selection specifies a model not in producer's variants - use selection directly
    const variant = await selectionToVariant(selection, producerMeta, producerSourcePath, resolvedPromptPaths?.get(producerName));
    const resolvedMapping = resolveSdkMappingFromProducer(
      rootBlueprint,
      producerName,
      selection.provider,
      selection.model,
    );
    return {
      ...variant,
      sdkMapping: resolvedMapping ?? variant.sdkMapping,
    };
  }
  if (variants.length === 1) {
    const variant = variants[0]!;
    // Resolve SDK mapping from producer YAML for the single variant
    const resolvedMapping = resolveSdkMappingFromProducer(
      rootBlueprint,
      producerName,
      variant.provider,
      variant.model,
    );
    return {
      ...variant,
      sdkMapping: resolvedMapping ?? variant.sdkMapping,
    };
  }
  if (allowAmbiguousDefault) {
    const variant = variants[0]!;
    const resolvedMapping = resolveSdkMappingFromProducer(
      rootBlueprint,
      producerName,
      variant.provider,
      variant.model,
    );
    return {
      ...variant,
      sdkMapping: resolvedMapping ?? variant.sdkMapping,
    };
  }
  const available = variants.map((variant) => `${variant.provider}/${variant.model}`).join(', ');
  throw createRuntimeError(
    RuntimeErrorCode.AMBIGUOUS_MODEL_SELECTION,
    `Multiple model variants defined for ${producerName}. Select one in inputs.yaml. Available: ${available}`,
    { context: producerName },
  );
}

/**
 * Resolve SDK mapping from producer YAML's mappings section.
 * Returns undefined if no mapping is found (producer doesn't define mappings for this model).
 */
function resolveSdkMappingFromProducer(
  rootBlueprint: BlueprintTreeNode,
  producerId: string,
  provider: string,
  model: string,
): Record<string, MappingFieldDefinition> | undefined {
  const resolved = resolveMappingsForModel(rootBlueprint, {
    provider,
    model,
    producerId,
  });
  return resolved ?? undefined;
}

export function buildProducerCatalog(
  options: ProducerOptionsMap,
): ProducerCatalog {
  const catalog: Record<string, ProducerCatalogEntry> = {};
  for (const [producer, entries] of options) {
    if (!entries || entries.length === 0) {
      throw createRuntimeError(
        RuntimeErrorCode.NO_PRODUCER_OPTIONS,
        `No producer options defined for "${producer}".`,
        { context: producer },
      );
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

