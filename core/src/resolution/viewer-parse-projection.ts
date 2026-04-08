import {
  getSystemInputDefinition,
  isSystemInputName,
  type SystemInputName,
} from '../execution/system-inputs.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import {
  parseDimensionSelector,
  type DimensionSelector,
} from '../parsing/dimension-selectors.js';
import { computeTopologyLayers } from '../topology/index.js';
import type {
  BlueprintArtefactDefinition,
  BlueprintInputDefinition,
  BlueprintLoopDefinition,
  BlueprintTreeNode,
} from '../types.js';
import {
  formatParsedGraphReferenceSegment,
  parseGraphReference,
} from './reference-parser.js';

export interface BlueprintParseGraphData {
  meta: {
    id: string;
    name: string;
    description?: string;
    version?: string;
  };
  nodes: BlueprintParseGraphNode[];
  edges: BlueprintParseGraphEdge[];
  inputs: BlueprintParseInputDef[];
  outputs: BlueprintParseOutputDef[];
  conditions?: BlueprintParseConditionDef[];
  layerAssignments?: Record<string, number>;
  layerCount?: number;
  loopGroups?: BlueprintLoopGroup[];
  managedCountInputs?: string[];
}

export interface BlueprintParseGraphNode {
  id: string;
  type: 'input' | 'producer' | 'output';
  label: string;
  loop?: string;
  producerType?: string;
  description?: string;
  inputBindings?: ProducerBinding[];
  outputBindings?: ProducerBinding[];
}

export interface BlueprintParseGraphEdge {
  id: string;
  source: string;
  target: string;
  conditionName?: string;
  isConditional?: boolean;
}

export type SystemInputKind = 'user' | 'derived' | 'runtime';

export interface BlueprintParseInputDef {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  itemType?: string;
  countInput?: string;
  system?: {
    kind: SystemInputKind;
    userSupplied: boolean;
    source: 'declared' | 'synthetic';
  };
}

export interface BlueprintParseOutputDef {
  name: string;
  type: string;
  description?: string;
  itemType?: string;
}

export interface BlueprintParseConditionDef {
  name: string;
  definition: unknown;
}

export type BindingEndpointType = 'input' | 'producer' | 'output' | 'unknown';

export type BindingSelector =
  | {
      kind: 'loop';
      raw: string;
      symbol: string;
      offset: number;
    }
  | {
      kind: 'const';
      raw: string;
      value: number;
    };

export interface BindingEndpointSegment {
  name: string;
  selectors: BindingSelector[];
}

export interface ProducerBindingEndpoint {
  kind: Exclude<BindingEndpointType, 'unknown'>;
  reference: string;
  producerName?: string;
  inputName?: string;
  outputName?: string;
  segments: BindingEndpointSegment[];
  loopSelectors: Array<Extract<BindingSelector, { kind: 'loop' }>>;
  constantSelectors: Array<Extract<BindingSelector, { kind: 'const' }>>;
  collectionSelectors: Array<{
    segment: string;
    segmentIndex: number;
    selector: BindingSelector;
  }>;
}

export interface ProducerBinding {
  from: string;
  to: string;
  sourceType: BindingEndpointType;
  targetType: BindingEndpointType;
  sourceEndpoint: ProducerBindingEndpoint;
  targetEndpoint: ProducerBindingEndpoint;
  conditionName?: string;
  isConditional: boolean;
}

export interface BlueprintLoopGroupMember {
  inputName: string;
}

export interface BlueprintLoopGroup {
  groupId: string;
  primaryDimension: string;
  countInput: string;
  countInputOffset: number;
  members: BlueprintLoopGroupMember[];
}

interface EndpointInfo {
  type: BindingEndpointType;
  producer?: string;
}

interface EdgeEndpoints {
  sourceType: BindingEndpointType;
  sourceProducer?: string;
  targetType: BindingEndpointType;
  targetProducer?: string;
}

/**
 * Builds the viewer parse payload from a blueprint tree.
 */
