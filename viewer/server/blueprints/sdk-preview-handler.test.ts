import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getProducerSdkPreview } from './sdk-preview-handler.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');
const CATALOG_ROOT = path.join(REPO_ROOT, 'catalog');

describe('getProducerSdkPreview', () => {
  it('returns sdk preview fields without producer-level contract errors for animated-edu blueprint', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'animated-edu-characters',
      'animated-edu-characters.yaml'
    );

    const response = await getProducerSdkPreview({
      blueprintPath,
      catalogRoot: CATALOG_ROOT,
      inputs: {
        Resolution: { width: 1280, height: 720 },
        VoiceId: 'voice_123',
        LanguageCode: 'eng',
      },
      models: [
        {
          producerId: 'CharacterImageProducer',
          provider: 'fal-ai',
          model: 'flux-2',
        },
        {
          producerId: 'NarrationAudioProducer',
          provider: 'fal-ai',
          model: 'elevenlabs/tts/eleven-v3',
        },
        {
          producerId: 'LipsyncVideoProducer',
          provider: 'fal-ai',
          model: 'ltx-2.3/audio-to-video',
        },
        {
          producerId: 'TranscriptionProducer',
          provider: 'renku',
          model: 'speech/transcription',
        },
      ],
    });

    expect(Object.keys(response.errorsByProducer ?? {})).toHaveLength(0);

    const imagePreview = response.producers.CharacterImageProducer;
    expect((imagePreview?.fields.length ?? 0) > 0).toBe(true);

    const narrationPreview = response.producers.NarrationAudioProducer;
    expect((narrationPreview?.fields.length ?? 0) > 0).toBe(true);
    expect(
      narrationPreview?.fields.some((field) => field.field === 'language_code')
    ).toBe(true);

    const lipsyncPreview = response.producers.LipsyncVideoProducer;
    expect(lipsyncPreview).toBeDefined();
    expect(Array.isArray(lipsyncPreview?.fields)).toBe(true);

    const transcriptionPreview = response.producers.TranscriptionProducer;
    expect((transcriptionPreview?.fields.length ?? 0) > 0).toBe(true);
    expect(
      transcriptionPreview?.fields.some(
        (field) => field.field === 'languageCode'
      )
    ).toBe(true);
  });

  it('keeps preview non-blocking when runtime inputs are incomplete', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'animated-edu-characters',
      'animated-edu-characters.yaml'
    );

    const response = await getProducerSdkPreview({
      blueprintPath,
      catalogRoot: CATALOG_ROOT,
      inputs: {},
      models: [
        {
          producerId: 'CharacterImageProducer',
          provider: 'fal-ai',
          model: 'flux-2',
        },
      ],
    });

    expect(Object.keys(response.errorsByProducer ?? {})).toHaveLength(0);
    const preview = response.producers.CharacterImageProducer;
    expect((preview?.fields.length ?? 0) > 0).toBe(true);
    expect(preview?.fields.every((field) => field.status !== 'error')).toBe(
      true
    );
    expect(
      preview?.fields.some((field) => field.status === 'warning')
    ).toBe(true);
  });
});
