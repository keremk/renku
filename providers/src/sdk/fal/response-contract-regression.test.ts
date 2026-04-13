import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createUnifiedHandler } from '../unified/schema-first-handler.js';
import type { HandlerFactoryInit, ProviderJobContext } from '../../types.js';
import { falAdapter } from './adapter.js';

function readFixtureSchema(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8'
  );
}

function createInit(model: string): HandlerFactoryInit {
  return {
    descriptor: {
      provider: 'fal-ai',
      model,
      environment: 'local',
    },
    mode: 'simulated',
    secretResolver: {
      async getSecret() {
        return 'mock-fal-key';
      },
    },
  };
}

function createRequest(args: {
  model: string;
  schemaRaw: string;
  resolvedInputs: Record<string, unknown>;
  inputBindings: Record<string, string>;
  sdkMapping: Record<string, { field: string; required?: boolean }>;
  produces: string[];
}): ProviderJobContext {
  return {
    jobId: `job-${args.model.replace(/[^a-z0-9]+/gi, '-')}`,
    provider: 'fal-ai',
    model: args.model,
    revision: 'rev-1',
    layerIndex: 0,
    attempt: 1,
    inputs: Object.values(args.inputBindings),
    produces: args.produces,
    context: {
      providerConfig: {},
      extras: {
        resolvedInputs: args.resolvedInputs,
        jobContext: {
          inputBindings: args.inputBindings,
          sdkMapping: args.sdkMapping,
        },
        plannerContext: { index: { segment: 0 } },
        schema: { raw: args.schemaRaw },
      },
    },
  };
}

