import type { CanonicalBlueprint } from './canonical-expander.js';
import {
  formatCanonicalArtifactId,
  formatCanonicalProducerId,
  formatProducerScopedInputIdForCanonicalProducerId,
  isCanonicalArtifactId,
  isCanonicalInputId,
  parseCanonicalOutputId,
} from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import { deriveProducerFamilyId } from '../orchestration/producer-overrides.js';
import type {
  BlueprintOutputDefinition,
  BlueprintProducerOutputDefinition,
  BlueprintProducerSdkMappingField,
  EdgeConditionClause,
  EdgeConditionDefinition,
  EdgeConditionGroup,
  FanInDescriptor,
  ConditionalInputBindingCandidate,
  InputArtifactSource,
  InputConditionInfo,
  ProducerCatalog,
  ProducerGraph,
  ProducerGraphEdge,
  ProducerGraphNode,
  ResolvedOutputRoute,
  ResolvedScalarBinding,
} from '../types.js';
import type { CanonicalEdgeInstance } from './canonical-expander.js';

export function createProducerGraph(
  canonical: CanonicalBlueprint,
  catalog: ProducerCatalog,
  options: Map<string, {
    sdkMapping?: Record<string, BlueprintProducerSdkMappingField>;
    outputs?: Record<string, BlueprintProducerOutputDefinition>;
    inputSchema?: string;
    outputSchema?: string;
    config?: Record<string, unknown>;
    selectionInputKeys?: string[];
    configInputPaths?: string[];
  }>,
): ProducerGraph {
  const nodeMap = new Map(canonical.nodes.map((node) => [node.id, node]));
  const artifactProducers = computeArtifactProducers(canonical, nodeMap);

  // Build set of artifacts that are actually connected downstream
  // (used as input to another node or chained to another artifact)
  const connectedArtifacts = computeConnectedArtifacts(canonical);

  // Build a map of edges by target producer for input-level conditions
  // Edges may target Input nodes (e.g., Input:ImageProducer.Prompt[0][0])
  // but we need to look up by Producer node ID (e.g., Producer:ImageProducer[0][0])
  const edgesByTargetProducer = new Map<string, CanonicalEdgeInstance[]>();
  for (const edge of canonical.edges) {
    const producerId = extractProducerIdFromTarget(edge.to);
    if (producerId) {
      const list = edgesByTargetProducer.get(producerId) ?? [];
      list.push(edge);
      edgesByTargetProducer.set(producerId, list);
    }
  }

  const nodes: ProducerGraphNode[] = [];
  const edges: ProducerGraphEdge[] = [];
  const edgeSet = new Set<string>();

  for (const node of canonical.nodes) {
    if (node.type !== 'Producer') {
      continue;
    }

    const inboundInputs = canonical.edges.filter((edge) => edge.to === node.id).map((edge) => edge.from);
    const producedArtifacts = canonical.edges
      .filter((edge) => edge.from === node.id)
      .map((edge) => edge.to)
      .filter((id) => isCanonicalArtifactId(id))
      // Only include artifacts that are actually connected downstream
      .filter((id) => connectedArtifacts.has(id));
    const producerAlias = node.producerAlias;
    const catalogEntry = resolveCatalogEntry(producerAlias, catalog);
    if (!catalogEntry) {
      throw createRuntimeError(
        RuntimeErrorCode.MISSING_PRODUCER_CATALOG_ENTRY,
        `Missing producer catalog entry for ${producerAlias}`,
        { context: producerAlias },
      );
    }
    const option = options.get(producerAlias);
    if (!option) {
      throw createRuntimeError(
        RuntimeErrorCode.NO_PRODUCER_OPTIONS,
        `Missing producer option for ${producerAlias}`,
        { context: producerAlias },
      );
    }
    const selectionInputs = option.selectionInputKeys ?? [];
    const configInputs = option.configInputPaths ?? [];
    const canonicalProducerId = deriveProducerFamilyId(node.id);
    const extraInputs = [...selectionInputs, ...configInputs].map((key) =>
      formatProducerScopedInputIdForCanonicalProducerId(
        canonicalProducerId,
        key
      ),
    );
    const allInputs = Array.from(new Set([...inboundInputs, ...extraInputs]));

    // Get input bindings early for building inputs list and dependency tracking
    const resolvedScalarBindings = readResolvedScalarBindingsForProducer(
      canonical,
      node.id
    );

    const inputBindings = canonical.inputBindings[node.id];
    const conditionalInputBindings =
      canonical.conditionalInputBindings?.[node.id];
    const resolvedConditionalInputBindings = conditionalInputBindings
      ? resolveConditionalInputBindingConditions(
          conditionalInputBindings,
          canonical.outputSources
        )
      : undefined;

    // Add artifact IDs from inputBindings to the inputs list
    // This ensures element-level bindings (e.g., ReferenceImages[0] -> Artifact:...) are included
    if (inputBindings) {
      for (const sourceId of Object.values(inputBindings)) {
        if (typeof sourceId === 'string' && isCanonicalArtifactId(sourceId)) {
          if (!allInputs.includes(sourceId)) {
            allInputs.push(sourceId);
          }
        }
      }
    }
    if (conditionalInputBindings) {
      for (const candidates of Object.values(conditionalInputBindings)) {
        for (const candidate of candidates) {
          if (
            typeof candidate.sourceId === 'string' &&
            isCanonicalArtifactId(candidate.sourceId) &&
            !allInputs.includes(candidate.sourceId)
          ) {
            allInputs.push(candidate.sourceId);
          }
        }
      }
    }
    if (resolvedScalarBindings) {
      for (const binding of resolvedScalarBindings) {
        if (
          isCanonicalArtifactId(binding.sourceId) &&
          !allInputs.includes(binding.sourceId)
        ) {
          allInputs.push(binding.sourceId);
        }
      }
    }

    const fanInSpecs =
      canonical.resolvedFanInDescriptors ?? canonical.fanIn;
    const fanInForJob: Record<string, FanInDescriptor> = {};
    if (fanInSpecs) {
      for (const inputId of allInputs) {
        const spec = fanInSpecs[inputId];
        if (spec) {
          fanInForJob[inputId] = spec;
        }
      }
    }

    const dependencyKeys = new Set(allInputs.filter((key) => isCanonicalArtifactId(key)));
    for (const spec of Object.values(fanInForJob)) {
      for (const member of spec.members) {
        dependencyKeys.add(member.id);
      }
    }
    // Also track dependencies from inputBindings (for virtual artifact edges that target Input nodes)
    if (inputBindings) {
      for (const sourceId of Object.values(inputBindings)) {
        if (typeof sourceId === 'string' && isCanonicalArtifactId(sourceId)) {
          dependencyKeys.add(sourceId);
        }
      }
    }
    if (conditionalInputBindings) {
      for (const candidates of Object.values(conditionalInputBindings)) {
        for (const candidate of candidates) {
          if (isCanonicalArtifactId(candidate.sourceId)) {
            dependencyKeys.add(candidate.sourceId);
          }
        }
      }
    }

    for (const dependencyKey of dependencyKeys) {
      const upstream = artifactProducers.get(dependencyKey);
      if (upstream && upstream !== node.id) {
        const edgeKey = `${upstream}->${node.id}`;
        if (!edgeSet.has(edgeKey)) {
          edges.push({ from: upstream, to: node.id });
          edgeSet.add(edgeKey);
        }
      }
    }

    const canonicalSdkMapping = normalizeSdkMapping(
      option.sdkMapping ?? node.producer?.sdkMapping,
    );

    const legacyInputConditions = collectLegacyInputConditions({
      node,
      nodeMap,
      edgesByTargetProducer,
      inputBindings,
      outputSources: canonical.outputSources,
    });
    const inputConditions = resolvedScalarBindings
      ? mergeLegacyInputConditionsForUnresolvedEdges(
          buildResolvedInputConditions(
            resolvedScalarBindings,
            fanInForJob,
            canonical.outputSources
          ),
          legacyInputConditions
        )
      : legacyInputConditions;
    const inputArtifactSources = buildInputArtifactSources({
      allInputs,
      fanInForJob,
      inputBindings,
      conditionalInputBindings,
      artifactProducers,
      nodeMap,
      catalog,
    });
    const outputDefinitions = collectProducedOutputDefinitions({
      producerId: node.id,
      canonical,
      nodeMap,
    });

    const nodeContext = {
      namespacePath: node.namespacePath,
      indices: node.indices,
      producerAlias: producerAlias,
      producerId: formatCanonicalProducerId(node.namespacePath, node.name),
      inputs: allInputs,
      produces: producedArtifacts,
      inputBindings: inputBindings && Object.keys(inputBindings).length > 0 ? inputBindings : undefined,
      conditionalInputBindings:
        resolvedConditionalInputBindings &&
        Object.keys(resolvedConditionalInputBindings).length > 0
          ? resolvedConditionalInputBindings
          : undefined,
      sdkMapping: canonicalSdkMapping,
      outputs: option.outputs ?? node.producer?.outputs,
      fanIn: Object.keys(fanInForJob).length > 0 ? fanInForJob : undefined,
      inputConditions: Object.keys(inputConditions).length > 0 ? inputConditions : undefined,
      extras: {
        schema: {
          input: option.inputSchema,
          output: option.outputSchema,
        },
        outputDefinitions,
        inputArtifactSources:
          Object.keys(inputArtifactSources).length > 0
            ? inputArtifactSources
            : undefined,
      },
    };
    nodes.push({
      jobId: node.id,
      producer: producerAlias,
      inputs: allInputs,
      produces: producedArtifacts,
      provider: catalogEntry.provider,
      providerModel: catalogEntry.providerModel,
      rateKey: catalogEntry.rateKey,
      context: nodeContext,
    });
  }

  return { nodes, edges };
}

