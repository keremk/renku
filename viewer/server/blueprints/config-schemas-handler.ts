/**
 * Handler for producer config schemas.
 * Returns x-renku-viewer-driven config descriptors per producer/model.
 */

import path from 'node:path';
import {
  createRuntimeError,
  RuntimeErrorCode,
  getProducerMappings,
  isRenkuError,
  loadYamlBlueprintTree,
  resolveMappingsForModel,
  type BlueprintTreeNode,
} from '@gorenku/core';
import {
  getAvailableModelsForNestedSlot,
  loadModelCatalog,
  loadModelSchemaFile,
  type LoadedModelCatalog,
  type NestedModelDeclaration,
} from '@gorenku/providers';
import { detectProducerCategory } from './producer-models.js';
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
}

export interface ProducerContractError {
  error: string;
  code: string;
}

export interface ProducerConfigSchemasResponse {
  producers: Record<string, ProducerConfigSchemas>;
  errorsByProducer?: Record<string, ProducerContractError>;
}

async function processNestedModels(args: {
  producerId: string;
  nestedModelDeclarations: NestedModelDeclaration[];
  catalog: LoadedModelCatalog;
  catalogModelsDir: string;
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
  root: BlueprintTreeNode;
  producerId: string;
  category: ProducerCategory;
  catalog: LoadedModelCatalog;
  catalogModelsDir: string;
}): Promise<ProducerConfigSchemas> {
  const mappings = getProducerMappings(args.root, args.producerId);
  if (!mappings) {
    return {
      producerId: args.producerId,
      category: args.category,
      modelSchemas: {},
    };
  }

  const bindingSummary = buildProducerBindingSummary({
    root: args.root,
    producerId: args.producerId,
  });

  const modelSchemas: Record<string, ModelConfigSchema> = {};
  let nestedModels: NestedModelConfigSchema[] | undefined;

  for (const [provider, modelMappings] of Object.entries(mappings)) {
    for (const model of Object.keys(modelMappings)) {
      const schemaFile = await loadModelSchemaFile(
        args.catalogModelsDir,
        args.catalog,
        provider,
        model
      );
      if (!schemaFile) {
        continue;
      }

      const modelMapping = resolveMappingsForModel(args.root, {
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

      const key = `${provider}/${model}`;
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
        });
      }
    }
  }

  return {
    producerId: args.producerId,
    category: args.category,
    modelSchemas,
    nestedModels,
  };
}

export async function getProducerConfigSchemas(
  blueprintPath: string,
  catalogRoot?: string
): Promise<ProducerConfigSchemasResponse> {
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
  const producers: Record<string, ProducerConfigSchemas> = {};
  const errorsByProducer: Record<string, ProducerContractError> = {};

  let catalog: LoadedModelCatalog | null = null;
  let catalogModelsDir: string | null = null;
  if (catalogRoot) {
    catalogModelsDir = path.join(catalogRoot, 'models');
    catalog = await loadModelCatalog(catalogModelsDir);
  }

  const visitNode = async (node: BlueprintTreeNode) => {
    for (const producerImport of node.document.producerImports) {
      const producerId = producerImport.name;
      const childNode = producerImport.path
        ? node.children.get(producerId)
        : undefined;
      const category = detectProducerCategory(producerImport, childNode);

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
          root,
          producerId,
          category,
          catalog,
          catalogModelsDir,
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

    for (const child of node.children.values()) {
      await visitNode(child);
    }
  };

  await visitNode(root);

  return {
    producers,
    ...(Object.keys(errorsByProducer).length > 0 ? { errorsByProducer } : {}),
  };
}
