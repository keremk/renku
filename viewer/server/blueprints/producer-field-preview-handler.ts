import path from 'node:path';
import {
  createRuntimeError,
  RuntimeErrorCode,
  expandBlueprintResolutionContext,
  isRenkuError,
  loadBlueprintResolutionContext,
  normalizeBlueprintResolutionInputs,
  resolveMappingsForModel,
  type ExpandedBlueprintResolution,
} from '@gorenku/core';
import {
  deriveMappingContractFields,
  evaluateResolutionMappingPreview,
  loadModelCatalog,
  loadModelSchemaFile,
  type MappingPreviewField,
  type LoadedModelCatalog,
} from '@gorenku/providers';
import {
  buildProducerBindingSummary,
  buildProducerRuntimeBindingSnapshot,
} from './mapping-binding-context.js';
import {
  assertPreviewSubsetOfDescriptors,
  buildFieldDescriptors,
  deriveFieldMappingMeta,
} from './models-pane-contract.js';

export interface ProducerFieldPreviewRequest {
  blueprintPath: string;
  catalogRoot?: string;
  inputs: Record<string, unknown>;
  models: ProducerFieldPreviewSelection[];
}

export interface ProducerFieldPreviewSelection {
  producerId: string;
  provider: string;
  model: string;
}

export interface ProducerFieldPreviewField {
  field: string;
  value: unknown;
  status: 'ok' | 'warning' | 'error';
  warnings: string[];
  errors: string[];
  connected: boolean;
  sourceAliases: string[];
  schemaType?: string;
  enumOptions?: unknown[];
  connectionBehavior?: 'invariant' | 'variant' | 'conditional';
  overridePolicy?: 'editable' | 'read_only_dynamic';
  instances?: ProducerFieldPreviewFieldInstance[];
}

export interface ProducerFieldPreviewFieldInstance {
  instanceId: string;
  instanceOrder: number;
  indices: Record<string, number>;
  value: unknown;
  status: 'ok' | 'warning' | 'error';
  warnings: string[];
  errors: string[];
  connected: boolean;
  sourceAliases: string[];
  sourceBindings: Record<string, string>;
}

export interface ProducerFieldPreviewEntry {
  producerId: string;
  fields: ProducerFieldPreviewField[];
}

export interface ProducerContractError {
  error: string;
  code: string;
}

export interface ProducerFieldPreviewResponse {
  producers: Record<string, ProducerFieldPreviewEntry>;
  errorsByProducer?: Record<string, ProducerContractError>;
}

const NON_BLOCKING_PREVIEW_BINDING_ERROR_CODES = new Set<string>([
  RuntimeErrorCode.MISSING_REQUIRED_INPUT,
  RuntimeErrorCode.MISSING_INPUT_SOURCE,
  RuntimeErrorCode.MISSING_DIMENSION_SIZE,
  RuntimeErrorCode.INVALID_INPUT_VALUE,
]);

