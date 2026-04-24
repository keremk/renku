import type {
  BlueprintGraph,
  BlueprintGraphNode,
  BlueprintGraphEdge,
} from './canonical-graph.js';
import type { DimensionSelector } from '../parsing/dimension-selectors.js';
import type {
  BlueprintOutputDefinition,
  BlueprintInputDefinition,
  BlueprintLoopDefinition,
  EdgeConditionClause,
  EdgeConditionDefinition,
  EdgeConditionGroup,
  ProducerConfig,
  FanInDescriptor,
} from '../types.js';
import {
  formatProducerAlias,
  formatCanonicalProducerId,
  formatCanonicalInputId,
  formatCanonicalOutputId,
  formatCanonicalArtifactId,
  isCanonicalInputId,
  isCanonicalOutputId,
} from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';

export interface CanonicalNodeInstance {
  id: string;
  type: 'Input' | 'Output' | 'Artifact' | 'Producer';
  /** The producer alias - the reference name used in blueprint connections */
  producerAlias: string;
  namespacePath: string[];
  name: string;
  indices: Record<string, number>;
  dimensions: string[];
  artifact?: BlueprintOutputDefinition;
  output?: BlueprintOutputDefinition;
  input?: BlueprintInputDefinition;
  producer?: ProducerConfig;
}

export interface CanonicalEdgeInstance {
  from: string;
  to: string;
  note?: string;
  groupBy?: string;
  orderBy?: string;
  /** Input alias override used for dynamic array element bindings. */
  bindingAlias?: string;
  /** Conditions that must be satisfied for this edge to be active (evaluated at runtime) */
  conditions?: EdgeConditionDefinition;
  /** The dimension indices for this edge instance (for resolving condition paths) */
  indices?: Record<string, number>;
}

export interface CanonicalOutputBinding {
  outputId: string;
  sourceId: string;
  conditions?: EdgeConditionDefinition;
  indices?: Record<string, number>;
}

export interface CanonicalBlueprint {
  nodes: CanonicalNodeInstance[];
  edges: CanonicalEdgeInstance[];
  inputBindings: Record<string, Record<string, string>>;
  outputSources: Record<string, string>;
  outputSourceBindings: CanonicalOutputBinding[];
  fanIn: Record<string, FanInDescriptor>;
}

export function expandBlueprintGraph(
  graph: BlueprintGraph,
  inputValues: Record<string, unknown>,
  inputSources: Map<string, string>
): CanonicalBlueprint {
  const dimensionSizes = resolveDimensionSizes(
    graph.nodes,
    inputValues,
    graph.edges,
    graph.dimensionLineage,
    inputSources,
    graph.loops
  );
  const instancesByNodeId = new Map<string, CanonicalNodeInstance[]>();
  const allNodes: CanonicalNodeInstance[] = [];
  const instanceByCanonicalId = new Map<string, CanonicalNodeInstance>();

  for (const node of graph.nodes) {
    const instances = expandNodeInstances(node, dimensionSizes);
    instancesByNodeId.set(node.id, instances);
    for (const instance of instances) {
      allNodes.push(instance);
      instanceByCanonicalId.set(instance.id, instance);
    }
  }

  const rawEdges = expandEdges(graph.edges, instancesByNodeId);
  const collapsedInputs = collapseInputNodes(
    rawEdges,
    allNodes
  );
  const { edges, nodes, outputSources, outputSourceBindings } = collapseOutputNodes(
    collapsedInputs.edges,
    collapsedInputs.nodes
  );
  const inputBindings = normalizeCollapsedInputBindings(
    collapsedInputs.inputBindings,
    outputSources
  );
  const fanIn = buildFanInCollections(nodes, edges, instanceByCanonicalId);

  return {
    nodes,
    edges,
    inputBindings,
    outputSources,
    outputSourceBindings,
    fanIn,
  };
}

function normalizeCollapsedInputBindings(
  inputBindings: Record<string, Record<string, string>>,
  outputSources: Record<string, string>
): Record<string, Record<string, string>> {
  const normalized: Record<string, Record<string, string>> = {};

  for (const [targetId, bindings] of Object.entries(inputBindings)) {
    const normalizedBindings: Record<string, string> = {};

    for (const [alias, canonicalId] of Object.entries(bindings)) {
      if (!isCanonicalOutputId(canonicalId)) {
        normalizedBindings[alias] = canonicalId;
        continue;
      }

      const sourceId = outputSources[canonicalId];
      if (!sourceId) {
        throw createRuntimeError(
          RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
          `Input binding for "${targetId}.${alias}" references output connector "${canonicalId}", but that connector was not resolved to a canonical source.`
        );
      }

      normalizedBindings[alias] = sourceId;
    }

    normalized[targetId] = normalizedBindings;
  }

  return normalized;
}

function resolveDimensionSizes(
  nodes: BlueprintGraphNode[],
  inputValues: Record<string, unknown>,
  edges: BlueprintGraphEdge[],
  lineage: Map<string, string | null>,
  inputSources: Map<string, string>,
  loops: Map<string, BlueprintLoopDefinition[]>
): Map<string, number> {
  const sizes = new Map<string, number>();

  // Phase 1: assign sizes from explicit countInput declarations.
  for (const node of nodes) {
    if (node.type !== 'Artifact' && node.type !== 'Output') {
      continue;
    }
    const definition = node.artifact ?? node.output;
    if (!definition?.countInput) {
      continue;
    }
    if (node.dimensions.length === 0) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Artifact "${[...node.namespacePath, node.name].join('.')}" declares countInput but has no dimensions.`
      );
    }
    const symbol = node.dimensions[node.dimensions.length - 1];
    const baseSize = readPositiveInteger(
      readInputValue(
        inputValues,
        node.namespacePath,
        definition.countInput,
        inputSources
      ),
      definition.countInput
    );
    const offset = definition.countInputOffset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Artifact "${[...node.namespacePath, node.name].join('.')}" declares an invalid countInputOffset (${offset}).`
      );
    }
    const size = baseSize + offset;
    assignDimensionSize(sizes, symbol, size);
    const targetLabel = extractDimensionLabel(symbol);
    for (let index = node.dimensions.length - 2; index >= 0; index -= 1) {
      const candidate = node.dimensions[index];
      if (extractDimensionLabel(candidate) === targetLabel) {
        assignDimensionSize(sizes, candidate, size);
      }
    }
  }

  // Phase 1b: assign sizes from loop definitions (for decomposed JSON artifacts and namespace dimensions).
  for (const node of nodes) {
    if (node.dimensions.length === 0) {
      continue;
    }
    for (const symbol of node.dimensions) {
      if (sizes.has(symbol)) {
        continue;
      }
      const label = extractDimensionLabel(symbol);
      const loopDef = findLoopDefinition(
        symbol,
        label,
        node.namespacePath,
        loops
      );
      if (!loopDef) {
        continue;
      }
      // Find the namespace path where the loop is defined to resolve the input
      const loopNamespacePath = findLoopNamespacePath(
        label,
        node.namespacePath,
        loops
      );
      const baseSize = readPositiveInteger(
        readInputValue(
          inputValues,
          loopNamespacePath,
          loopDef.countInput,
          inputSources
        ),
        loopDef.countInput
      );
      const offset = loopDef.countInputOffset ?? 0;
      const size = baseSize + offset;
      assignDimensionSize(sizes, symbol, size);
    }
  }

  // Build inbound edge lookup for derived dimensions.
  const inbound = new Map<string, BlueprintGraphEdge[]>();
  for (const edge of edges) {
    const list = inbound.get(edge.to.nodeId) ?? [];
    list.push(edge);
    inbound.set(edge.to.nodeId, list);
  }

  // Phase 2: derive sizes transitively from inbound edges.
  let updated = true;
  while (updated) {
    updated = false;
    for (const node of nodes) {
      if (node.dimensions.length === 0) {
        continue;
      }
      for (const symbol of node.dimensions) {
        if (sizes.has(symbol)) {
          continue;
        }
        const derivedSize = deriveDimensionSize(
          symbol,
          inbound,
          sizes,
          lineage
        );
        if (derivedSize !== undefined) {
          assignDimensionSize(sizes, symbol, derivedSize);
          updated = true;
        }
      }
    }
  }

  // Final validation: ensure every dimension has a size.
  for (const node of nodes) {
    for (const symbol of node.dimensions) {
      if (!sizes.has(symbol)) {
        const { nodeId, label } = parseDimensionSymbol(symbol);
        throw createRuntimeError(
          RuntimeErrorCode.MISSING_DIMENSION_SIZE,
          `Missing size for dimension "${label}" on node "${nodeId}". ` +
            `Ensure the upstream artifact declares countInput or can derive this dimension from a loop.`
        );
      }
    }
  }

  return sizes;
}

