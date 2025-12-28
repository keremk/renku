import type { CanonicalBlueprint } from './canonical-expander.js';
import { formatProducerScopedInputId, isCanonicalArtifactId, isCanonicalInputId, parseQualifiedProducerName } from '../parsing/canonical-ids.js';
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
      .filter((id) => isCanonicalArtifactId(id));

    const producerAlias = node.producerAlias;
    const catalogEntry = resolveCatalogEntry(producerAlias, catalog);
    if (!catalogEntry) {
      throw new Error(`Missing producer catalog entry for ${producerAlias}`);
    }
    const option = options.get(producerAlias);
    if (!option) {
      throw new Error(`Missing producer option for ${producerAlias}`);
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

    const inputBindings = canonical.inputBindings[node.id];
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
