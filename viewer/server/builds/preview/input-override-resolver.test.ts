import { describe, expect, it } from 'vitest';
import type { ProducerGraph } from '@gorenku/core';
import { resolveInputOverrideTargets } from './input-override-resolver.js';

function createProducerGraph(): ProducerGraph {
  return {
    nodes: [
      {
        jobId: 'Producer:NarrationProducer[3]',
        producer: 'NarrationProducer',
        inputs: [],
        produces: ['Artifact:NarrationProducer.GeneratedAudio[3]'],
        provider: 'elevenlabs',
        providerModel: 'eleven_v3',
        rateKey: 'elevenlabs/eleven_v3',
        context: {
          namespacePath: [],
          indices: { scene: 3 },
          producerAlias: 'NarrationProducer',
          inputs: [],
          produces: ['Artifact:NarrationProducer.GeneratedAudio[3]'],
          inputBindings: {
            VoiceId: 'Input:NarratorVoiceId',
            Emotion: 'Artifact:StoryProducer.Storyboard.Scenes[3].Emotion',
          },
          sdkMapping: {
            VoiceId: { field: 'voice' },
            Emotion: { field: 'emotion' },
          },
        },
      },
    ],
    edges: [],
  };
}

describe('resolveInputOverrideTargets', () => {
  it('maps override keys to canonical bindings from source job', () => {
    const graph = createProducerGraph();

    const resolved = resolveInputOverrideTargets({
      sourceJobId: 'Producer:NarrationProducer[3]',
      producerGraph: graph,
      inputOverrides: {
        VoiceId: 'new-voice',
        Emotion: 'serious',
      },
    });

    expect(resolved).toEqual([
      {
        inputName: 'VoiceId',
        canonicalId: 'Input:NarratorVoiceId',
        value: 'new-voice',
      },
      {
        inputName: 'Emotion',
        canonicalId: 'Artifact:StoryProducer.Storyboard.Scenes[3].Emotion',
        value: 'serious',
      },
    ]);
  });

  it('throws when source producer job is missing', () => {
    const graph = createProducerGraph();

    expect(() =>
      resolveInputOverrideTargets({
        sourceJobId: 'Producer:NarrationProducer[99]',
        producerGraph: graph,
        inputOverrides: { VoiceId: 'new-voice' },
      })
    ).toThrow(
      'source producer job Producer:NarrationProducer[99] was not found'
    );
  });

  it('throws when requested override key has no input binding', () => {
    const graph = createProducerGraph();
    const source = graph.nodes[0];
    if (!source?.context?.sdkMapping) {
      throw new Error('Expected sdkMapping in test graph');
    }
    source.context.sdkMapping = {
      UnknownField: { field: 'unknown_field' },
    };

    expect(() =>
      resolveInputOverrideTargets({
        sourceJobId: 'Producer:NarrationProducer[3]',
        producerGraph: graph,
        inputOverrides: { UnknownField: 'value' },
      })
    ).toThrow('binding is missing');
  });

  it('ignores override keys that are not in the selected model sdkMapping', () => {
    const graph = createProducerGraph();
    const source = graph.nodes[0];
    if (!source?.context?.sdkMapping) {
      throw new Error('Expected sdkMapping in test graph');
    }

    source.context.sdkMapping = {
      VoiceId: { field: 'voice' },
    };

    const resolved = resolveInputOverrideTargets({
      sourceJobId: 'Producer:NarrationProducer[3]',
      producerGraph: graph,
      inputOverrides: {
        VoiceId: 'new-voice',
        Emotion: 'serious',
      },
    });

    expect(resolved).toEqual([
      {
        inputName: 'VoiceId',
        canonicalId: 'Input:NarratorVoiceId',
        value: 'new-voice',
      },
    ]);
  });
});