function assignDimensionSize(
  sizes: Map<string, number>,
  symbol: string,
  size: number
): void {
  const existing = sizes.get(symbol);
  if (existing !== undefined && existing !== size) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
      `Dimension "${symbol}" has conflicting sizes (${existing} vs ${size}).`
    );
  }

  sizes.set(symbol, size);
}

function deriveDimensionSize(
  targetSymbol: string,
  inbound: Map<string, BlueprintGraphEdge[]>,
  knownSizes: Map<string, number>,
  lineage: Map<string, string | null>,
  visited: Set<string> = new Set()
): number | undefined {
  if (visited.has(targetSymbol)) {
    return undefined;
  }
  visited.add(targetSymbol);
  const ownerNodeId = extractNodeIdFromSymbol(targetSymbol);
  const incoming = inbound.get(ownerNodeId) ?? [];
  for (const edge of incoming) {
    const toIndex = edge.to.dimensions.findIndex(
      (symbol) => symbol === targetSymbol
    );
    if (toIndex === -1) {
      continue;
    }
    const targetSelector = edge.to.selectors?.[toIndex];
    const sourceSelector = edge.from.selectors?.[toIndex];
    const hasExplicitSelector =
      targetSelector !== undefined || sourceSelector !== undefined;
    if (hasExplicitSelector) {
      if (!targetSelector || !sourceSelector) {
        continue;
      }
      if (targetSelector.kind !== 'loop' || sourceSelector.kind !== 'loop') {
        continue;
      }
      if (targetSelector.offset !== 0 || sourceSelector.offset !== 0) {
        continue;
      }
      if (targetSelector.symbol !== sourceSelector.symbol) {
        continue;
      }
    }
    const fromSymbol = edge.from.dimensions[toIndex];
    if (!fromSymbol) {
      continue;
    }
    const upstreamSize = knownSizes.get(fromSymbol);
    if (upstreamSize !== undefined) {
      return upstreamSize;
    }
    const recursive = deriveDimensionSize(
      fromSymbol,
      inbound,
      knownSizes,
      lineage,
      new Set(visited)
    );
    if (recursive !== undefined) {
      return recursive;
    }
  }
  const parentSymbol = lineage.get(targetSymbol);
  if (parentSymbol) {
    const parentSize = knownSizes.get(parentSymbol);
    if (parentSize !== undefined) {
      return parentSize;
    }
    return deriveDimensionSize(
      parentSymbol,
      inbound,
      knownSizes,
      lineage,
      visited
    );
  }
  return undefined;
}

interface DimensionInfo {
  nodeId: string;
  label: string;
}

function parseDimensionSymbol(symbol: string): DimensionInfo {
  const delimiterIndex = symbol.indexOf('::');
  if (delimiterIndex === -1) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
      `Dimension symbol "${symbol}" is missing a node qualifier.`
    );
  }
  const nodeId = symbol.slice(0, delimiterIndex);
  const label = symbol.slice(delimiterIndex + 2);
  return { nodeId, label };
}

function extractNodeIdFromSymbol(symbol: string): string {
  return parseDimensionSymbol(symbol).nodeId;
}

function expandNodeInstances(
  node: BlueprintGraphNode,
  dimensionSizes: Map<string, number>
): CanonicalNodeInstance[] {
  const dimensionSymbols = node.dimensions;
  const tuples = buildIndexTuples(dimensionSymbols, dimensionSizes);

  return tuples.map((indices) => ({
    id: formatCanonicalNodeId(node, indices),
    type: mapNodeType(node.type),
    producerAlias: formatProducerAliasForNode(node),
    namespacePath: node.namespacePath,
    name: node.name,
    indices,
    dimensions: node.dimensions,
    artifact: node.artifact,
    input: node.input,
    producer: node.producer,
  }));
}

function buildIndexTuples(
  symbols: string[],
  sizes: Map<string, number>
): Record<string, number>[] {
  if (symbols.length === 0) {
    return [{}];
  }
  const tuples: Record<string, number>[] = [];
  function backtrack(index: number, current: Record<string, number>): void {
    if (index >= symbols.length) {
      tuples.push({ ...current });
      return;
    }
    const symbol = symbols[index];
    const size = sizes.get(symbol);
    if (size === undefined) {
      throw createRuntimeError(
        RuntimeErrorCode.MISSING_DIMENSION_SIZE,
        `Missing size for dimension "${symbol}".`
      );
    }
    for (let value = 0; value < size; value += 1) {
      current[symbol] = value;
      backtrack(index + 1, current);
    }
    delete current[symbol];
  }
  backtrack(0, {});
  return tuples;
}