function computeArtifactProducers(
  canonical: CanonicalBlueprint,
  nodeMap: Map<string, CanonicalBlueprint['nodes'][number]>,
): Map<string, string> {
  const map = new Map<string, string>();

  for (const edge of canonical.edges) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) {
      continue;
    }
    if (fromNode.type === 'Producer' && toNode.type === 'Artifact') {
      map.set(edge.to, edge.from);
    }
  }
  return map;
}

function normalizeSdkMapping(
  mapping: Record<string, BlueprintProducerSdkMappingField> | undefined,
): Record<string, BlueprintProducerSdkMappingField> {
  return mapping ?? {};
}

function readResolvedScalarBindingsForProducer(
  canonical: CanonicalBlueprint,
  producerId: string
): ResolvedScalarBinding[] | undefined {
  if (!canonical.resolvedScalarBindings) {
    return undefined;
  }

  const bindings = canonical.resolvedScalarBindings[producerId];
  if (!bindings) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
      `Canonical blueprint is missing resolved scalar bindings for producer "${producerId}".`
    );
  }

  return bindings;
}

function buildResolvedInputConditions(
  resolvedScalarBindings: ResolvedScalarBinding[],
  fanInForJob: Record<string, FanInDescriptor>,
  outputSources: Record<string, string>
): Record<string, InputConditionInfo> {
  const inputConditions: Record<string, InputConditionInfo> = {};

  for (const binding of resolvedScalarBindings) {
    if (!binding.optionalCondition) {
      continue;
    }
    setInputCondition(inputConditions, binding.sourceId, {
      condition: resolveConditionOutputSources(
        binding.optionalCondition.condition,
        outputSources
      ),
      indices: binding.optionalCondition.indices,
    });
  }

  for (const descriptor of Object.values(fanInForJob)) {
    for (const member of descriptor.members) {
      if (!member.condition) {
        continue;
      }
      setInputCondition(inputConditions, member.id, {
        condition: resolveConditionOutputSources(
          member.condition.condition,
          outputSources
        ),
        indices: member.condition.indices,
      });
    }
  }

  return inputConditions;
}