export async function getProducerFieldPreview(
  request: ProducerFieldPreviewRequest
): Promise<ProducerFieldPreviewResponse> {
  const context = await loadBlueprintResolutionContext({
    blueprintPath: request.blueprintPath,
    catalogRoot: request.catalogRoot,
    schemaSource: { kind: 'producer-metadata' },
  });
  const canonicalInputs = normalizeBlueprintResolutionInputs(
    context,
    request.inputs
  );
  let expanded: ExpandedBlueprintResolution | null = null;
  let expansionWarning: string | null = null;

  try {
    expanded = expandBlueprintResolutionContext(context, canonicalInputs);
  } catch (error) {
    if (
      isRenkuError(error) &&
      NON_BLOCKING_PREVIEW_BINDING_ERROR_CODES.has(error.code)
    ) {
      expansionWarning = error.message;
    } else {
      throw error;
    }
  }

  let catalog: LoadedModelCatalog | null = null;
  let catalogModelsDir: string | null = null;
  if (request.catalogRoot) {
    catalogModelsDir = path.join(request.catalogRoot, 'models');
    catalog = await loadModelCatalog(catalogModelsDir);
  }

  const producers: Record<string, ProducerFieldPreviewEntry> = {};
  const errorsByProducer: Record<string, ProducerContractError> = {};

  for (const selection of request.models) {
    try {
      const mapping = resolveMappingsForModel(context.root, {
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

      const previewWarningsByProducer = new Set<string>();
      let bindingContext: ReturnType<typeof buildProducerBindingSummary>;
      let runtimeSnapshot:
        | ReturnType<typeof buildProducerRuntimeBindingSnapshot>
        | null = null;
      if (expanded) {
        runtimeSnapshot = buildProducerRuntimeBindingSnapshot({
          expanded,
          producerId: selection.producerId,
        });
        bindingContext = buildProducerBindingSummary({
          expanded,
          producerId: selection.producerId,
          mode: 'runtime',
        });
      } else {
        if (expansionWarning) {
          previewWarningsByProducer.add(expansionWarning);
        }
        bindingContext = buildProducerBindingSummary({
          context,
          producerId: selection.producerId,
          inputs: canonicalInputs,
          mode: 'static',
        });
      }

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

      const baseFields = evaluateResolutionMappingPreview({
        mapping,
        context: {
          inputs:
            runtimeSnapshot?.resolvedInputs ?? bindingContext.resolvedInputs,
          inputBindings: bindingContext.mappingInputBindings,
        },
        connectedAliases: bindingContext.connectedAliases,
        inputSchema: schemaFile.inputSchema as Record<string, unknown>,
      });

      const runtimeInstanceFields = runtimeSnapshot
        ? runtimeSnapshot.instances.map((instance, instanceOrder) => ({
            instanceId: instance.instanceId,
            instanceOrder,
            indices: instance.indices,
            sourceBindings: instance.inputBindings,
            fields: evaluateResolutionMappingPreview({
              mapping,
              context: {
                inputs: runtimeSnapshot.resolvedInputs,
                inputBindings: instance.inputBindings,
              },
              connectedAliases: collectInstanceConnectedAliases({
                producerId: selection.producerId,
                staticConnectedAliases: bindingContext.connectedAliases,
                inputBindings: instance.inputBindings,
              }),
              inputSchema: schemaFile.inputSchema as Record<string, unknown>,
            }),
          }))
        : [];

      const visibleFields = baseFields.filter((field) => {
        const source = fieldMapping.get(field.field)?.source;
        return source !== 'artifact';
      });

      const visibilityFilter = (field: { field: string }) =>
        fieldMapping.get(field.field)?.source !== 'artifact';
      const visibleRuntimeInstanceFields = runtimeInstanceFields.map(
        (instance) => ({
          ...instance,
          fields: instance.fields.filter(visibilityFilter),
        })
      );

      const contractFields = deriveMappingContractFields(mapping);
      const connectedInputBehaviorByField = deriveConnectedInputBehaviorByField({
        contractFields,
        fieldMapping,
        runtimeSnapshot,
      });

      const fieldInstancePreviewByField = buildFieldInstancePreviewByField({
        contractFields,
        runtimeSnapshot,
        runtimeInstanceFields: visibleRuntimeInstanceFields,
      });

      const augmentedVisibleFields = augmentFieldsWithConnectionMetadata({
        visibleFields,
        connectedInputBehaviorByField,
        fieldInstancePreviewByField,
      });

      if (previewWarningsByProducer.size > 0) {
        const warnings = Array.from(previewWarningsByProducer);
        for (const field of augmentedVisibleFields) {
          const mergedWarnings = new Set([
            ...field.warnings,
            ...warnings,
            ...field.errors,
          ]);
          field.warnings = Array.from(mergedWarnings);
          field.errors = [];
          field.status = field.warnings.length > 0 ? 'warning' : 'ok';
        }
      }

      assertPreviewSubsetOfDescriptors({
        producerId: selection.producerId,
        provider: selection.provider,
        model: selection.model,
        descriptorFields,
        previewFields: augmentedVisibleFields,
      });

      producers[selection.producerId] = {
        producerId: selection.producerId,
        fields: augmentedVisibleFields,
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

function collectInstanceConnectedAliases(args: {
  producerId: string;
  staticConnectedAliases: Set<string>;
  inputBindings: Record<string, string>;
}): Set<string> {
  const connectedAliases = new Set<string>();

  for (const [alias, canonicalId] of Object.entries(args.inputBindings)) {
    if (args.staticConnectedAliases.has(alias)) {
      connectedAliases.add(alias);
      continue;
    }

    if (canonicalId.startsWith('Artifact:')) {
      connectedAliases.add(alias);
      continue;
    }

    if (
      canonicalId.startsWith('Input:') &&
      !canonicalId.startsWith(`Input:${args.producerId}.`)
    ) {
      connectedAliases.add(alias);
    }
  }

  return connectedAliases;
}

interface ConnectedInputFieldBehavior {
  connectionBehavior: 'invariant' | 'variant' | 'conditional';
  overridePolicy: 'editable' | 'read_only_dynamic';
  connected: boolean;
}

function deriveConnectedInputBehaviorByField(args: {
  contractFields: ReturnType<typeof deriveMappingContractFields>;
  fieldMapping: Map<string, unknown>;
  runtimeSnapshot: ReturnType<typeof buildProducerRuntimeBindingSnapshot> | null;
}): Map<string, ConnectedInputFieldBehavior> {
  const byField = new Map<string, ConnectedInputFieldBehavior>();
  if (!args.runtimeSnapshot) {
    return byField;
  }

  for (const contractField of args.contractFields) {
    const source = readFieldMappingSource(args.fieldMapping, contractField.field);
    if (source !== 'input') {
      continue;
    }

    const aliases = [...contractField.sourceAliases].sort();
    if (aliases.length === 0) {
      continue;
    }

    const connectionByInstance = args.runtimeSnapshot.instances.map((instance) =>
      aliases.every((alias) => instance.inputBindings[alias] !== undefined)
    );
    const connected = connectionByInstance.some((isConnected) => isConnected);
    const hasMissingAlias = connectionByInstance.some(
      (isConnected) => !isConnected
    );

    const signatures = args.runtimeSnapshot.instances.map((instance) =>
      buildAliasBindingSignature(instance.inputBindings, aliases)
    );
    const uniqueSignatures = new Set(signatures);

    const connectionBehavior = hasMissingAlias
      ? 'conditional'
      : uniqueSignatures.size > 1
        ? 'variant'
        : 'invariant';
    const overridePolicy =
      connectionBehavior === 'invariant' ? 'editable' : 'read_only_dynamic';

    byField.set(contractField.field, {
      connectionBehavior,
      overridePolicy,
      connected,
    });
  }

  return byField;
}

function buildAliasBindingSignature(
  inputBindings: Record<string, string>,
  aliases: string[]
): string {
  const pairs: string[] = [];
  for (const alias of aliases) {
    const binding = inputBindings[alias];
    if (!binding) {
      pairs.push(`${alias}=<missing>`);
      continue;
    }
    pairs.push(`${alias}=${binding}`);
  }
  return pairs.join('|');
}

function readFieldMappingSource(
  fieldMapping: Map<string, unknown>,
  field: string
): 'none' | 'input' | 'artifact' | 'mixed' | null {
  const value = fieldMapping.get(field) as { source?: unknown } | undefined;
  const source = value?.source;
  if (
    source === 'none' ||
    source === 'input' ||
    source === 'artifact' ||
    source === 'mixed'
  ) {
    return source;
  }
  return null;
}

function buildFieldInstancePreviewByField(args: {
  contractFields: ReturnType<typeof deriveMappingContractFields>;
  runtimeSnapshot: ReturnType<typeof buildProducerRuntimeBindingSnapshot> | null;
  runtimeInstanceFields: Array<{
    instanceId: string;
    instanceOrder: number;
    indices: Record<string, number>;
    sourceBindings: Record<string, string>;
    fields: MappingPreviewField[];
  }>;
}): Map<string, ProducerFieldPreviewFieldInstance[]> {
  const byField = new Map<string, ProducerFieldPreviewFieldInstance[]>();
  if (!args.runtimeSnapshot) {
    return byField;
  }

  const aliasesByField = new Map<string, string[]>();
  for (const contractField of args.contractFields) {
    aliasesByField.set(contractField.field, contractField.sourceAliases);
  }

  for (const runtimeInstance of args.runtimeInstanceFields) {
    const previewByField = new Map(
      runtimeInstance.fields.map((field) => [field.field, field])
    );

    for (const [field, aliases] of aliasesByField.entries()) {
      const preview = previewByField.get(field);
      const sourceBindings = pickSourceBindings(
        runtimeInstance.sourceBindings,
        aliases
      );
      const connected = aliases.every(
        (alias) => runtimeInstance.sourceBindings[alias] !== undefined
      );

      const warnings = preview
        ? [...preview.warnings]
        : connected
          ? []
          : ['Not mapped for this instance.'];
      const errors = preview ? [...preview.errors] : [];

      const instancePreview: ProducerFieldPreviewFieldInstance = {
        instanceId: runtimeInstance.instanceId,
        instanceOrder: runtimeInstance.instanceOrder,
        indices: runtimeInstance.indices,
        value: preview?.value,
        status: preview?.status ?? (connected ? 'ok' : 'warning'),
        warnings,
        errors,
        connected: preview?.connected ?? connected,
        sourceAliases: preview?.sourceAliases ?? aliases,
        sourceBindings,
      };

      const existing = byField.get(field) ?? [];
      existing.push(instancePreview);
      byField.set(field, existing);
    }
  }

  return byField;
}

function pickSourceBindings(
  inputBindings: Record<string, string>,
  aliases: string[]
): Record<string, string> {
  const bindings: Record<string, string> = {};
  for (const alias of aliases) {
    const binding = inputBindings[alias];
    if (binding !== undefined) {
      bindings[alias] = binding;
    }
  }
  return bindings;
}

function augmentFieldsWithConnectionMetadata(args: {
  visibleFields: MappingPreviewField[];
  connectedInputBehaviorByField: Map<string, ConnectedInputFieldBehavior>;
  fieldInstancePreviewByField: Map<string, ProducerFieldPreviewFieldInstance[]>;
}): ProducerFieldPreviewField[] {
  const byField = new Map<string, ProducerFieldPreviewField>();

  for (const field of args.visibleFields) {
    const behavior = args.connectedInputBehaviorByField.get(field.field);
    const instances = args.fieldInstancePreviewByField.get(field.field);
    byField.set(field.field, {
      ...field,
      ...(behavior
        ? {
            connectionBehavior: behavior.connectionBehavior,
            overridePolicy: behavior.overridePolicy,
            connected: behavior.connected,
          }
        : {}),
      ...(instances ? { instances } : {}),
    });
  }

  for (const [field, behavior] of args.connectedInputBehaviorByField.entries()) {
    if (byField.has(field)) {
      continue;
    }

    const instances = args.fieldInstancePreviewByField.get(field) ?? [];
    const firstInstance = instances[0];
    byField.set(field, {
      field,
      value: firstInstance?.value,
      status: firstInstance?.status ?? 'warning',
      warnings: firstInstance?.warnings ?? [
        'No preview value is available for this field.',
      ],
      errors: firstInstance?.errors ?? [],
      connected: behavior.connected,
      sourceAliases: firstInstance?.sourceAliases ?? [],
      connectionBehavior: behavior.connectionBehavior,
      overridePolicy: behavior.overridePolicy,
      instances,
    });
  }

  return Array.from(byField.values()).sort((left, right) =>
    left.field.localeCompare(right.field)
  );
}

async function loadSelectionSchemaFile(args: {
  selection: ProducerFieldPreviewSelection;
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
