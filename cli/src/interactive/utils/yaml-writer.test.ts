import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import {
  writeProducerInputsYaml,
  generateProducerInputsFileName,
  formatFileValue,
  formatInputsWithFilePrefix,
} from './yaml-writer.js';
import type { FormFieldConfig } from './schema-to-fields.js';
import type { ProducerInputsYamlData } from '../types/producer-mode.js';

describe('writeProducerInputsYaml', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `yaml-writer-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('generates correct filename from producer ID', () => {
    expect(generateProducerInputsFileName('TextToVideoProducer')).toBe(
      'texttovideoproducer-inputs.yaml'
    );
    expect(generateProducerInputsFileName('Image To Image')).toBe(
      'image-to-image-inputs.yaml'
    );
    expect(generateProducerInputsFileName('text_to_speech')).toBe(
      'text-to-speech-inputs.yaml'
    );
  });

  it('generates YAML with correct format matching blueprint input files', async () => {
    const data: ProducerInputsYamlData = {
      provider: 'fal-ai',
      model: 'wan/v2.6/text-to-video',
      producerId: 'TextToVideoProducer',
      inputs: {
        prompt: 'A cinematic sunset',
        duration: 8,
      },
      config: {
        seed: 12345,
        enable_prompt_expansion: true,
      },
    };

    const filePath = await writeProducerInputsYaml(data, {
      producerId: 'TextToVideoProducer',
      producerName: 'Text-to-Video Generator',
      outputDir: testDir,
    });

    // Read and parse the generated file
    const content = await readFile(filePath, 'utf8');
    const parsed = parseYaml(content) as Record<string, unknown>;

    // Verify structure matches blueprint input format
    expect(parsed).toHaveProperty('inputs');
    expect(parsed).toHaveProperty('models');

    // Verify inputs section at top level
    const inputs = parsed.inputs as Record<string, unknown>;
    expect(inputs.prompt).toBe('A cinematic sunset');
    expect(inputs.duration).toBe(8);

    // Verify models array
    const models = parsed.models as Array<Record<string, unknown>>;
    expect(models).toHaveLength(1);
    expect(models[0].model).toBe('wan/v2.6/text-to-video');
    expect(models[0].provider).toBe('fal-ai');
    expect(models[0].producerId).toBe('TextToVideoProducer');

    // Verify config is inside models entry, not at top level
    const config = models[0].config as Record<string, unknown>;
    expect(config.seed).toBe(12345);
    expect(config.enable_prompt_expansion).toBe(true);

    // Verify no config or provider/model at top level
    expect(parsed).not.toHaveProperty('config');
    expect(parsed).not.toHaveProperty('provider');
    expect(parsed).not.toHaveProperty('model');
  });

  it('does not duplicate inputs in config section', async () => {
    // This test ensures that fields that are producer inputs
    // do NOT appear in the config section
    const data: ProducerInputsYamlData = {
      provider: 'fal-ai',
      model: 'qwen-image-edit-2511',
      producerId: 'ImageToImageProducer',
      inputs: {
        prompt: 'A pixar style heart',
        num_images: 3,
        negative_prompt: 'No blurry image',
      },
      config: {
        // These should be config-only fields, NOT duplicates of inputs
        acceleration: 'regular',
        enable_safety_checker: true,
      },
    };

    const filePath = await writeProducerInputsYaml(data, {
      producerId: 'ImageToImageProducer',
      producerName: 'Image-to-Image Transformer',
      outputDir: testDir,
    });

    const content = await readFile(filePath, 'utf8');
    const parsed = parseYaml(content) as Record<string, unknown>;

    const inputs = parsed.inputs as Record<string, unknown>;
    const models = parsed.models as Array<Record<string, unknown>>;
    const config = models[0].config as Record<string, unknown>;

    // Verify inputs are in inputs section
    expect(inputs.prompt).toBe('A pixar style heart');
    expect(inputs.num_images).toBe(3);
    expect(inputs.negative_prompt).toBe('No blurry image');

    // Verify config has only config fields
    expect(config.acceleration).toBe('regular');
    expect(config.enable_safety_checker).toBe(true);

    // Verify inputs are NOT in config section
    expect(config).not.toHaveProperty('prompt');
    expect(config).not.toHaveProperty('num_images');
    expect(config).not.toHaveProperty('negative_prompt');
  });

  it('generates valid YAML when config is empty', async () => {
    const data: ProducerInputsYamlData = {
      provider: 'replicate',
      model: 'bytedance/seedance-1.5-pro',
      producerId: 'TextToVideoProducer',
      inputs: {
        prompt: 'A beautiful landscape',
      },
      config: {},
    };

    const filePath = await writeProducerInputsYaml(data, {
      producerId: 'TextToVideoProducer',
      producerName: 'Text-to-Video Generator',
      outputDir: testDir,
    });

    const content = await readFile(filePath, 'utf8');
    const parsed = parseYaml(content) as Record<string, unknown>;

    const models = parsed.models as Array<Record<string, unknown>>;
    expect(models[0]).not.toHaveProperty('config');
  });

  it('generates valid YAML when inputs is empty', async () => {
    const data: ProducerInputsYamlData = {
      provider: 'fal-ai',
      model: 'some-model',
      producerId: 'SomeProducer',
      inputs: {},
      config: {
        setting: 'value',
      },
    };

    const filePath = await writeProducerInputsYaml(data, {
      producerId: 'SomeProducer',
      producerName: 'Some Producer',
      outputDir: testDir,
    });

    const content = await readFile(filePath, 'utf8');
    const parsed = parseYaml(content) as Record<string, unknown>;

    expect(parsed).not.toHaveProperty('inputs');
    const models = parsed.models as Array<Record<string, unknown>>;
    expect(models[0].config).toEqual({ setting: 'value' });
  });

  it('formats file values with file: prefix when inputFields are provided', async () => {
    const data: ProducerInputsYamlData = {
      provider: 'fal-ai',
      model: 'qwen-image-edit-2511',
      producerId: 'ImageToImageProducer',
      inputs: {
        Prompt: 'Edit this image',
        SourceImages: ['images/photo1.png', 'images/photo2.jpg'],
        MaskImage: 'masks/mask.png',
      },
      config: {},
    };

    const inputFields: FormFieldConfig[] = [
      { name: 'Prompt', label: 'Prompt', type: 'text', required: true },
      { name: 'SourceImages', label: 'Source Images', type: 'file-collection', required: false, blobType: 'image' },
      { name: 'MaskImage', label: 'Mask Image', type: 'file', required: false, blobType: 'image' },
    ];

    const filePath = await writeProducerInputsYaml(data, {
      producerId: 'ImageToImageProducer',
      producerName: 'Image-to-Image Transformer',
      outputDir: testDir,
      inputFields,
    });

    const content = await readFile(filePath, 'utf8');
    const parsed = parseYaml(content) as Record<string, unknown>;

    const inputs = parsed.inputs as Record<string, unknown>;

    // Text field should not have file: prefix
    expect(inputs.Prompt).toBe('Edit this image');

    // File collection should have file: prefix on each element
    const sourceImages = inputs.SourceImages as string[];
    expect(sourceImages).toHaveLength(2);
    expect(sourceImages[0]).toBe('file:images/photo1.png');
    expect(sourceImages[1]).toBe('file:images/photo2.jpg');

    // Single file field should have file: prefix
    expect(inputs.MaskImage).toBe('file:masks/mask.png');
  });
});

describe('formatFileValue', () => {
  it('adds file: prefix to path', () => {
    expect(formatFileValue('images/photo.png')).toBe('file:images/photo.png');
  });

  it('handles relative paths', () => {
    expect(formatFileValue('./images/photo.png')).toBe('file:./images/photo.png');
  });

  it('does not double prefix if already has file:', () => {
    expect(formatFileValue('file:images/photo.png')).toBe('file:images/photo.png');
  });
});

describe('formatInputsWithFilePrefix', () => {
  it('adds file: prefix to file field values', () => {
    const inputs = {
      Prompt: 'A test prompt',
      Image: 'photo.png',
    };

    const fields: FormFieldConfig[] = [
      { name: 'Prompt', label: 'Prompt', type: 'text', required: true },
      { name: 'Image', label: 'Image', type: 'file', required: false },
    ];

    const result = formatInputsWithFilePrefix(inputs, fields);

    expect(result.Prompt).toBe('A test prompt');
    expect(result.Image).toBe('file:photo.png');
  });

  it('adds file: prefix to each element in file-collection', () => {
    const inputs = {
      Images: ['photo1.png', 'photo2.jpg', 'photo3.webp'],
    };

    const fields: FormFieldConfig[] = [
      { name: 'Images', label: 'Images', type: 'file-collection', required: false },
    ];

    const result = formatInputsWithFilePrefix(inputs, fields);

    const images = result.Images as string[];
    expect(images).toEqual([
      'file:photo1.png',
      'file:photo2.jpg',
      'file:photo3.webp',
    ]);
  });

  it('returns inputs unchanged if no fields provided', () => {
    const inputs = { Image: 'photo.png' };

    expect(formatInputsWithFilePrefix(inputs)).toEqual(inputs);
    expect(formatInputsWithFilePrefix(inputs, [])).toEqual(inputs);
  });

  it('skips empty values', () => {
    const inputs = {
      Image: '',
      OtherImage: undefined,
    };

    const fields: FormFieldConfig[] = [
      { name: 'Image', label: 'Image', type: 'file', required: false },
      { name: 'OtherImage', label: 'Other', type: 'file', required: false },
    ];

    const result = formatInputsWithFilePrefix(inputs, fields);

    expect(result.Image).toBe('');
    expect(result.OtherImage).toBeUndefined();
  });
});
