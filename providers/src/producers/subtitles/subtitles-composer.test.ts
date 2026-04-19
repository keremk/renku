import { describe, expect, it } from 'vitest';
import type { TimelineDocument } from '@gorenku/compositions';
import { createSubtitlesComposerHandler } from './subtitles-composer.js';
import type { HandlerFactoryInit } from '../../types.js';

function createInit(): HandlerFactoryInit {
  return {
    descriptor: {
      provider: 'renku',
      model: 'speech/subtitles-composer',
      environment: 'local',
    },
    mode: 'simulated',
    secretResolver: {
      async getSecret() {
        return null;
      },
    },
  };
}

describe('subtitles composer handler', () => {
  it('aligns sparse normalized transcripts to the final timeline by group index', async () => {
    const handler = createSubtitlesComposerHandler()(createInit());
    const timeline: TimelineDocument = {
      id: 'timeline-1',
      duration: 10,
      tracks: [
        {
          id: 'track-transcription',
          kind: 'Transcription',
          clips: [
            {
              id: 'clip-0',
              kind: 'Transcription',
              startTime: 0,
              duration: 3,
              properties: {
                assetId: 'Artifact:AudioProducer.GeneratedAudio[0]',
                groupIndex: 0,
              },
            },
            {
              id: 'clip-2',
              kind: 'Transcription',
              startTime: 6,
              duration: 2,
              properties: {
                assetId: 'Artifact:AudioProducer.GeneratedAudio[2]',
                groupIndex: 2,
              },
            },
          ],
        },
      ],
    };

    const response = await handler.invoke({
      jobId: 'job-1',
      provider: 'renku',
      model: 'speech/subtitles-composer',
      revision: 'rev-test',
      layerIndex: 0,
      attempt: 1,
      inputs: [],
      produces: ['Artifact:SubtitlesProducer.SubtitlesComposer.Transcription'],
      context: {
        environment: 'local',
        extras: {
          resolvedInputs: {
            'Artifact:TimelineComposer.Timeline': timeline,
            'Input:Duration': 10,
            'Input:SubtitlesProducer.SubtitlesComposer.Transcripts': {
              groupBy: 'segment',
              groups: [
                ['Artifact:SubtitlesProducer.STTNormalizer.NormalizedTranscript[0]'],
                [],
                ['Artifact:SubtitlesProducer.STTNormalizer.NormalizedTranscript[2]'],
              ],
            },
            'Artifact:SubtitlesProducer.STTNormalizer.NormalizedTranscript[0]': {
              text: 'Hello there',
              language: 'eng',
              words: [
                { text: 'Hello', startTime: 0.2, endTime: 0.4 },
                { text: 'there', startTime: 0.5, endTime: 0.8 },
              ],
              sourceDuration: 0.8,
            },
            'Artifact:SubtitlesProducer.STTNormalizer.NormalizedTranscript[2]': {
              text: 'again',
              language: 'eng',
              words: [
                { text: 'again', startTime: 0.1, endTime: 0.3 },
              ],
              sourceDuration: 0.3,
            },
          },
          jobContext: {
            inputBindings: {
              Timeline: 'Artifact:TimelineComposer.Timeline',
              Duration: 'Input:Duration',
            },
            fanIn: {
              'Input:SubtitlesProducer.SubtitlesComposer.Transcripts': {
                groupBy: 'segment',
                members: [],
              },
            },
          },
        },
      },
    });

    const artifact = response.artifacts[0];
    const payload = JSON.parse(String(artifact?.blob?.data));

    expect(payload.text).toBe('Hello there again');
    expect(payload.language).toBe('eng');
    expect(payload.totalDuration).toBe(10);
    expect(payload.words).toEqual([
      { text: 'Hello', startTime: 0.2, endTime: 0.4, clipId: 'clip-0' },
      { text: 'there', startTime: 0.5, endTime: 0.8, clipId: 'clip-0' },
      { text: 'again', startTime: 6.1, endTime: 6.3, clipId: 'clip-2' },
    ]);
    expect(payload.segments).toEqual([
      {
        clipId: 'clip-0',
        assetId: 'Artifact:AudioProducer.GeneratedAudio[0]',
        clipStartTime: 0,
        clipDuration: 3,
        text: 'Hello there',
      },
      {
        clipId: 'clip-2',
        assetId: 'Artifact:AudioProducer.GeneratedAudio[2]',
        clipStartTime: 6,
        clipDuration: 2,
        text: 'again',
      },
    ]);
  });
});
