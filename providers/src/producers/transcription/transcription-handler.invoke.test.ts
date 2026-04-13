import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderJobContext, ProviderResult } from '../../types.js';
import type { STTOutput } from './types.js';

const mocks = vi.hoisted(() => ({
  concatenateWithSilence: vi.fn(),
  alignTranscriptionToTimeline: vi.fn(),
}));

vi.mock('./audio-concatenator.js', () => ({
  concatenateWithSilence: mocks.concatenateWithSilence,
}));

vi.mock('./timestamp-aligner.js', () => ({
  alignTranscriptionToTimeline: mocks.alignTranscriptionToTimeline,
}));

import { createTranscriptionHandler } from './transcription-handler.js';

async function writeBinaryFile(
  storageRoot: string,
  relativePath: string,
  data: Buffer
): Promise<void> {
  const absolutePath = resolve(storageRoot, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, data);
}

function createTranscriptionRequest(storageRoot: string): ProviderJobContext {
  return {
    jobId: 'transcription-job-1',
    provider: 'renku',
    model: 'speech/transcription',
    revision: 'rev-1',
    layerIndex: 0,
    attempt: 1,
    inputs: ['Artifact:TimelineComposer.Timeline', 'Input:StorageRoot'],
    produces: ['Artifact:TranscriptionProducer.Transcription'],
    context: {
      providerConfig: {
        stt: {
          provider: 'fal-ai',
          model: 'elevenlabs/speech-to-text',
          diarize: false,
          tag_audio_events: true,
        },
      },
      extras: {
        resolvedInputs: {
          'Artifact:TimelineComposer.Timeline': {
            duration: 6,
            tracks: [
              {
                kind: 'Transcription',
                clips: [
                  {
                    id: 'clip-0',
                    kind: 'Transcription',
                    startTime: 0,
                    duration: 3,
                    properties: {
                      assetId: 'Artifact:AudioProducer.GeneratedAudio[0]',
                    },
                  },
                  {
                    id: 'clip-1',
                    kind: 'Transcription',
                    startTime: 3,
                    duration: 3,
                    properties: {
                      assetId: 'Artifact:AudioProducer.GeneratedAudio[1]',
                    },
                  },
                ],
              },
            ],
          },
          'Input:StorageRoot': storageRoot,
          'Input:TranscriptionProducer.LanguageCode': 'spa',
        },
        assetBlobPaths: {
          'Artifact:AudioProducer.GeneratedAudio[0]':
            'builds/movie-test/blobs/a0/audio-0.mp3',
          'Artifact:AudioProducer.GeneratedAudio[1]':
            'builds/movie-test/blobs/a1/audio-1.mp3',
        },
      },
    },
  };
}

