import { describe, expect, it } from 'vitest';
import { resolvePromptArtifactForMedia } from './artifact-prompt-resolver';
import type { ArtifactInfo } from '@/types/builds';
import type {
  BindingEndpointSegment,
  BindingSelector,
  BlueprintGraphData,
  ProducerBindingEndpoint,
} from '@/types/blueprint-graph';

function makeArtifact(id: string, mimeType = 'text/plain'): ArtifactInfo {
  return {
    id,
    name: id.replace(/^Artifact:/, ''),
    hash: `${id}-hash`,
    size: 128,
    mimeType,
    status: 'succeeded',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeGraph(
  inputBindings: Array<{ from: string; to: string }>
): BlueprintGraphData {
  return {
    meta: { id: 'test', name: 'Test' },
    nodes: [
      {
        id: 'Producer:MediaProducer',
        type: 'producer',
        label: 'MediaProducer',
        inputBindings: inputBindings.map((binding) => ({
          ...binding,
          sourceType: 'producer',
          targetType: 'producer',
          sourceEndpoint: createProducerEndpoint(binding.from, 'source'),
          targetEndpoint: createProducerEndpoint(binding.to, 'target'),
          isConditional: false,
        })),
        outputBindings: [],
      },
    ],
    edges: [],
    inputs: [],
    outputs: [],
  };
}

function createProducerEndpoint(
  reference: string,
  role: 'source' | 'target'
): ProducerBindingEndpoint {
  const segments = parseSegments(reference);
  const anchor = segments[0];
  if (!anchor) {
    throw new Error(`Expected at least one endpoint segment in "${reference}".`);
  }

  const loopSelectors = anchor.selectors.filter(
    (selector): selector is Extract<BindingSelector, { kind: 'loop' }> =>
      selector.kind === 'loop'
  );
  const constantSelectors = anchor.selectors.filter(
    (selector): selector is Extract<BindingSelector, { kind: 'const' }> =>
      selector.kind === 'const'
  );
  const collectionSelectors = segments.flatMap((segment, segmentIndex) =>
    segmentIndex === 0
      ? []
      : segment.selectors.map((selector) => ({
          segment: segment.name,
          segmentIndex,
          selector,
        }))
  );

  return {
    kind: 'producer',
    reference,
    producerName: anchor.name,
    inputName: role === 'target' ? segments[1]?.name : undefined,
    outputName: role === 'source' ? segments[1]?.name : undefined,
    segments,
    loopSelectors,
    constantSelectors,
    collectionSelectors,
  };
}

function parseSegments(reference: string): BindingEndpointSegment[] {
  return reference.split('.').map((segment) => {
    const nameMatch = segment.match(/^[^[]+/);
    if (!nameMatch) {
      throw new Error(`Invalid endpoint segment "${segment}" in "${reference}".`);
    }
    const rawSelectors = segment.match(/\[[^\]]+]/g) ?? [];
    return {
      name: nameMatch[0],
      selectors: rawSelectors.map((raw) => parseSelector(raw.slice(1, -1))),
    };
  });
}

function parseSelector(raw: string): BindingSelector {
  if (/^\d+$/.test(raw)) {
    return {
      kind: 'const',
      raw,
      value: Number.parseInt(raw, 10),
    };
  }
  const match = /^([A-Za-z_][A-Za-z0-9_]*)([+-]\d+)?$/.exec(raw);
  if (!match) {
    throw new Error(`Invalid selector "${raw}" in test binding metadata.`);
  }
  return {
    kind: 'loop',
    raw,
    symbol: match[1],
    offset: match[2] ? Number.parseInt(match[2], 10) : 0,
  };
}

describe('resolvePromptArtifactForMedia', () => {
  it('resolves prompt artifact with named dimensions', () => {
    const artifacts = [
      makeArtifact('Artifact:PromptProducer.ImagePrompt[segment=1][image=0]'),
      makeArtifact(
        'Artifact:MediaProducer.GeneratedImage[segment=1][image=0]',
        'image/png'
      ),
    ];

    const graphData = makeGraph([
      {
        from: 'PromptProducer.ImagePrompt[segment][image]',
        to: 'MediaProducer[segment][image].Prompt',
      },
    ]);

    const resolved = resolvePromptArtifactForMedia({
      mediaArtifactId:
        'Artifact:MediaProducer.GeneratedImage[segment=1][image=0]',
      artifacts,
      graphData,
    });

    expect(resolved?.id).toBe(
      'Artifact:PromptProducer.ImagePrompt[segment=1][image=0]'
    );
  });

  it('resolves prompt artifact with positional dimensions', () => {
    const artifacts = [
      makeArtifact('Artifact:PromptProducer.VideoPrompt[2][1]'),
      makeArtifact('Artifact:MediaProducer.GeneratedVideo[2][1]', 'video/mp4'),
    ];

    const graphData = makeGraph([
      {
        from: 'PromptProducer.VideoPrompt[scene][shot]',
        to: 'MediaProducer[scene][shot].Prompt',
      },
    ]);

    const resolved = resolvePromptArtifactForMedia({
      mediaArtifactId: 'Artifact:MediaProducer.GeneratedVideo[2][1]',
      artifacts,
      graphData,
    });

    expect(resolved?.id).toBe('Artifact:PromptProducer.VideoPrompt[2][1]');
  });

  it('prefers prompt-like bindings when multiple text inputs exist', () => {
    const artifacts = [
      makeArtifact('Artifact:StoryProducer.SceneData[0]'),
      makeArtifact('Artifact:StoryProducer.VideoPrompt[0]'),
      makeArtifact('Artifact:MediaProducer.GeneratedVideo[0]', 'video/mp4'),
    ];

    const graphData = makeGraph([
      {
        from: 'StoryProducer.SceneData[scene]',
        to: 'MediaProducer[scene].Metadata',
      },
      {
        from: 'StoryProducer.VideoPrompt[scene]',
        to: 'MediaProducer[scene].Prompt',
      },
    ]);

    const resolved = resolvePromptArtifactForMedia({
      mediaArtifactId: 'Artifact:MediaProducer.GeneratedVideo[0]',
      artifacts,
      graphData,
    });

    expect(resolved?.id).toBe('Artifact:StoryProducer.VideoPrompt[0]');
  });

  it('returns null when no matching upstream prompt artifact exists', () => {
    const artifacts = [
      makeArtifact('Artifact:MediaProducer.GeneratedAudio[0]', 'audio/mpeg'),
    ];

    const graphData = makeGraph([
      {
        from: 'PromptProducer.AudioPrompt[clip]',
        to: 'MediaProducer[clip].Prompt',
      },
    ]);

    const resolved = resolvePromptArtifactForMedia({
      mediaArtifactId: 'Artifact:MediaProducer.GeneratedAudio[0]',
      artifacts,
      graphData,
    });

    expect(resolved).toBeNull();
  });

  it('maps positional tokens after fixed dimensions in target binding', () => {
    const artifacts = [
      makeArtifact('Artifact:PromptProducer.VideoPrompt[3]'),
      makeArtifact('Artifact:MediaProducer.GeneratedVideo[0][3]', 'video/mp4'),
    ];

    const graphData = makeGraph([
      {
        from: 'PromptProducer.VideoPrompt[shot]',
        to: 'MediaProducer[0][shot].Prompt',
      },
    ]);

    const resolved = resolvePromptArtifactForMedia({
      mediaArtifactId: 'Artifact:MediaProducer.GeneratedVideo[0][3]',
      artifacts,
      graphData,
    });

    expect(resolved?.id).toBe('Artifact:PromptProducer.VideoPrompt[3]');
  });

  it('does not double-apply selector offsets while resolving source artifact ids', () => {
    const artifacts = [
      makeArtifact('Artifact:PromptProducer.ImagePrompt[4]'),
      makeArtifact('Artifact:MediaProducer.GeneratedImage[3]', 'image/png'),
    ];

    const graphData = makeGraph([
      {
        from: 'PromptProducer.ImagePrompt[scene+1]',
        to: 'MediaProducer[scene+1].Prompt',
      },
    ]);

    const resolved = resolvePromptArtifactForMedia({
      mediaArtifactId: 'Artifact:MediaProducer.GeneratedImage[3]',
      artifacts,
      graphData,
    });

    expect(resolved?.id).toBe('Artifact:PromptProducer.ImagePrompt[4]');
  });
});