function setInputCondition(
  inputConditions: Record<string, InputConditionInfo>,
  inputId: string,
  conditionInfo: InputConditionInfo
): void {
  const existing = inputConditions[inputId];
  if (
    existing &&
    JSON.stringify(existing) !== JSON.stringify(conditionInfo)
  ) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
      `Resolved input "${inputId}" has conflicting condition metadata.`
    );
  }
  inputConditions[inputId] = conditionInfo;
}

function mergeLegacyInputConditionsForUnresolvedEdges(
  resolved: Record<string, InputConditionInfo>,
  legacy: Record<string, InputConditionInfo>
): Record<string, InputConditionInfo> {
  const merged = { ...resolved };
  for (const [inputId, conditionInfo] of Object.entries(legacy)) {
    if (merged[inputId]) {
      continue;
    }
    merged[inputId] = conditionInfo;
  }
  return merged;
}

function collectLegacyInputConditions(args: {
  node: CanonicalBlueprint['nodes'][number];
  nodeMap: Map<string, CanonicalBlueprint['nodes'][number]>;
  edgesByTargetProducer: Map<string, CanonicalEdgeInstance[]>;
  inputBindings: Record<string, string> | undefined;
  outputSources: Record<string, string>;
}): Record<string, InputConditionInfo> {
  const {
    node,
    nodeMap,
    edgesByTargetProducer,
    inputBindings,
    outputSources,
  } = args;
  const inputConditions: Record<string, InputConditionInfo> = {};
  const incomingEdges = edgesByTargetProducer.get(node.id) ?? [];
  for (const edge of incomingEdges) {
    if (edge.conditions && edge.indices) {
      inputConditions[edge.from] = {
        condition: resolveConditionOutputSources(
          edge.conditions,
          outputSources
        ),
        indices: edge.indices,
      };
    }
  }
  if (inputBindings) {
    for (const [alias, sourceId] of Object.entries(inputBindings)) {
      if (inputConditions[sourceId]) {
        continue;
      }

      const bindingEdge = incomingEdges.find((edge) => {
        if (edge.from !== sourceId || !edge.conditions || !edge.indices) {
          return false;
        }

        const targetNode = nodeMap.get(edge.to);
        return matchesProducerInputSourceTarget(targetNode, node, alias);
      });

      if (bindingEdge?.conditions && bindingEdge.indices) {
        inputConditions[sourceId] = {
          condition: resolveConditionOutputSources(
            bindingEdge.conditions,
            outputSources
          ),
          indices: bindingEdge.indices,
        };
      }
    }
  }
  return inputConditions;
}

