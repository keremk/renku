import { describe, expect, it } from 'vitest';
import type {
  BindingEndpointSegment,
  BindingSelector,
  BlueprintGraphData,
  ProducerBindingEndpoint,
  ProducerBinding,
} from '@/types/blueprint-graph';
import { resolveAudioInputBindingSource } from './audio-input-binding-resolver';

function createGraphData(bindings: ProducerBinding[]): BlueprintGraphData {
  return {
    meta: { id: 'test', name: 'Test Graph' },
    nodes: [
      {
        id: 'Producer:NarrationProducer',
        type: 'producer',
        label: 'NarrationProducer',
        inputBindings: bindings,
        outputBindings: [],
      },
    ],
    edges: [],
    inputs: [],
    outputs: [],
  };
}

describe('resolveAudioInputBindingSource', () => {
  it('resolves input-bound and artifact-bound sources for indexed audio artifacts', () => {
    const graphData = createGraphData([
      {
        from: 'NarratorVoiceId',
        to: 'NarrationProducer[scene].VoiceId',
        sourceType: 'input',
        targetType: 'producer',
        sourceEndpoint: createInputEndpoint('NarratorVoiceId'),
        targetEndpoint: createProducerEndpoint(
          'NarrationProducer[scene].VoiceId',
          'target'
        ),
        isConditional: true,
      },
      {
        from: 'StoryProducer.Storyboard.Scenes[scene].Emotion',
        to: 'NarrationProducer[scene].Emotion',
        sourceType: 'producer',
        targetType: 'producer',
        sourceEndpoint: createProducerEndpoint(
          'StoryProducer.Storyboard.Scenes[scene].Emotion',
          'source'
        ),
        targetEndpoint: createProducerEndpoint(
          'NarrationProducer[scene].Emotion',
          'target'
        ),
        isConditional: true,
      },
    ]);

    const voiceSource = resolveAudioInputBindingSource({
      audioArtifactId: 'Artifact:NarrationProducer.GeneratedAudio[3]',
      inputName: 'VoiceId',
      graphData,
    });
    const emotionSource = resolveAudioInputBindingSource({
      audioArtifactId: 'Artifact:NarrationProducer.GeneratedAudio[3]',
      inputName: 'Emotion',
      graphData,
    });

    expect(voiceSource).toEqual({
      kind: 'input',
      inputName: 'NarratorVoiceId',
    });
    expect(emotionSource).toEqual({
      kind: 'artifact',
      artifactId: 'Artifact:StoryProducer.Storyboard.Scenes[3].Emotion',
    });
  });

  it('returns null when matching producer binding does not exist', () => {
    const graphData = createGraphData([
      {
        from: 'NarratorVoiceId',
        to: 'NarrationProducer[scene].VoiceId',
        sourceType: 'input',
        targetType: 'producer',
        sourceEndpoint: createInputEndpoint('NarratorVoiceId'),
        targetEndpoint: createProducerEndpoint(
          'NarrationProducer[scene].VoiceId',
          'target'
        ),
        isConditional: true,
      },
    ]);

    const source = resolveAudioInputBindingSource({
      audioArtifactId: 'Artifact:NarrationProducer.GeneratedAudio[0]',
      inputName: 'Emotion',
      graphData,
    });

    expect(source).toBeNull();
  });
});

function createInputEndpoint(reference: string): ProducerBindingEndpoint {
  const segments = parseSegments(reference);
  const anchor = segments[0];
  if (!anchor) {
    throw new Error(`Expected at least one input endpoint segment in "${reference}".`);
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
    kind: 'input',
    reference,
    inputName: anchor.name,
    segments,
    loopSelectors,
    constantSelectors,
    collectionSelectors,
  };
}

function createProducerEndpoint(
  reference: string,
  role: 'source' | 'target'
): ProducerBindingEndpoint {
  const segments = parseSegments(reference);
  const anchor = segments[0];
  if (!anchor) {
    throw new Error(`Expected at least one producer endpoint segment in "${reference}".`);
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
