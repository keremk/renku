import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
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
}

export async function buildProducerOptionsFromBlueprint(
  blueprint: BlueprintTreeNode,
  selections: ModelSelection[] = [],
  allowAmbiguousDefault = false,
  _context?: BuildProducerOptionsContext,
): Promise<ProducerOptionsMap> {
  const map: ProducerOptionsMap = new Map();
  const selectionMap = new Map<string, ModelSelection>();
  for (const selection of selections) {
    selectionMap.set(selection.producerId, selection);
  }
  // Note: baseDir from context is no longer used - promptFile/outputSchema now come from producer meta
  await collectProducers(blueprint, blueprint, map, selectionMap, allowAmbiguousDefault);
  return map;
}

async function collectProducers(
  node: BlueprintTreeNode,
  rootBlueprint: BlueprintTreeNode,
  map: ProducerOptionsMap,
  selectionMap: Map<string, ModelSelection>,
  allowAmbiguousDefault: boolean,
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
    );
    const option = toLoadedOption(namespacedName, chosen, selection);
    registerProducerOption(map, namespacedName, option);
  }
  for (const child of node.children.values()) {
    await collectProducers(child, rootBlueprint, map, selectionMap, allowAmbiguousDefault);
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

function buildVariantConfig(variant: ProducerModelVariant): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(variant.config ?? {}) };
  if (variant.systemPrompt) {
    base.systemPrompt = variant.systemPrompt;
  }
  if (variant.userPrompt) {
    base.userPrompt = variant.userPrompt;
  }
  if (variant.variables) {
    base.variables = variant.variables;
  }
  // Note: responseFormat is no longer built here.
  // The provider will auto-derive it from outputSchema in the request context.
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
 * Loads promptFile and outputSchema from the producer's meta section (not from ModelSelection).
 */
async function selectionToVariant(
  selection: ModelSelection,
  producerMeta: BlueprintMeta,
  producerSourcePath: string,
): Promise<CollectedVariant> {
  const producerDir = dirname(producerSourcePath);

  // Load prompt config from producer meta's promptFile (relative to producer YAML)
  let promptConfig: PromptConfig = {};
  if (producerMeta.promptFile) {
    const promptPath = resolve(producerDir, producerMeta.promptFile);
    promptConfig = await loadPromptConfig(promptPath);
  }

  // Load output schema from producer meta's outputSchema (relative to producer YAML)
  let outputSchemaContent: string | undefined;
  if (producerMeta.outputSchema) {
    const schemaPath = resolve(producerDir, producerMeta.outputSchema);
    outputSchemaContent = await loadJsonSchema(schemaPath);
  }

  // Build config from prompt file and selection's config (selection takes precedence)
  const config: Record<string, unknown> = { ...(promptConfig.config ?? {}), ...(selection.config ?? {}) };

  // Use inline values from selection if provided, otherwise use prompt file values
  const systemPrompt = selection.systemPrompt ?? promptConfig.systemPrompt;
  const userPrompt = selection.userPrompt ?? promptConfig.userPrompt;
  const variables = selection.variables ?? promptConfig.variables;

  if (systemPrompt) {
    config.systemPrompt = systemPrompt;
  }
  if (userPrompt) {
    config.userPrompt = userPrompt;
  }
  if (variables) {
    config.variables = variables;
  }
  // Note: responseFormat is no longer built here.
  // The provider will auto-derive it from outputSchema in the request context.

  return {
    provider: selection.provider,
    model: selection.model,
    config: Object.keys(config).length > 0 ? config : undefined,
    sdkMapping: undefined, // SDK mappings now come from producer YAML, resolved in chooseVariant
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
    const variant = await selectionToVariant(selection, producerMeta, producerSourcePath);
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
    const variant = await selectionToVariant(selection, producerMeta, producerSourcePath);
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
