import type { BlueprintGraphData } from '@/types/blueprint-graph';

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
  const candidateBindings = producerNode.inputBindings.filter(
    (binding) =>
      binding.targetType === 'producer' &&
      extractProducerAlias(binding.to) === parsedAudio.producer &&
      extractInputAlias(binding.to) === inputName
  );

  for (const binding of candidateBindings) {
    const resolvedIndices = resolveBindingIndices(binding.to, audioIndices);
    if (!resolvedIndices) {
      continue;
    }

    if (binding.sourceType === 'input') {
      const resolvedInputName = materializeInputName(
        binding.from,
        resolvedIndices
      );
      if (!resolvedInputName) {
        continue;
      }
      return { kind: 'input', inputName: resolvedInputName };
    }

    if (binding.sourceType === 'producer') {
      const resolvedArtifactId = materializeSourceArtifactId(
        binding.from,
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

function extractProducerAlias(path: string): string {
  const [producerSegment] = path.split('.');
  return producerSegment.replace(/\[[^\]]*\]/g, '');
}

function extractInputAlias(path: string): string | null {
  const firstDot = path.indexOf('.');
  if (firstDot < 0) {
    return null;
  }

  const remainder = path.slice(firstDot + 1);
  const [inputSegment] = remainder.split('.');
  if (!inputSegment) {
    return null;
  }

  return inputSegment.replace(/\[[^\]]*\]/g, '');
}

function resolveBindingIndices(
  bindingTo: string,
  mediaIndices: IndexLookup
): ResolvedBindingIndices | null {
  const ordered: number[] = [];
  const named = new Map<string, number>();
  const bracketPattern = /\[([^\]]+)\]/g;

  let fallbackIndex = 0;
  for (const match of bindingTo.matchAll(bracketPattern)) {
    const token = match[1];

    const numericToken = parseNumericToken(token);
    if (numericToken !== null) {
      ordered.push(numericToken);
      fallbackIndex += 1;
      continue;
    }

    const namedToken = parseNamedToken(token);
    if (namedToken) {
      ordered.push(namedToken.value);
      named.set(namedToken.name, namedToken.value);
      fallbackIndex += 1;
      continue;
    }

    const namedValue = mediaIndices.named.get(token);
    if (namedValue !== undefined) {
      ordered.push(namedValue);
      named.set(token, namedValue);
      fallbackIndex += 1;
      continue;
    }

    const positionalValue = mediaIndices.ordered[fallbackIndex];
    if (positionalValue === undefined) {
      return null;
    }

    ordered.push(positionalValue);
    named.set(token, positionalValue);
    fallbackIndex += 1;
  }

  return { ordered, named };
}

function materializeInputName(
  bindingFrom: string,
  resolved: ResolvedBindingIndices
): string | null {
  let positionalIndex = 0;
  const resolvedName = bindingFrom
    .replace(/^Input\./, '')
    .replace(/\[([^\]]+)\]/g, (_full, token: string) => {
      const numericToken = parseNumericToken(token);
      if (numericToken !== null) {
        return `[${numericToken}]`;
      }

      const namedToken = parseNamedToken(token);
      if (namedToken) {
        return `[${namedToken.value}]`;
      }

      const namedValue = resolved.named.get(token);
      if (namedValue !== undefined) {
        return `[${namedValue}]`;
      }

      const positionalValue = resolved.ordered[positionalIndex];
      positionalIndex += 1;

      if (positionalValue === undefined) {
        return '[unresolved]';
      }

      return `[${positionalValue}]`;
    });

  if (resolvedName.includes('[unresolved]')) {
    return null;
  }

  return resolvedName;
}

function materializeSourceArtifactId(
  bindingFrom: string,
  resolved: ResolvedBindingIndices
): string | null {
  const firstDot = bindingFrom.indexOf('.');
  if (firstDot === -1) {
    return null;
  }

  const sourceProducer = extractProducerAlias(bindingFrom);
  const sourceOutputTemplate = bindingFrom.slice(firstDot + 1);
  let positionalIndex = 0;

  const outputPath = sourceOutputTemplate.replace(
    /\[([^\]]+)\]/g,
    (_full, token: string) => {
      const numericToken = parseNumericToken(token);
      if (numericToken !== null) {
        return `[${numericToken}]`;
      }

      const namedToken = parseNamedToken(token);
      if (namedToken) {
        return `[${namedToken.value}]`;
      }

      const namedValue = resolved.named.get(token);
      if (namedValue !== undefined) {
        return `[${namedValue}]`;
      }

      const positionalValue = resolved.ordered[positionalIndex];
      positionalIndex += 1;

      if (positionalValue === undefined) {
        return '[unresolved]';
      }

      return `[${positionalValue}]`;
    }
  );

  if (outputPath.includes('[unresolved]')) {
    return null;
  }

  return `Artifact:${sourceProducer}.${outputPath}`;
}

function parseNumericToken(token: string): number | null {
  if (!/^\d+$/.test(token)) {
    return null;
  }
  return Number.parseInt(token, 10);
}

function parseNamedToken(
  token: string
): { name: string; value: number } | null {
  const match = /^(\w+)=(\d+)$/.exec(token);
  if (!match) {
    return null;
  }

  return {
    name: match[1],
    value: Number.parseInt(match[2], 10),
  };
}
