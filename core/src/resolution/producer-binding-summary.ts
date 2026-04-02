import type { BlueprintTreeNode } from '../types.js';
import {
  formatCanonicalArtifactId,
  formatCanonicalInputId,
} from '../parsing/canonical-ids.js';
import { parseDimensionSelector } from '../parsing/dimension-selectors.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type { BlueprintGraphNode } from './canonical-graph.js';
import { buildBlueprintGraph } from './canonical-graph.js';
import { expandBlueprintGraph } from './canonical-expander.js';
import {
  buildInputSourceMapFromCanonical,
  normalizeInputValues,
} from './input-sources.js';

export type BindingSourceKind = 'input' | 'artifact';

export interface ProducerBindingEntry {
  aliasBase: string;
  explicitNumericAlias?: string;
  targetCanonicalId?: string;
  sourceCanonicalId: string;
  sourceKind: BindingSourceKind;
}

export interface ProducerBindingSummary {
  resolvedInputs: Record<string, unknown>;
  mappingInputBindings: Record<string, string>;
  connectedAliases: Set<string>;
  aliasSources: Map<string, Set<BindingSourceKind>>;
}

export type ProducerBindingSummaryMode = 'static' | 'runtime';

export interface ProducerRuntimeBindingInstance {
  instanceId: string;
  indices: Record<string, number>;
  inputBindings: Record<string, string>;
}

export interface ProducerRuntimeBindingSnapshot {
  instances: ProducerRuntimeBindingInstance[];
  resolvedInputs: Record<string, unknown>;
}

export function collectProducerBindingEntries(
  root: BlueprintTreeNode,
  producerId: string
): ProducerBindingEntry[] {
  const graph = buildBlueprintGraph(root);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  const entries: ProducerBindingEntry[] = [];

  for (const edge of graph.edges) {
    const targetNode = nodesById.get(edge.to.nodeId);
    if (!targetNode || targetNode.type !== 'InputSource') {
      continue;
    }

    const targetProducerId = targetNode.namespacePath.join('.');
    if (targetProducerId !== producerId) {
      continue;
    }

    const sourceNode = nodesById.get(edge.from.nodeId);
    if (!sourceNode) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_INPUT_BINDING,
        `Missing source graph node "${edge.from.nodeId}" while collecting producer binding entries for "${producerId}".`
      );
    }

    const source = resolveSourceBinding(sourceNode, producerId);
    const targetAlias = parseTargetAlias(targetNode.name, producerId);

    entries.push({
      aliasBase: targetAlias.baseAlias,
      explicitNumericAlias: targetAlias.explicitNumericAlias,
      targetCanonicalId: formatCanonicalInputId(
        targetNode.namespacePath,
        targetNode.name
      ),
      sourceCanonicalId: source.canonicalId,
      sourceKind: source.kind,
    });
  }

  return entries;
}

export function buildProducerBindingSummary(args: {
  root: BlueprintTreeNode;
  producerId: string;
  inputs?: Record<string, unknown>;
  mode?: ProducerBindingSummaryMode;
}): ProducerBindingSummary {
  const entries = collectProducerBindingEntries(args.root, args.producerId);
  const staticBindings = buildStaticBindingState(entries);
  const mode = args.mode ?? (args.inputs ? 'runtime' : 'static');

  if (mode === 'static') {
    const resolvedInputs = args.inputs
      ? resolveStaticInputs(args.inputs, entries)
      : {};
    return {
      resolvedInputs,
      mappingInputBindings: staticBindings.mappingInputBindings,
      connectedAliases: staticBindings.connectedAliases,
      aliasSources: staticBindings.aliasSources,
    };
  }

  if (!args.inputs) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      `Runtime binding summary requires input values for producer "${args.producerId}".`
    );
  }

  const runtimeSnapshot = buildProducerRuntimeBindingSnapshot({
    root: args.root,
    producerId: args.producerId,
    inputs: args.inputs,
  });
  const firstInstance = runtimeSnapshot.instances[0];
  if (!firstInstance) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_INPUT_BINDING,
      `Runtime binding summary could not find canonical producer instance for "${args.producerId}".`
    );
  }

  const runtimeBindings = firstInstance.inputBindings;

  const connectedAliases = collectRuntimeConnectedAliases({
    producerId: args.producerId,
    runtimeInstances: runtimeSnapshot.instances,
    staticConnectedAliases: staticBindings.connectedAliases,
  });
  const aliasSources = buildRuntimeAliasSources({
    producerId: args.producerId,
    runtimeBindings,
    staticAliasSources: staticBindings.aliasSources,
    connectedAliases,
  });

  return {
    resolvedInputs: runtimeSnapshot.resolvedInputs,
    mappingInputBindings: runtimeBindings,
    connectedAliases,
    aliasSources,
  };
}

