import type { ArtifactInfo } from '@/types/builds';
import type {
  BlueprintGraphData,
  ProducerBinding,
} from '@/types/blueprint-graph';

interface IndexLookup {
  ordered: number[];
  named: Map<string, number>;
}

interface ResolvedBindingIndices {
  ordered: number[];
  named: Map<string, number>;
}

const PRIMARY_PROMPT_KEYWORDS = ['prompt'];
const SECONDARY_PROMPT_KEYWORDS = [
  'script',
  'caption',
  'description',
  'lyrics',
  'narration',
  'text',
];

/**
 * Resolve the upstream prompt artifact for a media artifact using producer input bindings.
 */
export function resolvePromptArtifactForMedia(args: {
  mediaArtifactId: string;
  artifacts: ArtifactInfo[];
  graphData?: BlueprintGraphData;
}): ArtifactInfo | null {
  const { mediaArtifactId, artifacts, graphData } = args;
  if (!graphData) {
    return null;
  }

  const parsedMedia = parseArtifactId(mediaArtifactId);
  if (!parsedMedia) {
    return null;
  }

  const producerNode = graphData.nodes.find(
    (node) =>
      node.type === 'producer' &&
      (node.id === `Producer:${parsedMedia.producer}` ||
        node.label === parsedMedia.producer)
  );
  if (!producerNode?.inputBindings) {
    return null;
  }

  const textArtifacts = artifacts.filter(isTextLikeArtifact);
  if (textArtifacts.length === 0) {
    return null;
  }

  const byNormalizedId = new Map<string, ArtifactInfo>();
  for (const artifact of textArtifacts) {
    byNormalizedId.set(normalizeArtifactId(artifact.id), artifact);
  }

  const mediaIndices = parseIndices(parsedMedia.outputPath);
  const candidateBindings = producerNode.inputBindings
    .filter(
      (binding) =>
        binding.sourceType === 'producer' &&
        extractProducerAlias(binding.to) === parsedMedia.producer
    )
    .sort((a, b) => scorePromptBinding(b) - scorePromptBinding(a));

  for (const binding of candidateBindings) {
    const resolvedIndices = resolveBindingIndices(binding.to, mediaIndices);
    if (!resolvedIndices) {
      continue;
    }

    const normalizedSourceArtifactId = materializeSourceArtifactId(
      binding.from,
      resolvedIndices
    );
    if (!normalizedSourceArtifactId) {
      continue;
    }

    const promptArtifact = byNormalizedId.get(normalizedSourceArtifactId);
    if (promptArtifact) {
      return promptArtifact;
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

function isTextLikeArtifact(artifact: ArtifactInfo): boolean {
  return (
    artifact.mimeType.startsWith('text/') ||
    artifact.mimeType === 'application/json'
  );
}

function normalizeArtifactId(artifactId: string): string {
  return artifactId.replace(/\[(?:\w+=)?(\d+)\]/g, '[$1]');
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

  const normalizedOutputPath = sourceOutputTemplate.replace(
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

  if (normalizedOutputPath.includes('[unresolved]')) {
    return null;
  }

  return normalizeArtifactId(
    `Artifact:${sourceProducer}.${normalizedOutputPath}`
  );
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

function scorePromptBinding(binding: ProducerBinding): number {
  const fromPath = binding.from.toLowerCase();
  const toPath = binding.to.toLowerCase();

  let score = 0;

  for (const keyword of PRIMARY_PROMPT_KEYWORDS) {
    if (fromPath.includes(keyword)) {
      score += 100;
    }
    if (toPath.includes(keyword)) {
      score += 60;
    }
  }

  for (const keyword of SECONDARY_PROMPT_KEYWORDS) {
    if (fromPath.includes(keyword)) {
      score += 25;
    }
    if (toPath.includes(keyword)) {
      score += 10;
    }
  }

  return score;
}
