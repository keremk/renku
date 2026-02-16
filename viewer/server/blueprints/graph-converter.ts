/**
 * Blueprint tree to graph conversion utilities.
 */

import {
  computeTopologyLayers,
  SYSTEM_INPUTS,
  type BlueprintTreeNode,
  type BlueprintInputDefinition,
  type BlueprintArtefactDefinition,
} from '@gorenku/core';
import type {
  BlueprintGraphData,
  BlueprintGraphNode,
  BlueprintGraphEdge,
  ConditionDef,
  ProducerBinding,
} from '../types.js';
import type { EndpointInfo, EdgeEndpoints } from './types.js';

const SYSTEM_INPUT_NAMES = new Set<string>(Object.values(SYSTEM_INPUTS));

/**
 * Converts a blueprint tree to graph data for visualization.
 */
export function convertTreeToGraph(
  root: BlueprintTreeNode
): BlueprintGraphData {
  const nodes: BlueprintGraphNode[] = [];
  const edges: BlueprintGraphEdge[] = [];
  const conditions: ConditionDef[] = [];

  // Collect all nodes and edges from the tree
  collectNodesAndEdges(root, nodes, edges, conditions);

  // Convert inputs (including synthetic system inputs referenced in edges)
  const declaredInputs = root.document.inputs;
  const declaredInputNames = new Set(declaredInputs.map((input) => input.name));
  const syntheticSystemInputs = collectReferencedSystemInputs(root)
    .filter((inputName) => !declaredInputNames.has(inputName))
    .map((inputName) => createSyntheticSystemInput(inputName));
  const inputs = [...declaredInputs, ...syntheticSystemInputs].map(
    (inp: BlueprintInputDefinition) => ({
      name: inp.name,
      type: inp.type,
      required: inp.required,
      description: inp.description,
      itemType: inp.itemType,
    })
  );

  // Convert outputs (artefacts)
  const outputs = root.document.artefacts.map(
    (art: BlueprintArtefactDefinition) => ({
      name: art.name,
      type: art.type,
      description: art.description,
      itemType: art.itemType,
    })
  );

  // Compute layer assignments for producer nodes using the core topology service
  const producerNodes = nodes.filter((n) => n.type === 'producer');
  const producerEdges = edges
    .filter(
      (e) =>
        e.source.startsWith('Producer:') && e.target.startsWith('Producer:')
    )
    .map((e) => ({
      from: e.source,
      to: e.target,
    }));

  const topologyResult = computeTopologyLayers(producerNodes, producerEdges);

  // Convert Map to Record for JSON serialization
  const layerAssignments: Record<string, number> = {};
  for (const [nodeId, layer] of topologyResult.layerAssignments) {
    layerAssignments[nodeId] = layer;
  }

  return {
    meta: {
      id: root.document.meta.id,
      name: root.document.meta.name,
      description: root.document.meta.description,
      version: root.document.meta.version,
    },
    nodes,
    edges,
    inputs,
    outputs,
    conditions: conditions.length > 0 ? conditions : undefined,
    layerAssignments,
    layerCount: topologyResult.layerCount,
  };
}

/**
 * Collects nodes and edges from a blueprint tree node.
 */
