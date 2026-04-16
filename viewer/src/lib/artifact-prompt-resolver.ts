import type { ArtifactInfo } from '@/types/builds';
import type {
  BindingSelector,
  BlueprintGraphData,
  ProducerBinding,
  ProducerBindingEndpoint,
} from '@/types/blueprint-graph';
import { resolveArtifactProducerNodeId } from './artifact-utils';

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
  mediaArtifact: ArtifactInfo;
  artifacts: ArtifactInfo[];
  graphData?: BlueprintGraphData;
}): ArtifactInfo | null {
  const { mediaArtifact, artifacts, graphData } = args;
  if (!graphData) {
    return null;
  }

  const producerNodeId = resolveArtifactProducerNodeId(mediaArtifact);
  if (!producerNodeId) {
    return null;
  }

  const mediaOutputPath = parseArtifactOutputPath(mediaArtifact.id);
  if (!mediaOutputPath) {
    return null;
  }

  const producerNode = graphData.nodes.find(
    (node) => node.type === 'producer' && node.id === producerNodeId
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

  const mediaIndices = parseIndices(mediaOutputPath);
  const candidateBindings = producerNode.inputBindings
    .filter((binding) => {
      const sourceEndpoint = binding.sourceEndpoint;
      const targetEndpoint = binding.targetEndpoint;
      return (
        sourceEndpoint?.kind === 'producer' &&
        targetEndpoint?.kind === 'producer' &&
        targetEndpoint.producerId === producerNodeId
      );
    })
    .sort((a, b) => scorePromptBinding(b) - scorePromptBinding(a));

  for (const binding of candidateBindings) {
    const sourceEndpoint = binding.sourceEndpoint;
    const targetEndpoint = binding.targetEndpoint;
    if (!sourceEndpoint || !targetEndpoint) {
      continue;
    }

    const resolvedIndices = resolveBindingIndices(targetEndpoint, mediaIndices);
    if (!resolvedIndices) {
      continue;
    }

    const normalizedSourceArtifactId = materializeSourceArtifactId(
      sourceEndpoint,
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

function parseArtifactOutputPath(artifactId: string): string | null {
  const match = /^Artifact:[^.]+\.(.+)$/.exec(artifactId);
  if (!match) {
    return null;
  }
  return match[1];
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

  return normalizeArtifactId(`Artifact:${endpoint.producerName}.${outputPath}`);
}

function materializeEndpointPath(
  segments: ProducerBindingEndpoint['segments'],
  resolved: ResolvedBindingIndices
): string | null {
  const pathParts: string[] = [];
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
    pathParts.push(part);
  }

  return pathParts.join('.');
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
    return namedValue;
  }

  const positionalValue = resolved.ordered[positionalIndex];
  if (positionalValue === undefined) {
    return null;
  }

  return positionalValue;
}

function scorePromptBinding(binding: ProducerBinding): number {
  const fromTokens = [
    ...(binding.sourceEndpoint?.segments.map((segment) => segment.name) ?? []),
    binding.sourceEndpoint?.outputName,
  ]
    .filter((token): token is string => typeof token === 'string')
    .join('.')
    .toLowerCase();

  const toTokens = [
    ...(binding.targetEndpoint?.segments.map((segment) => segment.name) ?? []),
    binding.targetEndpoint?.inputName,
  ]
    .filter((token): token is string => typeof token === 'string')
    .join('.')
    .toLowerCase();

  let score = 0;

  for (const keyword of PRIMARY_PROMPT_KEYWORDS) {
    if (fromTokens.includes(keyword)) {
      score += 100;
    }
    if (toTokens.includes(keyword)) {
      score += 60;
    }
  }

  for (const keyword of SECONDARY_PROMPT_KEYWORDS) {
    if (fromTokens.includes(keyword)) {
      score += 25;
    }
    if (toTokens.includes(keyword)) {
      score += 10;
    }
  }

  return score;
}
