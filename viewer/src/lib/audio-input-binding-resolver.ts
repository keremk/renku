import type {
  BindingSelector,
  BlueprintGraphData,
  ProducerBindingEndpoint,
} from '@/types/blueprint-graph';

interface IndexLookup {
  ordered: number[];
  named: Map<string, number>;
}

interface ResolvedBindingIndices {
  ordered: number[];
  named: Map<string, number>;
}

export type AudioInputBindingSource =
  | { kind: 'input'; inputName: string }
  | { kind: 'artifact'; artifactId: string };

export function resolveAudioInputBindingSource(args: {
  audioArtifactId: string;
  inputName: string;
  graphData?: BlueprintGraphData;
}): AudioInputBindingSource | null {
  const { audioArtifactId, inputName, graphData } = args;
  if (!graphData) {
    return null;
  }

  const parsedAudio = parseArtifactId(audioArtifactId);
  if (!parsedAudio) {
    return null;
  }

  const producerNode = graphData.nodes.find(
    (node) =>
      node.type === 'producer' &&
      (node.id === `Producer:${parsedAudio.producer}` ||
        node.label === parsedAudio.producer)
  );
  if (!producerNode?.inputBindings) {
    return null;
  }

  const audioIndices = parseIndices(parsedAudio.outputPath);
  const candidateBindings = producerNode.inputBindings.filter((binding) => {
    const targetEndpoint = binding.targetEndpoint;
    return (
      targetEndpoint?.kind === 'producer' &&
      targetEndpoint.producerName === parsedAudio.producer &&
      targetEndpoint.inputName === inputName
    );
  });

  for (const binding of candidateBindings) {
    const sourceEndpoint = binding.sourceEndpoint;
    const targetEndpoint = binding.targetEndpoint;
    if (!sourceEndpoint || !targetEndpoint) {
      continue;
    }

    const resolvedIndices = resolveBindingIndices(targetEndpoint, audioIndices);
    if (!resolvedIndices) {
      continue;
    }

    if (sourceEndpoint.kind === 'input') {
      const resolvedInputName = materializeInputName(
        sourceEndpoint,
        resolvedIndices
      );
      if (!resolvedInputName) {
        continue;
      }
      return { kind: 'input', inputName: resolvedInputName };
    }

    if (sourceEndpoint.kind === 'producer') {
      const resolvedArtifactId = materializeSourceArtifactId(
        sourceEndpoint,
        resolvedIndices
      );
      if (!resolvedArtifactId) {
        continue;
      }
      return { kind: 'artifact', artifactId: resolvedArtifactId };
    }
  }

  return null;
}

function parseArtifactId(
  artifactId: string
): { producer: string; outputPath: string } | null {
  const match = /^Artifact:([^.]+)\.(.+)$/.exec(artifactId);
  if (!match) {
    return null;
  }

  return {
    producer: match[1],
    outputPath: match[2],
  };
}

function parseIndices(path: string): IndexLookup {
  const ordered: number[] = [];
  const named = new Map<string, number>();
  const bracketPattern = /\[(?:(\w+)=)?(\d+)\]/g;

  for (const match of path.matchAll(bracketPattern)) {
    const name = match[1];
    const value = Number.parseInt(match[2], 10);
    ordered.push(value);
    if (name) {
      named.set(name, value);
    }
  }

  return { ordered, named };
}

function resolveBindingIndices(
  endpoint: ProducerBindingEndpoint,
  artifactIndices: IndexLookup
): ResolvedBindingIndices | null {
  const ordered: number[] = [];
  const named = new Map<string, number>();

  let fallbackIndex = 0;
  for (const selector of flattenEndpointSelectors(endpoint)) {
    const resolvedValue = resolveSelectorFromArtifactIndices(
      selector,
      artifactIndices,
      fallbackIndex
    );
    if (resolvedValue === null) {
      return null;
    }

    ordered.push(resolvedValue);
    if (selector.kind === 'loop') {
      named.set(selector.symbol, resolvedValue);
    }
    fallbackIndex += 1;
  }

  return { ordered, named };
}

function flattenEndpointSelectors(endpoint: ProducerBindingEndpoint): BindingSelector[] {
  const selectors: BindingSelector[] = [];
  for (const segment of endpoint.segments) {
    selectors.push(...segment.selectors);
  }
  return selectors;
}

function resolveSelectorFromArtifactIndices(
  selector: BindingSelector,
  artifactIndices: IndexLookup,
  fallbackIndex: number
): number | null {
  if (selector.kind === 'const') {
    return selector.value;
  }

  const namedValue = artifactIndices.named.get(selector.symbol);
  if (namedValue !== undefined) {
    return namedValue + selector.offset;
  }

  const positionalValue = artifactIndices.ordered[fallbackIndex];
  if (positionalValue === undefined) {
    return null;
  }

  return positionalValue + selector.offset;
}

function materializeInputName(
  endpoint: ProducerBindingEndpoint,
  resolved: ResolvedBindingIndices
): string | null {
  if (endpoint.kind !== 'input') {
    return null;
  }

  return materializeEndpointPath(endpoint.segments, resolved);
}

function materializeSourceArtifactId(
  endpoint: ProducerBindingEndpoint,
  resolved: ResolvedBindingIndices
): string | null {
  if (endpoint.kind !== 'producer' || !endpoint.producerName) {
    return null;
  }

  const outputSegments = endpoint.segments.slice(1);
  if (outputSegments.length === 0) {
    return null;
  }

  const outputPath = materializeEndpointPath(outputSegments, resolved);
  if (!outputPath) {
    return null;
  }

  return `Artifact:${endpoint.producerName}.${outputPath}`;
}

function materializeEndpointPath(
  segments: ProducerBindingEndpoint['segments'],
  resolved: ResolvedBindingIndices
): string | null {
  const parts: string[] = [];
  let positionalIndex = 0;

  for (const segment of segments) {
    let part = segment.name;
    for (const selector of segment.selectors) {
      const resolvedValue = materializeSelectorValue(
        selector,
        resolved,
        positionalIndex
      );
      positionalIndex += 1;
      if (resolvedValue === null) {
        return null;
      }
      part += `[${resolvedValue}]`;
    }
    parts.push(part);
  }

  return parts.join('.');
}

function materializeSelectorValue(
  selector: BindingSelector,
  resolved: ResolvedBindingIndices,
  positionalIndex: number
): number | null {
  if (selector.kind === 'const') {
    return selector.value;
  }

  const namedValue = resolved.named.get(selector.symbol);
  if (namedValue !== undefined) {
    return namedValue + selector.offset;
  }

  const positionalValue = resolved.ordered[positionalIndex];
  if (positionalValue === undefined) {
    return null;
  }

  return positionalValue + selector.offset;
}