describe('createTranscriptionHandler invoke contract', () => {
  let storageRoot = '';

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'renku-transcription-invoke-'));
    await writeBinaryFile(
      storageRoot,
      'builds/movie-test/blobs/a0/audio-0.mp3',
      Buffer.from('audio-segment-0')
    );
    await writeBinaryFile(
      storageRoot,
      'builds/movie-test/blobs/a1/audio-1.mp3',
      Buffer.from('audio-segment-1')
    );
    mocks.concatenateWithSilence.mockReset();
    mocks.alignTranscriptionToTimeline.mockReset();
    mocks.concatenateWithSilence.mockResolvedValue(Buffer.from('wav-audio'));
  });

  afterEach(async () => {
    if (storageRoot) {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it('delegates to the inner STT handler with blob audio, forwarded language_code, and forwarded STT config fields', async () => {
    const sttOutput: STTOutput = {
      text: 'hola mundo',
      language_code: 'spa',
      language_probability: 0.98,
      words: [
        {
          text: 'hola',
          start: 0,
          end: 0.4,
          type: 'word',
        },
      ],
    };
    const alignedTranscription = {
      text: 'hola mundo',
      language: 'spa',
      words: [
        {
          text: 'hola',
          startTime: 0,
          endTime: 0.4,
          clipId: 'clip-0',
        },
      ],
      segments: [
        {
          clipId: 'clip-0',
          assetId: 'Artifact:AudioProducer.GeneratedAudio[0]',
          clipStartTime: 0,
          clipDuration: 3,
          text: 'hola mundo',
        },
      ],
      totalDuration: 6,
    };
    mocks.alignTranscriptionToTimeline.mockReturnValue(alignedTranscription);

    const sttInvoke = vi.fn<
      [ProviderJobContext],
      Promise<ProviderResult>
    >().mockResolvedValue({
      status: 'succeeded',
      artefacts: [
        {
          artefactId: 'Artifact:TranscriptionProducer.SttTranscription',
          status: 'succeeded',
          blob: {
            data: Buffer.from(JSON.stringify(sttOutput)),
            mimeType: 'application/json',
          },
        },
      ],
    });

    const handler = createTranscriptionHandler()({
      descriptor: {
        provider: 'renku',
        model: 'speech/transcription',
        environment: 'local',
      },
      mode: 'live',
      secretResolver: {
        async getSecret() {
          return null;
        },
      },
      handlerResolver: () => ({
        provider: 'fal-ai',
        model: 'elevenlabs/speech-to-text',
        environment: 'local',
        mode: 'live',
        invoke: sttInvoke,
      }),
      getModelSchema: async () =>
        JSON.stringify({
          input_schema: {
            type: 'object',
            properties: {
              audio_url: { type: 'string', format: 'uri' },
            },
          },
        }),
    });

    const result = await handler.invoke(createTranscriptionRequest(storageRoot));

    expect(result.status).toBe('succeeded');
    expect(sttInvoke).toHaveBeenCalledTimes(1);

    const delegatedJob = sttInvoke.mock.calls[0]![0];
    const delegatedExtras = delegatedJob.context.extras as {
      resolvedInputs: Record<string, unknown>;
      jobContext: {
        inputBindings: Record<string, string>;
        sdkMapping: Record<string, { field: string }>;
      };
      schema?: { raw?: string };
    };

    expect(delegatedJob.provider).toBe('fal-ai');
    expect(delegatedJob.model).toBe('elevenlabs/speech-to-text');
    expect(delegatedJob.produces).toEqual([
      'Artifact:TranscriptionProducer.SttTranscription',
    ]);
    expect(delegatedExtras.resolvedInputs['Input:audio_url']).toEqual({
      data: Buffer.from('wav-audio'),
      mimeType: 'audio/wav',
    });
    expect(delegatedExtras.resolvedInputs['Input:language_code']).toBe('spa');
    expect(delegatedExtras.resolvedInputs['Input:diarize']).toBe(false);
    expect(delegatedExtras.resolvedInputs['Input:tag_audio_events']).toBe(true);
    expect(delegatedExtras.jobContext.inputBindings).toMatchObject({
      audio_url: 'Input:audio_url',
      language_code: 'Input:language_code',
      diarize: 'Input:diarize',
      tag_audio_events: 'Input:tag_audio_events',
    });
    expect(delegatedExtras.jobContext.sdkMapping).toMatchObject({
      audio_url: { field: 'audio_url' },
      language_code: { field: 'language_code' },
      diarize: { field: 'diarize' },
      tag_audio_events: { field: 'tag_audio_events' },
    });
    expect(delegatedExtras.schema?.raw).toContain('audio_url');

    expect(mocks.alignTranscriptionToTimeline).toHaveBeenCalledWith(
      sttOutput,
      expect.arrayContaining([
        expect.objectContaining({
          clipId: 'clip-0',
          assetId: 'Artifact:AudioProducer.GeneratedAudio[0]',
        }),
        expect.objectContaining({
          clipId: 'clip-1',
          assetId: 'Artifact:AudioProducer.GeneratedAudio[1]',
        }),
      ])
    );
    expect(
      JSON.parse(result.artefacts[0]!.blob!.data.toString('utf8'))
    ).toEqual(alignedTranscription);
  });

  it('fails fast in live mode when delegated STT returns zero word tokens', async () => {
    mocks.alignTranscriptionToTimeline.mockReturnValue({
      text: '',
      language: 'spa',
      words: [],
      segments: [],
      totalDuration: 0,
    });

    const handler = createTranscriptionHandler()({
      descriptor: {
        provider: 'renku',
        model: 'speech/transcription',
        environment: 'local',
      },
      mode: 'live',
      secretResolver: {
        async getSecret() {
          return null;
        },
      },
      handlerResolver: () => ({
        provider: 'fal-ai',
        model: 'elevenlabs/speech-to-text',
        environment: 'local',
        mode: 'live',
        invoke: async () => ({
          status: 'succeeded',
          artefacts: [
            {
              artefactId: 'Artifact:TranscriptionProducer.SttTranscription',
              status: 'succeeded',
              blob: {
                data: Buffer.from(
                  JSON.stringify({
                    text: '',
                    language_code: 'spa',
                    language_probability: 0.95,
                    words: [
                      {
                        text: ' ',
                        start: 0,
                        end: 0.1,
                        type: 'spacing',
                      },
                    ],
                  } satisfies STTOutput)
                ),
                mimeType: 'application/json',
              },
            },
          ],
        }),
      }),
    });

    await expect(
      handler.invoke(createTranscriptionRequest(storageRoot))
    ).rejects.toThrow(/returned 0 words/i);
    expect(mocks.alignTranscriptionToTimeline).not.toHaveBeenCalled();
  });
});
