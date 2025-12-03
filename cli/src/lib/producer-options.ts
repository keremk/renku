import type {
  BlueprintTreeNode,
  ProducerCatalog,
  ProducerCatalogEntry,
  ProducerConfig,
  ProducerModelVariant,
  BlueprintProducerOutputDefinition,
  BlueprintProducerSdkMappingField,
} from '@renku/core';
import type {
  ProviderAttachment,
  ProviderEnvironment,
} from '@renku/providers';

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

export interface ModelSelection {
  producerId: string;
  provider: string;
  model: string;
  config?: Record<string, unknown>;
}

export function buildProducerOptionsFromBlueprint(
  blueprint: BlueprintTreeNode,
  selections: ModelSelection[] = [],
  allowAmbiguousDefault = false,
): ProducerOptionsMap {
  const map: ProducerOptionsMap = new Map();
  const selectionMap = new Map<string, ModelSelection>();
  for (const selection of selections) {
    selectionMap.set(selection.producerId, selection);
  }
  collectProducers(blueprint, map, selectionMap, allowAmbiguousDefault);
  return map;
}

function collectProducers(
  node: BlueprintTreeNode,
  map: ProducerOptionsMap,
  selectionMap: Map<string, ModelSelection>,
  allowAmbiguousDefault: boolean,
): void {
  for (const producer of node.document.producers) {
    const namespacedName = formatProducerName(node.namespacePath, producer.name);
    const selection =
      selectionMap.get(namespacedName) ??
      selectionMap.get(producer.name);
    const variants = collectVariants(producer);
    const chosen = chooseVariant(namespacedName, variants, selection, allowAmbiguousDefault);
    const option = toLoadedOption(namespacedName, chosen, selection);
    registerProducerOption(map, namespacedName, option);
    if (namespacedName !== producer.name) {
      registerProducerOption(map, producer.name, option);
    }
  }
  for (const child of node.children.values()) {
    collectProducers(child, map, selectionMap, allowAmbiguousDefault);
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

function formatProducerName(namespacePath: string[], name: string): string {
  if (namespacePath.length === 0) {
    return name;
  }
  return `${namespacePath.join('.')}.${name}`;
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

function collectVariants(producer: ProducerConfig): Array<{
  provider: string;
  model: string;
  config?: Record<string, unknown>;
  sdkMapping?: Record<string, BlueprintProducerSdkMappingField>;
  outputs?: Record<string, BlueprintProducerOutputDefinition>;
  inputSchema?: string;
  outputSchema?: string;
  configInputPaths: string[];
  configDefaults: Record<string, unknown>;
}> {
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
  if (!producer.provider || !producer.model) {
    throw new Error(`Producer "${producer.name}" is missing provider/model configuration.`);
  }
  return [
    {
      provider: producer.provider,
      model: producer.model,
      config: producer.config ?? producer.settings,
      sdkMapping: producer.sdkMapping,
      outputs: producer.outputs,
      inputSchema: producer.jsonSchema,
      configInputPaths: flattenConfigKeys(producer.config ?? producer.settings ?? {}),
      configDefaults: flattenConfigValues(producer.config ?? producer.settings ?? {}),
    },
  ];
}

function chooseVariant(
  producerName: string,
  variants: ReturnType<typeof collectVariants>,
  selection: ModelSelection | undefined,
  allowAmbiguousDefault: boolean,
) {
  if (selection) {
    const match = variants.find(
      (variant) =>
        variant.provider.toLowerCase() === selection.provider.toLowerCase() &&
        variant.model === selection.model,
    );
    if (!match) {
      throw new Error(
        `No model variant matches selection for ${producerName}: ${selection.provider}/${selection.model}`,
      );
    }
    return match;
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
