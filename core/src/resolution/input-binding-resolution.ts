import type {
  EdgeConditionClause,
  EdgeConditionDefinition,
  EdgeConditionGroup,
  ResolvedScalarBinding,
} from '../types.js';
import {
  isCanonicalInputId,
  isCanonicalOutputId,
} from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type {
  CanonicalEdgeInstance,
  CanonicalNodeInstance,
} from './canonical-blueprint.js';
import { extractDimensionLabel } from './dimension-plan.js';
import {
  canonicalEdgeConditionFields,
  combineCanonicalEdgeConditionFields,
  hasCanonicalEdgeCondition,
  type CanonicalEdgeConditionFields,
} from './edge-instantiation.js';

export function normalizeResolvedScalarBindings(
  bindings: Record<string, ResolvedScalarBinding[]>,
  outputSources: Record<string, string>
): Record<string, ResolvedScalarBinding[]> {
  const normalized: Record<string, ResolvedScalarBinding[]> = {};

  for (const [targetId, targetBindings] of Object.entries(bindings)) {
    normalized[targetId] = targetBindings.map((binding) => {
      if (!isCanonicalOutputId(binding.sourceId)) {
        return binding;
      }

      const sourceId = outputSources[binding.sourceId];
      if (!sourceId) {
        throw createRuntimeError(
          RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
          `Resolved scalar binding for ${targetId}.${binding.inputId} references route-selected output ${binding.sourceId}. Bind to a concrete canonical input or artifact, or add explicit route handling before producer graph creation.`
        );
      }

      return {
        ...binding,
        sourceId,
      };
    });
  }

  return normalized;
}

