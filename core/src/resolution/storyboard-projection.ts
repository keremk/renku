import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import { evaluateCondition } from '../condition-evaluator.js';
import {
  canonicalProducerIdToAlias,
  canonicalProducerInstanceIdToProducerId,
  formatCanonicalProducerId,
  parseCanonicalArtifactId,
} from '../parsing/canonical-ids.js';
import type { BlueprintOutputDefinition, BlueprintTreeNode } from '../types.js';
import { buildBlueprintGraph, type BlueprintGraphNode } from './canonical-graph.js';
import { decomposeJsonSchema } from './schema-decomposition.js';
import {
  selectBlueprintResolutionInputs,
  type BlueprintResolutionContext,
  type ExpandedBlueprintResolution,
} from './blueprint-resolution-context.js';
import { collectPublishedArtifactIds } from './output-publication.js';
import type {
  CanonicalEdgeInstance,
  CanonicalNodeInstance,
} from './canonical-expander.js';
import { expandBlueprintGraph } from './canonical-expander.js';
import { buildInputSourceMapFromCanonical } from './input-sources.js';

export interface StoryboardArtifactState {
  canonicalArtifactId: string;
  status: 'succeeded' | 'failed' | 'skipped';
  hash?: string;
  mimeType?: string;
  failureReason?: 'timeout' | 'connection_error' | 'upstream_failure' | 'conditions_not_met';
  skipMessage?: string;
}

export interface StoryboardActionHints {
  canExpand: boolean;
  canEdit: boolean;
  canUpload: boolean;
}

export interface StoryboardProjection {
  meta: {
    blueprintId: string;
    blueprintName: string;
    axisLabel: string;
    axisDimension: string;
    axisCount: number;
    hasProducedStoryState: boolean;
  };
  columns: StoryboardColumn[];
  connectors: StoryboardConnector[];
}

export interface StoryboardColumn {
  id: string;
  title: string;
  dimension: {
    symbol: string;
    index: number;
  };
  groups: StoryboardItemGroup[];
}

export interface StoryboardItemGroup {
  id: string;
  label?: string;
  items: StoryboardItem[];
}

export interface StoryboardItem {
  id: string;
  kind:
    | 'input-text'
    | 'artifact-text'
    | 'input-image'
    | 'artifact-image'
    | 'input-audio'
    | 'artifact-audio'
    | 'input-video'
    | 'artifact-video'
    | 'placeholder';
  mediaType: StoryMediaType;
  identity: {
    canonicalInputId?: string;
    canonicalArtifactId?: string;
    canonicalProducerId?: string;
  };
  label: string;
  description?: string;
  state: 'input' | 'succeeded' | 'pending' | 'failed' | 'skipped';
  placeholderReason?: 'not-run' | 'error' | 'conditional-skip';
  placeholderMessage?: string;
  dependencyClass: 'local-upstream' | 'carry-over' | 'local-output';
  media?: {
    mimeType: string;
    hash?: string;
    value?: string;
  };
  text?: {
    value: string;
    language?: 'markdown' | 'json';
  };
  actions: StoryboardActionHints;
}

export interface StoryboardConnector {
  id: string;
  fromItemId: string;
  toItemId: string;
  kind: 'local' | 'carry-over';
}

export type BuildStoryboardProjectionArgs =
  | {
      expanded: ExpandedBlueprintResolution;
      artifactStates?: Record<string, StoryboardArtifactState>;
      resolvedArtifactValues?: Record<string, unknown>;
    }
  | {
      root: BlueprintTreeNode;
      effectiveInputs: Record<string, unknown>;
      artifactStates?: Record<string, StoryboardArtifactState>;
      resolvedArtifactValues?: Record<string, unknown>;
    };

type StoryMediaType = 'text' | 'image' | 'audio' | 'video';

interface ExpectedNodeInfo {
  node: CanonicalNodeInstance;
  mediaType: StoryMediaType;
}

interface ReducedEdge {
  from: string;
  to: string;
}

interface ColumnWorkset {
  index: number;
  expectedNodeIds: Set<string>;
}

interface StoryboardPlaceholderDetails {
  state: 'pending' | 'failed' | 'skipped';
  reason: 'not-run' | 'error' | 'conditional-skip';
  message?: string;
}

interface ProducerStoryboardInputSelection {
  mainInputName?: string;
  secondaryInputName?: string;
}

interface StoryboardCompanionSelection {
  mediaNodeId: string;
  sourceNodeId: string;
}

interface StoryboardAxisFamily {
  publicLabel: string;
  labels: Set<string>;
}

const STORY_MEDIA_TYPES = new Set(['image', 'audio', 'video']);
const EXCLUDED_TERMINAL_ARTIFACT_NAMES = new Set(['timeline', 'finalvideo']);

