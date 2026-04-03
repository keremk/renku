import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getProducerConfigSchemas } from './config-schemas-handler.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');
const CATALOG_ROOT = path.join(REPO_ROOT, 'catalog');

function collectFieldPaths(
  fields: Array<{ keyPath: string; fields?: unknown[] }>
): string[] {
  const paths: string[] = [];
  const visit = (items: Array<{ keyPath: string; fields?: unknown[] }>) => {
    for (const item of items) {
      paths.push(item.keyPath);
      if (Array.isArray(item.fields)) {
        visit(item.fields as Array<{ keyPath: string; fields?: unknown[] }>);
      }
    }
  };
  visit(fields);
  return paths;
}

function findFieldByPath(
  fields: Array<{
    keyPath: string;
    component: string;
    mappingSource: string;
    schema?: { minimum?: number; maximum?: number; default?: unknown };
    fields?: unknown[];
    value?: unknown;
    item?: unknown;
    variants?: unknown[];
  }>,
  keyPath: string
): {
  keyPath: string;
  component: string;
  mappingSource: string;
  schema?: { minimum?: number; maximum?: number; default?: unknown };
  fields?: unknown[];
  value?: unknown;
  item?: unknown;
  variants?: unknown[];
} | null {
  const stack = [...fields];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) {
      continue;
    }
    if (current.keyPath === keyPath) {
      return current;
    }
    if (Array.isArray(current.fields)) {
      stack.push(
        ...(current.fields as Array<{
          keyPath: string;
          component: string;
          mappingSource: string;
          schema?: { minimum?: number; maximum?: number; default?: unknown };
          fields?: unknown[];
          value?: unknown;
          item?: unknown;
          variants?: unknown[];
        }>)
      );
    }
    if (current.value && typeof current.value === 'object') {
      stack.push(
        current.value as {
          keyPath: string;
          component: string;
          mappingSource: string;
          schema?: { minimum?: number; maximum?: number; default?: unknown };
          fields?: unknown[];
          value?: unknown;
          item?: unknown;
          variants?: unknown[];
        }
      );
    }
    if (current.item && typeof current.item === 'object') {
      stack.push(
        current.item as {
          keyPath: string;
          component: string;
          mappingSource: string;
          schema?: { minimum?: number; maximum?: number; default?: unknown };
          fields?: unknown[];
          value?: unknown;
          item?: unknown;
          variants?: unknown[];
        }
      );
    }
    if (Array.isArray(current.variants)) {
      stack.push(
        ...(current.variants as Array<{
          keyPath: string;
          component: string;
          mappingSource: string;
          schema?: { minimum?: number; maximum?: number };
          fields?: unknown[];
          value?: unknown;
          item?: unknown;
          variants?: unknown[];
        }>)
      );
    }
  }

  return null;
}