function resolveConditionalInputBindingConditions(
  bindings: Record<string, ConditionalInputBindingCandidate[]>,
  outputSources: Record<string, string>
): Record<string, ConditionalInputBindingCandidate[]> {
  return Object.fromEntries(
    Object.entries(bindings).map(([alias, candidates]) => [
      alias,
      candidates.map((candidate) => ({
        ...candidate,
        condition: resolveConditionOutputSources(
          candidate.condition,
          outputSources
        ),
      })),
    ])
  );
}

function matchesProducerInputSourceTarget(
  targetNode: CanonicalBlueprint['nodes'][number] | undefined,
  producerNode: CanonicalBlueprint['nodes'][number],
  alias: string
): boolean {
  if (!targetNode || targetNode.type !== 'Input') {
    return false;
  }

  if (targetNode.name !== alias) {
    return false;
  }

  const expectedNamespacePath = [...producerNode.namespacePath, producerNode.name];
  if (targetNode.namespacePath.length !== expectedNamespacePath.length) {
    return false;
  }

  return targetNode.namespacePath.every(
    (segment, index) => segment === expectedNamespacePath[index]
  );
}

function resolveCatalogEntry(id: string, catalog: ProducerCatalog) {
  if (catalog[id as keyof ProducerCatalog]) {
    return catalog[id as keyof ProducerCatalog];
  }
  return undefined;
}

function buildInputArtifactSources(args: {
  allInputs: string[];
  fanInForJob: Record<string, FanInDescriptor>;
  inputBindings: Record<string, string> | undefined;
  conditionalInputBindings:
    | CanonicalBlueprint['conditionalInputBindings'][string]
    | undefined;
  artifactProducers: Map<string, string>;
  nodeMap: Map<string, CanonicalBlueprint['nodes'][number]>;
  catalog: ProducerCatalog;
}): Record<string, InputArtifactSource> {
  const {
    allInputs,
    fanInForJob,
    inputBindings,
    conditionalInputBindings,
    artifactProducers,
    nodeMap,
    catalog,
  } = args;

  const sources: Record<string, InputArtifactSource> = {};
  const artifactIds = new Set<string>();

  for (const inputId of allInputs) {
    if (isCanonicalArtifactId(inputId)) {
      artifactIds.add(inputId);
    }
  }

  if (inputBindings) {
    for (const sourceId of Object.values(inputBindings)) {
      if (isCanonicalArtifactId(sourceId)) {
        artifactIds.add(sourceId);
      }
    }
  }
  if (conditionalInputBindings) {
    for (const candidates of Object.values(conditionalInputBindings)) {
      for (const candidate of candidates) {
        if (isCanonicalArtifactId(candidate.sourceId)) {
          artifactIds.add(candidate.sourceId);
        }
      }
    }
  }

  for (const descriptor of Object.values(fanInForJob)) {
    for (const member of descriptor.members) {
      if (isCanonicalArtifactId(member.id)) {
        artifactIds.add(member.id);
      }
    }
  }

  for (const artifactId of artifactIds) {
    const upstreamJobId = artifactProducers.get(artifactId);
    if (!upstreamJobId) {
      continue;
    }

    const upstreamNode = nodeMap.get(upstreamJobId);
    if (!upstreamNode || upstreamNode.type !== 'Producer') {
      continue;
    }

    const catalogEntry = resolveCatalogEntry(upstreamNode.producerAlias, catalog);
    if (!catalogEntry) {
      throw createRuntimeError(
        RuntimeErrorCode.MISSING_PRODUCER_CATALOG_ENTRY,
        `Missing producer catalog entry for ${upstreamNode.producerAlias}`,
        { context: upstreamNode.producerAlias },
      );
    }

    sources[artifactId] = {
      artifactId,
      upstreamJobId,
      upstreamProducerId: formatCanonicalProducerId(
        upstreamNode.namespacePath,
        upstreamNode.name,
      ),
      upstreamProducerAlias: upstreamNode.producerAlias,
      provider: catalogEntry.provider,
      model: catalogEntry.providerModel,
    };
  }

  return sources;
}