function expandEdges(
  edges: BlueprintGraphEdge[],
  nodeInstances: Map<string, CanonicalNodeInstance[]>
): CanonicalEdgeInstance[] {
  const results: CanonicalEdgeInstance[] = [];
  for (const edge of edges) {
    const fromInstances = nodeInstances.get(edge.from.nodeId) ?? [];
    const toInstances = nodeInstances.get(edge.to.nodeId) ?? [];
    for (const fromNode of fromInstances) {
      for (const toNode of toInstances) {
        if (!edgeInstancesAlign(edge, fromNode, toNode)) {
          continue;
        }
        if (fromNode.id === toNode.id) {
          continue;
        }
        // Merge indices from both nodes for condition resolution
        const mergedIndices = edge.conditions
          ? { ...fromNode.indices, ...toNode.indices }
          : undefined;
        results.push({
          from: fromNode.id,
          to: toNode.id,
          note: edge.note,
          groupBy: edge.groupBy,
          orderBy: edge.orderBy,
          bindingAlias: resolveBindingAlias(edge, fromNode, toNode),
          conditions: edge.conditions,
          indices: mergedIndices,
        });
      }
    }
  }
  return results;
}

function buildFanInCollections(
  nodes: CanonicalNodeInstance[],
  edges: CanonicalEdgeInstance[],
  instancesById: Map<string, CanonicalNodeInstance>
): Record<string, FanInDescriptor> {
  const inbound = new Map<
    string,
    Array<{
      sourceId: string;
      position: number;
      groupBy?: string;
      orderBy?: string;
    }>
  >();

  for (const [position, edge] of edges.entries()) {
    if (!isCanonicalInputId(edge.to)) {
      continue;
    }
    const list = inbound.get(edge.to) ?? [];
    list.push({
      sourceId: edge.from,
      position,
      groupBy: edge.groupBy,
      orderBy: edge.orderBy,
    });
    inbound.set(edge.to, list);
  }

  const fanIn: Record<string, FanInDescriptor> = {};
  for (const node of nodes) {
    if (node.type !== 'Input' || !node.input?.fanIn) {
      continue;
    }

    const targetId = node.id;
    const entries = inbound.get(targetId) ?? [];
    const explicitMeta = resolveExplicitFanInMeta(targetId, entries);

    if (entries.length === 0 && !explicitMeta) {
      continue;
    }

    const inferredMeta = inferFanInMeta(targetId, entries, instancesById);
    const meta = explicitMeta ?? inferredMeta;

    const members = entries.map((entry) => {
      const instance = instancesById.get(entry.sourceId);
      const group = resolveFanInGroup(targetId, meta.groupBy, instance);
      const order = resolveFanInOrder(
        targetId,
        meta.orderBy,
        instance,
        entry.position
      );
      return {
        id: entry.sourceId,
        group,
        order,
      };
    });

    fanIn[targetId] = {
      groupBy: meta.groupBy,
      orderBy: meta.orderBy,
      members,
    };
  }

  return fanIn;
}

function resolveExplicitFanInMeta(
  targetId: string,
  entries: Array<{ groupBy?: string; orderBy?: string; sourceId: string }>
): { groupBy: string; orderBy?: string } | undefined {
  let explicit: { groupBy: string; orderBy?: string } | undefined;
  for (const entry of entries) {
    if (!entry.groupBy && !entry.orderBy) {
      continue;
    }
    if (!entry.groupBy) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Input node ${targetId} has a connection with orderBy but missing groupBy.`
      );
    }
    const candidate = {
      groupBy: entry.groupBy,
      orderBy: entry.orderBy,
    };
    if (!explicit) {
      explicit = candidate;
      continue;
    }
    if (
      explicit.groupBy !== candidate.groupBy ||
      explicit.orderBy !== candidate.orderBy
    ) {
      throw createRuntimeError(
        RuntimeErrorCode.MULTIPLE_UPSTREAM_INPUTS,
        `Input node ${targetId} receives conflicting fan-in metadata across connections.`
      );
    }
  }
  return explicit;
}

function inferFanInMeta(
  targetId: string,
  entries: Array<{ sourceId: string }>,
  instancesById: Map<string, CanonicalNodeInstance>
): { groupBy: string; orderBy?: string } {
  if (entries.length === 0) {
    return { groupBy: 'singleton' };
  }

  const signatures = new Map<string, string[]>();
  for (const entry of entries) {
    const instance = instancesById.get(entry.sourceId);
    if (!instance) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Input node ${targetId} references unknown fan-in source ${entry.sourceId}.`
      );
    }
    const labels = getDimensionLabels(instance);
    signatures.set(labels.join('|'), labels);
  }

  if (signatures.size > 1) {
    const variants = Array.from(signatures.values()).map((labels) =>
      labels.length > 0 ? `[${labels.join(', ')}]` : '[]'
    );
    throw createRuntimeError(
      RuntimeErrorCode.MULTIPLE_UPSTREAM_INPUTS,
      `Input node ${targetId} has mixed upstream dimension signatures (${variants.join(', ')}). Add explicit groupBy/orderBy metadata on the connection(s).`
    );
  }

  const labels = signatures.values().next().value as string[];
  if (labels.length === 0) {
    if (entries.length > 1) {
      const parents = entries.map((entry) => entry.sourceId).join(', ');
      throw createRuntimeError(
        RuntimeErrorCode.MULTIPLE_UPSTREAM_INPUTS,
        `Input node ${targetId} has multiple scalar upstream dependencies (${parents}). Add explicit groupBy metadata on the connection(s).`
      );
    }
    return { groupBy: 'singleton' };
  }

  if (labels.length === 1) {
    return { groupBy: labels[0] };
  }
  if (labels.length === 2) {
    return {
      groupBy: labels[0],
      orderBy: labels[1],
    };
  }

  throw createRuntimeError(
    RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
    `Input node ${targetId} has ${labels.length} upstream dimensions [${labels.join(', ')}]. Add explicit groupBy/orderBy metadata on the connection(s).`
  );
}

function getDimensionLabels(node: CanonicalNodeInstance): string[] {
  const labels: string[] = [];
  for (const symbol of node.dimensions) {
    const label = extractDimensionLabel(symbol);
    if (!labels.includes(label)) {
      labels.push(label);
    }
  }
  return labels;
}

function resolveFanInGroup(
  targetId: string,
  groupBy: string,
  instance: CanonicalNodeInstance | undefined
): number {
  if (groupBy === 'singleton') {
    return 0;
  }
  if (!instance) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
      `Input node ${targetId} is missing fan-in source instance while resolving groupBy "${groupBy}".`
    );
  }
  const index = getDimensionIndex(instance, groupBy);
  if (index === undefined) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
      `Input node ${targetId} groupBy "${groupBy}" does not exist on source ${instance.id}.`
    );
  }
  return index;
}

function resolveFanInOrder(
  targetId: string,
  orderBy: string | undefined,
  instance: CanonicalNodeInstance | undefined,
  fallbackOrder: number
): number {
  if (!orderBy) {
    return fallbackOrder;
  }
  if (!instance) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
      `Input node ${targetId} is missing fan-in source instance while resolving orderBy "${orderBy}".`
    );
  }
  const index = getDimensionIndex(instance, orderBy);
  if (index === undefined) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
      `Input node ${targetId} orderBy "${orderBy}" does not exist on source ${instance.id}.`
    );
  }
  return index;
}

