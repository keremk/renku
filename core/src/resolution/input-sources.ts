import { formatCanonicalInputId, isCanonicalInputId } from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type { BlueprintGraph } from './canonical-graph.js';

export type InputSourceMap = Map<string, string>;

export function buildInputSourceMapFromCanonical(graph: BlueprintGraph): InputSourceMap {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const inboundInputs = new Map<string, Set<string>>();

  for (const edge of graph.edges) {
    const from = nodesById.get(edge.from.nodeId);
    const to = nodesById.get(edge.to.nodeId);
    if (!from || !to) {
      continue;
    }
    if (from.type !== 'InputSource' || to.type !== 'InputSource') {
      continue;
    }
    const existing = inboundInputs.get(to.id) ?? new Set<string>();
    existing.add(from.id);
    inboundInputs.set(to.id, existing);
  }

  const sources: InputSourceMap = new Map();

  for (const node of graph.nodes) {
    if (node.type !== 'InputSource') {
      continue;
    }
    const canonicalId = formatCanonicalInputId(node.namespacePath, node.name);
    if (node.input?.fanIn) {
      sources.set(canonicalId, canonicalId);
      continue;
    }
    const upstream = Array.from(inboundInputs.get(node.id) ?? []);
    if (upstream.length === 0) {
      sources.set(canonicalId, canonicalId);
      continue;
    }
    if (upstream.length > 1) {
      const upstreamNames = upstream
        .map((id) => {
          const upstreamNode = nodesById.get(id);
          return upstreamNode
            ? formatCanonicalInputId(upstreamNode.namespacePath, upstreamNode.name)
            : id;
        })
        .join(', ');
      throw createRuntimeError(
        RuntimeErrorCode.MULTIPLE_UPSTREAM_INPUTS,
        `Input "${canonicalId}" has multiple upstream inputs: ${upstreamNames}.`,
      );
    }
    const upstreamNode = nodesById.get(upstream[0]!);
    if (!upstreamNode || upstreamNode.type !== 'InputSource') {
      throw createRuntimeError(
        RuntimeErrorCode.NON_INPUT_UPSTREAM,
        `Input "${canonicalId}" has a non-input upstream dependency.`,
      );
    }
    const upstreamCanonical = formatCanonicalInputId(upstreamNode.namespacePath, upstreamNode.name);
    sources.set(canonicalId, upstreamCanonical);
  }

  return sources;
}

export function normalizeInputValues(
  values: Record<string, unknown>,
  sources: InputSourceMap,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    if (!isCanonicalInputId(key)) {
      normalized[key] = value;
      continue;
    }
    const sourceId = sources.get(key);
    if (!sourceId) {
      normalized[key] = value;
      continue;
    }
    if (sourceId === key) {
      normalized[sourceId] = value;
      continue;
    }
    if (!(sourceId in normalized)) {
      normalized[sourceId] = value;
    }
  }

  return normalized;
}
