import type {
  BlueprintGraphEdge,
  BlueprintGraphNode,
} from './canonical-graph.js';
import type { BlueprintLoopDefinition } from '../types.js';
import { formatCanonicalInputId } from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';

export function resolveDimensionSizes(
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

export function extractDimensionLabel(symbol: string): string {
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