export function buildStoryboardProjection(
  args: BuildStoryboardProjectionArgs
): StoryboardProjection {
  const expanded =
    'expanded' in args
      ? args.expanded
      : buildLegacyStoryboardExpandedResolution(args);
  const { context, normalizedInputs, canonical } = expanded;
  const root = context.root;
  const graph = context.graph;
  const artifactStateById = args.artifactStates ?? {};
  const resolvedArtifactValues = args.resolvedArtifactValues ?? {};
  const producerStoryboardInputs = collectProducerStoryboardInputs(graph.nodes);

  const candidateVisibleNodeInfos = collectExpectedVisibleMediaNodes(canonical.nodes);

  const hasProducedStoryState = candidateVisibleNodeInfos.some((info) => {
    if (info.node.type !== 'Artifact') {
      return false;
    }
    return artifactStateById[info.node.id] !== undefined;
  });

  const activeEdges = filterActiveEdges(
    canonical.edges,
    resolvedArtifactValues,
    normalizedInputs,
    hasProducedStoryState
  );
  const rootOutputIds = collectRootOutputIds(root);
  const publishedArtifactIds = collectPublishedArtifactIds(
    canonical.outputSourceBindings.filter((binding) =>
      rootOutputIds.has(stripCanonicalIndices(binding.outputId))
    ),
    {
      resolvedArtifacts: resolvedArtifactValues,
      resolvedInputs: normalizedInputs,
      hasProducedStoryState,
    }
  );
  const preliminaryVisibleNodeInfos = filterDisconnectedProducerArtifacts({
    visibleNodeInfos: candidateVisibleNodeInfos,
    adjacency: buildAdjacency(activeEdges),
    publishedArtifactIds,
  });
  const adjacency = buildAdjacency(activeEdges);
  const reverseAdjacency = buildReverseAdjacency(activeEdges);
  const nodeById = new Map(canonical.nodes.map((node) => [node.id, node]));
  const visibleMediaInfoById = new Map(
    preliminaryVisibleNodeInfos.map((info) => [info.node.id, info])
  );
  const candidateReducedEdges = buildReducedVisibleEdges({
    visibleNodeIds: new Set(visibleMediaInfoById.keys()),
    adjacency,
  });
  const candidateReducedIncoming =
    buildReducedReverseAdjacency(candidateReducedEdges);
  const expectedVisibleMediaInfos = filterPassThroughAliasArtifacts({
    visibleNodeInfos: preliminaryVisibleNodeInfos,
    artifactStateById,
    reducedIncoming: candidateReducedIncoming,
    nodeInfoById: visibleMediaInfoById,
  });
  const expectedVisibleMediaInfoById = new Map(
    expectedVisibleMediaInfos.map((info) => [info.node.id, info])
  );
  const expectedVisibleNodeIds = new Set(expectedVisibleMediaInfoById.keys());
  const reducedEdges = buildReducedVisibleEdges({
    visibleNodeIds: expectedVisibleNodeIds,
    adjacency,
  });
  const reducedOutgoing = buildReducedAdjacency(reducedEdges);
  const reducedIncoming = buildReducedReverseAdjacency(reducedEdges);

  const terminalArtifactInfos = expectedVisibleMediaInfos.filter((info) =>
    isTerminalColumnArtifact(info, reducedOutgoing)
  );

  const axisFamily = deriveStoryboardAxisFamily({
    root: context.root,
    terminalArtifacts: terminalArtifactInfos,
    loops: graph.loops,
  });
  const axisDimension = axisFamily.publicLabel;
  const axisLabel = humanizeLabel(axisDimension);
  const axisCount = deriveAxisCount(canonical.nodes, axisFamily);
  const nodeColumnById = new Map<string, number | null>(
    canonical.nodes.map((node) => [node.id, getDimensionIndex(node, axisFamily)])
  );

  const terminalArtifactsByColumn = groupTerminalArtifactsByColumn(
    terminalArtifactInfos,
    axisFamily
  );
  const columnsWorkset = buildColumnWorksets({
    axisCount,
    terminalArtifactsByColumn,
    reducedIncoming,
  });

  const columnGroups = new Map<number, Map<string, StoryboardItem[]>>();
  const companionSelections = new Map<string, StoryboardCompanionSelection>();

  for (const column of columnsWorkset) {
    const groups = columnGroups.get(column.index) ?? new Map<string, StoryboardItem[]>();

    for (const nodeId of column.expectedNodeIds) {
      const expectedInfo = expectedVisibleMediaInfoById.get(nodeId);
      if (!expectedInfo) {
        continue;
      }

      const item = buildStoryboardItem({
        node: expectedInfo.node,
        mediaType: expectedInfo.mediaType,
        columnIndex: column.index,
        artifactStateById,
        effectiveInputs: normalizedInputs,
        resolvedArtifactValues,
        reducedIncoming,
        reducedOutgoing,
        nodeColumnById,
        activeReverseAdjacency: reverseAdjacency,
        nodeById,
        producerInputBindings: canonical.inputBindings,
        hasProducedStoryState,
      });

      if (!item) {
        continue;
      }
      if (!isNodeInStoryboardAxis(expectedInfo.node, axisFamily)) {
        continue;
      }

      pushStoryboardItem(groups, expectedInfo.node, item);

      const companionSourceId = resolveStoryboardCompanionSourceId({
        mediaNode: expectedInfo.node,
        reverseAdjacency,
        nodeById,
        producerInputBindings: canonical.inputBindings,
        producerStoryboardInputs,
      });
      if (!companionSourceId) {
        continue;
      }

      const sourceNode = nodeById.get(companionSourceId);
      if (!sourceNode) {
        throw createRuntimeError(
          RuntimeErrorCode.GRAPH_BUILD_ERROR,
          `Storyboard companion source "${companionSourceId}" was selected for "${expectedInfo.node.id}" but is missing from the canonical graph.`
        );
      }

      const companionItem = buildStoryboardItem({
        node: sourceNode,
        mediaType: 'text',
        columnIndex: column.index,
        artifactStateById,
        effectiveInputs: normalizedInputs,
        resolvedArtifactValues,
        reducedIncoming,
        reducedOutgoing,
        nodeColumnById,
        activeReverseAdjacency: reverseAdjacency,
        nodeById,
        producerInputBindings: canonical.inputBindings,
        hasProducedStoryState,
      });
      if (!companionItem) {
        continue;
      }
      if (!isNodeInStoryboardAxis(sourceNode, axisFamily)) {
        continue;
      }

      pushStoryboardItem(groups, sourceNode, companionItem);
      companionSelections.set(
        `${sourceNode.id}->${expectedInfo.node.id}`,
        {
          mediaNodeId: expectedInfo.node.id,
          sourceNodeId: sourceNode.id,
        }
      );
    }

    columnGroups.set(column.index, groups);
  }
  const columns = Array.from({ length: axisCount }, (_, index) => {
    const groups = columnGroups.get(index) ?? new Map<string, StoryboardItem[]>();
    const orderedGroups = Array.from(groups.entries())
      .map(([groupId, items]) => ({
        id: `${axisDimension}:${index}:${groupId}`,
        label: groupId === 'inputs' ? 'Inputs' : humanizeLabel(groupId),
        items: sortStoryboardItems(items),
      }))
      .sort((left, right) => left.label.localeCompare(right.label));

    return {
      id: `${axisDimension}:${index}`,
      title: `${axisLabel} ${index + 1}`,
      dimension: {
        symbol: axisDimension,
        index,
      },
      groups: orderedGroups,
    } satisfies StoryboardColumn;
  });

  const renderedItemIds = new Set<string>([
    ...columns.flatMap((column) =>
      column.groups.flatMap((group) => group.items.map((item) => item.id))
    ),
  ]);

  const itemEntries: Array<readonly [string, StoryboardItem]> = [
    ...columns.flatMap((column) =>
      column.groups.flatMap((group) =>
        group.items.map(
          (item): readonly [string, StoryboardItem] => [item.id, item]
        )
      )
    ),
  ];
  const itemById = new Map<string, StoryboardItem>(itemEntries);

  const connectors = reducedEdges
    .map((edge) =>
      toStoryboardConnector({
        edge,
        itemById,
        renderedItemIds,
        nodeColumnById,
      })
    )
    .filter((connector): connector is StoryboardConnector => connector !== null);
  const fallbackCarryOverConnectors = buildCarryOverFallbackConnectors({
    itemById,
    renderedItemIds,
    nodeColumnById,
    reverseAdjacency,
    nodeById,
    producerInputBindings: canonical.inputBindings,
  });
  const companionConnectors = Array.from(companionSelections.values())
    .map((selection) =>
      toStoryboardCompanionConnector({
        selection,
        itemById,
        renderedItemIds,
        nodeColumnById,
      })
    )
    .filter((connector): connector is StoryboardConnector => connector !== null);
  const dedupedConnectors = new Map<string, StoryboardConnector>();
  for (const connector of [
    ...connectors,
    ...fallbackCarryOverConnectors,
    ...companionConnectors,
  ]) {
    dedupedConnectors.set(connector.id, connector);
  }

  return {
    meta: {
      blueprintId: context.root.document.meta.id,
      blueprintName: context.root.document.meta.name,
      axisLabel,
      axisDimension,
      axisCount,
      hasProducedStoryState,
    },
    columns,
    connectors: Array.from(dedupedConnectors.values()),
  };
}

