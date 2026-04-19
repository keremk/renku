import { describe, expect, it } from 'vitest';
import { createSttNormalizerHandler } from './stt-normalizer.js';
import type { HandlerFactoryInit } from '../../types.js';

function createInit(
  sttNormalizer?: string | null,
): HandlerFactoryInit {
  const modelDefinition: Record<string, unknown> = {
    name: 'elevenlabs/speech-to-text',
    type: 'stt',
  };
  if (sttNormalizer !== null) {
    modelDefinition.sttNormalizer =
      sttNormalizer === undefined
        ? 'elevenlabs-word-timestamps-v1'
        : sttNormalizer;
  }

  return {
    descriptor: {
      provider: 'renku',
      model: 'speech/stt-normalizer',
      environment: 'local',
    },
    mode: 'simulated',
    secretResolver: {
      async getSecret() {
        return null;
      },
    },
    getModelDefinition: () => modelDefinition as any,
  };
}

describe('stt normalizer handler', () => {
  it('normalizes elevenlabs word timestamps into the internal transcript shape', async () => {
    const handler = createSttNormalizerHandler()(createInit());
    const response = await handler.invoke({
      jobId: 'job-1',
      provider: 'renku',
      model: 'speech/stt-normalizer',
      revision: 'rev-test',
      layerIndex: 0,
      attempt: 1,
      inputs: ['Artifact:SubtitlesProducer.STTTimestamps.RawTranscription[0]'],
      produces: ['Artifact:SubtitlesProducer.STTNormalizer.NormalizedTranscript[0]'],
      context: {
        environment: 'local',
        extras: {
          resolvedInputs: {
            'Artifact:SubtitlesProducer.STTTimestamps.RawTranscription[0]': {
              text: 'Hello there',
              language_code: 'eng',
              words: [
                { text: 'Hello', start: 0.1, end: 0.4, type: 'word' },
                { text: ' ', start: 0.4, end: 0.45, type: 'spacing' },
                { text: 'there', start: 0.5, end: 0.9, type: 'word' },
              ],
            },
          },
          inputArtifactSources: {
            'Artifact:SubtitlesProducer.STTTimestamps.RawTranscription[0]': {
              artifactId: 'Artifact:SubtitlesProducer.STTTimestamps.RawTranscription[0]',
              upstreamJobId: 'Producer:SubtitlesProducer.STTTimestamps[0]',
              upstreamProducerId: 'Producer:SubtitlesProducer.STTTimestamps[0]',
              upstreamProducerAlias: 'SubtitlesProducer.STTTimestamps',
              provider: 'fal-ai',
              model: 'elevenlabs/speech-to-text',
            },
          },
        },
      },
    });

    expect(response.status).toBe('succeeded');
    const artifact = response.artifacts[0];
    expect(artifact?.blob?.mimeType).toBe('application/json');

    const payload = JSON.parse(String(artifact?.blob?.data));
    expect(payload).toEqual({
      text: 'Hello there',
      language: 'eng',
      words: [
        { text: 'Hello', startTime: 0.1, endTime: 0.4 },
        { text: 'there', startTime: 0.5, endTime: 0.9 },
      ],
      sourceDuration: 0.9,
    });
  });

  it('fails fast when the upstream stt model does not declare a normalizer', async () => {
    const handler = createSttNormalizerHandler()(createInit(null));

    await expect(
      handler.invoke({
        jobId: 'job-2',
        provider: 'renku',
        model: 'speech/stt-normalizer',
        revision: 'rev-test',
        layerIndex: 0,
        attempt: 1,
        inputs: ['Artifact:SubtitlesProducer.STTTimestamps.RawTranscription[0]'],
        produces: ['Artifact:SubtitlesProducer.STTNormalizer.NormalizedTranscript[0]'],
        context: {
          environment: 'local',
          extras: {
            resolvedInputs: {
              'Artifact:SubtitlesProducer.STTTimestamps.RawTranscription[0]': {
                text: 'Hello',
                language_code: 'eng',
                words: [],
              },
            },
            inputArtifactSources: {
              'Artifact:SubtitlesProducer.STTTimestamps.RawTranscription[0]': {
                artifactId: 'Artifact:SubtitlesProducer.STTTimestamps.RawTranscription[0]',
                upstreamJobId: 'Producer:SubtitlesProducer.STTTimestamps[0]',
                upstreamProducerId: 'Producer:SubtitlesProducer.STTTimestamps[0]',
                upstreamProducerAlias: 'SubtitlesProducer.STTTimestamps',
                provider: 'fal-ai',
                model: 'elevenlabs/speech-to-text',
              },
            },
          },
        },
      }),
    ).rejects.toThrow(/does not declare a subtitles normalizer/i);
  });
});
