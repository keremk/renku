import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import {
  writeProducerInputsYaml,
  generateProducerInputsFileName,
  type ProducerInputsYamlData,
} from './yaml-writer.js';

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
});