/**
 * Extracts the Producer node ID from an edge target.
 * Handles both direct Producer targets and Input node targets.
 *
 * The canonical Input ID format is: "Input:<namespace>.<producerName>.<inputName>[indices]"
 * We need to extract the producer name with proper indices.
 *
 * Examples:
 * - "Producer:ImageProducer[0][0]" → "Producer:ImageProducer[0][0]"
 * - "Input:ImageProducer.Prompt[0][0]" → "Producer:ImageProducer[0][0]"
 * - "Input:Namespace.Producer.InputName[1][2]" → "Producer:Namespace.Producer[1][2]"
 * - "Artifact:..." → undefined (not a producer target)
 */
/**
 * Computes the set of artifact IDs that are actually connected downstream.
 * An artifact is "connected" if:
 * 1. It has an outgoing edge to another node (used as input or chains to another artifact), OR
 * 2. It's a root-level blueprint artifact (empty namespace path) - these are final outputs, OR
 * 3. It's referenced in a condition `when` clause on an edge
 *
 * Producer-specific artifacts (with non-empty namespace path) that have no downstream
 * connections are excluded - they're declared by the producer but not used in the blueprint.
 */
function computeConnectedArtifacts(canonical: CanonicalBlueprint): Set<string> {
  const connected = new Set<string>();

  // Mark artifacts that have outgoing edges as connected
  for (const edge of canonical.edges) {
    if (isCanonicalArtifactId(edge.from)) {
      connected.add(edge.from);
      continue;
    }
    if (edge.from.startsWith('Output:')) {
      const parsedOutputId = parseCanonicalOutputId(edge.from);
      connected.add(
        formatCanonicalArtifactId(parsedOutputId.path, parsedOutputId.name)
      );
    }
  }

  // Only top-level blueprint outputs keep an artifact "connected" on their own.
  // Imported producer-local Output nodes should not force unrelated schema-decomposed
  // fields into the producer job contract unless something downstream actually uses them.
  const rootOutputBindings = canonical.resolvedOutputRoutes?.length
    ? canonical.resolvedOutputRoutes
    : canonical.outputSourceBindings?.length
      ? canonical.outputSourceBindings
    : Object.entries(canonical.outputSources ?? {}).map(([outputId, sourceId]) => ({
        outputId,
        sourceId,
      }));
  for (const { outputId, sourceId } of rootOutputBindings) {
    const parsedOutputId = parseCanonicalOutputId(outputId);
    if (parsedOutputId.path.length > 0) {
      continue;
    }
    if (isCanonicalArtifactId(sourceId)) {
      connected.add(sourceId);
    }
  }

  // Root-level runtime artifacts are final outputs for leaf producer blueprints.
  for (const node of canonical.nodes) {
    if (node.type === 'Artifact' && node.namespacePath.length === 0) {
      connected.add(node.id);
    }
  }

  // Include artifacts referenced in condition `when` clauses
  const outputRoutesForConditions =
    canonical.resolvedOutputRoutes?.length
      ? canonical.resolvedOutputRoutes
      : canonical.outputSourceBindings;
  const outputConditionEdges: CanonicalEdgeInstance[] =
    outputRoutesForConditions?.flatMap((binding) =>
      isCanonicalArtifactId(binding.sourceId)
        ? [{
            from: binding.sourceId,
            to: binding.outputId,
            conditions: outputRouteCondition(binding),
            indices: binding.indices,
          }]
        : []
    ) ?? [];
  const conditionPatterns = extractConditionArtifactPatterns([
    ...canonical.edges,
    ...outputConditionEdges,
  ], canonical.outputSources);
  for (const node of canonical.nodes) {
    if (node.type === 'Artifact' && !connected.has(node.id)) {
      // Check if this artifact matches any condition pattern
      if (matchesConditionPattern(node.id, conditionPatterns)) {
        connected.add(node.id);
      }
    }
  }

  return connected;
}