function collectRootOutputIds(root: BlueprintTreeNode): Set<string> {
  const outputIds = new Set<string>();

  for (const output of root.document.outputs) {
    for (const expandedOutput of expandRootOutputDefinitions(output)) {
      outputIds.add(`Output:${expandedOutput.name}`);
    }
  }

  return outputIds;
}

function expandRootOutputDefinitions(
  output: BlueprintOutputDefinition
): BlueprintOutputDefinition[] {
  if (output.type !== 'json' || !output.schema || !output.arrays) {
    return [output];
  }

  return decomposeJsonSchema(output.schema, output.name, output.arrays).map(
    (field) => ({
      name: field.path,
      type: field.type,
      required: output.required,
      description: output.description,
    })
  );
}

function buildLegacyStoryboardExpandedResolution(args: {
  root: BlueprintTreeNode;
  effectiveInputs: Record<string, unknown>;
}): ExpandedBlueprintResolution {
  const graph = buildBlueprintGraph(args.root);
  const inputSources = buildInputSourceMapFromCanonical(graph);
  const context: BlueprintResolutionContext = {
    root: args.root,
    graph,
    inputSources,
  };
  const normalizedInputs = selectBlueprintResolutionInputs(
    context,
    args.effectiveInputs
  );

  return {
    context,
    normalizedInputs,
    canonical: expandBlueprintGraph(graph, normalizedInputs, inputSources),
  };
}

function collectProducerStoryboardInputs(
  nodes: BlueprintGraphNode[]
): Map<string, ProducerStoryboardInputSelection> {
  const selections = new Map<string, ProducerStoryboardInputSelection>();

  for (const node of nodes) {
    if (node.type !== 'InputSource' || node.namespacePath.length === 0) {
      continue;
    }
    if (!node.input?.storyboard) {
      continue;
    }

    const producerId = formatCanonicalProducerId(node.namespacePath, node.namespacePath[0]!);
    const selection = selections.get(producerId) ?? {};
    if (node.input.storyboard === 'main') {
      selection.mainInputName = node.name;
    } else {
      selection.secondaryInputName = node.name;
    }
    selections.set(producerId, selection);
  }

  return selections;
}

function pushStoryboardItem(
  groups: Map<string, StoryboardItem[]>,
  node: CanonicalNodeInstance,
  item: StoryboardItem
): void {
  const groupId = getGroupId(node);
  const existingItems = groups.get(groupId) ?? [];
  if (existingItems.some((existing) => existing.id === item.id)) {
    return;
  }
  groups.set(groupId, [...existingItems, item]);
}

function resolveStoryboardCompanionSourceId(args: {
  mediaNode: CanonicalNodeInstance;
  reverseAdjacency: Map<string, string[]>;
  nodeById: Map<string, CanonicalNodeInstance>;
  producerInputBindings: Record<string, Record<string, string>>;
  producerStoryboardInputs: Map<string, ProducerStoryboardInputSelection>;
}): string | null {
  const upstreamProducerIds = findNearestUpstreamProducerIds({
    startNodeId: args.mediaNode.id,
    reverseAdjacency: args.reverseAdjacency,
    nodeById: args.nodeById,
  });

  for (const upstreamId of upstreamProducerIds) {
    const upstreamNode = args.nodeById.get(upstreamId);
    if (upstreamNode?.type !== 'Producer') {
      continue;
    }
    const producerBaseId = stripProducerIndices(upstreamNode.id);
    const storyboardInputs = args.producerStoryboardInputs.get(producerBaseId);
    if (!storyboardInputs) {
      continue;
    }

    const bindings = args.producerInputBindings[upstreamNode.id] ?? {};
    const mainSourceId = storyboardInputs.mainInputName
      ? bindings[storyboardInputs.mainInputName]
      : undefined;
    if (mainSourceId && !isProducerInternalSource(mainSourceId, producerBaseId)) {
      return mainSourceId;
    }

    const secondarySourceId = storyboardInputs.secondaryInputName
      ? bindings[storyboardInputs.secondaryInputName]
      : undefined;
    if (
      secondarySourceId &&
      !isProducerInternalSource(secondarySourceId, producerBaseId)
    ) {
      return secondarySourceId;
    }
  }

  return null;
}

function findNearestUpstreamProducerIds(args: {
  startNodeId: string;
  reverseAdjacency: Map<string, string[]>;
  nodeById: Map<string, CanonicalNodeInstance>;
}): string[] {
  const queue = [...(args.reverseAdjacency.get(args.startNodeId) ?? [])];
  const visited = new Set<string>();
  const producers: string[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);

    const currentNode = args.nodeById.get(currentId);
    if (currentNode?.type === 'Producer') {
      producers.push(currentId);
      continue;
    }

    queue.push(...(args.reverseAdjacency.get(currentId) ?? []));
  }

  return producers;
}

function stripProducerIndices(canonicalProducerId: string): string {
  return canonicalProducerInstanceIdToProducerId(canonicalProducerId);
}

function stripCanonicalIndices(canonicalId: string): string {
  return canonicalId.replace(/\[\d+\]/g, '');
}

function isProducerInternalSource(
  sourceId: string,
  producerBaseId: string
): boolean {
  const producerAlias = canonicalProducerIdToAlias(producerBaseId);
  const strippedSourceId = stripCanonicalIndices(sourceId);
  return (
    strippedSourceId === `Input:${producerAlias}` ||
    strippedSourceId.startsWith(`Input:${producerAlias}.`) ||
    strippedSourceId === `Artifact:${producerAlias}` ||
    strippedSourceId.startsWith(`Artifact:${producerAlias}.`)
  );
}

