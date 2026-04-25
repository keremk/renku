import type { BlueprintGraphEdge } from './canonical-graph.js';
import type { DimensionSelector } from '../parsing/dimension-selectors.js';
import type {
  EdgeConditionClause,
  EdgeConditionDefinition,
  EdgeConditionGroup,
} from '../types.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type {
  CanonicalEdgeInstance,
  CanonicalNodeInstance,
} from './canonical-blueprint.js';
import { extractDimensionLabel } from './dimension-plan.js';

export function expandEdges(
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
        const mergedIndices = hasGraphEdgeCondition(edge)
          ? { ...fromNode.indices, ...toNode.indices }
          : undefined;
        results.push({
          from: fromNode.id,
          to: toNode.id,
          note: edge.note,
          groupBy: edge.groupBy,
          orderBy: edge.orderBy,
          bindingAlias: resolveBindingAlias(edge, fromNode, toNode),
          ...(edge.activationConditions
            ? { activationConditions: edge.activationConditions }
            : {}),
          ...(edge.endpointConditions
            ? { endpointConditions: edge.endpointConditions }
            : {}),
          ...(edge.authoredEdgeConditions
            ? { authoredEdgeConditions: edge.authoredEdgeConditions }
            : {}),
          ...(edge.conditions ? { conditions: edge.conditions } : {}),
          ...(mergedIndices ? { indices: mergedIndices } : {}),
        });
      }
    }
  }
  return results;
}

function hasGraphEdgeCondition(edge: BlueprintGraphEdge): boolean {
  return Boolean(
    edge.activationConditions ||
      edge.endpointConditions ||
      edge.authoredEdgeConditions ||
      edge.conditions
  );
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
    if (edge.conditions && conditionSelectsEndpointDimensions(edge, fromEntries, toEntries)) {
      return true;
    }
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

function conditionSelectsEndpointDimensions(
  edge: BlueprintGraphEdge,
  fromEntries: Map<
    string,
    {
      index: number;
      selector: DimensionSelector | undefined;
    }
  >,
  toEntries: Map<
    string,
    {
      index: number;
      selector: DimensionSelector | undefined;
    }
  >
): boolean {
  const fromReferences = new Set(fromEntries.keys());
  const toReferences = new Set(toEntries.keys());
  const conditionReferences = collectConditionDimensionReferences(edge.conditions);
  const missingReferences = [
    ...Array.from(fromReferences).filter((reference) => !toReferences.has(reference)),
    ...Array.from(toReferences).filter((reference) => !fromReferences.has(reference)),
  ];

  return (
    missingReferences.length > 0 &&
    missingReferences.every((reference) => conditionReferences.has(reference))
  );
}

function collectConditionDimensionReferences(
  condition: EdgeConditionDefinition | undefined
): Set<string> {
  const references = new Set<string>();
  if (!condition) {
    return references;
  }

  const visitClause = (clause: EdgeConditionClause): void => {
    const matches = clause.when.matchAll(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g);
    for (const match of matches) {
      references.add(match[1]!);
    }
  };

  const visitItem = (item: EdgeConditionClause | EdgeConditionGroup): void => {
    if ('when' in item) {
      visitClause(item);
      return;
    }
    for (const clause of item.all ?? []) {
      visitClause(clause);
    }
    for (const clause of item.any ?? []) {
      visitClause(clause);
    }
  };

  if (Array.isArray(condition)) {
    for (const item of condition) {
      visitItem(item);
    }
    return references;
  }

  visitItem(condition);
  return references;
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

export interface CanonicalEdgeConditionFields {
  activationConditions?: EdgeConditionDefinition;
  endpointConditions?: EdgeConditionDefinition;
  authoredEdgeConditions?: EdgeConditionDefinition;
  conditions?: EdgeConditionDefinition;
  indices?: Record<string, number>;
}

export function canonicalEdgeConditionFields(
  edge: CanonicalEdgeInstance
): CanonicalEdgeConditionFields {
  return {
    ...(edge.activationConditions
      ? { activationConditions: edge.activationConditions }
      : {}),
    ...(edge.endpointConditions
      ? { endpointConditions: edge.endpointConditions }
      : {}),
    ...(edge.authoredEdgeConditions
      ? { authoredEdgeConditions: edge.authoredEdgeConditions }
      : {}),
    ...(edge.conditions ? { conditions: edge.conditions } : {}),
    ...(edge.indices ? { indices: edge.indices } : {}),
  };
}

export function hasCanonicalEdgeCondition(
  fields: CanonicalEdgeConditionFields
): boolean {
  return Boolean(
    fields.activationConditions ||
      fields.endpointConditions ||
      fields.authoredEdgeConditions ||
      fields.conditions
  );
}

export function combineCanonicalEdgeConditionFields(
  left: CanonicalEdgeConditionFields,
  right: CanonicalEdgeConditionFields
): CanonicalEdgeConditionFields {
  const activationConditions = combineEdgeConditions(
    left.activationConditions,
    right.activationConditions
  );
  const endpointConditions = combineEdgeConditions(
    left.endpointConditions,
    right.endpointConditions
  );
  const authoredEdgeConditions = combineEdgeConditions(
    left.authoredEdgeConditions,
    right.authoredEdgeConditions
  );
  const conditions = combineEdgeConditions(left.conditions, right.conditions);
  const indices = mergeConditionIndices(left.indices, right.indices);

  return {
    ...(activationConditions ? { activationConditions } : {}),
    ...(endpointConditions ? { endpointConditions } : {}),
    ...(authoredEdgeConditions ? { authoredEdgeConditions } : {}),
    ...(conditions ? { conditions } : {}),
    ...(indices ? { indices } : {}),
  };
}

export function combineEdgeConditions(
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

export function mergeConditionIndices(
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

export function getDimensionIndex(
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