function outputRouteCondition(
  binding: ResolvedOutputRoute | CanonicalBlueprint['outputSourceBindings'][number]
): EdgeConditionDefinition | undefined {
  return (
    (binding as CanonicalBlueprint['outputSourceBindings'][number]).conditions ??
    (binding as ResolvedOutputRoute).condition
  );
}

function collectProducedOutputDefinitions(args: {
  producerId: string;
  canonical: CanonicalBlueprint;
  nodeMap: Map<string, CanonicalBlueprint['nodes'][number]>;
}): Record<string, BlueprintOutputDefinition> | undefined {
  const { producerId, canonical, nodeMap } = args;
  const definitions: Record<string, BlueprintOutputDefinition> = {};

  for (const edge of canonical.edges) {
    if (edge.from !== producerId || !isCanonicalArtifactId(edge.to)) {
      continue;
    }
    const artifactNode = nodeMap.get(edge.to);
    if (artifactNode?.type !== 'Artifact' || !artifactNode.artifact) {
      continue;
    }
    definitions[artifactNode.name] = artifactNode.artifact;
  }

  return Object.keys(definitions).length > 0 ? definitions : undefined;
}

/**
 * Extracts artifact path patterns from condition `when` clauses.
 * The patterns are used to match canonical artifact IDs.
 *
 * Example: "DocProducer.VideoScript.Segments[segment].UseNarrationAudio"
 * Returns regex that treats symbolic indices as wildcards and numeric indices as exact.
 */
function extractConditionArtifactPatterns(
  edges: CanonicalEdgeInstance[],
  outputSources: Record<string, string>
): RegExp[] {
  const patterns: RegExp[] = [];

  for (const edge of edges) {
    if (!edge.conditions) {
      continue;
    }

    const whenPaths = extractWhenPaths(edge.conditions);
    for (const whenPath of whenPaths) {
      // Convert the when path to a pattern that can match canonical artifact IDs
      const pattern = whenPathToPattern(whenPath, outputSources);
      if (pattern) {
        patterns.push(pattern);
      }
    }
  }

  return patterns;
}

/**
 * Recursively extracts all `when` paths from a condition definition.
 */
function extractWhenPaths(condition: EdgeConditionDefinition): string[] {
  const paths: string[] = [];

  if (Array.isArray(condition)) {
    for (const item of condition) {
      paths.push(...extractWhenPaths(item));
    }
  } else if ('all' in condition || 'any' in condition) {
    const group = condition as EdgeConditionGroup;
    if (group.all) {
      for (const clause of group.all) {
        if ('when' in clause) {
          paths.push(clause.when);
        }
      }
    }
    if (group.any) {
      for (const clause of group.any) {
        if ('when' in clause) {
          paths.push(clause.when);
        }
      }
    }
  } else if ('when' in condition) {
    paths.push((condition as EdgeConditionClause).when);
  }

  return paths;
}

function resolveConditionOutputSources(
  condition: EdgeConditionDefinition,
  outputSources: Record<string, string>
): EdgeConditionDefinition {
  if (Array.isArray(condition)) {
    return condition.map((item) =>
      resolveConditionOutputSources(item, outputSources)
    ) as EdgeConditionDefinition;
  }

  if ('when' in condition) {
    return {
      ...condition,
      when: outputSources[condition.when] ?? condition.when,
    };
  }

  return {
    ...condition,
    ...(condition.all
      ? {
          all: condition.all.map((clause) => ({
            ...clause,
            when: outputSources[clause.when] ?? clause.when,
          })),
        }
      : {}),
    ...(condition.any
      ? {
          any: condition.any.map((clause) => ({
            ...clause,
            when: outputSources[clause.when] ?? clause.when,
          })),
        }
      : {}),
  };
}

