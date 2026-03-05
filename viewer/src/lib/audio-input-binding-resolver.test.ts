import { describe, expect, it } from 'vitest';
import type {
  BlueprintGraphData,
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
        isConditional: true,
      },
      {
        from: 'StoryProducer.Storyboard.Scenes[scene].Emotion',
        to: 'NarrationProducer[scene].Emotion',
        sourceType: 'producer',
        targetType: 'producer',
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