export function buildBlueprintParseGraphProjection(
  root: BlueprintTreeNode
): BlueprintParseGraphData {
  const nodes: BlueprintParseGraphNode[] = [];
  const edges: BlueprintParseGraphEdge[] = [];
  const conditions: BlueprintParseConditionDef[] = [];

  collectNodesAndEdges(root, nodes, edges, conditions);

  const declaredInputs = root.document.inputs;
  const declaredInputNames = new Set(declaredInputs.map((input) => input.name));
  const syntheticSystemInputs = collectReferencedSystemInputs(root)
    .filter((inputName) => !declaredInputNames.has(inputName))
    .map((inputName) => createSyntheticSystemInput(inputName));
  const inputs = [
    ...declaredInputs.map((input) => toGraphInputDefinition(input, 'declared')),
    ...syntheticSystemInputs.map((input) =>
      toGraphInputDefinition(input, 'synthetic')
    ),
  ];

  const outputs = root.document.artefacts.map(
    (artifact: BlueprintArtefactDefinition) => ({
      name: artifact.name,
      type: artifact.type,
      description: artifact.description,
      itemType: artifact.itemType,
    })
  );

  const producerNodes = nodes.filter((node) => node.type === 'producer');
  const producerEdges = edges
    .filter(
      (edge) =>
        edge.source.startsWith('Producer:') && edge.target.startsWith('Producer:')
    )
    .map((edge) => ({
      from: edge.source,
      to: edge.target,
    }));

  const topology = computeTopologyLayers(producerNodes, producerEdges);
  const layerAssignments: Record<string, number> = {};
  for (const [nodeId, layer] of topology.layerAssignments) {
    layerAssignments[nodeId] = layer;
  }

  const { loopGroups, managedCountInputs } = deriveLoopGroups({
    loops: root.document.loops ?? [],
    producerNodes,
    inputDefs: inputs,
  });

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
    layerCount: topology.layerCount,
    loopGroups: loopGroups.length > 0 ? loopGroups : undefined,
    managedCountInputs:
      managedCountInputs.length > 0 ? managedCountInputs : undefined,
  };
}

/**
 * Backward-compatible alias for the previous viewer graph converter name.
 */
export function convertTreeToGraph(
  root: BlueprintTreeNode
): BlueprintParseGraphData {
  return buildBlueprintParseGraphProjection(root);
}

