import path from 'node:path';
import {
  createRuntimeError,
  RuntimeErrorCode,
  isRenkuError,
  loadYamlBlueprintTree,
  resolveMappingsForModel,
} from '@gorenku/core';
import {
  evaluateResolutionMappingPreview,
  loadModelCatalog,
  loadModelSchemaFile,
  type LoadedModelCatalog,
} from '@gorenku/providers';
import { buildProducerBindingSummary } from './mapping-binding-context.js';
import {
  assertPreviewSubsetOfDescriptors,
  buildFieldDescriptors,
  deriveFieldMappingMeta,
} from './models-pane-contract.js';

export interface ProducerSdkPreviewRequest {
  blueprintPath: string;
  catalogRoot?: string;
  inputs: Record<string, unknown>;
  models: ProducerSdkPreviewSelection[];
}

export interface ProducerSdkPreviewSelection {
  producerId: string;
  provider: string;
  model: string;
}

export interface ProducerSdkPreviewField {
  field: string;
  value: unknown;
  status: 'ok' | 'warning' | 'error';
  warnings: string[];
  errors: string[];
  connected: boolean;
  sourceAliases: string[];
  schemaType?: string;
  enumOptions?: unknown[];
}

export interface ProducerSdkPreviewResult {
  producerId: string;
  fields: ProducerSdkPreviewField[];
}

export interface ProducerContractError {
  error: string;
  code: string;
}

export interface ProducerSdkPreviewResponse {
  producers: Record<string, ProducerSdkPreviewResult>;
  errorsByProducer?: Record<string, ProducerContractError>;
}

export async function getProducerSdkPreview(
  request: ProducerSdkPreviewRequest
): Promise<ProducerSdkPreviewResponse> {
  const { root } = await loadYamlBlueprintTree(request.blueprintPath, {
    catalogRoot: request.catalogRoot,
  });

  let catalog: LoadedModelCatalog | null = null;
  let catalogModelsDir: string | null = null;
  if (request.catalogRoot) {
    catalogModelsDir = path.join(request.catalogRoot, 'models');
    catalog = await loadModelCatalog(catalogModelsDir);
  }

  const producers: Record<string, ProducerSdkPreviewResult> = {};
  const errorsByProducer: Record<string, ProducerContractError> = {};

  for (const selection of request.models) {
    try {
      const mapping = resolveMappingsForModel(root, {
        producerId: selection.producerId,
        provider: selection.provider,
        model: selection.model,
      });
      if (!mapping) {
        producers[selection.producerId] = {
          producerId: selection.producerId,
          fields: [],
        };
        continue;
      }

      const bindingContext = buildProducerBindingSummary({
        root,
        producerId: selection.producerId,
        inputs: request.inputs,
      });

      const schemaFile = await loadSelectionSchemaFile({
        selection,
        catalog,
        catalogModelsDir,
      });
      if (!schemaFile) {
        throw createRuntimeError(
          RuntimeErrorCode.MODELS_PANE_DESCRIPTOR_MISSING_FOR_MODEL,
          `Missing schema descriptor for selected model ${selection.producerId} (${selection.provider}/${selection.model}).`
        );
      }

      const fieldMapping = deriveFieldMappingMeta({
        schemaFile,
        mapping,
        bindingSummary: bindingContext,
        producerId: selection.producerId,
        provider: selection.provider,
        model: selection.model,
      });

      const descriptorFields = buildFieldDescriptors({
        schemaFile,
        fieldMapping,
        producerId: selection.producerId,
        provider: selection.provider,
        model: selection.model,
      });

      const fields = evaluateResolutionMappingPreview({
        mapping,
        context: {
          inputs: bindingContext.resolvedInputs,
          inputBindings: bindingContext.mappingInputBindings,
        },
        connectedAliases: bindingContext.connectedAliases,
        inputSchema: schemaFile.inputSchema as Record<string, unknown>,
      });

      const visibleFields = fields.filter((field) => {
        const source = fieldMapping.get(field.field)?.source;
        return source !== 'artifact';
      });

      assertPreviewSubsetOfDescriptors({
        producerId: selection.producerId,
        provider: selection.provider,
        model: selection.model,
        descriptorFields,
        previewFields: visibleFields,
      });

      producers[selection.producerId] = {
        producerId: selection.producerId,
        fields: visibleFields,
      };
    } catch (error) {
      const contractError = isRenkuError(error)
        ? error
        : createRuntimeError(
            RuntimeErrorCode.MODELS_PANE_DESCRIPTOR_MISSING_FOR_MODEL,
            error instanceof Error
              ? error.message
              : `Failed to compute models-pane runtime contract for producer ${selection.producerId}.`
          );

      errorsByProducer[selection.producerId] = {
        error: contractError.message,
        code: contractError.code,
      };

      producers[selection.producerId] = {
        producerId: selection.producerId,
        fields: [],
      };
    }
  }

  return {
    producers,
    ...(Object.keys(errorsByProducer).length > 0 ? { errorsByProducer } : {}),
  };
}

async function loadSelectionSchemaFile(args: {
  selection: ProducerSdkPreviewSelection;
  catalog: LoadedModelCatalog | null;
  catalogModelsDir: string | null;
}) {
  if (!args.catalog || !args.catalogModelsDir) {
    return null;
  }

  return loadModelSchemaFile(
    args.catalogModelsDir,
    args.catalog,
    args.selection.provider,
    args.selection.model
  );
}