describe('fal-ai unified response contract regressions', () => {
  it('saves STT artifacts at the schema root with no fal transport wrapper fields', async () => {
    const schemaRaw = readFixtureSchema(
      '../../../tests/fixtures/unified-provider-contract/fal-stt-schema.fixture.json'
    );
    const handler = createUnifiedHandler({
      adapter: falAdapter,
      outputMimeType: 'application/json',
    })(createInit('elevenlabs/speech-to-text'));

    const result = await handler.invoke(
      createRequest({
        model: 'elevenlabs/speech-to-text',
        schemaRaw,
        resolvedInputs: {
          'Input:audio_url': 'https://example.com/audio.mp3',
          'Input:language_code': 'eng',
        },
        inputBindings: {
          audio_url: 'Input:audio_url',
          language_code: 'Input:language_code',
        },
        sdkMapping: {
          audio_url: { field: 'audio_url', required: true },
          language_code: { field: 'language_code' },
        },
        produces: ['Artifact:TranscriptionProducer.SttTranscription'],
      })
    );

    const saved = JSON.parse(result.artefacts[0]!.blob!.data.toString('utf8')) as Record<
      string,
      unknown
    >;

    expect(Object.keys(saved)).toEqual(
      expect.arrayContaining([
        'text',
        'language_code',
        'language_probability',
        'words',
      ])
    );
    expect(Object.keys(saved)).toHaveLength(4);
    expect(saved).not.toHaveProperty('data');
    expect(saved).not.toHaveProperty('data.text');
    expect(saved).not.toHaveProperty('requestId');
    expect(saved).not.toHaveProperty('providerRequestId');
    expect(saved.words).toBeInstanceOf(Array);
  });

  it('saves fal JSON model outputs at the root without wrapper leakage', async () => {
    const schemaRaw = readFixtureSchema(
      '../../../tests/fixtures/unified-provider-contract/fal-json-voice-schema.fixture.json'
    );
    const handler = createUnifiedHandler({
      adapter: falAdapter,
      outputMimeType: 'application/json',
    })(createInit('kling-video/create-voice'));

    const result = await handler.invoke(
      createRequest({
        model: 'kling-video/create-voice',
        schemaRaw,
        resolvedInputs: {
          'Input:voice_url': 'https://example.com/voice.wav',
        },
        inputBindings: {
          voice_url: 'Input:voice_url',
        },
        sdkMapping: {
          voice_url: { field: 'voice_url', required: true },
        },
        produces: ['Artifact:VoiceProducer.CreatedVoice'],
      })
    );

    const saved = JSON.parse(result.artefacts[0]!.blob!.data.toString('utf8')) as Record<
      string,
      unknown
    >;

    expect(saved).toHaveProperty('voice_id');
    expect(Object.keys(saved)).toEqual(['voice_id']);
    expect(saved).not.toHaveProperty('data');
    expect(saved).not.toHaveProperty('requestId');
  });

  it('still produces fal image artifacts in simulated mode after adapter unwrapping', async () => {
    const schemaRaw = readFixtureSchema(
      '../../../tests/fixtures/unified-provider-contract/fal-image-schema.fixture.json'
    );
    const handler = createUnifiedHandler({
      adapter: falAdapter,
      outputMimeType: 'image/png',
    })(createInit('wan/v2-6-text-to-image'));

    const result = await handler.invoke(
      createRequest({
        model: 'wan/v2-6-text-to-image',
        schemaRaw,
        resolvedInputs: {
          'Input:Prompt': 'A city skyline at sunset',
        },
        inputBindings: {
          Prompt: 'Input:Prompt',
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
        },
        produces: [
          'Artifact:ImageProducer.GeneratedImage[0]',
          'Artifact:ImageProducer.GeneratedImage[1]',
        ],
      })
    );

    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(2);
    expect(
      result.artefacts.every(
        (artefact) =>
          artefact.status === 'succeeded' &&
          artefact.diagnostics?.sourceUrl &&
          artefact.blob?.mimeType === 'image/png'
      )
    ).toBe(true);
  });

  it('still produces fal video artifacts and derived extractions in simulated mode', async () => {
    const schemaRaw = readFixtureSchema(
      '../../../tests/fixtures/unified-provider-contract/fal-video-schema.fixture.json'
    );
    const handler = createUnifiedHandler({
      adapter: falAdapter,
      outputMimeType: 'video/mp4',
    })(createInit('wan/v2-6-text-to-video'));

    const result = await handler.invoke(
      createRequest({
        model: 'wan/v2-6-text-to-video',
        schemaRaw,
        resolvedInputs: {
          'Input:Prompt': 'A robot walking through a rainy alley',
          'Input:Duration': 5,
        },
        inputBindings: {
          Prompt: 'Input:Prompt',
          Duration: 'Input:Duration',
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
        },
        produces: [
          'Artifact:VideoProducer.GeneratedVideo',
          'Artifact:VideoProducer.FirstFrame',
          'Artifact:VideoProducer.LastFrame',
          'Artifact:VideoProducer.AudioTrack',
        ],
      })
    );

    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(4);
    expect(
      result.artefacts.find((artefact) => artefact.artefactId === 'Artifact:VideoProducer.GeneratedVideo')
        ?.blob?.mimeType
    ).toBe('video/mp4');
    expect(
      result.artefacts.find((artefact) => artefact.artefactId === 'Artifact:VideoProducer.FirstFrame')
        ?.blob?.mimeType
    ).toBe('image/png');
    expect(
      result.artefacts.find((artefact) => artefact.artefactId === 'Artifact:VideoProducer.LastFrame')
        ?.blob?.mimeType
    ).toBe('image/png');
    expect(
      result.artefacts.find((artefact) => artefact.artefactId === 'Artifact:VideoProducer.AudioTrack')
        ?.blob?.mimeType
    ).toBe('audio/wav');
  });

  it('still produces fal audio artifacts in simulated mode after adapter unwrapping', async () => {
    const schemaRaw = readFixtureSchema(
      '../../../tests/fixtures/unified-provider-contract/fal-audio-schema.fixture.json'
    );
    const handler = createUnifiedHandler({
      adapter: falAdapter,
      outputMimeType: 'audio/mpeg',
    })(createInit('stable-audio/25/text-to-audio'));

    const result = await handler.invoke(
      createRequest({
        model: 'stable-audio/25/text-to-audio',
        schemaRaw,
        resolvedInputs: {
          'Input:Prompt': 'Soft ambient piano with rain',
          'Input:Duration': 8,
        },
        inputBindings: {
          Prompt: 'Input:Prompt',
          Duration: 'Input:Duration',
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
        },
        produces: ['Artifact:AudioProducer.GeneratedAudio'],
      })
    );

    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(1);
    expect(result.artefacts[0]?.blob?.mimeType).toBe('audio/mpeg');
  });
});