function collectExpectedVisibleMediaNodes(
  nodes: CanonicalNodeInstance[]
): ExpectedNodeInfo[] {
  return nodes.flatMap((node) => {
    if (node.type !== 'Input' && node.type !== 'Artifact') {
      return [];
    }

    const mediaType = resolveStoryMediaType(node);
    if (!mediaType) {
      return [];
    }

    return isVisibleStoryboardMediaNode(node, mediaType)
      ? [{ node, mediaType }]
      : [];
  });
}

function isVisibleStoryboardMediaNode(
  node: CanonicalNodeInstance,
  mediaType: StoryMediaType
): boolean {
  if (mediaType === 'text') {
    return false;
  }
  if (node.type === 'Input' && node.namespacePath.length > 0) {
    return false;
  }
  if (EXCLUDED_TERMINAL_ARTIFACT_NAMES.has(node.name.toLowerCase())) {
    return false;
  }
  return true;
}

function filterPassThroughAliasArtifacts(args: {
  visibleNodeInfos: ExpectedNodeInfo[];
  artifactStateById: Record<string, StoryboardArtifactState>;
  reducedIncoming: Map<string, string[]>;
  nodeInfoById: Map<string, ExpectedNodeInfo>;
}): ExpectedNodeInfo[] {
  return args.visibleNodeInfos.filter((info) => {
    if (info.node.type !== 'Artifact' || info.mediaType === 'text') {
      return true;
    }

    return !isPassThroughAliasArtifact({
      info,
      artifactStateById: args.artifactStateById,
      reducedIncoming: args.reducedIncoming,
      nodeInfoById: args.nodeInfoById,
    });
  });
}

function isPassThroughAliasArtifact(args: {
  info: ExpectedNodeInfo;
  artifactStateById: Record<string, StoryboardArtifactState>;
  reducedIncoming: Map<string, string[]>;
  nodeInfoById: Map<string, ExpectedNodeInfo>;
}): boolean {
  if (args.artifactStateById[args.info.node.id]) {
    return false;
  }

  const parsed = parseCanonicalArtifactId(args.info.node.id);
  if (parsed.path.length > 0) {
    return false;
  }

  const upstreamIds = args.reducedIncoming.get(args.info.node.id) ?? [];
  if (upstreamIds.length === 0) {
    return false;
  }

  let sawSameMediaArtifact = false;
  for (const upstreamId of upstreamIds) {
    const upstreamInfo = args.nodeInfoById.get(upstreamId);
    if (!upstreamInfo) {
      return false;
    }
    if (upstreamInfo.mediaType === 'text') {
      return false;
    }
    if (
      upstreamInfo.node.type !== 'Artifact' ||
      upstreamInfo.mediaType !== args.info.mediaType
    ) {
      return false;
    }
    sawSameMediaArtifact = true;
  }

  return sawSameMediaArtifact;
}

function filterDisconnectedProducerArtifacts(args: {
  visibleNodeInfos: ExpectedNodeInfo[];
  adjacency: Map<string, string[]>;
  publishedArtifactIds: Set<string>;
}): ExpectedNodeInfo[] {
  return args.visibleNodeInfos.filter((info) => {
    if (info.node.type !== 'Artifact' || info.mediaType === 'text') {
      return true;
    }

    if (args.publishedArtifactIds.has(info.node.id)) {
      return true;
    }

    const parsed = parseCanonicalArtifactId(info.node.id);
    if (parsed.path.length === 0) {
      return true;
    }

    return (args.adjacency.get(info.node.id) ?? []).length > 0;
  });
}

function resolveStoryMediaType(node: CanonicalNodeInstance): StoryMediaType | null {
  const definition = node.type === 'Input' ? node.input : node.artifact;
  if (!definition) {
    return null;
  }

  const rawType = String(definition.type ?? '').toLowerCase();
  const rawItemType = String(definition.itemType ?? '').toLowerCase();

  if (rawType === 'array' || rawType === 'multidimarray') {
    if (rawItemType === 'string' || rawItemType === 'text' || rawItemType === 'json') {
      return 'text';
    }
    if (STORY_MEDIA_TYPES.has(rawItemType)) {
      return rawItemType as Exclude<StoryMediaType, 'text'>;
    }
    return null;
  }

  if (rawType === 'json') {
    return 'text';
  }

  if (rawType === 'text' || rawType === 'string') {
    return 'text';
  }

  if (STORY_MEDIA_TYPES.has(rawType)) {
    return rawType as Exclude<StoryMediaType, 'text'>;
  }

  return null;
}

function filterActiveEdges(
  edges: CanonicalEdgeInstance[],
  resolvedArtifacts: Record<string, unknown>,
  resolvedInputs: Record<string, unknown>,
  hasProducedStoryState: boolean
): CanonicalEdgeInstance[] {
  return edges.filter((edge) => {
    return isConditionActive(
      edge.conditions,
      edge.indices,
      resolvedArtifacts,
      resolvedInputs,
      hasProducedStoryState
    );
  });
}

function isConditionActive(
  conditions: CanonicalEdgeInstance['conditions'],
  indices: Record<string, number> | undefined,
  resolvedArtifacts: Record<string, unknown>,
  resolvedInputs: Record<string, unknown>,
  hasProducedStoryState: boolean
): boolean {
  if (!conditions) {
    return true;
  }

  const result = evaluateCondition(conditions, indices ?? {}, {
    resolvedArtifacts,
    resolvedInputs,
  });
  if (result.satisfied) {
    return true;
  }

  if (
    hasProducedStoryState &&
    typeof result.reason === 'string' &&
    result.reason.startsWith('Artifact not found')
  ) {
    return true;
  }

  return false;
}

function buildAdjacency(edges: CanonicalEdgeInstance[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const current = adjacency.get(edge.from) ?? [];
    current.push(edge.to);
    adjacency.set(edge.from, current);
  }
  return adjacency;
}

function buildReverseAdjacency(
  edges: CanonicalEdgeInstance[]
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const current = adjacency.get(edge.to) ?? [];
    current.push(edge.from);
    adjacency.set(edge.to, current);
  }
  return adjacency;
}
function buildReducedVisibleEdges(args: {
  visibleNodeIds: Set<string>;
  adjacency: Map<string, string[]>;
}): ReducedEdge[] {
  const edges = new Map<string, ReducedEdge>();

  for (const sourceId of args.visibleNodeIds) {
    const queue = [...(args.adjacency.get(sourceId) ?? [])];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId || visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      if (args.visibleNodeIds.has(currentId)) {
        const edgeId = `${sourceId}->${currentId}`;
        if (sourceId !== currentId && !edges.has(edgeId)) {
          edges.set(edgeId, { from: sourceId, to: currentId });
        }
        continue;
      }

      queue.push(...(args.adjacency.get(currentId) ?? []));
    }
  }

  return Array.from(edges.values());
}

