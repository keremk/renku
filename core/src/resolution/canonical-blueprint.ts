import type { BlueprintGraph } from './canonical-graph.js';
import type {
  BlueprintOutputDefinition,
  BlueprintInputDefinition,
  EdgeConditionDefinition,
  ProducerConfig,
  FanInDescriptor,
  ConditionalInputBindingCandidate,
  ProducerActivation,
  ResolvedFanInDescriptor,
  ResolvedOutputRoute,
  ResolvedProducerActivation,
  ResolvedScalarBinding,
} from '../types.js';
import { resolveDimensionSizes } from './dimension-plan.js';
import { expandNodeInstances } from './node-instantiation.js';
import { expandEdges } from './edge-instantiation.js';
import {
  collapseInputNodes,
  normalizeCollapsedConditionalInputBindings,
  normalizeCollapsedInputBindings,
  normalizeResolvedScalarBindings,
} from './input-binding-resolution.js';
import { buildFanInCollections } from './fan-in-resolution.js';
import {
  buildResolvedOutputRoutes,
  collapseOutputNodes,
} from './output-route-resolution.js';

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
  activation?: ProducerActivation;
}

export interface CanonicalEdgeInstance {
  from: string;
  to: string;
  note?: string;
  groupBy?: string;
  orderBy?: string;
  /** Input alias override used for dynamic array element bindings. */
  bindingAlias?: string;
  /** Conditions inherited from enclosing producer/import activation. */
  activationConditions?: EdgeConditionDefinition;
  /** Conditions inherited from the imported endpoint referenced by this edge. */
  endpointConditions?: EdgeConditionDefinition;
  /** Conditions authored directly on this edge. */
  authoredEdgeConditions?: EdgeConditionDefinition;
  /**
   * Compatibility: combined legacy view of all condition provenance.
   * TODO(blueprint-condition-simplification Phase 10): remove new callers'
   * dependency on this flattened field.
   */
  conditions?: EdgeConditionDefinition;
  /** The dimension indices for this edge instance (for resolving condition paths) */
  indices?: Record<string, number>;
}

export interface CanonicalOutputBinding {
  outputId: string;
  sourceId: string;
  activationConditions?: EdgeConditionDefinition;
  endpointConditions?: EdgeConditionDefinition;
  authoredEdgeConditions?: EdgeConditionDefinition;
  conditions?: EdgeConditionDefinition;
  indices?: Record<string, number>;
}

export interface CanonicalBlueprint {
  nodes: CanonicalNodeInstance[];
  edges: CanonicalEdgeInstance[];
  inputBindings: Record<string, Record<string, string>>;
  conditionalInputBindings: Record<string, Record<string, ConditionalInputBindingCandidate[]>>;
  outputSources: Record<string, string>;
  outputSourceBindings: CanonicalOutputBinding[];
  fanIn: Record<string, FanInDescriptor>;
  resolvedProducerActivations: Record<string, ResolvedProducerActivation>;
  resolvedScalarBindings: Record<string, ResolvedScalarBinding[]>;
  resolvedFanInDescriptors: Record<string, ResolvedFanInDescriptor>;
  resolvedOutputRoutes: ResolvedOutputRoute[];
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
  const conditionalInputBindings = normalizeCollapsedConditionalInputBindings(
    collapsedInputs.conditionalInputBindings,
    outputSources
  );
  const resolvedScalarBindings = normalizeResolvedScalarBindings(
    collapsedInputs.resolvedScalarBindings,
    outputSources
  );
  const fanIn = buildFanInCollections(nodes, edges, instanceByCanonicalId);
  const resolvedProducerActivations = buildResolvedProducerActivations(nodes);
  const resolvedOutputRoutes = buildResolvedOutputRoutes(outputSourceBindings);

  return {
    nodes,
    edges,
    inputBindings,
    conditionalInputBindings,
    outputSources,
    outputSourceBindings,
    fanIn,
    resolvedProducerActivations,
    resolvedScalarBindings,
    resolvedFanInDescriptors: fanIn,
    resolvedOutputRoutes,
  };
}

function buildResolvedProducerActivations(
  nodes: CanonicalNodeInstance[]
): Record<string, ResolvedProducerActivation> {
  const activations: Record<string, ResolvedProducerActivation> = {};

  for (const node of nodes) {
    if (node.type !== 'Producer') {
      continue;
    }
    activations[node.id] = {
      ...(node.activation?.condition
        ? { condition: node.activation.condition }
        : {}),
      indices: node.indices,
      inheritedFrom: node.activation?.inheritedFrom ?? [],
    };
  }

  return activations;
}