function edgeInstancesAlign(
  edge: BlueprintGraphEdge,
  fromNode: CanonicalNodeInstance,
  toNode: CanonicalNodeInstance
): boolean {
  const fromSymbols = edge.from.dimensions;
  const toSymbols = edge.to.dimensions;
  const fromSelectors = edge.from.selectors;
  const toSelectors = edge.to.selectors;

  const fromEntries = collectAlignmentEntries(
    fromSymbols,
    fromSelectors,
    fromNode
  );
  const toEntries = collectAlignmentEntries(toSymbols, toSelectors, toNode);

  for (const entry of [...fromEntries.values(), ...toEntries.values()]) {
    if (entry.selector?.kind === 'const' && entry.index !== entry.selector.value) {
      return false;
    }
  }

  const sharedReferences = Array.from(fromEntries.keys()).filter((reference) =>
    toEntries.has(reference)
  );
  if (sharedReferences.length === 0) {
    return edgeInstancesAlignByPosition(
      edge,
      fromNode,
      toNode,
      fromSymbols,
      toSymbols,
      fromSelectors,
      toSelectors
    );
  }

  for (const [reference, fromEntry] of fromEntries.entries()) {
    const toEntry = toEntries.get(reference);
    if (!toEntry) {
      continue;
    }

    const fromOffset =
      fromEntry.selector?.kind === 'loop' ? fromEntry.selector.offset : 0;
    const toOffset =
      toEntry.selector?.kind === 'loop' ? toEntry.selector.offset : 0;

    if (fromEntry.index - fromOffset !== toEntry.index - toOffset) {
      return false;
    }
  }

  return true;
}

function edgeInstancesAlignByPosition(
  edge: BlueprintGraphEdge,
  fromNode: CanonicalNodeInstance,
  toNode: CanonicalNodeInstance,
  fromSymbols: string[],
  toSymbols: string[],
  fromSelectors: (DimensionSelector | undefined)[] | undefined,
  toSelectors: (DimensionSelector | undefined)[] | undefined
): boolean {
  const limit = Math.max(fromSymbols.length, toSymbols.length);

  for (let i = 0; i < limit; i += 1) {
    const fromSymbol = fromSymbols[i];
    const toSymbol = toSymbols[i];

    const fromIndex = fromSymbol
      ? getDimensionValue(fromNode.indices, fromSymbol)
      : undefined;
    const toIndex = toSymbol
      ? getDimensionValue(toNode.indices, toSymbol)
      : undefined;

    const fromSelector = fromSymbol ? fromSelectors?.[i] : undefined;
    const toSelector = toSymbol ? toSelectors?.[i] : undefined;

    if (fromIndex === undefined || toIndex === undefined) {
      continue;
    }

    const fromOffset = fromSelector?.kind === 'loop' ? fromSelector.offset : 0;
    const toOffset = toSelector?.kind === 'loop' ? toSelector.offset : 0;

    const fromReference = getSelectorReferenceLabel(fromSymbol, fromSelector);
    const toReference = getSelectorReferenceLabel(toSymbol, toSelector);
    if (
      fromReference !== toReference &&
      edge.to.arraySelectors &&
      edge.to.arraySelectors.length > 0
    ) {
      continue;
    }

    if (fromIndex - fromOffset !== toIndex - toOffset) {
      return false;
    }
  }

  return true;
}

function collectAlignmentEntries(
  symbols: string[],
  selectors: (DimensionSelector | undefined)[] | undefined,
  node: CanonicalNodeInstance
): Map<
  string,
  {
    index: number;
    selector: DimensionSelector | undefined;
  }
> {
  const entries = new Map<
    string,
    {
      index: number;
      selector: DimensionSelector | undefined;
    }
  >();

  for (let i = 0; i < symbols.length; i += 1) {
    const symbol = symbols[i];
    if (!symbol) {
      continue;
    }

    const index = getDimensionValue(node.indices, symbol);
    const selector = selectors?.[i];
    const reference = getSelectorReferenceLabel(symbol, selector);
    if (reference === undefined) {
      continue;
    }

    entries.set(reference, { index, selector });
  }

  return entries;
}

function getSelectorReferenceLabel(
  symbol: string | undefined,
  selector:
    | {
        kind: 'loop';
        symbol: string;
        offset: number;
      }
    | {
        kind: 'const';
        value: number;
      }
    | undefined
): string | undefined {
  if (!symbol) {
    return undefined;
  }
  if (selector?.kind === 'loop') {
    return selector.symbol;
  }
  return extractDimensionLabel(symbol);
}