function buildReducedAdjacency(edges: ReducedEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const current = adjacency.get(edge.from) ?? [];
    current.push(edge.to);
    adjacency.set(edge.from, current);
  }
  return adjacency;
}

function buildReducedReverseAdjacency(edges: ReducedEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const current = adjacency.get(edge.to) ?? [];
    current.push(edge.from);
    adjacency.set(edge.to, current);
  }
  return adjacency;
}

function isTerminalColumnArtifact(
  info: ExpectedNodeInfo,
  reducedOutgoing: Map<string, string[]>
): boolean {
  if (info.node.type !== 'Artifact') {
    return false;
  }

  if (info.node.dimensions.length === 0) {
    return false;
  }

  if (EXCLUDED_TERMINAL_ARTIFACT_NAMES.has(info.node.name.toLowerCase())) {
    return false;
  }

  return (reducedOutgoing.get(info.node.id) ?? []).length === 0;
}

function deriveStoryboardAxisFamily(args: {
  root: BlueprintTreeNode;
  terminalArtifacts: ExpectedNodeInfo[];
  loops: Map<string, Array<{ name: string; countInput: string }>>;
}): StoryboardAxisFamily {
  const labels = new Set(
    Array.from(args.loops.values())
      .flatMap((definitions) => definitions)
      .filter((definition) => definition.countInput === 'NumOfSegments')
      .map((definition) => definition.name)
  );
  labels.add('NumOfSegments');

  if (labels.size === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_BUILD_ERROR,
      'Storyboard projection only supports visible story media driven by a NumOfSegments loop, but no such loop was declared.'
    );
  }

  const visibleAxisLabels = new Set<string>();
  for (const info of args.terminalArtifacts) {
    for (const dimensionSymbol of info.node.dimensions) {
      const label = extractDimensionLabel(dimensionSymbol);
      if (labels.has(label)) {
        visibleAxisLabels.add(label);
      }
    }
  }

  if (visibleAxisLabels.size === 0) {
    const candidateAxes = new Set<string>();
    for (const info of args.terminalArtifacts) {
      const dimension = getTopLevelDimensionLabel(info.node);
      if (dimension) {
        candidateAxes.add(dimension);
      }
    }
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_BUILD_ERROR,
      `Storyboard projection only supports scene or segment loops driven by NumOfSegments. Visible story artifacts were keyed by unsupported axes: ${Array.from(candidateAxes).join(', ')}.`
    );
  }

  const rootLabel = args.root.document.loops?.find(
    (loop) => loop.countInput === 'NumOfSegments'
  )?.name;
  const publicLabel = rootLabel && visibleAxisLabels.has(rootLabel)
    ? rootLabel
    : Array.from(visibleAxisLabels)[0]!;

  return {
    publicLabel,
    labels,
  };
}

function deriveAxisCount(
  nodes: CanonicalNodeInstance[],
  axisFamily: StoryboardAxisFamily
): number {
  let maxIndex = -1;

  for (const node of nodes) {
    const axisIndex = getDimensionIndex(node, axisFamily);
    if (axisIndex !== null && axisIndex > maxIndex) {
      maxIndex = axisIndex;
    }
  }

  if (maxIndex < 0) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_BUILD_ERROR,
      `Storyboard projection could not resolve any instances for the axis "${axisFamily.publicLabel}".`
    );
  }

  return maxIndex + 1;
}

function groupTerminalArtifactsByColumn(
  terminalArtifacts: ExpectedNodeInfo[],
  axisFamily: StoryboardAxisFamily
): Map<number, string[]> {
  const byColumn = new Map<number, string[]>();

  for (const info of terminalArtifacts) {
    const axisIndex = getDimensionIndex(info.node, axisFamily);
    if (axisIndex === null) {
      continue;
    }

    const current = byColumn.get(axisIndex) ?? [];
    current.push(info.node.id);
    byColumn.set(axisIndex, current);
  }

  return byColumn;
}

function buildColumnWorksets(args: {
  axisCount: number;
  terminalArtifactsByColumn: Map<number, string[]>;
  reducedIncoming: Map<string, string[]>;
}): ColumnWorkset[] {
  return Array.from({ length: args.axisCount }, (_, index) => {
    const roots = args.terminalArtifactsByColumn.get(index) ?? [];
    const expectedNodeIds = new Set<string>();
    const queue = [...roots];

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId || expectedNodeIds.has(currentId)) {
        continue;
      }
      expectedNodeIds.add(currentId);
      queue.push(...(args.reducedIncoming.get(currentId) ?? []));
    }

    return {
      index,
      expectedNodeIds,
    };
  });
}

function buildStoryboardItem(args: {
  node: CanonicalNodeInstance;
  mediaType: StoryMediaType;
  columnIndex: number;
  artifactStateById: Record<string, StoryboardArtifactState>;
  effectiveInputs: Record<string, unknown>;
  resolvedArtifactValues: Record<string, unknown>;
  reducedIncoming: Map<string, string[]>;
  reducedOutgoing: Map<string, string[]>;
  nodeColumnById: Map<string, number | null>;
  activeReverseAdjacency: Map<string, string[]>;
  nodeById: Map<string, CanonicalNodeInstance>;
  producerInputBindings: Record<string, Record<string, string>>;
  hasProducedStoryState: boolean;
}): StoryboardItem | null {
  if (args.node.type === 'Artifact') {
    const artifactState = args.artifactStateById[args.node.id];
    const dependencyClass = resolveDependencyClass({
      node: args.node,
      columnIndex: args.columnIndex,
      reducedIncoming: args.reducedIncoming,
      reducedOutgoing: args.reducedOutgoing,
      nodeColumnById: args.nodeColumnById,
      activeReverseAdjacency: args.activeReverseAdjacency,
      nodeById: args.nodeById,
      producerInputBindings: args.producerInputBindings,
    });

    if (artifactState?.status !== 'succeeded') {
      const placeholder = resolvePlaceholderDetails({
        nodeId: args.node.id,
        artifactStateById: args.artifactStateById,
        hasProducedStoryState: args.hasProducedStoryState,
        activeReverseAdjacency: args.activeReverseAdjacency,
        nodeById: args.nodeById,
      });

      return {
        id: args.node.id,
        kind: 'placeholder',
        mediaType: args.mediaType,
        identity: {
          canonicalArtifactId: args.node.id,
          canonicalProducerId: getCanonicalProducerId(args.node),
        },
        label: formatNodeLabel(args.node),
        description: args.node.artifact?.description,
        state: placeholder.state,
        placeholderReason: placeholder.reason,
        placeholderMessage: placeholder.message,
        dependencyClass,
        actions: {
          canExpand: false,
          canEdit: false,
          canUpload: false,
        },
      };
    }

    return buildConcreteItem({
      node: args.node,
      mediaType: args.mediaType,
      state: 'succeeded',
      dependencyClass,
      value: args.resolvedArtifactValues[args.node.id],
      mimeType: artifactState?.mimeType,
      hash: artifactState?.hash,
    });
  }

  const dependencyClass = resolveDependencyClass({
    node: args.node,
    columnIndex: args.columnIndex,
    reducedIncoming: args.reducedIncoming,
    reducedOutgoing: args.reducedOutgoing,
    nodeColumnById: args.nodeColumnById,
    activeReverseAdjacency: args.activeReverseAdjacency,
    nodeById: args.nodeById,
    producerInputBindings: args.producerInputBindings,
  });

  return buildConcreteItem({
    node: args.node,
    mediaType: args.mediaType,
    state: 'input',
    dependencyClass,
    value: resolveNodeInputValue(args.node, args.effectiveInputs),
  });
}