export function collectNodesAndEdges(
  node: BlueprintTreeNode,
  nodes: BlueprintGraphNode[],
  edges: BlueprintGraphEdge[],
  conditions: ConditionDef[]
): void {
  const doc = node.document;

  // Collect names for reference resolution
  const inputNames = new Set(doc.inputs.map((inp) => inp.name));
  for (const systemInputName of collectReferencedSystemInputs(node)) {
    inputNames.add(systemInputName);
  }
  const producerNames = new Set(doc.producerImports.map((p) => p.name));
  const artifactNames = new Set(doc.artefacts.map((a) => a.name));

  // Add single "Inputs" node representing all blueprint inputs
  nodes.push({
    id: 'Inputs',
    type: 'input',
    label: 'Inputs',
    description: `${inputNames.size} input${inputNames.size !== 1 ? 's' : ''}`,
  });

  // Add producer nodes from producer imports
  for (const producerImport of doc.producerImports) {
    nodes.push({
      id: `Producer:${producerImport.name}`,
      type: 'producer',
      label: producerImport.name,
      loop: producerImport.loop,
      producerType: producerImport.producer,
      description: producerImport.description,
      inputBindings: [],
      outputBindings: [],
    });
  }
  const producerNodeById = new Map<string, BlueprintGraphNode>();
  for (const producerNode of nodes) {
    if (producerNode.type === 'producer') {
      producerNodeById.set(producerNode.id, producerNode);
    }
  }

  // Add single "Outputs" node representing all blueprint outputs
  nodes.push({
    id: 'Outputs',
    type: 'output',
    label: 'Outputs',
    description: `${doc.artefacts.length} artifact${doc.artefacts.length !== 1 ? 's' : ''}`,
  });

  // Track which producers have input dependencies and which produce outputs
  const producersWithInputDeps = new Set<string>();
  const producersWithOutputs = new Set<string>();
  const addedEdges = new Set<string>();

  // Process edges to create producer-to-producer connections and detailed producer bindings.
  for (const edge of doc.edges) {
    const isConditional = Boolean(edge.if || edge.conditions);
    const { sourceType, sourceProducer, targetType, targetProducer } =
      resolveEdgeEndpoints(
        edge.from,
        edge.to,
        inputNames,
        producerNames,
        artifactNames
      );
    const edgeBinding: ProducerBinding = {
      from: edge.from,
      to: edge.to,
      sourceType,
      targetType,
      conditionName: edge.if,
      isConditional,
    };

    if (sourceType === 'producer' && sourceProducer) {
      const normalizedSource = normalizeProducerName(sourceProducer);
      const sourceNodeId = `Producer:${normalizedSource}`;
      const sourceNode = producerNodeById.get(sourceNodeId);
      if (sourceNode) {
        if (!sourceNode.outputBindings) {
          throw new Error(
            `Missing outputBindings for producer node: ${sourceNodeId}`
          );
        }
        sourceNode.outputBindings.push(edgeBinding);
      }
    }

    if (targetType === 'producer' && targetProducer) {
      const normalizedTarget = normalizeProducerName(targetProducer);
      const targetNodeId = `Producer:${normalizedTarget}`;
      const targetNode = producerNodeById.get(targetNodeId);
      if (targetNode) {
        if (!targetNode.inputBindings) {
          throw new Error(
            `Missing inputBindings for producer node: ${targetNodeId}`
          );
        }
        targetNode.inputBindings.push(edgeBinding);
      }
    }

    // Input -> Producer: track that this producer has input dependencies
    if (sourceType === 'input' && targetType === 'producer' && targetProducer) {
      producersWithInputDeps.add(targetProducer);
    }

    // Producer -> Output: track that this producer produces outputs
    if (
      sourceType === 'producer' &&
      targetType === 'output' &&
      sourceProducer
    ) {
      producersWithOutputs.add(sourceProducer);
    }

    // Producer -> Producer: create edge between producers
    if (
      sourceType === 'producer' &&
      targetType === 'producer' &&
      sourceProducer &&
      targetProducer
    ) {
      // Normalize loop references like "VideoProducer[segment-1]" to "VideoProducer"
      const normalizedSource = normalizeProducerName(sourceProducer);
      const normalizedTarget = normalizeProducerName(targetProducer);

      // Skip edges where source or target is not an actual producer (e.g., derived values like "Duration")
      if (
        !producerNames.has(normalizedSource) ||
        !producerNames.has(normalizedTarget)
      ) {
        continue;
      }

      // Skip self-loops from loop iteration references (e.g., VideoProducer[segment-1] -> VideoProducer[segment])
      // Instead, we'll show a self-loop indicator on the node
      if (normalizedSource === normalizedTarget) {
        // Mark the producer as having a loop (self-reference)
        const producerNode = nodes.find(
          (n) => n.id === `Producer:${normalizedSource}`
        );
        if (producerNode && !producerNode.loop) {
          producerNode.loop = 'self';
        }
        continue;
      }

      const edgeId = `Producer:${normalizedSource}->Producer:${normalizedTarget}`;
      if (!addedEdges.has(edgeId)) {
        addedEdges.add(edgeId);
        edges.push({
          id: edgeId,
          source: `Producer:${normalizedSource}`,
          target: `Producer:${normalizedTarget}`,
          conditionName: edge.if,
          isConditional,
        });
      }
    }
  }

  // Add edges from Inputs to producers with input dependencies
  for (const producer of producersWithInputDeps) {
    const normalizedProducer = normalizeProducerName(producer);
    const edgeId = `Inputs->Producer:${normalizedProducer}`;
    if (!addedEdges.has(edgeId)) {
      addedEdges.add(edgeId);
      edges.push({
        id: edgeId,
        source: 'Inputs',
        target: `Producer:${normalizedProducer}`,
        isConditional: false,
      });
    }
  }

  // Add edges from producers to Outputs for those that produce artifacts
  for (const producer of producersWithOutputs) {
    const normalizedProducer = normalizeProducerName(producer);
    const edgeId = `Producer:${normalizedProducer}->Outputs`;
    if (!addedEdges.has(edgeId)) {
      addedEdges.add(edgeId);
      edges.push({
        id: edgeId,
        source: `Producer:${normalizedProducer}`,
        target: 'Outputs',
        isConditional: false,
      });
    }
  }

  // Collect named conditions
  if (doc.conditions) {
    for (const [name, def] of Object.entries(doc.conditions)) {
      conditions.push({ name, definition: def });
    }
  }
}