export function buildProducerRuntimeBindingSnapshot(args: {
  root: BlueprintTreeNode;
  producerId: string;
  inputs: Record<string, unknown>;
}): ProducerRuntimeBindingSnapshot {
  const graph = buildBlueprintGraph(args.root);
  const inputSources = buildInputSourceMapFromCanonical(graph);
  const canonicalizedInputs = canonicalizeInputKeys(args.inputs);
  const normalizedInputs = normalizeInputValues(
    canonicalizedInputs,
    inputSources
  );
  const canonical = expandBlueprintGraph(graph, normalizedInputs, inputSources);

  const producerInstances = canonical.nodes
    .filter(
      (node) =>
        node.type === 'Producer' && node.producerAlias === args.producerId
    )
    .sort((left, right) => compareProducerInstanceOrder(left.id, right.id));

  if (producerInstances.length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_INPUT_BINDING,
      `Runtime binding summary could not find canonical producer instance for "${args.producerId}".`
    );
  }

  const instances = producerInstances.map((producerInstance) => ({
    instanceId: producerInstance.id,
    indices: producerInstance.indices,
    inputBindings: canonical.inputBindings[producerInstance.id] ?? {},
  }));

  const resolvedInputs = resolveRuntimeInputsFromInstances(args.inputs, instances);

  return {
    instances,
    resolvedInputs,
  };
}

function resolveSourceBinding(
  sourceNode: BlueprintGraphNode,
  producerId: string
): { kind: BindingSourceKind; canonicalId: string } {
  if (sourceNode.type === 'InputSource') {
    return {
      kind: 'input',
      canonicalId: formatCanonicalInputId(
        sourceNode.namespacePath,
        sourceNode.name
      ),
    };
  }

  if (sourceNode.type === 'Artifact') {
    return {
      kind: 'artifact',
      canonicalId: formatCanonicalArtifactId(
        sourceNode.namespacePath,
        sourceNode.name
      ),
    };
  }

  throw createRuntimeError(
    RuntimeErrorCode.INVALID_INPUT_BINDING,
    `Unsupported source node type "${sourceNode.type}" while collecting producer binding entries for "${producerId}".`
  );
}

function parseTargetAlias(
  aliasSegment: string,
  producerId: string
): { baseAlias: string; explicitNumericAlias?: string } {
  const baseAlias = stripAllSelectors(aliasSegment);
  if (!baseAlias) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_INPUT_BINDING,
      `Invalid producer binding target alias "${aliasSegment}" for ${producerId}.`
    );
  }

  const selectorSuffix = aliasSegment.match(/(\[[^\]]+])+$|$/)?.[0] ?? '';
  if (!selectorSuffix || !/^(\[\d+])+$/.test(selectorSuffix)) {
    return { baseAlias };
  }

  return {
    baseAlias,
    explicitNumericAlias: `${baseAlias}${selectorSuffix}`,
  };
}

function stripAllSelectors(value: string): string {
  return value.replace(/(\[[^\]]+])+$/, '');
}

function buildStaticBindingState(entries: ProducerBindingEntry[]): {
  mappingInputBindings: Record<string, string>;
  connectedAliases: Set<string>;
  aliasSources: Map<string, Set<BindingSourceKind>>;
} {
  const mappingInputBindings: Record<string, string> = {};
  const connectedAliases = new Set<string>();
  const aliasSources = new Map<string, Set<BindingSourceKind>>();
  const seenPerBaseAlias = new Map<string, number>();

  for (const entry of entries) {
    const mappedAlias = nextMappedAlias(entry.aliasBase, seenPerBaseAlias);
    mappingInputBindings[mappedAlias] =
      entry.explicitNumericAlias && entry.targetCanonicalId
        ? entry.targetCanonicalId
        : entry.sourceCanonicalId;
    connectedAliases.add(mappedAlias);
    upsertAliasSource(aliasSources, mappedAlias, entry.sourceKind);

    if (entry.explicitNumericAlias) {
      mappingInputBindings[entry.explicitNumericAlias] =
        entry.sourceCanonicalId;
      connectedAliases.add(entry.explicitNumericAlias);
      upsertAliasSource(
        aliasSources,
        entry.explicitNumericAlias,
        entry.sourceKind
      );
    }
  }

  return {
    mappingInputBindings,
    connectedAliases,
    aliasSources,
  };
}