function resolveBindingAlias(
  edge: BlueprintGraphEdge,
  fromNode: CanonicalNodeInstance,
  toNode: CanonicalNodeInstance
): string | undefined {
  const selectors = edge.to.arraySelectors;
  if (!selectors || selectors.length === 0) {
    return undefined;
  }

  const resolvedIndices = selectors.map((selector) => {
    if (selector.kind === 'const') {
      return selector.value;
    }
    const value = resolveSelectorLoopIndex(selector.symbol, fromNode, toNode);
    const indexed = value + selector.offset;
    if (!Number.isInteger(indexed) || indexed < 0) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Array element selector "${selector.symbol}${selector.offset >= 0 ? `+${selector.offset}` : selector.offset}" on input ${toNode.id} resolved to invalid index ${indexed}.`
      );
    }
    return indexed;
  });

  const suffix = resolvedIndices.map((index) => `[${index}]`).join('');
  return `${toNode.name}${suffix}`;
}

function resolveSelectorLoopIndex(
  label: string,
  fromNode: CanonicalNodeInstance,
  toNode: CanonicalNodeInstance
): number {
  const toValue = getDimensionIndex(toNode, label);
  if (toValue !== undefined) {
    return toValue;
  }
  const fromValue = getDimensionIndex(fromNode, label);
  if (fromValue !== undefined) {
    return fromValue;
  }
  throw createRuntimeError(
    RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
    `Array element selector "${label}" on input ${toNode.id} does not exist on source ${fromNode.id} or target ${toNode.id}.`
  );
}

function getDimensionValue(
  indices: Record<string, number>,
  symbol: string
): number {
  if (!(symbol in indices)) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_DIMENSION_INDEX,
      `Dimension "${symbol}" missing on node instance.`
    );
  }
  return indices[symbol]!;
}

interface CollapseResult {
  edges: CanonicalEdgeInstance[];
  nodes: CanonicalNodeInstance[];
  inputBindings: Record<string, Record<string, string>>;
}

function collapseInputNodes(
  edges: CanonicalEdgeInstance[],
  nodes: CanonicalNodeInstance[]
): CollapseResult {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const inbound = new Map<string, CanonicalEdgeInstance[]>();
  const outbound = new Map<string, CanonicalEdgeInstance[]>();

  for (const edge of edges) {
    const inList = inbound.get(edge.to) ?? [];
    inList.push(edge);
    inbound.set(edge.to, inList);

    const outList = outbound.get(edge.from) ?? [];
    outList.push(edge);
    outbound.set(edge.from, outList);
  }

  const aliasCache = new Map<string, string>();

  function resolveInputAlias(id: string, stack: Set<string>): string {
    if (aliasCache.has(id)) {
      return aliasCache.get(id)!;
    }
    const node = nodeById.get(id);
    if (!node || node.type !== 'Input') {
      aliasCache.set(id, id);
      return id;
    }
    if (node.input?.fanIn) {
      aliasCache.set(id, id);
      return id;
    }
    const inboundEdges = inbound.get(id) ?? [];
    if (inboundEdges.length === 0) {
      aliasCache.set(id, id);
      return id;
    }
    if (inboundEdges.length > 1) {
      const hasDynamicCollectionBindings = inboundEdges.some(
        (edge) => !!edge.bindingAlias
      );
      if (hasDynamicCollectionBindings) {
        aliasCache.set(id, id);
        return id;
      }
      const parents = inboundEdges.map((edge) => edge.from).join(', ');
      throw createRuntimeError(
        RuntimeErrorCode.MULTIPLE_UPSTREAM_INPUTS,
        `Input node ${id} has multiple upstream dependencies (${parents}).`
      );
    }
    const upstreamId = inboundEdges[0].from;
    if (stack.has(upstreamId)) {
      throw createRuntimeError(
        RuntimeErrorCode.ALIAS_CYCLE_DETECTED,
        `Alias cycle detected for ${id}`
      );
    }
    stack.add(upstreamId);
    const upstreamNode = nodeById.get(upstreamId);
    if (!upstreamNode) {
      aliasCache.set(id, upstreamId);
      stack.delete(upstreamId);
      return upstreamId;
    }
    if (upstreamNode.type === 'Input') {
      const resolved = resolveInputAlias(upstreamId, stack);
      aliasCache.set(id, resolved);
      stack.delete(upstreamId);
      return resolved;
    }
    aliasCache.set(id, upstreamId);
    stack.delete(upstreamId);
    return upstreamId;
  }

  const normalizeId = (id: string): string => {
    const node = nodeById.get(id);
    if (node?.type === 'Input') {
      return resolveInputAlias(id, new Set());
    }
    return id;
  };

  const materializeConditionWhenPath = (
    when: string,
    indices: Record<string, number> | undefined
  ): string => {
    if (!indices) {
      return when;
    }

    const indicesByLabel = new Map<string, number>();
    for (const [symbol, index] of Object.entries(indices)) {
      indicesByLabel.set(extractDimensionLabel(symbol), index);
    }

    let materialized = when;
    for (const [label, index] of indicesByLabel.entries()) {
      materialized = materialized.replaceAll(`[${label}]`, `[${index}]`);
    }

    return materialized;
  };

  const normalizeConditionDefinition = (
    condition: EdgeConditionDefinition | undefined,
    indices: Record<string, number> | undefined
  ): EdgeConditionDefinition | undefined => {
    if (!condition) {
      return undefined;
    }
    if (Array.isArray(condition)) {
      return condition.map((item) => normalizeConditionItem(item, indices));
    }
    return normalizeConditionItem(condition, indices);
  };

  const normalizeConditionItem = (
    item: EdgeConditionClause | EdgeConditionGroup,
    indices: Record<string, number> | undefined
  ): EdgeConditionClause | EdgeConditionGroup => {
    if ('when' in item) {
      return normalizeConditionClause(item, indices);
    }
    return {
      ...(item.all
        ? {
            all: item.all.map((clause) => normalizeConditionClause(clause, indices)),
          }
        : {}),
      ...(item.any
        ? {
            any: item.any.map((clause) => normalizeConditionClause(clause, indices)),
          }
        : {}),
    };
  };

  const normalizeConditionClause = (
    clause: EdgeConditionClause,
    indices: Record<string, number> | undefined
  ): EdgeConditionClause => {
    const materializedWhen = materializeConditionWhenPath(clause.when, indices);
    return {
      ...clause,
      when: isCanonicalInputId(materializedWhen)
        ? normalizeId(materializedWhen)
        : materializedWhen,
    };
  };

  const bindingMap = new Map<string, Map<string, string>>();

  function recordBinding(
    targetId: string,
    alias: string,
    canonicalId: string
  ): void {
    if (!alias) {
      return;
    }
    const existing = bindingMap.get(targetId) ?? new Map<string, string>();
    const previous = existing.get(alias);
    if (previous !== undefined && previous !== canonicalId) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_INPUT_BINDING,
        `Conflicting input binding for ${targetId}.${alias}: ${previous} vs ${canonicalId}`
      );
    }
    existing.set(alias, canonicalId);
    bindingMap.set(targetId, existing);
  }

  const propagateAlias = (
    sourceId: string,
    alias: string,
    canonicalId: string,
    visited: Set<string>
  ): void => {
    const outgoing = outbound.get(sourceId) ?? [];
    for (const edge of outgoing) {
      const targetNode = nodeById.get(edge.to);
      if (!targetNode) {
        continue;
      }
      if (targetNode.type === 'Producer') {
        recordBinding(targetNode.id, edge.bindingAlias ?? alias, canonicalId);
        continue;
      }
      if (targetNode.type === 'Input') {
        const key = `${targetNode.id}:${alias}`;
        if (visited.has(key)) {
          continue;
        }
        visited.add(key);
        propagateAlias(targetNode.id, alias, canonicalId, visited);
      }
    }
  };

  // Build a map to propagate conditions from inbound edges to outbound edges
  // when Input nodes are collapsed. Key = input node ID, Value = conditions from inbound edge
  const conditionsFromInbound = new Map<
    string,
    Array<{
      conditions: CanonicalEdgeInstance['conditions'];
      indices: CanonicalEdgeInstance['indices'];
    }>
  >();
  for (const edge of edges) {
    if (edge.conditions) {
      const targetNode = nodeById.get(edge.to);
      if (targetNode?.type === 'Input') {
        const inherited = conditionsFromInbound.get(edge.to) ?? [];
        inherited.push({
          conditions: edge.conditions,
          indices: edge.indices,
        });
        conditionsFromInbound.set(edge.to, inherited);
      }
    }
  }

  const resolvedEdges: CanonicalEdgeInstance[] = [];
  for (const edge of edges) {
    const normalizedFrom = normalizeId(edge.from);
    const normalizedTo = normalizeId(edge.to);
    const targetNode = nodeById.get(edge.to);
    if (targetNode?.type === 'Input' && normalizedTo !== edge.to) {
      continue;
    }
    if (normalizedFrom === normalizedTo) {
      continue;
    }

    // Propagate conditions from collapsed Input nodes
    // When an edge goes FROM an Input node that was collapsed, check if that
    // Input had inbound edges with conditions and propagate them
    let edgeConditions = edge.conditions;
    let edgeIndices = edge.indices;
    if (!edgeConditions) {
      const sourceNode = nodeById.get(edge.from);
      if (sourceNode?.type === 'Input' && normalizedFrom !== edge.from) {
        // The source Input node was collapsed (aliased to something else)
        // Check if it had inbound conditions that should propagate
        const inherited = conditionsFromInbound.get(edge.from);
        if (inherited && inherited.length === 1) {
          edgeConditions = inherited[0]?.conditions;
          edgeIndices = inherited[0]?.indices ?? edgeIndices;
        }
      }
    }

    edgeConditions = normalizeConditionDefinition(edgeConditions, edgeIndices);

    resolvedEdges.push({
      from: normalizedFrom,
      to: normalizedTo,
      note: edge.note,
      groupBy: edge.groupBy,
      orderBy: edge.orderBy,
      bindingAlias: edge.bindingAlias,
      conditions: edgeConditions,
      indices: edgeIndices,
    });
  }

  // Build a map to find element-level Input nodes for each base Input
  // e.g., for base "ReferenceImages", find "ReferenceImages[0]", "ReferenceImages[1]"
  const elementInputsByBase = new Map<string, CanonicalNodeInstance[]>();
  for (const node of nodes) {
    if (node.type !== 'Input') {
      continue;
    }
    // Check if this is an element-level input (e.g., "ReferenceImages[0]")
    const match = node.name.match(/^([A-Za-z_][A-Za-z0-9_]*)(\[\d+\]+)$/);
    if (match) {
      const baseName = match[1];
      const baseKey = `${node.namespacePath.join('.')}:${baseName}`;
      const list = elementInputsByBase.get(baseKey) ?? [];
      list.push(node);
      elementInputsByBase.set(baseKey, list);
    }
  }

  const dynamicBindingsByInput = new Map<
    string,
    Array<{
      alias: string;
      canonicalId: string;
      conditions?: CanonicalEdgeInstance['conditions'];
      indices?: CanonicalEdgeInstance['indices'];
    }>
  >();
  for (const edge of edges) {
    if (!edge.bindingAlias) {
      continue;
    }
    const targetNode = nodeById.get(edge.to);
    if (targetNode?.type !== 'Input') {
      continue;
    }
    const canonicalId = normalizeId(edge.from);
    const list = dynamicBindingsByInput.get(edge.to) ?? [];
    list.push({
      alias: edge.bindingAlias,
      canonicalId,
      conditions: edge.conditions,
      indices: edge.indices,
    });
    dynamicBindingsByInput.set(edge.to, list);
  }

  for (const node of nodes) {
    if (node.type !== 'Input') {
      continue;
    }
    const aliasName = node.name;
    if (!aliasName) {
      continue;
    }
    const canonicalId = resolveInputAlias(node.id, new Set());
    const visited = new Set<string>();
    propagateAlias(node.id, aliasName, canonicalId, visited);

    // If this is a base input with element-level inputs, also propagate those bindings
    // through this node's outbound edges
    // e.g., if "ReferenceImages" connects to Producer, also propagate "ReferenceImages[0]" binding
    const baseKey = `${node.namespacePath.join('.')}:${aliasName}`;
    const elementInputs = elementInputsByBase.get(baseKey);
    if (elementInputs && elementInputs.length > 0) {
      for (const elementNode of elementInputs) {
        if (!nodeMatchesElementInstance(node, elementNode)) {
          continue;
        }
        const elementAlias = elementNode.name;
        const elementCanonicalId = resolveInputAlias(elementNode.id, new Set());
        // Only propagate if the element was aliased to something different (i.e., resolved to an artifact)
        if (elementCanonicalId !== elementNode.id) {
          const elementVisited = new Set<string>();
          propagateAlias(
            node.id,
            elementAlias,
            elementCanonicalId,
            elementVisited
          );

          const inherited = conditionsFromInbound.get(elementNode.id);
          if (inherited && inherited.length === 1) {
            const normalizedConditions = normalizeConditionDefinition(
              inherited[0]?.conditions,
              inherited[0]?.indices
            );
            const outgoing = outbound.get(node.id) ?? [];
            for (const outboundEdge of outgoing) {
              const normalizedTo = normalizeId(outboundEdge.to);
              if (elementCanonicalId === normalizedTo) {
                continue;
              }

              resolvedEdges.push({
                from: elementCanonicalId,
                to: normalizedTo,
                note: outboundEdge.note,
                groupBy: outboundEdge.groupBy,
                orderBy: outboundEdge.orderBy,
                bindingAlias: elementAlias,
                conditions: normalizedConditions,
                indices: inherited[0]?.indices,
              });
            }
          }
        }
      }
    }

    const dynamicBindings = dynamicBindingsByInput.get(node.id);
    if (dynamicBindings && dynamicBindings.length > 0) {
      for (const dynamicBinding of dynamicBindings) {
        propagateAlias(
          node.id,
          dynamicBinding.alias,
          dynamicBinding.canonicalId,
          new Set<string>()
        );

        if (!dynamicBinding.conditions) {
          continue;
        }

        const normalizedConditions = normalizeConditionDefinition(
          dynamicBinding.conditions,
          dynamicBinding.indices
        );
        const outgoing = outbound.get(node.id) ?? [];
        for (const outboundEdge of outgoing) {
          const normalizedTo = normalizeId(outboundEdge.to);
          if (dynamicBinding.canonicalId === normalizedTo) {
            continue;
          }

          resolvedEdges.push({
            from: dynamicBinding.canonicalId,
            to: normalizedTo,
            note: outboundEdge.note,
            groupBy: outboundEdge.groupBy,
            orderBy: outboundEdge.orderBy,
            bindingAlias: dynamicBinding.alias,
            conditions: normalizedConditions,
            indices: dynamicBinding.indices,
          });
        }
      }
    }
  }

  const filteredNodes = nodes.filter((node) => {
    if (node.type !== 'Input') {
      return true;
    }
    const resolved = resolveInputAlias(node.id, new Set());
    return resolved === node.id;
  });

  return {
    edges: resolvedEdges,
    nodes: filteredNodes,
    inputBindings: mapOfMapsToRecord(bindingMap),
  };
}

interface OutputCollapseResult {
  edges: CanonicalEdgeInstance[];
  nodes: CanonicalNodeInstance[];
  outputSources: Record<string, string>;
  outputSourceBindings: CanonicalOutputBinding[];
}

interface ResolvedOutputBinding {
  sourceId: string;
  conditions?: EdgeConditionDefinition;
  indices?: Record<string, number>;
}

function collapseOutputNodes(
  edges: CanonicalEdgeInstance[],
  nodes: CanonicalNodeInstance[]
): OutputCollapseResult {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const inbound = new Map<string, CanonicalEdgeInstance[]>();
  const outbound = new Map<string, CanonicalEdgeInstance[]>();

  for (const edge of edges) {
    const inList = inbound.get(edge.to) ?? [];
    inList.push(edge);
    inbound.set(edge.to, inList);

    const outList = outbound.get(edge.from) ?? [];
    outList.push(edge);
    outbound.set(edge.from, outList);
  }

  const bindingCache = new Map<string, ResolvedOutputBinding>();

  function resolveOutputBinding(
    outputId: string,
    stack: Set<string>
  ): ResolvedOutputBinding {
    const cached = bindingCache.get(outputId);
    if (cached) {
      return cached;
    }

    const outputNode = nodeById.get(outputId);
    if (!outputNode || outputNode.type !== 'Output') {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Output connector "${outputId}" is missing from the canonical node set.`
      );
    }

    const inboundEdges = inbound.get(outputId) ?? [];
    if (inboundEdges.length === 0) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Output connector "${outputId}" is unbound. Every Output must bind to exactly one upstream canonical source.`
      );
    }
    if (inboundEdges.length > 1) {
      const parents = inboundEdges.map((edge) => edge.from).join(', ');
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Output connector "${outputId}" has multiple upstream bindings (${parents}). Output connectors must resolve to exactly one canonical source.`
      );
    }

    const inboundEdge = inboundEdges[0]!;
    if (inboundEdge.groupBy || inboundEdge.orderBy) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Output connector "${outputId}" uses groupBy/orderBy on its inbound binding. Output connectors must be single-source passthrough bindings.`
      );
    }

    const sourceNode = nodeById.get(inboundEdge.from);
    if (!sourceNode) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Output connector "${outputId}" references missing source node "${inboundEdge.from}".`
      );
    }

    if (sourceNode.type === 'Artifact' || sourceNode.type === 'Input') {
      const resolved: ResolvedOutputBinding = {
        sourceId: sourceNode.id,
        conditions: inboundEdge.conditions,
        indices: inboundEdge.indices,
      };
      bindingCache.set(outputId, resolved);
      return resolved;
    }

    if (sourceNode.type !== 'Output') {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Output connector "${outputId}" resolves from "${sourceNode.id}" (${sourceNode.type}). Output connectors must bind only to canonical Inputs, canonical Artifacts, or other Output connectors.`
      );
    }

    if (stack.has(sourceNode.id)) {
      throw createRuntimeError(
        RuntimeErrorCode.ALIAS_CYCLE_DETECTED,
        `Output connector cycle detected while resolving "${outputId}".`
      );
    }

    stack.add(sourceNode.id);
    const upstream = resolveOutputBinding(sourceNode.id, stack);
    stack.delete(sourceNode.id);

    const resolved: ResolvedOutputBinding = {
      sourceId: upstream.sourceId,
      conditions: combineEdgeConditions(upstream.conditions, inboundEdge.conditions),
      indices: mergeConditionIndices(upstream.indices, inboundEdge.indices),
    };
    bindingCache.set(outputId, resolved);
    return resolved;
  }

  const normalizeOutputConditionDefinition = (
    condition: EdgeConditionDefinition | undefined
  ): EdgeConditionDefinition | undefined => {
    if (!condition) {
      return undefined;
    }
    if (Array.isArray(condition)) {
      return condition.map((item) => normalizeOutputConditionItem(item));
    }
    return normalizeOutputConditionItem(condition);
  };

  const normalizeOutputConditionItem = (
    item: EdgeConditionClause | EdgeConditionGroup
  ): EdgeConditionClause | EdgeConditionGroup => {
    if ('when' in item) {
      return normalizeOutputConditionClause(item);
    }
    return {
      ...(item.all
        ? {
            all: item.all.map((clause) => normalizeOutputConditionClause(clause)),
          }
        : {}),
      ...(item.any
        ? {
            any: item.any.map((clause) => normalizeOutputConditionClause(clause)),
          }
        : {}),
    };
  };

  const normalizeOutputConditionClause = (
    clause: EdgeConditionClause
  ): EdgeConditionClause => ({
    ...clause,
    when: isCanonicalOutputId(clause.when)
      ? resolveOutputBinding(clause.when, new Set([clause.when])).sourceId
      : clause.when,
  });

  const resolvedEdges: CanonicalEdgeInstance[] = [];
  for (const edge of edges) {
    const targetNode = nodeById.get(edge.to);
    if (targetNode?.type === 'Output') {
      continue;
    }

    const sourceNode = nodeById.get(edge.from);
    if (sourceNode?.type !== 'Output') {
      resolvedEdges.push(edge);
      continue;
    }

    const resolvedBinding = resolveOutputBinding(edge.from, new Set([edge.from]));
    if (resolvedBinding.sourceId === edge.to) {
      continue;
    }

    resolvedEdges.push({
      ...edge,
      from: resolvedBinding.sourceId,
      conditions: normalizeOutputConditionDefinition(
        combineEdgeConditions(resolvedBinding.conditions, edge.conditions)
      ),
      indices: mergeConditionIndices(resolvedBinding.indices, edge.indices),
    });
  }

  const outputSources: Record<string, string> = {};
  const outputSourceBindings: CanonicalOutputBinding[] = [];
  for (const node of nodes) {
    if (node.type !== 'Output') {
      continue;
    }
    const resolvedBinding = resolveOutputBinding(node.id, new Set([node.id]));
    outputSources[node.id] = resolvedBinding.sourceId;
    outputSourceBindings.push({
      outputId: node.id,
      sourceId: resolvedBinding.sourceId,
      conditions: normalizeOutputConditionDefinition(resolvedBinding.conditions),
      indices: resolvedBinding.indices,
    });
  }

  return {
    edges: dedupeCanonicalEdges(resolvedEdges),
    nodes: nodes.filter((node) => node.type !== 'Output'),
    outputSources,
    outputSourceBindings,
  };
}

function mapNodeType(kind: string): CanonicalNodeInstance['type'] {
  switch (kind) {
    case 'InputSource':
      return 'Input';
    case 'Output':
      return 'Output';
    case 'Artifact':
      return 'Artifact';
    case 'Producer':
      return 'Producer';
    default:
      throw createRuntimeError(
        RuntimeErrorCode.UNKNOWN_NODE_KIND,
        `Unknown node kind ${kind}`
      );
  }
}

function formatCanonicalNodeId(
  node: BlueprintGraphNode,
  indices: Record<string, number>
): string {
  // Check if the node name contains dimension placeholders (e.g., "Segments[segment]")
  // For decomposed artifacts, we need to replace placeholders with indices inline
  const hasPlaceholders = /\[[a-zA-Z_][a-zA-Z0-9_]*\]/.test(node.name);

  if (hasPlaceholders && (node.type === 'Artifact' || node.type === 'Output')) {
    // Replace dimension placeholders with corresponding numeric indices
    let resolvedName = node.name;
    for (const symbol of node.dimensions) {
      if (!(symbol in indices)) {
        throw createRuntimeError(
          RuntimeErrorCode.MISSING_DIMENSION_INDEX,
          `Missing index value for dimension "${symbol}" on node ${node.name}`
        );
      }
      const label = extractDimensionLabel(symbol);
      // Replace [label] with [index]
      resolvedName = resolvedName.replace(
        new RegExp(`\\[${escapeRegex(label)}\\]`, 'g'),
        `[${indices[symbol]}]`
      );
    }
    return node.type === 'Artifact'
      ? formatCanonicalArtifactId(node.namespacePath, resolvedName)
      : formatCanonicalOutputId(node.namespacePath, resolvedName);
  }

  // Standard handling: append indices as suffix
  const baseId =
    node.type === 'InputSource'
      ? formatCanonicalInputId(node.namespacePath, node.name)
      : node.type === 'Output'
        ? formatCanonicalOutputId(node.namespacePath, node.name)
      : node.type === 'Artifact'
        ? formatCanonicalArtifactId(node.namespacePath, node.name)
        : formatCanonicalProducerId(node.namespacePath, node.name);
  const suffix = node.dimensions
    .map((symbol) => {
      if (!(symbol in indices)) {
        throw createRuntimeError(
          RuntimeErrorCode.MISSING_DIMENSION_INDEX,
          `Missing index value for dimension "${symbol}" on node ${baseId}`
        );
      }
      return `[${indices[symbol]}]`;
    })
    .join('');
  return `${baseId}${suffix}`;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function combineEdgeConditions(
  left?: EdgeConditionDefinition,
  right?: EdgeConditionDefinition
): EdgeConditionDefinition | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return [...normalizeConditionList(left), ...normalizeConditionList(right)];
}

function normalizeConditionList(
  condition: EdgeConditionDefinition
): Array<EdgeConditionClause | EdgeConditionGroup> {
  return Array.isArray(condition) ? condition : [condition];
}

function mergeConditionIndices(
  left?: Record<string, number>,
  right?: Record<string, number>
): Record<string, number> | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  const merged: Record<string, number> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = merged[key];
    if (existing !== undefined && existing !== value) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Conflicting condition indices for "${key}" while collapsing output connectors (${existing} vs ${value}).`
      );
    }
    merged[key] = value;
  }
  return merged;
}