/**
 * Normalizes a producer name by removing loop index suffixes.
 */
export function normalizeProducerName(name: string): string {
  // Remove loop index suffixes like "[segment]", "[segment-1]", "[0]", "[segment][image]"
  return name.replace(/(\[[^\]]+\])+$/, '');
}

/**
 * Resolves edge endpoints to determine source and target types.
 */
export function resolveEdgeEndpoints(
  from: string,
  to: string,
  inputNames: Set<string>,
  producerNames: Set<string>,
  artifactNames: Set<string>
): EdgeEndpoints {
  const source = resolveEndpoint(
    from,
    inputNames,
    producerNames,
    artifactNames
  );
  const target = resolveEndpoint(to, inputNames, producerNames, artifactNames);

  if (source.type === 'unknown') {
    throw new Error(`Unable to resolve edge source endpoint: ${from}`);
  }

  if (target.type === 'unknown') {
    throw new Error(`Unable to resolve edge target endpoint: ${to}`);
  }

  return {
    sourceType: source.type,
    sourceProducer: source.producer,
    targetType: target.type,
    targetProducer: target.producer,
  };
}

/**
 * Resolves a single endpoint reference to determine its type.
 */
export function resolveEndpoint(
  ref: string,
  inputNames: Set<string>,
  producerNames: Set<string>,
  artifactNames: Set<string>
): EndpointInfo {
  const parts = ref.split('.');

  if (parts.length === 1) {
    const name = normalizeProducerName(parts[0]);
    if (inputNames.has(name)) {
      return { type: 'input' };
    }
    if (SYSTEM_INPUT_NAMES.has(name)) {
      return { type: 'input' };
    }
    if (producerNames.has(name)) {
      return { type: 'producer', producer: parts[0] };
    }
    if (artifactNames.has(name)) {
      return { type: 'output' };
    }
    return { type: 'unknown' };
  }

  const first = parts[0];
  if (first === 'Input') {
    return { type: 'input' };
  }
  if (first === 'Output') {
    return { type: 'output' };
  }

  // Producer.Output reference - the source/target is the producer
  const normalizedFirst = normalizeProducerName(first);
  if (producerNames.has(normalizedFirst)) {
    return { type: 'producer', producer: first };
  }

  return { type: 'unknown' };
}

function collectReferencedSystemInputs(root: BlueprintTreeNode): string[] {
  const referenced = new Set<string>();

  for (const edge of root.document.edges) {
    const sourceInput = extractSystemInputName(edge.from);
    if (sourceInput) {
      referenced.add(sourceInput);
    }

    const targetInput = extractSystemInputName(edge.to);
    if (targetInput) {
      referenced.add(targetInput);
    }
  }

  return Array.from(referenced).sort((a, b) => a.localeCompare(b));
}

function extractSystemInputName(reference: string): string | null {
  if (reference.startsWith('Input.')) {
    const remainder = reference.slice('Input.'.length);
    const [nameSegment] = remainder.split('.');
    const name = parseReferenceName(nameSegment);
    if (name && SYSTEM_INPUT_NAMES.has(name)) {
      return name;
    }
    return null;
  }

  if (reference.includes('.')) {
    return null;
  }

  const simpleName = parseReferenceName(reference);
  if (simpleName && SYSTEM_INPUT_NAMES.has(simpleName)) {
    return simpleName;
  }

  return null;
}

function parseReferenceName(reference: string): string | null {
  const match = reference.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  return match ? match[1] : null;
}

function createSyntheticSystemInput(name: string): BlueprintInputDefinition {
  return {
    name,
    type: getSystemInputType(name),
    required: false,
    description: `System input: ${name}`,
  };
}

function getSystemInputType(name: string): string {
  switch (name) {
    case SYSTEM_INPUTS.DURATION:
    case SYSTEM_INPUTS.NUM_OF_SEGMENTS:
    case SYSTEM_INPUTS.SEGMENT_DURATION:
      return 'number';
    case SYSTEM_INPUTS.MOVIE_ID:
    case SYSTEM_INPUTS.STORAGE_ROOT:
    case SYSTEM_INPUTS.STORAGE_BASE_PATH:
      return 'string';
    default:
      throw new Error(`Unsupported system input type mapping: ${name}`);
  }
}
