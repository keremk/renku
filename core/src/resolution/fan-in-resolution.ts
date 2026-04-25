import { isCanonicalInputId } from '../parsing/canonical-ids.js';
import type {
  EdgeConditionDefinition,
  ResolvedFanInDescriptor,
} from '../types.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type {
  CanonicalEdgeInstance,
  CanonicalNodeInstance,
} from './canonical-blueprint.js';
import { extractDimensionLabel } from './dimension-plan.js';
import { getDimensionIndex } from './edge-instantiation.js';

export function buildFanInCollections(
  nodes: CanonicalNodeInstance[],
  edges: CanonicalEdgeInstance[],
  instancesById: Map<string, CanonicalNodeInstance>
): Record<string, ResolvedFanInDescriptor> {
  const inbound = new Map<
    string,
    Array<{
      sourceId: string;
      position: number;
      groupBy?: string;
      orderBy?: string;
      conditions?: EdgeConditionDefinition;
      indices?: Record<string, number>;
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
      ...(edge.conditions ? { conditions: edge.conditions } : {}),
      ...(edge.indices ? { indices: edge.indices } : {}),
    });
    inbound.set(edge.to, list);
  }

  const fanIn: Record<string, ResolvedFanInDescriptor> = {};
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
      if (entry.conditions && !entry.indices) {
        throw createRuntimeError(
          RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
          `Fan-in member ${entry.sourceId} for input node ${targetId} has conditions but no resolved condition indices.`
        );
      }
      return {
        id: entry.sourceId,
        group,
        order,
        ...(entry.conditions && entry.indices
          ? {
              condition: {
                condition: entry.conditions,
                indices: entry.indices,
              },
            }
          : {}),
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