function dedupeCanonicalEdges(
  edges: CanonicalEdgeInstance[]
): CanonicalEdgeInstance[] {
  const seen = new Set<string>();
  const deduped: CanonicalEdgeInstance[] = [];

  for (const edge of edges) {
    const key = JSON.stringify({
      from: edge.from,
      to: edge.to,
      note: edge.note,
      groupBy: edge.groupBy,
      orderBy: edge.orderBy,
      bindingAlias: edge.bindingAlias,
      conditions: edge.conditions,
      indices: edge.indices,
    });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(edge);
  }

  return deduped;
}

function mapOfMapsToRecord(
  map: Map<string, Map<string, string>>
): Record<string, Record<string, string>> {
  const record: Record<string, Record<string, string>> = {};
  for (const [key, inner] of map.entries()) {
    record[key] = Object.fromEntries(inner.entries());
  }
  return record;
}

function getDimensionIndex(
  node: CanonicalNodeInstance,
  label: string
): number | undefined {
  for (const symbol of node.dimensions) {
    if (extractDimensionLabel(symbol) === label) {
      return node.indices[symbol];
    }
  }
  return undefined;
}

function nodeMatchesElementInstance(
  baseNode: CanonicalNodeInstance,
  elementNode: CanonicalNodeInstance
): boolean {
  const baseIndices = getIndicesByLabel(baseNode);
  const elementIndices = getIndicesByLabel(elementNode);

  for (const [label, index] of baseIndices.entries()) {
    const elementIndex = elementIndices.get(label);
    if (elementIndex !== undefined && elementIndex !== index) {
      return false;
    }
  }
  return true;
}