export function collectNodesAndEdges(
  node: BlueprintTreeNode,
  nodes: BlueprintParseGraphNode[],
  edges: BlueprintParseGraphEdge[],
  conditions: BlueprintParseConditionDef[]
): void {
  const doc = node.document;

  const inputNames = new Set(doc.inputs.map((input) => input.name));
  for (const systemInputName of collectReferencedSystemInputs(node)) {
    inputNames.add(systemInputName);
  }
  const producerNames = new Set(doc.producerImports.map((producer) => producer.name));
  const artifactNames = new Set(doc.artefacts.map((artifact) => artifact.name));

  nodes.push({
    id: 'Inputs',
    type: 'input',
    label: 'Inputs',
    description: `${inputNames.size} input${inputNames.size !== 1 ? 's' : ''}`,
  });

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

  const producerNodeById = new Map<string, BlueprintParseGraphNode>();
  for (const producerNode of nodes) {
    if (producerNode.type === 'producer') {
      producerNodeById.set(producerNode.id, producerNode);
    }
  }

  nodes.push({
    id: 'Outputs',
    type: 'output',
    label: 'Outputs',
    description: `${doc.artefacts.length} artifact${doc.artefacts.length !== 1 ? 's' : ''}`,
  });

  const producersWithInputDeps = new Set<string>();
  const producersWithOutputs = new Set<string>();
  const addedEdges = new Set<string>();

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

    if (sourceType === 'unknown' || targetType === 'unknown') {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_BUILD_ERROR,
        `Unable to resolve edge endpoints for "${edge.from}" -> "${edge.to}".`
      );
    }

    const edgeBinding: ProducerBinding = {
      from: edge.from,
      to: edge.to,
      sourceType,
      targetType,
      sourceEndpoint: parseBindingEndpoint(edge.from, sourceType, 'source'),
      targetEndpoint: parseBindingEndpoint(edge.to, targetType, 'target'),
      conditionName: edge.if,
      isConditional,
    };

    if (sourceType === 'producer' && sourceProducer) {
      const normalizedSource = normalizeProducerName(sourceProducer);
      const sourceNodeId = `Producer:${normalizedSource}`;
      const sourceNode = producerNodeById.get(sourceNodeId);
      if (sourceNode) {
        if (!sourceNode.outputBindings) {
          throw createRuntimeError(
            RuntimeErrorCode.GRAPH_BUILD_ERROR,
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
          throw createRuntimeError(
            RuntimeErrorCode.GRAPH_BUILD_ERROR,
            `Missing inputBindings for producer node: ${targetNodeId}`
          );
        }
        targetNode.inputBindings.push(edgeBinding);
      }
    }

    if (sourceType === 'input' && targetType === 'producer' && targetProducer) {
      producersWithInputDeps.add(targetProducer);
    }

    if (sourceType === 'producer' && targetType === 'output' && sourceProducer) {
      producersWithOutputs.add(sourceProducer);
    }

    if (
      sourceType === 'producer' &&
      targetType === 'producer' &&
      sourceProducer &&
      targetProducer
    ) {
      const normalizedSource = normalizeProducerName(sourceProducer);
      const normalizedTarget = normalizeProducerName(targetProducer);

      if (
        !producerNames.has(normalizedSource) ||
        !producerNames.has(normalizedTarget)
      ) {
        continue;
      }

      if (normalizedSource === normalizedTarget) {
        const producerNode = nodes.find(
          (candidate) => candidate.id === `Producer:${normalizedSource}`
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

  if (doc.conditions) {
    for (const [name, definition] of Object.entries(doc.conditions)) {
      conditions.push({ name, definition });
    }
  }
}

/**
 * Normalizes producer IDs by removing trailing selector groups.
 */
export function normalizeProducerName(name: string): string {
  return name.replace(/(\[[^\]]+\])+$/, '');
}

export function resolveEdgeEndpoints(
  from: string,
  to: string,
  inputNames: Set<string>,
  producerNames: Set<string>,
  artifactNames: Set<string>
): EdgeEndpoints {
  const source = resolveEndpoint(from, inputNames, producerNames, artifactNames);
  const target = resolveEndpoint(to, inputNames, producerNames, artifactNames);

  if (source.type === 'unknown') {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_BUILD_ERROR,
      `Unable to resolve edge source endpoint: ${from}`
    );
  }

  if (target.type === 'unknown') {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_BUILD_ERROR,
      `Unable to resolve edge target endpoint: ${to}`
    );
  }

  return {
    sourceType: source.type,
    sourceProducer: source.producer,
    targetType: target.type,
    targetProducer: target.producer,
  };
}

export function resolveEndpoint(
  ref: string,
  inputNames: Set<string>,
  producerNames: Set<string>,
  artifactNames: Set<string>
): EndpointInfo {
  if (ref.startsWith('Input.')) {
    return { type: 'input' };
  }
  if (ref.startsWith('Output.')) {
    return { type: 'output' };
  }

  const parsed = parseGraphReference(ref);
  const segments = [...parsed.namespaceSegments, parsed.node];
  const firstSegment = segments[0];
  if (!firstSegment) {
    return { type: 'unknown' };
  }

  const firstSegmentRaw = formatParsedGraphReferenceSegment(firstSegment);
  const normalizedName = normalizeProducerName(firstSegment.name);

  if (inputNames.has(normalizedName) || isSystemInputName(normalizedName)) {
    return { type: 'input' };
  }
  if (producerNames.has(normalizedName)) {
    return { type: 'producer', producer: firstSegmentRaw };
  }
  if (artifactNames.has(normalizedName)) {
    return { type: 'output' };
  }

  return { type: 'unknown' };
}

function toGraphInputDefinition(
  input: BlueprintInputDefinition,
  source: 'declared' | 'synthetic'
): BlueprintParseInputDef {
  const system = buildSystemInputMeta(input.name, source);
  return {
    name: input.name,
    type: input.type,
    required: input.required,
    description: input.description,
    itemType: input.itemType,
    countInput: input.countInput,
    ...(system ? { system } : {}),
  };
}

