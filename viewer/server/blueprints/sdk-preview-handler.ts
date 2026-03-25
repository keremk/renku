import path from 'node:path';
import { loadYamlBlueprintTree, resolveMappingsForModel } from '@gorenku/core';
import {
  evaluateResolutionMappingPreview,
  loadModelCatalog,
  loadModelSchemaFile,
  lookupModel,
  type LoadedModelCatalog,
} from '@gorenku/providers';
import { convertTreeToGraph } from './graph-converter.js';

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

export interface ProducerSdkPreviewResponse {
  producers: Record<string, ProducerSdkPreviewResult>;
}

export async function getProducerSdkPreview(
  request: ProducerSdkPreviewRequest
): Promise<ProducerSdkPreviewResponse> {
  const { root } = await loadYamlBlueprintTree(request.blueprintPath, {
    catalogRoot: request.catalogRoot,
  });
  const graph = convertTreeToGraph(root);
  const producerNodes = new Map(
    graph.nodes
      .filter((node) => node.type === 'producer')
      .map((node) => [
        node.id.replace('Producer:', ''),
        {
          producerType: node.producerType,
          inputBindings: node.inputBindings ?? [],
        },
      ])
  );

  let catalog: LoadedModelCatalog | null = null;
  let catalogModelsDir: string | null = null;
  if (request.catalogRoot) {
    catalogModelsDir = path.join(request.catalogRoot, 'models');
    catalog = await loadModelCatalog(catalogModelsDir);
  }

  const producers: Record<string, ProducerSdkPreviewResult> = {};

  for (const selection of request.models) {
    const producerNode = producerNodes.get(selection.producerId);
    if (!producerNode) {
      continue;
    }

    if (
      !isImageOrVideoSelection(selection, producerNode.producerType, catalog)
    ) {
      continue;
    }

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

    const bindingContext = buildProducerBindingContext({
      producerId: selection.producerId,
      inputBindings: producerNode.inputBindings,
      inputs: request.inputs,
    });

    const inputSchema = await loadSelectionInputSchema({
      selection,
      catalog,
      catalogModelsDir,
    });

    const fields = evaluateResolutionMappingPreview({
      mapping,
      context: {
        inputs: bindingContext.resolvedInputs,
        inputBindings: bindingContext.mappingInputBindings,
      },
      connectedAliases: bindingContext.connectedAliases,
      inputSchema,
    });

    producers[selection.producerId] = {
      producerId: selection.producerId,
      fields,
    };
  }

  return { producers };
}

async function loadSelectionInputSchema(args: {
  selection: ProducerSdkPreviewSelection;
  catalog: LoadedModelCatalog | null;
  catalogModelsDir: string | null;
}): Promise<Record<string, unknown> | undefined> {
  if (!args.catalog || !args.catalogModelsDir) {
    return undefined;
  }

  const schemaFile = await loadModelSchemaFile(
    args.catalogModelsDir,
    args.catalog,
    args.selection.provider,
    args.selection.model
  );
  if (!schemaFile) {
    return undefined;
  }

  return schemaFile.inputSchema as Record<string, unknown>;
}

function isImageOrVideoSelection(
  selection: ProducerSdkPreviewSelection,
  producerType: string | undefined,
  catalog: LoadedModelCatalog | null
): boolean {
  if (catalog) {
    const modelDef = lookupModel(catalog, selection.provider, selection.model);
    const modelType = modelDef?.type;
    if (modelType === 'image' || modelType === 'video') {
      return true;
    }
  }

  if (!producerType) {
    return false;
  }
  return producerType.includes('image') || producerType.includes('video');
}

function buildProducerBindingContext(args: {
  producerId: string;
  inputBindings: Array<{ from: string; to: string; sourceType: string }>;
  inputs: Record<string, unknown>;
}): {
  resolvedInputs: Record<string, unknown>;
  mappingInputBindings: Record<string, string>;
  connectedAliases: Set<string>;
} {
  const resolvedInputs: Record<string, unknown> = {};
  const mappingInputBindings: Record<string, string> = {};
  const connectedAliases = new Set<string>();
  const seenPerAlias = new Map<string, number>();

  for (const binding of args.inputBindings) {
    const alias = extractTargetAlias(binding.to, args.producerId);
    if (!alias) {
      continue;
    }

    connectedAliases.add(alias);
    const baseAlias = alias.replace(/\[\d+\]$/, '');
    connectedAliases.add(baseAlias);

    const sourceCanonicalId = buildSourceCanonicalId(
      binding.from,
      binding.sourceType
    );
    const normalizedAlias = normalizeAliasBinding(alias, seenPerAlias);
    mappingInputBindings[normalizedAlias] = sourceCanonicalId;

    const inputName = extractInputName(binding.from, binding.sourceType);
    if (inputName === undefined) {
      continue;
    }

    const value = resolveInputValue(args.inputs, inputName);
    if (value === undefined) {
      continue;
    }
    resolvedInputs[sourceCanonicalId] = value;
  }

  return {
    resolvedInputs,
    mappingInputBindings,
    connectedAliases,
  };
}

function normalizeAliasBinding(
  alias: string,
  seenPerAlias: Map<string, number>
): string {
  if (/\[\d+\]$/.test(alias)) {
    return alias;
  }

  const seen = seenPerAlias.get(alias) ?? 0;
  seenPerAlias.set(alias, seen + 1);
  if (seen === 0) {
    return alias;
  }
  return `${alias}[${seen}]`;
}

function extractTargetAlias(
  targetRef: string,
  producerId: string
): string | null {
  const escapedProducerId = producerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = targetRef.match(
    new RegExp(`^${escapedProducerId}(?:\\[[^\\]]+\\])*\\.(.+)$`)
  );
  if (!match || !match[1]) {
    return null;
  }
  const [alias] = match[1].split('.');
  return alias ?? null;
}

function buildSourceCanonicalId(sourceRef: string, sourceType: string): string {
  if (sourceType === 'input') {
    const inputName = extractInputName(sourceRef, sourceType);
    if (!inputName) {
      return `Input:${sourceRef}`;
    }
    return `Input:${inputName}`;
  }

  return `Artifact:${sourceRef}`;
}

function extractInputName(
  reference: string,
  sourceType: string
): string | undefined {
  if (sourceType !== 'input') {
    return undefined;
  }

  if (reference.startsWith('Input.')) {
    return reference.slice('Input.'.length);
  }

  return reference;
}

function resolveInputValue(
  inputs: Record<string, unknown>,
  inputName: string
): unknown {
  if (inputName in inputs) {
    return inputs[inputName];
  }

  const canonical = `Input:${inputName}`;
  if (canonical in inputs) {
    return inputs[canonical];
  }

  return undefined;
}
