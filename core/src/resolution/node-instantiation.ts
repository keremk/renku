import type { BlueprintGraphNode } from './canonical-graph.js';
import type { CanonicalNodeInstance } from './canonical-blueprint.js';
import {
  formatProducerAlias,
  formatCanonicalProducerId,
  formatCanonicalInputId,
  formatCanonicalOutputId,
  formatCanonicalArtifactId,
} from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import { extractDimensionLabel } from './dimension-plan.js';

export function expandNodeInstances(
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
    ...(node.activation
      ? {
          activation: {
            ...node.activation,
            indices,
          },
        }
      : {}),
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

function formatProducerAliasForNode(node: BlueprintGraphNode): string {
  if (node.type === 'Producer') {
    return formatProducerAlias(node.namespacePath, node.name);
  }
  return node.type === 'InputSource'
    ? node.name
    : [...node.namespacePath, node.name].join('.');
}