function buildSystemInputMeta(
  name: string,
  source: 'declared' | 'synthetic'
): BlueprintParseInputDef['system'] | undefined {
  if (!isSystemInputName(name)) {
    return undefined;
  }
  const definition = getSystemInputDefinition(name);
  return {
    kind: definition.kind,
    userSupplied: definition.userSupplied,
    source,
  };
}

function collectReferencedSystemInputs(root: BlueprintTreeNode): SystemInputName[] {
  const referenced = new Set<SystemInputName>();

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

  for (const loop of root.document.loops ?? []) {
    const loopCountInput = parseReferenceName(loop.countInput);
    if (loopCountInput && isSystemInputName(loopCountInput)) {
      referenced.add(loopCountInput);
    }
  }

  for (const artifact of root.document.artefacts) {
    if (!artifact.countInput) {
      continue;
    }
    const artifactCountInput = parseReferenceName(artifact.countInput);
    if (artifactCountInput && isSystemInputName(artifactCountInput)) {
      referenced.add(artifactCountInput);
    }
  }

  for (const input of root.document.inputs) {
    if (!input.countInput) {
      continue;
    }
    const inputCountInput = parseReferenceName(input.countInput);
    if (inputCountInput && isSystemInputName(inputCountInput)) {
      referenced.add(inputCountInput);
    }
  }

  return Array.from(referenced).sort((a, b) => a.localeCompare(b));
}

function extractSystemInputName(reference: string): SystemInputName | null {
  if (reference.startsWith('Input.')) {
    const parsed = parseGraphReference(reference.slice('Input.'.length));
    const segments = [...parsed.namespaceSegments, parsed.node];
    const first = segments[0];
    if (!first) {
      return null;
    }
    if (isSystemInputName(first.name)) {
      return first.name;
    }
    return null;
  }

  const parsed = parseGraphReference(reference);
  if (parsed.namespaceSegments.length > 0) {
    return null;
  }

  if (isSystemInputName(parsed.node.name)) {
    return parsed.node.name;
  }

  return null;
}

function parseReferenceName(reference: string): string | null {
  const parsed = parseGraphReference(reference);
  const firstSegment = [...parsed.namespaceSegments, parsed.node][0];
  return firstSegment?.name ?? null;
}

function createSyntheticSystemInput(
  name: SystemInputName
): BlueprintInputDefinition {
  const definition = getSystemInputDefinition(name);
  return {
    name,
    type: definition.type,
    required: false,
    description: definition.description,
  };
}

function parseBindingEndpoint(
  reference: string,
  endpointType: Exclude<BindingEndpointType, 'unknown'>,
  role: 'source' | 'target'
): ProducerBindingEndpoint {
  const normalizedReference = stripEndpointPrefix(reference, endpointType);
  const parsed = parseGraphReference(normalizedReference);
  const parsedSegments = [...parsed.namespaceSegments, parsed.node];
  const segments = parsedSegments.map((segment) => ({
    name: segment.name,
    selectors: segment.dimensions.map((dimension) =>
      parseBindingSelector(dimension, reference)
    ),
  }));

  if (segments.length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_BUILD_ERROR,
      `Unable to parse binding endpoint metadata for "${reference}".`
    );
  }

  const anchorSegmentIndex = 0;
  const anchorSegment = segments[anchorSegmentIndex];
  if (!anchorSegment) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_BUILD_ERROR,
      `Missing anchor segment while parsing binding endpoint "${reference}".`
    );
  }

  const loopSelectors = anchorSegment.selectors.filter(
    (selector): selector is Extract<BindingSelector, { kind: 'loop' }> =>
      selector.kind === 'loop'
  );
  const constantSelectors = anchorSegment.selectors.filter(
    (selector): selector is Extract<BindingSelector, { kind: 'const' }> =>
      selector.kind === 'const'
  );
  const collectionSelectors: ProducerBindingEndpoint['collectionSelectors'] = [];
  for (let index = anchorSegmentIndex + 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) {
      continue;
    }
    for (const selector of segment.selectors) {
      collectionSelectors.push({
        segment: segment.name,
        segmentIndex: index,
        selector,
      });
    }
  }

  if (endpointType === 'input') {
    return {
      kind: 'input',
      reference,
      inputName: anchorSegment.name,
      segments,
      loopSelectors,
      constantSelectors,
      collectionSelectors,
    };
  }

  if (endpointType === 'output') {
    return {
      kind: 'output',
      reference,
      outputName: anchorSegment.name,
      segments,
      loopSelectors,
      constantSelectors,
      collectionSelectors,
    };
  }

  const producerName = normalizeProducerName(anchorSegment.name);
  const linkedName = segments[1]?.name;

  return {
    kind: 'producer',
    reference,
    producerName,
    inputName: role === 'target' ? linkedName : undefined,
    outputName: role === 'source' ? linkedName : undefined,
    segments,
    loopSelectors,
    constantSelectors,
    collectionSelectors,
  };
}

