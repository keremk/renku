/**
 * Blueprint tree to graph conversion wrappers.
 *
 * This module remains as a compatibility layer for existing imports,
 * while delegating all parse projection logic to core.
 */

import type { BlueprintTreeNode } from '@gorenku/core';
import {
  collectNodesAndEdges as collectNodesAndEdgesFromCore,
  convertTreeToGraph as convertTreeToGraphFromCore,
  normalizeProducerName as normalizeProducerNameFromCore,
  resolveEdgeEndpoints as resolveEdgeEndpointsFromCore,
  resolveEndpoint as resolveEndpointFromCore,
} from '@gorenku/core';
import type {
  BlueprintGraphData,
  BlueprintGraphNode,
  BlueprintGraphEdge,
  ConditionDef,
} from '../types.js';
import type { EndpointInfo, EdgeEndpoints } from './types.js';

export function convertTreeToGraph(root: BlueprintTreeNode): BlueprintGraphData {
  return convertTreeToGraphFromCore(root) as BlueprintGraphData;
}

export function collectNodesAndEdges(
  node: BlueprintTreeNode,
  nodes: BlueprintGraphNode[],
  edges: BlueprintGraphEdge[],
  conditions: ConditionDef[]
): void {
  collectNodesAndEdgesFromCore(
    node,
    nodes as unknown as Parameters<typeof collectNodesAndEdgesFromCore>[1],
    edges as unknown as Parameters<typeof collectNodesAndEdgesFromCore>[2],
    conditions as unknown as Parameters<typeof collectNodesAndEdgesFromCore>[3],
  );
}

export function normalizeProducerName(name: string): string {
  return normalizeProducerNameFromCore(name);
}

export function resolveEdgeEndpoints(
  from: string,
  to: string,
  inputNames: Set<string>,
  producerNames: Set<string>,
  artifactNames: Set<string>
): EdgeEndpoints {
  return resolveEdgeEndpointsFromCore(
    from,
    to,
    inputNames,
    producerNames,
    artifactNames
  ) as EdgeEndpoints;
}

export function resolveEndpoint(
  ref: string,
  inputNames: Set<string>,
  producerNames: Set<string>,
  artifactNames: Set<string>
): EndpointInfo {
  return resolveEndpointFromCore(
    ref,
    inputNames,
    producerNames,
    artifactNames
  ) as EndpointInfo;
}