describe('getProducerConfigSchemas', () => {
  it('builds producer config contracts without producer-level failures in animated-edu blueprint', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'animated-edu-characters',
      'animated-edu-characters.yaml'
    );

    const response = await getProducerConfigSchemas(
      blueprintPath,
      CATALOG_ROOT
    );

    expect(Object.keys(response.errorsByProducer ?? {})).toHaveLength(0);

    expect(response.producers.EduScriptProducer?.category).toBe('prompt');

    const imageProducer = response.producers.CharacterImageProducer;
    expect(Object.keys(imageProducer?.modelSchemas ?? {}).length > 0).toBe(
      true
    );

    const narrationProducer = response.producers.NarrationAudioProducer;
    expect(Object.keys(narrationProducer?.modelSchemas ?? {}).length > 0).toBe(
      true
    );

    const lipsyncProducer = response.producers.LipsyncVideoProducer;
    expect(Object.keys(lipsyncProducer?.modelSchemas ?? {}).length > 0).toBe(
      true
    );
  });

  it('keeps optional narration aliases unmapped instead of failing the producer', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'animated-edu-characters',
      'animated-edu-characters.yaml'
    );

    const response = await getProducerConfigSchemas(
      blueprintPath,
      CATALOG_ROOT
    );

    const narrationProducer = response.producers.NarrationAudioProducer;
    const elevenV3Schema =
      narrationProducer?.modelSchemas['fal-ai/elevenlabs/tts/eleven-v3'];
    expect(elevenV3Schema).toBeDefined();

    const languageField = findFieldByPath(
      elevenV3Schema?.fields as Array<{
        keyPath: string;
        component: string;
        mappingSource: string;
        schema?: { minimum?: number; maximum?: number; default?: unknown };
        fields?: unknown[];
        value?: unknown;
        item?: unknown;
        variants?: unknown[];
      }>,
      'language_code'
    );

    expect(languageField).toBeDefined();
    expect(languageField?.mappingSource).toBe('none');
  });

  it('hydrates voice options from options_file for voice-id selectors', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'animated-edu-characters',
      'animated-edu-characters.yaml'
    );

    const response = await getProducerConfigSchemas(
      blueprintPath,
      CATALOG_ROOT
    );

    const narrationProducer = response.producers.NarrationAudioProducer;
    const elevenV3Schema =
      narrationProducer?.modelSchemas['fal-ai/elevenlabs/tts/eleven-v3'];
    expect(elevenV3Schema).toBeDefined();

    const voiceField = findFieldByPath(
      elevenV3Schema?.fields as Array<{
        keyPath: string;
        component: string;
        mappingSource: string;
        schema?: { minimum?: number; maximum?: number; default?: unknown };
        fields?: unknown[];
        value?: unknown;
        item?: unknown;
        variants?: unknown[];
      }>,
      'voice'
    ) as { custom?: string; customConfig?: Record<string, unknown> } | null;

    expect(voiceField?.custom).toBe('voice-id-selector');
    expect(voiceField?.customConfig?.options_file).toBe(
      'voices/elevenlabs-default-voices.json'
    );

    const optionsRich = voiceField?.customConfig?.options_rich;
    expect(Array.isArray(optionsRich)).toBe(true);
    expect((optionsRich as unknown[]).length).toBeGreaterThan(0);
    expect((optionsRich as Array<Record<string, unknown>>)[0]).toEqual(
      expect.objectContaining({
        value: expect.any(String),
        label: expect.any(String),
      })
    );
  });

  it('resolves anyOf schema pointers for ltx guidance scale descriptors', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'animated-edu-characters',
      'animated-edu-characters.yaml'
    );

    const response = await getProducerConfigSchemas(
      blueprintPath,
      CATALOG_ROOT
    );

    const lipsyncProducer = response.producers.LipsyncVideoProducer;
    const ltxSchema =
      lipsyncProducer?.modelSchemas['fal-ai/ltx-2.3/audio-to-video'];
    const ltx19Schema =
      lipsyncProducer?.modelSchemas['fal-ai/ltx-2-19b/audio-to-video'];
    expect(ltxSchema).toBeDefined();
    expect(ltx19Schema).toBeDefined();

    const guidanceField = findFieldByPath(
      ltxSchema?.fields as Array<{
        keyPath: string;
        component: string;
        mappingSource: string;
        schema?: { minimum?: number; maximum?: number; default?: unknown };
        fields?: unknown[];
        value?: unknown;
        item?: unknown;
        variants?: unknown[];
      }>,
      'guidance_scale'
    );

    expect(guidanceField).toBeDefined();
    expect(guidanceField?.component).toBe('nullable');

    const guidanceValue = guidanceField?.value as
      | {
          component: string;
          schema?: { minimum?: number; maximum?: number };
        }
      | undefined;
    expect(guidanceValue?.component).toBe('number');
    expect(guidanceValue?.schema?.minimum).toBe(1);
    expect(guidanceValue?.schema?.maximum).toBe(50);

    const ltxEndImageUrlField = findFieldByPath(
      ltx19Schema?.fields as Array<{
        keyPath: string;
        component: string;
        mappingSource: string;
        schema?: { minimum?: number; maximum?: number; default?: unknown };
        fields?: unknown[];
        value?: unknown;
        item?: unknown;
        variants?: unknown[];
      }>,
      'end_image_url'
    );

    expect(ltxEndImageUrlField).toBeDefined();
    expect(ltxEndImageUrlField?.component).toBe('nullable');
    expect(
      (
        ltxEndImageUrlField?.value as
          | {
              component: string;
            }
          | undefined
      )?.component
    ).toBe('file-uri');

  });

  it('marks nullable URL descriptors as URI controls for Kling image-to-video schemas', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'short-video-documentary',
      'historical-story.yaml'
    );

    const response = await getProducerConfigSchemas(
      blueprintPath,
      CATALOG_ROOT
    );

    const videoProducer = response.producers.VideoProducer;
    const klingSchema =
      videoProducer?.modelSchemas['fal-ai/kling-video/v3/pro/image-to-video'];
    expect(klingSchema).toBeDefined();

    const endImageUrlField = findFieldByPath(
      klingSchema?.fields as Array<{
        keyPath: string;
        component: string;
        mappingSource: string;
        schema?: { minimum?: number; maximum?: number; default?: unknown };
        fields?: unknown[];
        value?: unknown;
        item?: unknown;
        variants?: unknown[];
      }>,
      'end_image_url'
    );

    expect(endImageUrlField).toBeDefined();
    expect(endImageUrlField?.component).toBe('nullable');
    expect(
      (
        endImageUrlField?.value as
          | {
              component: string;
            }
          | undefined
      )?.component
    ).toBe('file-uri');

    const referenceImageUrlsField = findFieldByPath(
      klingSchema?.fields as Array<{
        keyPath: string;
        component: string;
        mappingSource: string;
        schema?: { minimum?: number; maximum?: number; default?: unknown };
        fields?: unknown[];
        value?: unknown;
        item?: unknown;
        variants?: unknown[];
      }>,
      'elements.reference_image_urls'
    );

    expect(referenceImageUrlsField).toBeDefined();
    expect(referenceImageUrlsField?.component).toBe('nullable');
    expect(
      (
        referenceImageUrlsField?.value as
          | {
              component: string;
            }
          | undefined
      )?.component
    ).toBe('array-file-uri');
  });

  it('keeps expanded resolution mappings marked as connected input fields', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'celebrity-then-now',
      'celebrity-then-now.yaml'
    );

    const response = await getProducerConfigSchemas(
      blueprintPath,
      CATALOG_ROOT
    );

    expect(Object.keys(response.errorsByProducer ?? {})).toHaveLength(0);

    const thenImageProducer = response.producers.ThenImageProducer;
    const nanoBananaSchema =
      thenImageProducer?.modelSchemas['replicate/google/nano-banana-pro'];
    expect(nanoBananaSchema).toBeDefined();

    const aspectRatioField = findFieldByPath(
      nanoBananaSchema?.fields as Array<{
        keyPath: string;
        component: string;
        mappingSource: string;
        schema?: { minimum?: number; maximum?: number };
        fields?: unknown[];
        value?: unknown;
        item?: unknown;
        variants?: unknown[];
      }>,
      'aspect_ratio'
    );
    const resolutionField = findFieldByPath(
      nanoBananaSchema?.fields as Array<{
        keyPath: string;
        component: string;
        mappingSource: string;
        schema?: { minimum?: number; maximum?: number };
        fields?: unknown[];
        value?: unknown;
        item?: unknown;
        variants?: unknown[];
      }>,
      'resolution'
    );

    expect(aspectRatioField).toBeDefined();
    expect(resolutionField).toBeDefined();
    expect(aspectRatioField?.mappingSource).toBe('input');
    expect(resolutionField?.mappingSource).toBe('input');
    expect(resolutionField?.schema?.default).toBe('2K');
  });

  it('hides nested STT fields mapped by the parent transcription producer contract', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'ken-burns-documentary',
      'historical-documentary.yaml'
    );

    const response = await getProducerConfigSchemas(
      blueprintPath,
      CATALOG_ROOT
    );

    const transcriptionProducer = response.producers.TranscriptionProducer;
    expect(transcriptionProducer).toBeDefined();

    const sttNested = transcriptionProducer?.nestedModels?.find(
      (nestedModel) => nestedModel.declaration.name === 'stt'
    );
    expect(sttNested).toBeDefined();

    const sttSchema =
      sttNested?.modelSchemas['fal-ai/elevenlabs/speech-to-text'];
    expect(sttSchema).toBeDefined();

    const fieldPaths = collectFieldPaths(sttSchema?.fields ?? []);
    expect(fieldPaths.includes('audio_url')).toBe(false);
    expect(fieldPaths.includes('language_code')).toBe(false);
    expect(fieldPaths.includes('diarize')).toBe(true);
    expect(fieldPaths.includes('tag_audio_events')).toBe(true);
  });
});