/**
 * Converts a condition `when` path to a pattern for matching canonical artifact IDs.
 *
 * Example: "DocProducer.VideoScript.Segments[segment].UseNarrationAudio"
 * Returns regex that:
 * - Treats symbolic indices (e.g. [segment]) as wildcards that match numeric indices
 * - Keeps explicit numeric indices (e.g. [0]) exact
 */
function whenPathToPattern(
  whenPath: string,
  outputSources: Record<string, string>
): RegExp | null {
  if (isCanonicalInputId(whenPath)) {
    return null;
  }
  const resolvedPath = whenPath.startsWith('Output:')
    ? outputSources[whenPath]
    : whenPath;
  if (!resolvedPath || isCanonicalInputId(resolvedPath)) {
    return null;
  }
  if (!isCanonicalArtifactId(resolvedPath)) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_EXPANSION_ERROR,
      `Edge condition path must be canonical Artifact ID (Artifact:...), received "${resolvedPath}".`
    );
  }
  const normalizedPath = resolvedPath.slice('Artifact:'.length);
  if (!normalizedPath) {
    return null;
  }

  const wildcardToken = '__RENKU_ANY_INDEX__';
  const withWildcards = normalizedPath.replace(/\[([^\d\]]+)\]/g, wildcardToken);
  const escaped = escapeRegexLiteral(withWildcards);
  const regexSource = escaped.replace(
    new RegExp(escapeRegexLiteral(wildcardToken), 'g'),
    '\\[\\d+\\]',
  );
  return new RegExp(`^${regexSource}$`);
}

/**
 * Checks if a canonical artifact ID matches any of the condition patterns.
 *
 * Example:
 * - Artifact ID: "Artifact:DocProducer.VideoScript.Segments[0].UseNarrationAudio"
 * - Pattern: "DocProducer.VideoScript.Segments.UseNarrationAudio"
 * - Should match because the artifact is the concrete instance of the pattern
 */
function matchesConditionPattern(artifactId: string, patterns: RegExp[]): boolean {
  if (patterns.length === 0) {
    return false;
  }

  // Extract the artifact body (everything after "Artifact:")
  const body = artifactId.slice('Artifact:'.length);

  // Match against compiled regex patterns
  return patterns.some((pattern) => pattern.test(body));
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractProducerIdFromTarget(target: string): string | undefined {
  // If it's already a Producer ID, return as-is
  if (target.startsWith('Producer:')) {
    return target;
  }

  // If it's an Input or InputSource ID, extract the producer portion
  const inputPrefix = isCanonicalInputId(target)
    ? 'Input:'
    : target.startsWith('InputSource:')
      ? 'InputSource:'
      : undefined;
  if (inputPrefix) {
    const body = target.slice(inputPrefix.length);
    // Body format: "<namespace>.<producerName>.<inputName>[indices]"
    // The indices are at the END, after the input name
    // Example: "ImageProducer.Prompt[0][0]"
    //   - Producer name: "ImageProducer"
    //   - Input name: "Prompt"
    //   - Indices: "[0][0]"

    // Extract indices from the end
    let indicesStart = body.length;
    let depth = 0;
    for (let i = body.length - 1; i >= 0; i--) {
      const char = body[i];
      if (char === ']') {
        depth++;
        if (depth === 1) {
          // Starting a new bracket group from the end
          indicesStart = i + 1;
        }
      } else if (char === '[') {
        depth--;
        if (depth === 0) {
          // Found the start of this bracket group
          indicesStart = i;
        }
      } else if (depth === 0) {
        // We've moved past all trailing brackets
        break;
      }
    }

    const indices = body.slice(indicesStart);
    const bodyWithoutIndices = body.slice(0, indicesStart);

    // Now find the last dot to separate producer from input name
    const lastDotIndex = bodyWithoutIndices.lastIndexOf('.');
    if (lastDotIndex > 0) {
      const producerPart = bodyWithoutIndices.slice(0, lastDotIndex);
      return `Producer:${producerPart}${indices}`;
    }
  }

  return undefined;
}
