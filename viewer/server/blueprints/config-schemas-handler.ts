/**
 * Handler for producer config schemas.
 * Returns x-renku-viewer-driven config descriptors per producer/model.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createRuntimeError,
  RuntimeErrorCode,
  getProducerMappings,
  isRenkuError,
  loadBlueprintResolutionContext,
  resolveMappingsForModel,
  type BlueprintResolutionContext,
} from '@gorenku/core';
import {
  getAvailableModelsForNestedSlot,
  loadModelCatalog,
  loadModelSchemaFile,
  type LoadedModelCatalog,
  type NestedModelDeclaration,
} from '@gorenku/providers';
import { collectLeafProducerImports } from './producer-models.js';
import { buildProducerBindingSummary } from './mapping-binding-context.js';
import {
  buildFieldDescriptors,
  deriveFieldMappingMeta,
  flattenProperties,
  type ConfigFieldDescriptor,
  type ConfigProperty,
} from './models-pane-contract.js';
import type { ProducerCategory } from './types.js';

export type {
  ConfigFieldDescriptor,
  ConfigProperty,
  SchemaProperty,
} from './models-pane-contract.js';

export interface ModelConfigSchema {
  provider: string;
  model: string;
  fields: ConfigFieldDescriptor[];
  properties: ConfigProperty[];
}

export interface NestedModelConfigSchema {
  declaration: NestedModelDeclaration;
  availableModels: Array<{ provider: string; model: string }>;
  modelSchemas: Record<string, ModelConfigSchema>;
}

export interface ProducerConfigSchemas {
  producerId: string;
  category: ProducerCategory;
  modelSchemas: Record<string, ModelConfigSchema>;
  nestedModels?: NestedModelConfigSchema[];
  errorsByModel?: Record<string, ProducerContractError>;
}

export interface ProducerContractError {
  error: string;
  code: string;
}

export interface ProducerConfigSchemasResponse {
  producers: Record<string, ProducerConfigSchemas>;
  errorsByProducer?: Record<string, ProducerContractError>;
}

interface VoiceOption {
  value: string;
  label: string;
  tagline?: string;
  description?: string;
  preview_url?: string;
}

type VoiceOptionsLoader = (optionsFile: string) => Promise<VoiceOption[]>;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseVoiceOptionsFile(
  content: string,
  optionsFile: string
): VoiceOption[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Voice options file "${optionsFile}" is invalid JSON: ${message}`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `Voice options file "${optionsFile}" must contain a top-level array.`
    );
  }

  const options: VoiceOption[] = [];
  const seenValues = new Set<string>();

  for (const [index, entry] of parsed.entries()) {
    if (!isObjectRecord(entry)) {
      throw new Error(
        `Voice options file "${optionsFile}" has invalid entry at index ${index}. Expected object.`
      );
    }

    const voiceId = entry.voice_id;
    if (typeof voiceId !== 'string' || voiceId.trim().length === 0) {
      throw new Error(
        `Voice options file "${optionsFile}" has invalid voice_id at index ${index}. Expected non-empty string.`
      );
    }

    const name = entry.name;
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(
        `Voice options file "${optionsFile}" has invalid name at index ${index}. Expected non-empty string.`
      );
    }

    if (seenValues.has(voiceId)) {
      throw new Error(
        `Voice options file "${optionsFile}" contains duplicate voice_id "${voiceId}".`
      );
    }
    seenValues.add(voiceId);

    const option: VoiceOption = {
      value: voiceId,
      label: name,
    };

    if ('tagline' in entry && entry.tagline !== undefined) {
      if (typeof entry.tagline !== 'string') {
        throw new Error(
          `Voice options file "${optionsFile}" has invalid tagline at index ${index}. Expected string.`
        );
      }
      option.tagline = entry.tagline;
    }

    if ('description' in entry && entry.description !== undefined) {
      if (typeof entry.description !== 'string') {
        throw new Error(
          `Voice options file "${optionsFile}" has invalid description at index ${index}. Expected string.`
        );
      }
      option.description = entry.description;
    }

    if ('preview_url' in entry && entry.preview_url !== undefined) {
      if (typeof entry.preview_url !== 'string') {
        throw new Error(
          `Voice options file "${optionsFile}" has invalid preview_url at index ${index}. Expected string.`
        );
      }
      option.preview_url = entry.preview_url;
    }

    options.push(option);
  }

  return options;
}

function createVoiceOptionsLoader(catalogRoot: string): VoiceOptionsLoader {
  const resolvedCatalogRoot = path.resolve(catalogRoot);
  const cache = new Map<string, Promise<VoiceOption[]>>();

  return async (optionsFile: string) => {
    if (cache.has(optionsFile)) {
      return cache.get(optionsFile)!;
    }

    const loader = (async () => {
      const resolvedFile = path.resolve(resolvedCatalogRoot, optionsFile);
      const expectedPrefix = `${resolvedCatalogRoot}${path.sep}`;
      if (
        resolvedFile !== resolvedCatalogRoot &&
        !resolvedFile.startsWith(expectedPrefix)
      ) {
        throw new Error(
          `Voice options file "${optionsFile}" resolves outside catalog root.`
        );
      }

      let content: string;
      try {
        content = await readFile(resolvedFile, 'utf8');
      } catch (error) {
        throw new Error(
          `Failed to read voice options file "${optionsFile}" at ${resolvedFile}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      return parseVoiceOptionsFile(content, optionsFile);
    })();

    cache.set(optionsFile, loader);
    return loader;
  };
}

async function hydrateVoicePickerConfigs(args: {
  fields: ConfigFieldDescriptor[];
  voiceOptionsLoader?: VoiceOptionsLoader;
  producerId: string;
  provider: string;
  model: string;
}) {
  if (!args.voiceOptionsLoader) {
    return;
  }

  for (const field of args.fields) {
    await hydrateVoicePickerConfigForField({
      field,
      voiceOptionsLoader: args.voiceOptionsLoader,
      producerId: args.producerId,
      provider: args.provider,
      model: args.model,
    });
  }
}

async function hydrateVoicePickerConfigForField(args: {
  field: ConfigFieldDescriptor;
  voiceOptionsLoader: VoiceOptionsLoader;
  producerId: string;
  provider: string;
  model: string;
}) {
  const { field } = args;

  if (field.custom === 'voice-id-selector') {
    if (!isObjectRecord(field.customConfig)) {
      throw createRuntimeError(
        RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
        `Voice-id field "${field.keyPath}" for ${args.producerId} (${args.provider}/${args.model}) must declare object custom_config.`
      );
    }

    const optionsFile = field.customConfig.options_file;
    if (optionsFile !== undefined) {
      if (typeof optionsFile !== 'string' || optionsFile.trim().length === 0) {
        throw createRuntimeError(
          RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
          `Voice-id field "${field.keyPath}" for ${args.producerId} (${args.provider}/${args.model}) has invalid custom_config.options_file.`
        );
      }

      const optionsRich = await args.voiceOptionsLoader(optionsFile);
      field.customConfig = {
        ...field.customConfig,
        options_rich: optionsRich,
      };
    }
  }

  if (field.fields && field.fields.length > 0) {
    for (const child of field.fields) {
      await hydrateVoicePickerConfigForField({
        field: child,
        voiceOptionsLoader: args.voiceOptionsLoader,
        producerId: args.producerId,
        provider: args.provider,
        model: args.model,
      });
    }
  }

  if (field.item) {
    await hydrateVoicePickerConfigForField({
      field: field.item,
      voiceOptionsLoader: args.voiceOptionsLoader,
      producerId: args.producerId,
      provider: args.provider,
      model: args.model,
    });
  }

  if (field.value) {
    await hydrateVoicePickerConfigForField({
      field: field.value,
      voiceOptionsLoader: args.voiceOptionsLoader,
      producerId: args.producerId,
      provider: args.provider,
      model: args.model,
    });
  }

  if (field.variants && field.variants.length > 0) {
    for (const variant of field.variants) {
      await hydrateVoicePickerConfigForField({
        field: variant,
        voiceOptionsLoader: args.voiceOptionsLoader,
        producerId: args.producerId,
        provider: args.provider,
        model: args.model,
      });
    }
  }
}

async function processNestedModels(args: {
  producerId: string;
  nestedModelDeclarations: NestedModelDeclaration[];
  catalog: LoadedModelCatalog;
  catalogModelsDir: string;
  voiceOptionsLoader?: VoiceOptionsLoader;
}): Promise<NestedModelConfigSchema[]> {
  const result: NestedModelConfigSchema[] = [];

  for (const declaration of args.nestedModelDeclarations) {
    const availableModels = getAvailableModelsForNestedSlot(
      args.catalog,
      declaration
    );

    const modelSchemas: Record<string, ModelConfigSchema> = {};
    const forceArtifactFields = new Set(declaration.mappedFields ?? []);

    for (const { provider, model } of availableModels) {
      const schemaFile = await loadModelSchemaFile(
        args.catalogModelsDir,
        args.catalog,
        provider,
        model
      );
      if (!schemaFile) {
        continue;
      }

      const fields = buildFieldDescriptors({
        schemaFile,
        fieldMapping: new Map(),
        forceArtifactFields,
        producerId: args.producerId,
        provider,
        model,
      });

      await hydrateVoicePickerConfigs({
        fields,
        voiceOptionsLoader: args.voiceOptionsLoader,
        producerId: args.producerId,
        provider,
        model,
      });

      const key = `${provider}/${model}`;
      modelSchemas[key] = {
        provider,
        model,
        fields,
        properties: flattenProperties(fields),
      };
    }

    result.push({
      declaration,
      availableModels,
      modelSchemas,
    });
  }

  return result;
}

async function buildProducerModelSchemas(args: {
  context: BlueprintResolutionContext;
  producerId: string;
  category: ProducerCategory;
  catalog: LoadedModelCatalog;
  catalogModelsDir: string;
  voiceOptionsLoader?: VoiceOptionsLoader;
}): Promise<ProducerConfigSchemas> {
  const mappings = getProducerMappings(args.context.root, args.producerId);
  if (!mappings) {
    return {
      producerId: args.producerId,
      category: args.category,
      modelSchemas: {},
    };
  }

  const bindingSummary = buildProducerBindingSummary({
    context: args.context,
    producerId: args.producerId,
    mode: 'static',
  });

  const modelSchemas: Record<string, ModelConfigSchema> = {};
  const errorsByModel: Record<string, ProducerContractError> = {};
  let nestedModels: NestedModelConfigSchema[] | undefined;

  for (const [provider, modelMappings] of Object.entries(mappings)) {
    for (const model of Object.keys(modelMappings)) {
      const key = `${provider}/${model}`;
      try {
        const schemaFile = await loadModelSchemaFile(
          args.catalogModelsDir,
          args.catalog,
          provider,
          model
        );
        if (!schemaFile) {
          continue;
        }

        const modelMapping = resolveMappingsForModel(args.context.root, {
          producerId: args.producerId,
          provider,
          model,
        });
        if (!modelMapping) {
          throw createRuntimeError(
            RuntimeErrorCode.MODELS_PANE_DESCRIPTOR_MISSING_FOR_MODEL,
            `Missing mapping resolution for ${args.producerId} (${provider}/${model}) while building config schema descriptors.`
          );
        }

        const fieldMapping = deriveFieldMappingMeta({
          schemaFile,
          mapping: modelMapping,
          bindingSummary,
          producerId: args.producerId,
          provider,
          model,
        });

        const fields = buildFieldDescriptors({
          schemaFile,
          fieldMapping,
          producerId: args.producerId,
          provider,
          model,
        });

        await hydrateVoicePickerConfigs({
          fields,
          voiceOptionsLoader: args.voiceOptionsLoader,
          producerId: args.producerId,
          provider,
          model,
        });

        modelSchemas[key] = {
          provider,
          model,
          fields,
          properties: flattenProperties(fields),
        };

        if (schemaFile.nestedModels && schemaFile.nestedModels.length > 0) {
          nestedModels = await processNestedModels({
            producerId: args.producerId,
            nestedModelDeclarations: schemaFile.nestedModels,
            catalog: args.catalog,
            catalogModelsDir: args.catalogModelsDir,
            voiceOptionsLoader: args.voiceOptionsLoader,
          });
        }
      } catch (error) {
        const contractError = isRenkuError(error)
          ? error
          : createRuntimeError(
              RuntimeErrorCode.MODELS_PANE_DESCRIPTOR_MISSING_FOR_MODEL,
              error instanceof Error
                ? error.message
                : `Failed to build models-pane descriptor contract for ${args.producerId} (${provider}/${model}).`
            );
        errorsByModel[key] = {
          error: contractError.message,
          code: contractError.code,
        };
      }
    }
  }

  return {
    producerId: args.producerId,
    category: args.category,
    modelSchemas,
    nestedModels,
    ...(Object.keys(errorsByModel).length > 0 ? { errorsByModel } : {}),
  };
}

export async function getProducerConfigSchemas(
  blueprintPath: string,
  catalogRoot?: string
): Promise<ProducerConfigSchemasResponse> {
  const context = await loadBlueprintResolutionContext({
    blueprintPath,
    catalogRoot,
    schemaSource: { kind: 'producer-metadata' },
  });
  const { root } = context;
  const producers: Record<string, ProducerConfigSchemas> = {};
  const errorsByProducer: Record<string, ProducerContractError> = {};

  let catalog: LoadedModelCatalog | null = null;
  let catalogModelsDir: string | null = null;
  let voiceOptionsLoader: VoiceOptionsLoader | undefined;
  if (catalogRoot) {
    catalogModelsDir = path.join(catalogRoot, 'models');
    catalog = await loadModelCatalog(catalogModelsDir);
    voiceOptionsLoader = createVoiceOptionsLoader(catalogRoot);
  }

  for (const entry of collectLeafProducerImports(root)) {
    const producerId = entry.canonicalProducerId;
    const category = entry.category;

    if (category === 'prompt' || !catalog || !catalogModelsDir) {
      producers[producerId] = {
        producerId,
        category,
        modelSchemas: {},
      };
      continue;
    }

    try {
      producers[producerId] = await buildProducerModelSchemas({
        context,
        producerId,
        category,
        catalog,
        catalogModelsDir,
        voiceOptionsLoader,
      });
    } catch (error) {
      const contractError = isRenkuError(error)
        ? error
        : createRuntimeError(
            RuntimeErrorCode.MODELS_PANE_DESCRIPTOR_MISSING_FOR_MODEL,
            error instanceof Error
              ? error.message
              : `Failed to build models-pane descriptor contract for producer ${producerId}.`
          );

      errorsByProducer[producerId] = {
        error: contractError.message,
        code: contractError.code,
      };

      producers[producerId] = {
        producerId,
        category,
        modelSchemas: {},
      };
    }
  }

  return {
    producers,
    ...(Object.keys(errorsByProducer).length > 0 ? { errorsByProducer } : {}),
  };
}