function nextMappedAlias(
  aliasBase: string,
  seenPerBaseAlias: Map<string, number>
): string {
  const seen = seenPerBaseAlias.get(aliasBase) ?? 0;
  seenPerBaseAlias.set(aliasBase, seen + 1);
  if (seen === 0) {
    return aliasBase;
  }
  return `${aliasBase}[${seen}]`;
}

function upsertAliasSource(
  aliasSources: Map<string, Set<BindingSourceKind>>,
  alias: string,
  sourceKind: BindingSourceKind
): void {
  const existing = aliasSources.get(alias);
  if (existing) {
    existing.add(sourceKind);
    return;
  }
  aliasSources.set(alias, new Set([sourceKind]));
}

function canonicalizeInputKeys(
  inputs: Record<string, unknown>
): Record<string, unknown> {
  const canonicalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(inputs)) {
    canonicalized[key] = value;

    if (
      !key.startsWith('Input:') &&
      !key.startsWith('Artifact:') &&
      !key.startsWith('Producer:')
    ) {
      const canonicalKey = `Input:${key}`;
      if (!(canonicalKey in canonicalized)) {
        canonicalized[canonicalKey] = value;
      }
    }
  }

  return canonicalized;
}

function compareProducerInstanceOrder(leftId: string, rightId: string): number {
  const leftIndices = extractTrailingIndices(leftId);
  const rightIndices = extractTrailingIndices(rightId);
  const max = Math.max(leftIndices.length, rightIndices.length);

  for (let index = 0; index < max; index += 1) {
    const leftValue = leftIndices[index] ?? -1;
    const rightValue = rightIndices[index] ?? -1;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return leftId.localeCompare(rightId);
}

function extractTrailingIndices(id: string): number[] {
  const matches = id.match(/\[(\d+)]/g);
  if (!matches) {
    return [];
  }

  return matches.map((match) => parseInt(match.slice(1, -1), 10));
}

function buildRuntimeAliasSources(args: {
  producerId: string;
  runtimeBindings: Record<string, string>;
  staticAliasSources: Map<string, Set<BindingSourceKind>>;
  connectedAliases: Set<string>;
}): Map<string, Set<BindingSourceKind>> {
  const aliasSources = new Map<string, Set<BindingSourceKind>>();

  for (const alias of args.connectedAliases) {
    const staticSources = args.staticAliasSources.get(alias);
    if (staticSources) {
      aliasSources.set(alias, new Set(staticSources));
      continue;
    }

    const inferredKind = inferBindingSourceKind(
      args.runtimeBindings[alias],
      args.producerId
    );
    if (inferredKind) {
      aliasSources.set(alias, new Set([inferredKind]));
    }
  }

  for (const alias of args.connectedAliases) {
    if (alias.includes('[')) {
      continue;
    }

    const existing = aliasSources.get(alias) ?? new Set<BindingSourceKind>();
    for (const candidateAlias of args.connectedAliases) {
      if (!candidateAlias.startsWith(`${alias}[`)) {
        continue;
      }

      const candidateSources = aliasSources.get(candidateAlias);
      if (!candidateSources) {
        continue;
      }

      for (const sourceKind of candidateSources) {
        existing.add(sourceKind);
      }
    }

    if (existing.size > 0) {
      aliasSources.set(alias, existing);
    }
  }

  return aliasSources;
}

export function collectRuntimeConnectedAliases(args: {
  producerId: string;
  runtimeInstances: ProducerRuntimeBindingInstance[];
  staticConnectedAliases: Set<string>;
}): Set<string> {
  const connectedAliases = new Set<string>();

  for (const instance of args.runtimeInstances) {
    for (const [alias, canonicalId] of Object.entries(instance.inputBindings)) {
      // Preserve aliases that are explicitly connected in blueprint graph metadata.
      if (args.staticConnectedAliases.has(alias)) {
        connectedAliases.add(alias);
        continue;
      }

      // Runtime expander can emit producer-local fallbacks such as
      // Input:<ProducerAlias>.<Alias> for unmapped model params. These are not
      // external bindings and must not be treated as connected aliases.
      if (inferBindingSourceKind(canonicalId, args.producerId)) {
        connectedAliases.add(alias);
      }
    }
  }

  return connectedAliases;
}

function inferBindingSourceKind(
  canonicalId: string | undefined,
  producerId: string
): BindingSourceKind | null {
  if (!canonicalId) {
    return null;
  }

  if (canonicalId.startsWith('Artifact:')) {
    return 'artifact';
  }

  if (canonicalId.startsWith('Input:')) {
    if (canonicalId.startsWith(`Input:${producerId}.`)) {
      return null;
    }
    return 'input';
  }

  return null;
}

function resolveRuntimeInputsFromInstances(
  inputs: Record<string, unknown>,
  instances: ProducerRuntimeBindingInstance[]
): Record<string, unknown> {
  const resolvedInputs: Record<string, unknown> = {};

  const canonicalInputIds = new Set<string>();
  for (const instance of instances) {
    for (const canonicalId of Object.values(instance.inputBindings)) {
      if (canonicalId.startsWith('Input:')) {
        canonicalInputIds.add(canonicalId);
      }
    }
  }

  for (const canonicalId of canonicalInputIds) {
    const value = resolveInputValue(inputs, canonicalId);
    if (value !== undefined) {
      resolvedInputs[canonicalId] = value;
    }
  }

  return resolvedInputs;
}

function resolveStaticInputs(
  inputs: Record<string, unknown>,
  entries: ProducerBindingEntry[]
): Record<string, unknown> {
  const resolvedInputs: Record<string, unknown> = {};

  for (const entry of entries) {
    if (entry.sourceKind !== 'input') {
      continue;
    }

    const value = resolveInputValue(inputs, entry.sourceCanonicalId);
    if (value !== undefined) {
      resolvedInputs[entry.sourceCanonicalId] = value;
    }
  }

  return resolvedInputs;
}

function resolveInputValue(
  inputs: Record<string, unknown>,
  sourceCanonicalId: string
): unknown {
  if (sourceCanonicalId in inputs) {
    return inputs[sourceCanonicalId];
  }

  const inputName = sourceCanonicalId.startsWith('Input:')
    ? sourceCanonicalId.slice('Input:'.length)
    : sourceCanonicalId;

  if (inputName in inputs) {
    return inputs[inputName];
  }

  const indexedValue = resolveIndexedInputValue(inputs, sourceCanonicalId);
  if (indexedValue !== undefined) {
    return indexedValue;
  }

  if (inputName !== sourceCanonicalId) {
    return resolveIndexedInputValue(inputs, inputName);
  }

  return undefined;
}

function resolveIndexedInputValue(
  inputs: Record<string, unknown>,
  reference: string
): unknown {
  const indexedAccess = parseIndexedInputAccess(reference);
  if (!indexedAccess) {
    return undefined;
  }

  const baseValue = inputs[indexedAccess.baseId];
  if (baseValue === undefined) {
    return undefined;
  }

  let currentValue: unknown = baseValue;
  for (const rawSelector of indexedAccess.selectors) {
    if (!Array.isArray(currentValue)) {
      return undefined;
    }

    const index = resolvePreviewSelectorIndex(rawSelector);
    if (index < 0 || index >= currentValue.length) {
      return undefined;
    }

    currentValue = currentValue[index];
  }

  return currentValue;
}

function resolvePreviewSelectorIndex(rawSelector: string): number {
  const selector = parseDimensionSelector(rawSelector);
  if (selector.kind === 'const') {
    return selector.value;
  }

  return selector.offset;
}

function parseIndexedInputAccess(
  reference: string
): { baseId: string; selectors: string[] } | undefined {
  const selectors: string[] = [];
  let baseId = reference;

  let match = baseId.match(/^(.*)\[([^\]]+)]$/);
  while (match) {
    selectors.unshift(match[2]!.trim());
    baseId = match[1]!;
    match = baseId.match(/^(.*)\[([^\]]+)]$/);
  }

  if (selectors.length === 0 || baseId === reference) {
    return undefined;
  }

  return { baseId, selectors };
}