function buildConcreteItem(args: {
  node: CanonicalNodeInstance;
  mediaType: StoryMediaType;
  state: 'input' | 'succeeded';
  dependencyClass: StoryboardItem['dependencyClass'];
  value: unknown;
  mimeType?: string;
  hash?: string;
}): StoryboardItem {
  const baseIdentity =
    args.node.type === 'Input'
      ? {
          canonicalInputId: args.node.id,
        }
      : {
          canonicalArtifactId: args.node.id,
          canonicalProducerId: getCanonicalProducerId(args.node),
        };

  const kindPrefix = args.node.type === 'Input' ? 'input' : 'artifact';

  if (args.mediaType === 'text') {
    return {
      id: args.node.id,
      kind: `${kindPrefix}-text`,
      mediaType: args.mediaType,
      identity: baseIdentity,
      label: formatNodeLabel(args.node),
      description: args.node.type === 'Input'
        ? args.node.input?.description
        : args.node.artifact?.description,
      state: args.state,
      dependencyClass: args.dependencyClass,
      text: {
        value: stringifyStoryText(args.value),
        language: inferTextLanguage(args.node),
      },
      actions: {
        canExpand: true,
        canEdit: args.node.type === 'Input',
        canUpload: false,
      },
    } satisfies StoryboardItem;
  }

  return {
    id: args.node.id,
    kind: `${kindPrefix}-${args.mediaType}`,
    mediaType: args.mediaType,
    identity: baseIdentity,
    label: formatNodeLabel(args.node),
    description: args.node.type === 'Input'
      ? args.node.input?.description
      : args.node.artifact?.description,
    state: args.state,
    dependencyClass: args.dependencyClass,
    media: {
      mimeType: args.mimeType ?? inferMimeTypeFromMediaType(args.mediaType),
      hash: args.hash,
      value: typeof args.value === 'string' ? args.value : undefined,
    },
    actions: {
      canExpand: true,
      canEdit: false,
      canUpload: args.node.type === 'Input',
    },
  } satisfies StoryboardItem;
}

function resolvePlaceholderDetails(args: {
  nodeId: string;
  artifactStateById: Record<string, StoryboardArtifactState>;
  hasProducedStoryState: boolean;
  activeReverseAdjacency: Map<string, string[]>;
  nodeById: Map<string, CanonicalNodeInstance>;
}): StoryboardPlaceholderDetails {
  const directState = args.artifactStateById[args.nodeId];
  if (directState?.status === 'failed') {
    return {
      state: 'failed',
      reason: 'error',
      message: 'This step failed in the current run.',
    };
  }

  if (directState?.status === 'skipped') {
    return {
      state: 'skipped',
      reason: 'conditional-skip',
      message:
        directState.skipMessage ?? 'This step was skipped because its condition was not met.',
    };
  }

  if (!args.hasProducedStoryState) {
    return {
      state: 'pending',
      reason: 'not-run',
      message: 'This step has not been run yet.',
    };
  }

  const inheritedReason = resolveInheritedPlaceholderReason({
    nodeId: args.nodeId,
    artifactStateById: args.artifactStateById,
    activeReverseAdjacency: args.activeReverseAdjacency,
    nodeById: args.nodeById,
    visited: new Set<string>(),
  });

  if (inheritedReason === 'conditional-skip') {
    return {
      state: 'skipped',
      reason: 'conditional-skip',
      message: 'This step was skipped because an upstream condition was not met.',
    };
  }

  if (inheritedReason === 'error') {
    return {
      state: 'failed',
      reason: 'error',
      message: 'This step was not generated because an upstream step failed.',
    };
  }

  return {
    state: 'pending',
    reason: 'not-run',
    message: 'This step has not been generated yet.',
  };
}

function resolveInheritedPlaceholderReason(args: {
  nodeId: string;
  artifactStateById: Record<string, StoryboardArtifactState>;
  activeReverseAdjacency: Map<string, string[]>;
  nodeById: Map<string, CanonicalNodeInstance>;
  visited: Set<string>;
}): 'error' | 'conditional-skip' | null {
  if (args.visited.has(args.nodeId)) {
    return null;
  }
  args.visited.add(args.nodeId);

  let sawConditionalSkip = false;

  for (const sourceId of args.activeReverseAdjacency.get(args.nodeId) ?? []) {
    const sourceState = args.artifactStateById[sourceId];
    if (sourceState?.status === 'failed') {
      return 'error';
    }
    if (
      sourceState?.status === 'skipped' ||
      sourceState?.failureReason === 'conditions_not_met'
    ) {
      sawConditionalSkip = true;
      continue;
    }

    const sourceNode = args.nodeById.get(sourceId);
    if (!sourceNode) {
      continue;
    }

    const nestedReason = resolveInheritedPlaceholderReason({
      ...args,
      nodeId: sourceId,
    });
    if (nestedReason === 'error') {
      return 'error';
    }
    if (nestedReason === 'conditional-skip') {
      sawConditionalSkip = true;
    }
  }

  return sawConditionalSkip ? 'conditional-skip' : null;
}

function resolveNodeInputValue(
  node: CanonicalNodeInstance,
  effectiveInputs: Record<string, unknown>
): unknown {
  return indexIntoValue(effectiveInputs[stripCanonicalIndices(node.id)], node);
}