function getIndicesByLabel(node: CanonicalNodeInstance): Map<string, number> {
  const indices = new Map<string, number>();
  for (const symbol of node.dimensions) {
    const value = node.indices[symbol];
    if (value === undefined) {
      continue;
    }
    indices.set(extractDimensionLabel(symbol), value);
  }
  return indices;
}

function formatProducerAliasForNode(node: BlueprintGraphNode): string {
  if (node.type === 'Producer') {
    return formatProducerAlias(node.namespacePath, node.name);
  }
  return node.type === 'InputSource'
    ? node.name
    : [...node.namespacePath, node.name].join('.');
}

function extractDimensionLabel(symbol: string): string {
  const parts = symbol.split(':');
  return parts.length > 0 ? (parts[parts.length - 1] ?? symbol) : symbol;
}

/**
 * Finds a loop definition for a given dimension symbol.
 * Searches all parent namespaces (from current to root) to find the loop definition.
 * This handles both namespace and local dimensions.
 */
function findLoopDefinition(
  _symbol: string,
  label: string,
  namespacePath: string[],
  loops: Map<string, BlueprintLoopDefinition[]>
): BlueprintLoopDefinition | undefined {
  // Try progressively shorter namespace paths (from current to root)
  // This handles loops defined in any ancestor namespace
  for (let i = namespacePath.length; i >= 0; i--) {
    const candidatePath = namespacePath.slice(0, i);
    const key = candidatePath.join('.');
    const candidateLoops = loops.get(key);
    if (candidateLoops) {
      const loopDef = candidateLoops.find((loop) => loop.name === label);
      if (loopDef) {
        return loopDef;
      }
    }
  }

  return undefined;
}