export function normalizeCollapsedInputBindings(
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

interface CollapseResult {
  edges: CanonicalEdgeInstance[];
  nodes: CanonicalNodeInstance[];
  inputBindings: Record<string, Record<string, string>>;
  resolvedScalarBindings: Record<string, ResolvedScalarBinding[]>;
}

export function collapseInputNodes(
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

  const normalizeConditionFields = (
    fields: CanonicalEdgeConditionFields
  ): CanonicalEdgeConditionFields => {
    const activationConditions = normalizeConditionDefinition(
      fields.activationConditions,
      fields.indices
    );
    const endpointConditions = normalizeConditionDefinition(
      fields.endpointConditions,
      fields.indices
    );
    const authoredEdgeConditions = normalizeConditionDefinition(
      fields.authoredEdgeConditions,
      fields.indices
    );
    const conditions = normalizeConditionDefinition(
      fields.conditions,
      fields.indices
    );

    return {
      ...(activationConditions ? { activationConditions } : {}),
      ...(endpointConditions ? { endpointConditions } : {}),
      ...(authoredEdgeConditions ? { authoredEdgeConditions } : {}),
      ...(conditions ? { conditions } : {}),
      ...(fields.indices ? { indices: fields.indices } : {}),
    };
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
  const resolvedScalarBindingMap = new Map<string, ResolvedScalarBinding[]>();

  for (const node of nodes) {
    if (node.type === 'Producer') {
      resolvedScalarBindingMap.set(node.id, []);
    }
  }

  function recordResolvedScalarBinding(
    targetId: string,
    alias: string,
    canonicalId: string,
    inputRequired: boolean,
    conditions: CanonicalEdgeInstance['conditions'],
    indices: CanonicalEdgeInstance['indices']
  ): void {
    if (!alias) {
      return;
    }
    if (conditions && !indices) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
        `Resolved scalar binding for ${targetId}.${alias} has conditions but no resolved condition indices.`
      );
    }

    const bindings = resolvedScalarBindingMap.get(targetId) ?? [];
    const binding: ResolvedScalarBinding = {
      inputId: alias,
      sourceId: canonicalId,
      inputRequired,
      ...(conditions && indices
        ? {
            optionalCondition: {
              condition: conditions,
              indices,
            },
          }
        : {}),
    };
    const duplicate = bindings.some(
      (candidate) =>
        candidate.inputId === binding.inputId &&
        candidate.sourceId === binding.sourceId &&
        JSON.stringify(candidate.optionalCondition) ===
          JSON.stringify(binding.optionalCondition)
    );
    if (duplicate) {
      return;
    }

    bindings.push(binding);
    resolvedScalarBindingMap.set(targetId, bindings);
  }

  function recordBinding(
    targetId: string,
    alias: string,
    canonicalId: string,
    inputRequired: boolean,
    conditions?: CanonicalEdgeInstance['conditions'],
    indices?: CanonicalEdgeInstance['indices']
  ): void {
    if (!alias) {
      return;
    }
    recordResolvedScalarBinding(
      targetId,
      alias,
      canonicalId,
      inputRequired,
      conditions,
      indices
    );
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
    inputRequired: boolean,
    conditionFields: CanonicalEdgeConditionFields,
    visited: Set<string>
  ): void => {
    const outgoing = outbound.get(sourceId) ?? [];
    for (const edge of outgoing) {
      const combinedFields = combineCanonicalEdgeConditionFields(
        conditionFields,
        canonicalEdgeConditionFields(edge)
      );
      const targetNode = nodeById.get(edge.to);
      if (!targetNode) {
        continue;
      }
      if (targetNode.type === 'Producer') {
        const bindingConditions = scalarBindingConditions(combinedFields);
        recordBinding(
          targetNode.id,
          edge.bindingAlias ?? alias,
          canonicalId,
          inputRequired,
          bindingConditions,
          bindingConditions ? combinedFields.indices : undefined
        );
        continue;
      }
      if (targetNode.type === 'Input') {
        const key = `${targetNode.id}:${alias}`;
        if (visited.has(key)) {
          continue;
        }
        visited.add(key);
        propagateAlias(
          targetNode.id,
          alias,
          canonicalId,
          inputRequired,
          combinedFields,
          visited
        );
      }
    }
  };

  function scalarBindingConditions(
    fields: CanonicalEdgeConditionFields
  ): EdgeConditionDefinition | undefined {
    if (fields.authoredEdgeConditions) {
      return fields.authoredEdgeConditions;
    }
    if (fields.activationConditions || fields.endpointConditions) {
      return undefined;
    }
    return fields.conditions;
  }

  // Build a map to propagate conditions from inbound edges to outbound edges
  // when Input nodes are collapsed. Key = input node ID, Value = conditions from inbound edge
  const conditionsFromInbound = new Map<
    string,
    CanonicalEdgeConditionFields[]
  >();
  for (const edge of edges) {
    const conditionFields = canonicalEdgeConditionFields(edge);
    if (hasCanonicalEdgeCondition(conditionFields)) {
      const targetNode = nodeById.get(edge.to);
      if (targetNode?.type === 'Input') {
        const inherited = conditionsFromInbound.get(edge.to) ?? [];
        inherited.push(conditionFields);
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
    let edgeConditionFields = canonicalEdgeConditionFields(edge);
    if (!hasCanonicalEdgeCondition(edgeConditionFields)) {
      const sourceNode = nodeById.get(edge.from);
      if (sourceNode?.type === 'Input' && normalizedFrom !== edge.from) {
        // The source Input node was collapsed (aliased to something else)
        // Check if it had inbound conditions that should propagate
        const inherited = conditionsFromInbound.get(edge.from);
        if (inherited && inherited.length === 1) {
          edgeConditionFields = combineCanonicalEdgeConditionFields(
            edgeConditionFields,
            inherited[0]!
          );
        }
      }
    }

    edgeConditionFields = normalizeConditionFields(edgeConditionFields);

    resolvedEdges.push({
      from: normalizedFrom,
      to: normalizedTo,
      note: edge.note,
      groupBy: edge.groupBy,
      orderBy: edge.orderBy,
      bindingAlias: edge.bindingAlias,
      ...edgeConditionFields,
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
      conditionFields: CanonicalEdgeConditionFields;
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
      conditionFields: canonicalEdgeConditionFields(edge),
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
    propagateAlias(
      node.id,
      aliasName,
      canonicalId,
      requireInputDefinition(node).required,
      {},
      visited
    );

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
            requireInputDefinition(elementNode).required,
            {},
            elementVisited
          );

          const inherited = conditionsFromInbound.get(elementNode.id);
          if (inherited && inherited.length === 1) {
            const inheritedFields = normalizeConditionFields(inherited[0]!);
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
                ...inheritedFields,
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
          requireInputDefinition(node).required,
          dynamicBinding.conditionFields,
          new Set<string>()
        );

        if (!hasCanonicalEdgeCondition(dynamicBinding.conditionFields)) {
          continue;
        }

        const dynamicConditionFields = normalizeConditionFields(
          dynamicBinding.conditionFields
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
            ...dynamicConditionFields,
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
    resolvedScalarBindings: mapOfArraysToRecord(resolvedScalarBindingMap),
  };
}

function mapOfMapsToRecord<T>(
  map: Map<string, Map<string, T>>
): Record<string, Record<string, T>> {
  const record: Record<string, Record<string, T>> = {};
  for (const [key, inner] of map.entries()) {
    record[key] = Object.fromEntries(inner.entries());
  }
  return record;
}

function mapOfArraysToRecord<T>(
  map: Map<string, T[]>
): Record<string, T[]> {
  return Object.fromEntries(map.entries());
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

function requireInputDefinition(
  node: CanonicalNodeInstance
): NonNullable<CanonicalNodeInstance['input']> {
  if (!node.input) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
      `Input node ${node.id} is missing its input definition.`
    );
  }
  return node.input;
}