function indexIntoValue(value: unknown, node: CanonicalNodeInstance): unknown {
  let current = value;

  for (const dimension of node.dimensions) {
    const index = node.indices[dimension];
    if (index === undefined) {
      continue;
    }
    if (!Array.isArray(current)) {
      return current;
    }
    current = current[index];
  }

  return current;
}

function resolveDependencyClass(args: {
  node: CanonicalNodeInstance;
  columnIndex: number;
  reducedIncoming: Map<string, string[]>;
  reducedOutgoing: Map<string, string[]>;
  nodeColumnById: Map<string, number | null>;
  activeReverseAdjacency: Map<string, string[]>;
  nodeById: Map<string, CanonicalNodeInstance>;
  producerInputBindings: Record<string, Record<string, string>>;
}): StoryboardItem['dependencyClass'] {
  const hasCarryOver =
    hasCarryOverProducerBinding({
      nodeId: args.node.id,
      expectedPreviousColumn: args.columnIndex - 1,
      activeReverseAdjacency: args.activeReverseAdjacency,
      nodeById: args.nodeById,
      nodeColumnById: args.nodeColumnById,
      producerInputBindings: args.producerInputBindings,
    }) ||
    hasPreviousColumnArtifactAncestor({
      nodeId: args.node.id,
      expectedPreviousColumn: args.columnIndex - 1,
      activeReverseAdjacency: args.activeReverseAdjacency,
      nodeById: args.nodeById,
      nodeColumnById: args.nodeColumnById,
      visited: new Set<string>(),
    });
  if (hasCarryOver) {
    return 'carry-over';
  }

  const outgoing = args.reducedOutgoing.get(args.node.id) ?? [];
  const hasLocalOutgoing = outgoing.some((targetId) => {
    const targetColumn = args.nodeColumnById.get(targetId) ?? null;
    return targetColumn === args.columnIndex;
  });

  return hasLocalOutgoing || args.node.type === 'Input'
    ? 'local-upstream'
    : 'local-output';
}

function getDimensionIndex(
  node: CanonicalNodeInstance,
  axisFamily: StoryboardAxisFamily
): number | null {
  for (const dimensionSymbol of node.dimensions) {
    if (!axisFamily.labels.has(extractDimensionLabel(dimensionSymbol))) {
      continue;
    }
    const value = node.indices[dimensionSymbol];
    if (typeof value === 'number') {
      return value;
    }
  }
  return null;
}

function isNodeInStoryboardAxis(
  node: CanonicalNodeInstance,
  axisFamily: StoryboardAxisFamily
): boolean {
  return getDimensionIndex(node, axisFamily) !== null;
}

function getTopLevelDimensionLabel(node: CanonicalNodeInstance): string | null {
  const firstDimension = node.dimensions[0];
  return firstDimension ? extractDimensionLabel(firstDimension) : null;
}

function extractDimensionLabel(symbol: string): string {
  const parts = symbol.split(':');
  return parts[parts.length - 1] ?? symbol;
}

function formatNodeLabel(node: CanonicalNodeInstance): string {
  const suffix = node.dimensions
    .map((dimension) => node.indices[dimension])
    .filter((value): value is number => typeof value === 'number')
    .map((value) => value + 1)
    .join('.');

  return suffix.length > 0 ? `${humanizeLabel(node.name)} ${suffix}` : humanizeLabel(node.name);
}

