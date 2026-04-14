import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getProducerFieldPreview } from './producer-field-preview-handler.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');
const CATALOG_ROOT = path.join(REPO_ROOT, 'catalog');

describe('getProducerFieldPreview', () => {
  it('returns producer field preview fields without producer-level contract errors for animated-edu blueprint', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'animated-edu-characters',
      'animated-edu-characters.yaml'
    );

    const response = await getProducerFieldPreview({
      blueprintPath,
      catalogRoot: CATALOG_ROOT,
      inputs: {
        'Input:Resolution': { width: 1280, height: 720 },
        'Input:NarrationAudioProducer.LanguageCode': 'eng',
        'Input:TranscriptionProducer.LanguageCode': 'eng',
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

    const response = await getProducerFieldPreview({
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

  it('marks connected variant fields as read-only dynamic and provides per-instance previews', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'celebrity-then-now',
      'celebrity-then-now.yaml'
    );

    const response = await getProducerFieldPreview({
      blueprintPath,
      catalogRoot: CATALOG_ROOT,
      inputs: {
        'Input:CelebrityThenImages': [
          'file:./images/then-1.jpg',
          'file:./images/then-2.jpg',
        ],
        'Input:CelebrityNowImages': [
          'file:./images/now-1.jpg',
          'file:./images/now-2.jpg',
        ],
        'Input:SettingImage': 'file:./images/setting.jpg',
        'Input:Theme': 'Theme',
        'Input:EnvironmentDescription': 'Environment',
        'Input:VisualStyle': 'Visual style',
        'Input:NumOfSegments': 2,
        'Input:SegmentDuration': 15,
        'Input:MeetingDuration': 10,
        'Input:TransitionDuration': 5,
        'Input:Resolution': { width: 1280, height: 720 },
      },
      models: [
        {
          producerId: 'ThenImageProducer',
          provider: 'fal-ai',
          model: 'qwen-image-edit-2511',
        },
      ],
    });

    expect(Object.keys(response.errorsByProducer ?? {})).toHaveLength(0);

    const imagePreview = response.producers.ThenImageProducer;
    const imageUrlsField = imagePreview?.fields.find(
      (field) => field.field === 'image_urls'
    );
    expect(imageUrlsField).toBeDefined();
    expect(imageUrlsField?.connectionBehavior).toBe('variant');
    expect(imageUrlsField?.overridePolicy).toBe('read_only_dynamic');
    expect(imageUrlsField?.instances).toHaveLength(2);

    const firstInstanceValue = imageUrlsField?.instances?.[0]?.value as
      | unknown[]
      | undefined;
    const secondInstanceValue = imageUrlsField?.instances?.[1]?.value as
      | unknown[]
      | undefined;
    expect(Array.isArray(firstInstanceValue)).toBe(true);
    expect(Array.isArray(secondInstanceValue)).toBe(true);
    expect(firstInstanceValue?.[0]).toBe('file:./images/then-1.jpg');
    expect(secondInstanceValue?.[0]).toBe('file:./images/then-2.jpg');
    expect(firstInstanceValue?.[1]).toBe('file:./images/setting.jpg');
    expect(secondInstanceValue?.[1]).toBe('file:./images/setting.jpg');

    const imageSizeField = imagePreview?.fields.find(
      (field) => field.field === 'image_size'
    );
    expect(imageSizeField).toBeDefined();
    expect(imageSizeField?.connectionBehavior).toBe('invariant');
    expect(imageSizeField?.overridePolicy).toBe('editable');
    expect(imageSizeField?.instances).toHaveLength(2);
  });
});
