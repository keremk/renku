import type {
  EdgeConditionClause,
  EdgeConditionDefinition,
  EdgeConditionGroup,
  ResolvedOutputRoute,
} from '../types.js';
import { isCanonicalOutputId } from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type {
  CanonicalEdgeInstance,
  CanonicalNodeInstance,
  CanonicalOutputBinding,
} from './canonical-blueprint.js';
import {
  canonicalEdgeConditionFields,
  combineEdgeConditions,
  mergeConditionIndices,
} from './edge-instantiation.js';

export function buildResolvedOutputRoutes(
  outputSourceBindings: CanonicalOutputBinding[]
): ResolvedOutputRoute[] {
  return outputSourceBindings.map((binding) => ({
    outputId: binding.outputId,
    sourceId: binding.sourceId,
    ...(binding.conditions ? { condition: binding.conditions } : {}),
    ...(binding.indices ? { indices: binding.indices } : {}),
  }));
}

interface OutputCollapseResult {
  edges: CanonicalEdgeInstance[];
  nodes: CanonicalNodeInstance[];
  outputSources: Record<string, string>;
  outputSourceBindings: CanonicalOutputBinding[];
}

interface ResolvedOutputBinding {
  sourceId: string;
  activationConditions?: EdgeConditionDefinition;
  endpointConditions?: EdgeConditionDefinition;
  authoredEdgeConditions?: EdgeConditionDefinition;
  conditions?: EdgeConditionDefinition;
  indices?: Record<string, number>;
}

export function collapseOutputNodes(
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

  const bindingCache = new Map<string, ResolvedOutputBinding[]>();

  function resolveOutputBindings(
    outputId: string,
    stack: Set<string>
  ): ResolvedOutputBinding[] {
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
        `Output connector "${outputId}" is unbound. Every Output must bind to at least one upstream canonical source.`
      );
    }

    const resolved = inboundEdges.flatMap((inboundEdge) => {
      if (inboundEdge.groupBy || inboundEdge.orderBy) {
        throw createRuntimeError(
          RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
          `Output connector "${outputId}" uses groupBy/orderBy on its inbound binding. Output connectors must be passthrough bindings.`
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
        return [{
          sourceId: sourceNode.id,
          ...canonicalEdgeConditionFields(inboundEdge),
        }];
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
      const upstreamBindings = resolveOutputBindings(sourceNode.id, stack);
      stack.delete(sourceNode.id);

      return upstreamBindings.map((upstream) => {
        const activationConditions = combineEdgeConditions(
          upstream.activationConditions,
          inboundEdge.activationConditions
        );
        const endpointConditions = combineEdgeConditions(
          upstream.endpointConditions,
          inboundEdge.endpointConditions
        );
        const authoredEdgeConditions = combineEdgeConditions(
          upstream.authoredEdgeConditions,
          inboundEdge.authoredEdgeConditions
        );
        const conditions = combineEdgeConditions(
          upstream.conditions,
          inboundEdge.conditions
        );
        const indices = mergeConditionIndices(
          upstream.indices,
          inboundEdge.indices
        );
        return {
          sourceId: upstream.sourceId,
          ...(activationConditions ? { activationConditions } : {}),
          ...(endpointConditions ? { endpointConditions } : {}),
          ...(authoredEdgeConditions ? { authoredEdgeConditions } : {}),
          ...(conditions ? { conditions } : {}),
          ...(indices ? { indices } : {}),
        };
      });
    });

    if (
      resolved.length > 1 &&
      resolved.some((binding) => !binding.conditions)
    ) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Output connector "${outputId}" has multiple upstream sources. Every route to a multi-source Output must declare an explicit condition.`
      );
    }

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
      ? resolveSingleOutputBindingForCondition(clause.when).sourceId
      : clause.when,
  });

  const resolveSingleOutputBindingForCondition = (
    outputId: string
  ): ResolvedOutputBinding => {
    const bindings = resolveOutputBindings(outputId, new Set([outputId]));
    if (bindings.length !== 1) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Condition references output connector "${outputId}", but that output has ${bindings.length} upstream sources. Conditions must reference a concrete canonical input or artifact when an output is route-selected.`
      );
    }
    return bindings[0]!;
  };

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

    const resolvedBindings = resolveOutputBindings(edge.from, new Set([edge.from]));
    for (const resolvedBinding of resolvedBindings) {
      if (resolvedBinding.sourceId === edge.to) {
        continue;
      }

      const activationConditions = normalizeOutputConditionDefinition(
        combineEdgeConditions(
          resolvedBinding.activationConditions,
          edge.activationConditions
        )
      );
      const endpointConditions = normalizeOutputConditionDefinition(
        combineEdgeConditions(
          resolvedBinding.endpointConditions,
          edge.endpointConditions
        )
      );
      const authoredEdgeConditions = normalizeOutputConditionDefinition(
        combineEdgeConditions(
          resolvedBinding.authoredEdgeConditions,
          edge.authoredEdgeConditions
        )
      );
      const conditions = normalizeOutputConditionDefinition(
        combineEdgeConditions(resolvedBinding.conditions, edge.conditions)
      );
      const indices = mergeConditionIndices(resolvedBinding.indices, edge.indices);
      resolvedEdges.push({
        to: edge.to,
        note: edge.note,
        groupBy: edge.groupBy,
        orderBy: edge.orderBy,
        bindingAlias: edge.bindingAlias,
        from: resolvedBinding.sourceId,
        ...(activationConditions ? { activationConditions } : {}),
        ...(endpointConditions ? { endpointConditions } : {}),
        ...(authoredEdgeConditions ? { authoredEdgeConditions } : {}),
        ...(conditions ? { conditions } : {}),
        ...(indices ? { indices } : {}),
      });
    }
  }

  const outputSources: Record<string, string> = {};
  const outputSourceBindings: CanonicalOutputBinding[] = [];
  for (const node of nodes) {
    if (node.type !== 'Output') {
      continue;
    }
    const resolvedBindings = resolveOutputBindings(node.id, new Set([node.id]));
    if (resolvedBindings.length === 1) {
      outputSources[node.id] = resolvedBindings[0]!.sourceId;
    }
    for (const resolvedBinding of resolvedBindings) {
      const activationConditions = normalizeOutputConditionDefinition(
        resolvedBinding.activationConditions
      );
      const endpointConditions = normalizeOutputConditionDefinition(
        resolvedBinding.endpointConditions
      );
      const authoredEdgeConditions = normalizeOutputConditionDefinition(
        resolvedBinding.authoredEdgeConditions
      );
      const conditions = normalizeOutputConditionDefinition(
        resolvedBinding.conditions
      );
      outputSourceBindings.push({
        outputId: node.id,
        sourceId: resolvedBinding.sourceId,
        ...(activationConditions ? { activationConditions } : {}),
        ...(endpointConditions ? { endpointConditions } : {}),
        ...(authoredEdgeConditions ? { authoredEdgeConditions } : {}),
        ...(conditions ? { conditions } : {}),
        ...(resolvedBinding.indices ? { indices: resolvedBinding.indices } : {}),
      });
    }
  }

  return {
    edges: dedupeCanonicalEdges(resolvedEdges),
    nodes: nodes.filter((node) => node.type !== 'Output'),
    outputSources,
    outputSourceBindings,
  };
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
      activationConditions: edge.activationConditions,
      endpointConditions: edge.endpointConditions,
      authoredEdgeConditions: edge.authoredEdgeConditions,
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