function humanizeLabel(label: string): string {
  return label
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function stringifyStoryText(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function inferTextLanguage(node: CanonicalNodeInstance): 'markdown' | 'json' {
  const definition = node.type === 'Input' ? node.input : node.artifact;
  return definition?.type === 'json' ? 'json' : 'markdown';
}

function inferMimeTypeFromMediaType(mediaType: Exclude<StoryMediaType, 'text'>): string {
  switch (mediaType) {
    case 'image':
      return 'image/png';
    case 'audio':
      return 'audio/mpeg';
    case 'video':
      return 'video/mp4';
  }
}

function getGroupId(node: CanonicalNodeInstance): string {
  if (node.type === 'Input') {
    return 'inputs';
  }
  const parsed = parseCanonicalArtifactId(node.id);
  return parsed.path[0] ?? node.name;
}

function sortStoryboardItems(items: StoryboardItem[]): StoryboardItem[] {
  return [...items].sort((left, right) => left.label.localeCompare(right.label));
}

function getCanonicalProducerId(node: CanonicalNodeInstance): string | undefined {
  if (node.type === 'Input') {
    return undefined;
  }

  const parsed = parseCanonicalArtifactId(node.id);
  if (parsed.path.length === 0) {
    return undefined;
  }

  return `Producer:${parsed.path[0]}`;
}

function toStoryboardConnector(args: {
  edge: ReducedEdge;
  itemById: Map<string, StoryboardItem>;
  renderedItemIds: Set<string>;
  nodeColumnById: Map<string, number | null>;
}): StoryboardConnector | null {
  if (
    !args.renderedItemIds.has(args.edge.from) ||
    !args.renderedItemIds.has(args.edge.to)
  ) {
    return null;
  }

  const fromColumn = args.nodeColumnById.get(args.edge.from) ?? null;
  const toColumn = args.nodeColumnById.get(args.edge.to) ?? null;

  const kind =
    fromColumn !== null &&
    toColumn !== null &&
    toColumn === fromColumn + 1
      ? 'carry-over'
      : 'local';

  const fromItem = args.itemById.get(args.edge.from);
  const toItem = args.itemById.get(args.edge.to);
  if (!fromItem || !toItem) {
    return null;
  }

  return {
    id: `${fromItem.id}->${toItem.id}`,
    fromItemId: fromItem.id,
    toItemId: toItem.id,
    kind,
  };
}

function toStoryboardCompanionConnector(args: {
  selection: StoryboardCompanionSelection;
  itemById: Map<string, StoryboardItem>;
  renderedItemIds: Set<string>;
  nodeColumnById: Map<string, number | null>;
}): StoryboardConnector | null {
  if (
    !args.renderedItemIds.has(args.selection.sourceNodeId) ||
    !args.renderedItemIds.has(args.selection.mediaNodeId)
  ) {
    return null;
  }

  const fromItem = args.itemById.get(args.selection.sourceNodeId);
  const toItem = args.itemById.get(args.selection.mediaNodeId);
  if (!fromItem || !toItem) {
    return null;
  }

  const fromColumn = args.nodeColumnById.get(args.selection.sourceNodeId) ?? null;
  const toColumn = args.nodeColumnById.get(args.selection.mediaNodeId) ?? null;
  const kind =
    fromColumn !== null &&
    toColumn !== null &&
    toColumn === fromColumn + 1
      ? 'carry-over'
      : 'local';

  return {
    id: `${fromItem.id}->${toItem.id}`,
    fromItemId: fromItem.id,
    toItemId: toItem.id,
    kind,
  };
}

function hasPreviousColumnArtifactAncestor(args: {
  nodeId: string;
  expectedPreviousColumn: number;
  activeReverseAdjacency: Map<string, string[]>;
  nodeById: Map<string, CanonicalNodeInstance>;
  nodeColumnById: Map<string, number | null>;
  visited: Set<string>;
}): boolean {
  if (args.visited.has(args.nodeId)) {
    return false;
  }
  args.visited.add(args.nodeId);

  for (const sourceId of args.activeReverseAdjacency.get(args.nodeId) ?? []) {
    const sourceNode = args.nodeById.get(sourceId);
    if (!sourceNode) {
      continue;
    }

    const sourceColumn = args.nodeColumnById.get(sourceId) ?? null;
    if (
      sourceNode.type === 'Artifact' &&
      sourceColumn === args.expectedPreviousColumn
    ) {
      return true;
    }

    if (
      hasPreviousColumnArtifactAncestor({
        ...args,
        nodeId: sourceId,
      })
    ) {
      return true;
    }
  }

  return false;
}

function buildCarryOverFallbackConnectors(args: {
  itemById: Map<string, StoryboardItem>;
  renderedItemIds: Set<string>;
  nodeColumnById: Map<string, number | null>;
  reverseAdjacency: Map<string, string[]>;
  nodeById: Map<string, CanonicalNodeInstance>;
  producerInputBindings: Record<string, Record<string, string>>;
}): StoryboardConnector[] {
  const connectors: StoryboardConnector[] = [];

  for (const item of args.itemById.values()) {
    if (item.dependencyClass !== 'carry-over') {
      continue;
    }

    const targetColumn = args.nodeColumnById.get(item.id) ?? null;
    if (targetColumn === null) {
      continue;
    }

    const sourceId = findPreviousColumnArtifactAncestorId({
      nodeId: item.id,
      expectedPreviousColumn: targetColumn - 1,
      reverseAdjacency: args.reverseAdjacency,
      nodeById: args.nodeById,
      nodeColumnById: args.nodeColumnById,
      producerInputBindings: args.producerInputBindings,
      renderedItemIds: args.renderedItemIds,
      visited: new Set<string>(),
    });
    if (!sourceId) {
      continue;
    }

    connectors.push({
      id: `${sourceId}->${item.id}`,
      fromItemId: sourceId,
      toItemId: item.id,
      kind: 'carry-over',
    });
  }

  return connectors;
}

function hasCarryOverProducerBinding(args: {
  nodeId: string;
  expectedPreviousColumn: number;
  activeReverseAdjacency: Map<string, string[]>;
  nodeById: Map<string, CanonicalNodeInstance>;
  nodeColumnById: Map<string, number | null>;
  producerInputBindings: Record<string, Record<string, string>>;
}): boolean {
  for (const upstreamId of args.activeReverseAdjacency.get(args.nodeId) ?? []) {
    const upstreamNode = args.nodeById.get(upstreamId);
    if (upstreamNode?.type !== 'Producer') {
      continue;
    }

    for (const sourceId of Object.values(args.producerInputBindings[upstreamId] ?? {})) {
      const sourceNode = args.nodeById.get(sourceId);
      const sourceColumn = args.nodeColumnById.get(sourceId) ?? null;
      if (
        sourceNode?.type === 'Artifact' &&
        sourceColumn === args.expectedPreviousColumn
      ) {
        return true;
      }
    }
  }

  return false;
}

function findPreviousColumnArtifactAncestorId(args: {
  nodeId: string;
  expectedPreviousColumn: number;
  reverseAdjacency: Map<string, string[]>;
  nodeById: Map<string, CanonicalNodeInstance>;
  nodeColumnById: Map<string, number | null>;
  producerInputBindings: Record<string, Record<string, string>>;
  renderedItemIds: Set<string>;
  visited: Set<string>;
}): string | null {
  if (args.visited.has(args.nodeId)) {
    return null;
  }
  args.visited.add(args.nodeId);

  const directCarryOverSource = findCarryOverProducerBindingSource({
    nodeId: args.nodeId,
    expectedPreviousColumn: args.expectedPreviousColumn,
    reverseAdjacency: args.reverseAdjacency,
    nodeById: args.nodeById,
    nodeColumnById: args.nodeColumnById,
    producerInputBindings: args.producerInputBindings,
    renderedItemIds: args.renderedItemIds,
  });
  if (directCarryOverSource) {
    return directCarryOverSource;
  }

  for (const sourceId of args.reverseAdjacency.get(args.nodeId) ?? []) {
    const sourceNode = args.nodeById.get(sourceId);
    if (!sourceNode) {
      continue;
    }

    const sourceColumn = args.nodeColumnById.get(sourceId) ?? null;
    if (
      sourceNode.type === 'Artifact' &&
      sourceColumn === args.expectedPreviousColumn &&
      args.renderedItemIds.has(sourceId)
    ) {
      return sourceId;
    }

    const nested = findPreviousColumnArtifactAncestorId({
      ...args,
      nodeId: sourceId,
    });
    if (nested) {
      return nested;
    }
  }

  return null;
}

function findCarryOverProducerBindingSource(args: {
  nodeId: string;
  expectedPreviousColumn: number;
  reverseAdjacency: Map<string, string[]>;
  nodeById: Map<string, CanonicalNodeInstance>;
  nodeColumnById: Map<string, number | null>;
  producerInputBindings: Record<string, Record<string, string>>;
  renderedItemIds: Set<string>;
}): string | null {
  for (const upstreamId of args.reverseAdjacency.get(args.nodeId) ?? []) {
    const upstreamNode = args.nodeById.get(upstreamId);
    if (upstreamNode?.type !== 'Producer') {
      continue;
    }

    for (const sourceId of Object.values(args.producerInputBindings[upstreamId] ?? {})) {
      const sourceNode = args.nodeById.get(sourceId);
      const sourceColumn = args.nodeColumnById.get(sourceId) ?? null;
      if (
        sourceNode?.type === 'Artifact' &&
        sourceColumn === args.expectedPreviousColumn &&
        args.renderedItemIds.has(sourceId)
      ) {
        return sourceId;
      }
    }
  }

  return null;
}
