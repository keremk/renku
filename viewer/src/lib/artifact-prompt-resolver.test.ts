import { describe, expect, it } from 'vitest';
import { resolvePromptArtifactForMedia } from './artifact-prompt-resolver';
import type { ArtifactInfo } from '@/types/builds';
import type { BlueprintGraphData } from '@/types/blueprint-graph';

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
});