/**
 * Finds the namespace path where a loop with the given label is defined.
 * Returns the namespace path for input resolution.
 */
function findLoopNamespacePath(
  label: string,
  namespacePath: string[],
  loops: Map<string, BlueprintLoopDefinition[]>
): string[] {
  // Try progressively shorter namespace paths (from current to root)
  for (let i = namespacePath.length; i >= 0; i--) {
    const candidatePath = namespacePath.slice(0, i);
    const key = candidatePath.join('.');
    const candidateLoops = loops.get(key);
    if (candidateLoops) {
      const loopDef = candidateLoops.find((loop) => loop.name === label);
      if (loopDef) {
        return candidatePath;
      }
    }
  }
  return namespacePath;
}

function readInputValue(
  values: Record<string, unknown>,
  namespacePath: string[],
  name: string,
  inputSources: Map<string, string>
): unknown {
  const canonicalId = formatCanonicalInputId(namespacePath, name);
  const sourceId = inputSources.get(canonicalId);
  if (!sourceId) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_INPUT_SOURCE,
      `Missing input source mapping for "${canonicalId}".`
    );
  }
  if (!(sourceId in values)) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      `Input "${sourceId}" is required but missing a value.`
    );
  }
  return values[sourceId];
}

function readPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_INPUT_VALUE,
      `Input "${field}" must be a finite number.`
    );
  }
  const normalized = Math.trunc(value);
  if (normalized <= 0) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_INPUT_VALUE,
      `Input "${field}" must be greater than zero.`
    );
  }
  return normalized;
}
