import type { CanonicalBlueprint } from './canonical-expander.js';
import { formatProducerScopedInputId, isCanonicalArtifactId, parseQualifiedProducerName } from '../parsing/canonical-ids.js';
import type {
  BlueprintProducerOutputDefinition,
  BlueprintProducerSdkMappingField,
  FanInDescriptor,
  ProducerCatalog,
  ProducerGraph,
  ProducerGraphEdge,
  ProducerGraphNode,
} from '../types.js';

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

    const qualifiedProducerName = node.qualifiedName;
    const canonicalProducerName = qualifiedProducerName;
    const catalogEntry = resolveCatalogEntry(canonicalProducerName, catalog);
    if (!catalogEntry) {
      throw new Error(`Missing producer catalog entry for ${qualifiedProducerName}`);
    }
    const option = options.get(canonicalProducerName);
    if (!option) {
      throw new Error(`Missing producer option for ${qualifiedProducerName}`);
    }
    const { namespacePath: producerNamespace, producerName: resolvedProducerName } = parseQualifiedProducerName(
      qualifiedProducerName,
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

    const nodeContext = {
      namespacePath: node.namespacePath,
      indices: node.indices,
      qualifiedName: qualifiedProducerName,
      inputs: allInputs,
      produces: producedArtefacts,
      inputBindings: inputBindings && Object.keys(inputBindings).length > 0 ? inputBindings : undefined,
      sdkMapping: canonicalSdkMapping,
      outputs: option.outputs ?? node.producer?.outputs,
      fanIn: Object.keys(fanInForJob).length > 0 ? fanInForJob : undefined,
      extras: {
        schema: {
          input: option.inputSchema,
          output: option.outputSchema,
        },
      },
    };
    nodes.push({
      jobId: node.id,
      producer: canonicalProducerName,
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