function stripEndpointPrefix(
  reference: string,
  endpointType: Exclude<BindingEndpointType, 'unknown'>
): string {
  if (endpointType === 'input' && reference.startsWith('Input.')) {
    return reference.slice('Input.'.length);
  }
  if (endpointType === 'output' && reference.startsWith('Output.')) {
    return reference.slice('Output.'.length);
  }
  return reference;
}

function parseBindingSelector(
  selector: string,
  reference: string
): BindingSelector {
  let parsed: DimensionSelector;
  try {
    parsed = parseDimensionSelector(selector);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_DIMENSION_SELECTOR,
      `Invalid selector "${selector}" in binding endpoint "${reference}": ${message}`
    );
  }

  if (parsed.kind === 'const') {
    return {
      kind: 'const',
      raw: selector,
      value: parsed.value,
    };
  }

  return {
    kind: 'loop',
    raw: selector,
    symbol: parsed.symbol,
    offset: parsed.offset,
  };
}

function deriveLoopGroups(args: {
  loops: BlueprintLoopDefinition[];
  producerNodes: BlueprintParseGraphNode[];
  inputDefs: BlueprintParseInputDef[];
}): { loopGroups: BlueprintLoopGroup[]; managedCountInputs: string[] } {
  const loopByName = new Map<string, BlueprintLoopDefinition>();
  for (const loop of args.loops) {
    loopByName.set(loop.name, loop);
  }

  const inputDefsByName = new Map(args.inputDefs.map((input) => [input.name, input]));
  const groups = new Map<
    string,
    {
      groupId: string;
      primaryDimension: string;
      countInput: string;
      countInputOffset: number;
      members: Set<string>;
    }
  >();
  const memberGroupIndex = new Map<string, string>();

  const addInputToGroup = (args: {
    inputName: string;
    countInput: string;
    countInputOffset?: number;
    primaryDimension?: string;
    sourceContext: string;
  }): void => {
    const countInputDef = inputDefsByName.get(args.countInput);
    if (!countInputDef) {
      throw createRuntimeError(
        RuntimeErrorCode.LOOP_GROUP_DERIVATION_ERROR,
        `Cannot derive loop input group from ${args.sourceContext}. Count input "${args.countInput}" is missing from parse input definitions.`
      );
    }

    const existingGroup = groups.get(args.countInput);
    const resolvedOffset =
      args.countInputOffset ?? existingGroup?.countInputOffset ?? 0;

    if (
      existingGroup &&
      existingGroup.countInputOffset !== resolvedOffset
    ) {
      throw createRuntimeError(
        RuntimeErrorCode.LOOP_GROUP_DERIVATION_ERROR,
        `Cannot derive loop input group for "${args.inputName}" from ${args.sourceContext}. Count input "${args.countInput}" maps to conflicting offsets (${existingGroup.countInputOffset} and ${resolvedOffset}).`
      );
    }

    const groupId = existingGroup?.groupId ?? `LoopGroup:${args.countInput}:${resolvedOffset}`;
    const nextPrimaryDimension =
      args.primaryDimension ?? existingGroup?.primaryDimension ?? args.countInput;
    const group = existingGroup ?? {
      groupId,
      primaryDimension: nextPrimaryDimension,
      countInput: args.countInput,
      countInputOffset: resolvedOffset,
      members: new Set<string>(),
    };

    if (
      args.primaryDimension &&
      group.primaryDimension === group.countInput
    ) {
      group.primaryDimension = args.primaryDimension;
    }

    const previousGroupId = memberGroupIndex.get(args.inputName);
    if (previousGroupId && previousGroupId !== groupId) {
      throw createRuntimeError(
        RuntimeErrorCode.LOOP_GROUP_AMBIGUOUS_INPUT,
        `Input "${args.inputName}" maps to multiple loop groups ("${previousGroupId}" and "${groupId}"). Resolve blueprint loop bindings so each input maps to one primary loop group.`
      );
    }

    memberGroupIndex.set(args.inputName, groupId);
    group.members.add(args.inputName);
    groups.set(args.countInput, group);
  };

  for (const producerNode of args.producerNodes) {
    const bindings = producerNode.inputBindings ?? [];
    for (const binding of bindings) {
      if (
        binding.sourceEndpoint.kind !== 'input' ||
        binding.targetEndpoint.kind !== 'producer'
      ) {
        continue;
      }

      const primarySelector = binding.sourceEndpoint.loopSelectors[0];
      if (!primarySelector) {
        continue;
      }

      const loopDefinition = loopByName.get(primarySelector.symbol);
      if (!loopDefinition) {
        throw createRuntimeError(
          RuntimeErrorCode.LOOP_GROUP_MISSING_LOOP_DEFINITION,
          `Cannot derive loop input group for binding "${binding.from}" -> "${binding.to}". Loop "${primarySelector.symbol}" is not declared in blueprint loops metadata.`
        );
      }

      const inputName = binding.sourceEndpoint.inputName;
      if (!inputName) {
        throw createRuntimeError(
          RuntimeErrorCode.LOOP_GROUP_DERIVATION_ERROR,
          `Cannot derive loop input group for binding "${binding.from}" -> "${binding.to}". Source endpoint input name is missing.`
        );
      }

      const inputDef = inputDefsByName.get(inputName);
      if (!inputDef) {
        throw createRuntimeError(
          RuntimeErrorCode.LOOP_GROUP_DERIVATION_ERROR,
          `Cannot derive loop input group for "${inputName}" because it is missing from parse input definitions.`
        );
      }

      if (inputDef.type !== 'array') {
        throw createRuntimeError(
          RuntimeErrorCode.LOOP_GROUP_INVALID_INPUT,
          `Input "${inputName}" is loop-indexed in binding "${binding.from}" -> "${binding.to}" but is declared as "${inputDef.type}". Looped grouped inputs must use array type.`
        );
      }

      addInputToGroup({
        inputName,
        countInput: loopDefinition.countInput,
        countInputOffset: loopDefinition.countInputOffset ?? 0,
        primaryDimension: primarySelector.symbol,
        sourceContext: `binding "${binding.from}" -> "${binding.to}"`,
      });
    }
  }

  for (const inputDef of args.inputDefs) {
    if (!inputDef.countInput) {
      continue;
    }
    if (inputDef.type !== 'array') {
      throw createRuntimeError(
        RuntimeErrorCode.LOOP_GROUP_INVALID_INPUT,
        `Input "${inputDef.name}" declares countInput "${inputDef.countInput}" but is declared as "${inputDef.type}". Count-managed grouped inputs must use array type.`
      );
    }

    addInputToGroup({
      inputName: inputDef.name,
      countInput: inputDef.countInput,
      sourceContext: `input definition "${inputDef.name}"`,
    });
  }

  const loopGroups = Array.from(groups.values())
    .map((group) => ({
      groupId: group.groupId,
      primaryDimension: group.primaryDimension,
      countInput: group.countInput,
      countInputOffset: group.countInputOffset,
      members: Array.from(group.members)
        .sort((a, b) => a.localeCompare(b))
        .map((inputName) => ({ inputName })),
    }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId));

  const managedCountInputs = Array.from(
    new Set(loopGroups.map((group) => group.countInput))
  ).sort((a, b) => a.localeCompare(b));

  return { loopGroups, managedCountInputs };
}
