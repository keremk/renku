import type { CanonicalBlueprint } from './canonical-expander.js';
import { formatProducerScopedInputId, isCanonicalArtifactId, isCanonicalInputId, parseQualifiedProducerName } from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type {
  BlueprintProducerOutputDefinition,
  BlueprintProducerSdkMappingField,
  FanInDescriptor,
  InputConditionInfo,
  ProducerCatalog,
  ProducerGraph,
  ProducerGraphEdge,
  ProducerGraphNode,
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
  const artefactProducers = computeArtefactProducers(canonical, nodeMap);

  // Build set of artifacts that are actually connected downstream
  // (used as input to another node or chained to another artifact)
  const connectedArtifacts = computeConnectedArtifacts(canonical);

  // Build a map of (from, to) -> edge for looking up conditions
  const edgesByKey = new Map<string, CanonicalEdgeInstance>();
  for (const edge of canonical.edges) {
    edgesByKey.set(`${edge.from}->${edge.to}`, edge);
  }

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
    const producedArtefacts = canonical.edges
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
    const { namespacePath: producerNamespace, producerName: resolvedProducerName } = parseQualifiedProducerName(
      producerAlias,
    );
    const selectionInputs = option.selectionInputKeys ?? [];
    const configInputs = option.configInputPaths ?? [];
    const extraInputs = [...selectionInputs, ...configInputs].map((key) =>
      formatProducerScopedInputId(producerNamespace, resolvedProducerName, key),
    );
    const allInputs = Array.from(new Set([...inboundInputs, ...extraInputs]));

    // Get input bindings early for building inputs list and dependency tracking
    const inputBindings = canonical.inputBindings[node.id];

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

    const fanInSpecs = canonical.fanIn;
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

    for (const dependencyKey of dependencyKeys) {
      const upstream = artefactProducers.get(dependencyKey);
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

    // Collect input conditions from edges targeting this producer
    const inputConditions: Record<string, InputConditionInfo> = {};
    const incomingEdges = edgesByTargetProducer.get(node.id) ?? [];
    for (const edge of incomingEdges) {
      if (edge.conditions && edge.indices) {
        inputConditions[edge.from] = {
          condition: edge.conditions,
          indices: edge.indices,
        };
      }
    }

    const nodeContext = {
      namespacePath: node.namespacePath,
      indices: node.indices,
      producerAlias: producerAlias,
      inputs: allInputs,
      produces: producedArtefacts,
      inputBindings: inputBindings && Object.keys(inputBindings).length > 0 ? inputBindings : undefined,
      sdkMapping: canonicalSdkMapping,
      outputs: option.outputs ?? node.producer?.outputs,
      fanIn: Object.keys(fanInForJob).length > 0 ? fanInForJob : undefined,
      inputConditions: Object.keys(inputConditions).length > 0 ? inputConditions : undefined,
      extras: {
        schema: {
          input: option.inputSchema,
          output: option.outputSchema,
        },
      },
    };
    nodes.push({
      jobId: node.id,
      producer: producerAlias,
      inputs: allInputs,
      produces: producedArtefacts,
      provider: catalogEntry.provider,
      providerModel: catalogEntry.providerModel,
      rateKey: catalogEntry.rateKey,
      context: nodeContext,
    });
  }

  return { nodes, edges };
}

function computeArtefactProducers(
  canonical: CanonicalBlueprint,
  nodeMap: Map<string, CanonicalBlueprint['nodes'][number]>,
): Map<string, string> {
  const map = new Map<string, string>();

  // First pass: capture direct Producer -> Artifact edges
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

  // Build artifact-to-artifact edge lookup for chain resolution
  const artifactAliases = new Map<string, string>();
  for (const edge of canonical.edges) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) {
      continue;
    }
    // Track Artifact -> Artifact edges (e.g., producer output -> blueprint artifact)
    if (fromNode.type === 'Artifact' && toNode.type === 'Artifact') {
      artifactAliases.set(edge.to, edge.from);
    }
  }

  // Second pass: resolve chains transitively
  // If ArtifactB is written from ArtifactA, and ArtifactA is produced by ProducerX,
  // then ArtifactB is also produced by ProducerX
  for (const [artifactId, sourceArtifactId] of artifactAliases) {
    let current = sourceArtifactId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const producer = map.get(current);
      if (producer) {
        map.set(artifactId, producer);
        break;
      }
      // Follow the chain
      current = artifactAliases.get(current) ?? '';
    }
  }

  return map;
}

function normalizeSdkMapping(
  mapping: Record<string, BlueprintProducerSdkMappingField> | undefined,
): Record<string, BlueprintProducerSdkMappingField> {
  return mapping ?? {};
}

function resolveCatalogEntry(id: string, catalog: ProducerCatalog) {
  if (catalog[id as keyof ProducerCatalog]) {
    return catalog[id as keyof ProducerCatalog];
  }
  return undefined;
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
 * 2. It's a root-level blueprint artifact (empty namespace path) - these are final outputs
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
    }
  }

  // Also include root-level artifacts (empty namespace path) as they're blueprint outputs
  for (const node of canonical.nodes) {
    if (node.type === 'Artifact' && node.namespacePath.length === 0) {
      connected.add(node.id);
    }
  }

  return connected;
}

function extractProducerIdFromTarget(target: string): string | undefined {
  // If it's already a Producer ID, return as-is
  if (target.startsWith('Producer:')) {
    return target;
  }

  // If it's an Input ID, extract the producer portion
  if (isCanonicalInputId(target)) {
    const body = target.slice('Input:'.length);
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
