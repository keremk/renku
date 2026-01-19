import { describe, it, expect } from 'vitest';
import {
  extractProducerInputMappings,
  categorizeSchemaFields,
  isBlobInput,
  getExtensionsForBlobType,
  createBlobFieldConfig,
} from './schema-to-fields.js';
import type { SchemaFile } from '@gorenku/providers';
import type { ProducerInputMapping, ProducerInputDef } from './schema-to-fields.js';

describe('extractProducerInputMappings', () => {
  it('extracts simple string mappings with producer and schema field names', () => {
    const mappings = {
      Prompt: 'prompt',
      NumImages: 'num_images',
      Seed: 'seed',
    };

    const result = extractProducerInputMappings(mappings);

    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ producerInput: 'Prompt', schemaField: 'prompt' });
    expect(result).toContainEqual({ producerInput: 'NumImages', schemaField: 'num_images' });
    expect(result).toContainEqual({ producerInput: 'Seed', schemaField: 'seed' });
  });

  it('extracts field from complex mappings with field property', () => {
    const mappings = {
      Prompt: 'prompt',
      AspectRatio: {
        field: 'image_size',
        transform: {
          '16:9': 'landscape_16_9',
          '9:16': 'portrait_16_9',
        },
      },
      Duration: {
        field: 'duration',
        intToString: true,
      },
    };

    const result = extractProducerInputMappings(mappings);

    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ producerInput: 'Prompt', schemaField: 'prompt' });
    expect(result).toContainEqual({ producerInput: 'AspectRatio', schemaField: 'image_size' });
    expect(result).toContainEqual({ producerInput: 'Duration', schemaField: 'duration' });
  });

  it('handles mixed simple and complex mappings', () => {
    const mappings = {
      Prompt: 'prompt',
      NegativePrompt: 'negative_prompt',
      VideoSize: {
        field: 'video_size',
        combine: {
          inputs: ['AspectRatio', 'Resolution'],
          table: {
            '16:9+480p': { width: 848, height: 480 },
          },
        },
      },
      EnableSafetyChecker: {
        field: 'disable_safety_checker',
        invert: true,
      },
    };

    const result = extractProducerInputMappings(mappings);

    expect(result).toHaveLength(4);
    expect(result).toContainEqual({ producerInput: 'Prompt', schemaField: 'prompt' });
    expect(result).toContainEqual({ producerInput: 'NegativePrompt', schemaField: 'negative_prompt' });
    expect(result).toContainEqual({ producerInput: 'VideoSize', schemaField: 'video_size' });
    expect(result).toContainEqual({ producerInput: 'EnableSafetyChecker', schemaField: 'disable_safety_checker' });
  });

  it('returns empty array for empty mappings', () => {
    const result = extractProducerInputMappings({});
    expect(result).toHaveLength(0);
  });
});

describe('categorizeSchemaFields', () => {
  // Helper to create a mock SchemaFile with proper typing
  // Using 'as SchemaFile' since we know these are valid partial schemas
  const createMockSchemaFile = (
    properties: Record<string, { type: string; description?: string }>,
    required: string[] = [],
  ): SchemaFile =>
    ({
      inputSchema: {
        type: 'object',
        properties,
        required,
      },
      definitions: {},
    }) as SchemaFile;

  it('uses producer input names for input fields and schema names for config fields', () => {
    const schemaFile = createMockSchemaFile({
      prompt: { type: 'string', description: 'The prompt' },
      num_images: { type: 'integer', description: 'Number of images' },
      seed: { type: 'integer', description: 'Random seed' },
      acceleration: { type: 'string', description: 'Acceleration mode' },
      enable_safety_checker: { type: 'boolean', description: 'Safety checker' },
    });

    // Mappings from producer inputs to schema fields
    const inputMappings: ProducerInputMapping[] = [
      { producerInput: 'Prompt', schemaField: 'prompt' },
      { producerInput: 'NumImages', schemaField: 'num_images' },
      { producerInput: 'Seed', schemaField: 'seed' },
    ];

    const result = categorizeSchemaFields(schemaFile, inputMappings);

    // Input fields should use PRODUCER INPUT names (uppercase)
    const inputNames = result.inputFields.map((f) => f.name);
    expect(inputNames).toContain('Prompt');
    expect(inputNames).toContain('NumImages');
    expect(inputNames).toContain('Seed');

    // Input fields should NOT use schema field names
    expect(inputNames).not.toContain('prompt');
    expect(inputNames).not.toContain('num_images');
    expect(inputNames).not.toContain('seed');

    // Config fields should use SCHEMA FIELD names (not mapped)
    const configNames = result.configFields.map((f) => f.name);
    expect(configNames).toContain('acceleration');
    expect(configNames).toContain('enable_safety_checker');

    // No overlap between inputs and config
    expect(inputNames).not.toContain('acceleration');
    expect(inputNames).not.toContain('enable_safety_checker');
  });

  it('input fields get configuration (type, description) from the corresponding schema field', () => {
    const schemaFile = createMockSchemaFile({
      prompt: { type: 'string', description: 'The text prompt for generation' },
      num_images: { type: 'integer', description: 'Number of images to generate' },
    });

    const inputMappings: ProducerInputMapping[] = [
      { producerInput: 'Prompt', schemaField: 'prompt' },
      { producerInput: 'NumImages', schemaField: 'num_images' },
    ];

    const result = categorizeSchemaFields(schemaFile, inputMappings);

    // Find the Prompt input field
    const promptField = result.inputFields.find((f) => f.name === 'Prompt');
    expect(promptField).toBeDefined();
    expect(promptField?.type).toBe('text'); // From schema string type
    expect(promptField?.description).toBe('The text prompt for generation');

    // Find the NumImages input field
    const numImagesField = result.inputFields.find((f) => f.name === 'NumImages');
    expect(numImagesField).toBeDefined();
    expect(numImagesField?.type).toBe('number'); // From schema integer type
    expect(numImagesField?.description).toBe('Number of images to generate');
  });

  it('puts all fields in config when no mappings exist', () => {
    const schemaFile = createMockSchemaFile({
      prompt: { type: 'string' },
      seed: { type: 'integer' },
    });

    const inputMappings: ProducerInputMapping[] = [];

    const result = categorizeSchemaFields(schemaFile, inputMappings);

    expect(result.inputFields).toHaveLength(0);
    expect(result.configFields).toHaveLength(2);
    // Config uses schema field names
    expect(result.configFields.map((f) => f.name)).toContain('prompt');
    expect(result.configFields.map((f) => f.name)).toContain('seed');
  });

  it('puts all fields in inputs when all are mapped', () => {
    const schemaFile = createMockSchemaFile({
      prompt: { type: 'string' },
      seed: { type: 'integer' },
    });

    const inputMappings: ProducerInputMapping[] = [
      { producerInput: 'Prompt', schemaField: 'prompt' },
      { producerInput: 'Seed', schemaField: 'seed' },
    ];

    const result = categorizeSchemaFields(schemaFile, inputMappings);

    expect(result.inputFields).toHaveLength(2);
    expect(result.configFields).toHaveLength(0);
    // Input uses producer input names
    expect(result.inputFields.map((f) => f.name)).toContain('Prompt');
    expect(result.inputFields.map((f) => f.name)).toContain('Seed');
  });

  it('sorts required fields first within each category', () => {
    const schemaFile = createMockSchemaFile(
      {
        optional_input: { type: 'string' },
        required_input: { type: 'string' },
        optional_config: { type: 'string' },
        required_config: { type: 'string' },
      },
      ['required_input', 'required_config'],
    );

    const inputMappings: ProducerInputMapping[] = [
      { producerInput: 'OptionalInput', schemaField: 'optional_input' },
      { producerInput: 'RequiredInput', schemaField: 'required_input' },
    ];

    const result = categorizeSchemaFields(schemaFile, inputMappings);

    // Required fields should come first (using producer input names)
    expect(result.inputFields[0].name).toBe('RequiredInput');
    expect(result.inputFields[0].required).toBe(true);
    expect(result.inputFields[1].name).toBe('OptionalInput');
    expect(result.inputFields[1].required).toBe(false);

    // Config uses schema names
    expect(result.configFields[0].name).toBe('required_config');
    expect(result.configFields[0].required).toBe(true);
    expect(result.configFields[1].name).toBe('optional_config');
    expect(result.configFields[1].required).toBe(false);
  });

  it('creates file picker fields for blob inputs when producer inputs are provided', () => {
    const schemaFile = createMockSchemaFile({
      prompt: { type: 'string' },
      image_urls: { type: 'array' },
      mask_image_url: { type: 'string' },
    });

    const inputMappings: ProducerInputMapping[] = [
      { producerInput: 'Prompt', schemaField: 'prompt' },
      { producerInput: 'SourceImages', schemaField: 'image_urls' },
      { producerInput: 'MaskImage', schemaField: 'mask_image_url' },
    ];

    const producerInputs: ProducerInputDef[] = [
      { name: 'Prompt', type: 'string' },
      { name: 'SourceImages', type: 'collection', itemType: 'image' },
      { name: 'MaskImage', type: 'image' },
    ];

    const result = categorizeSchemaFields(schemaFile, inputMappings, producerInputs);

    // Prompt should be a text field
    const promptField = result.inputFields.find((f) => f.name === 'Prompt');
    expect(promptField?.type).toBe('text');

    // SourceImages should be a file-collection field
    const sourceImagesField = result.inputFields.find((f) => f.name === 'SourceImages');
    expect(sourceImagesField?.type).toBe('file-collection');
    expect(sourceImagesField?.blobType).toBe('image');
    expect(sourceImagesField?.fileExtensions).toContain('png');
    expect(sourceImagesField?.fileExtensions).toContain('jpg');

    // MaskImage should be a file field (single)
    const maskImageField = result.inputFields.find((f) => f.name === 'MaskImage');
    expect(maskImageField?.type).toBe('file');
    expect(maskImageField?.blobType).toBe('image');
  });
});

describe('isBlobInput', () => {
  it('returns true for single image type', () => {
    expect(isBlobInput({ name: 'Image', type: 'image' })).toBe(true);
  });

  it('returns true for single audio type', () => {
    expect(isBlobInput({ name: 'Audio', type: 'audio' })).toBe(true);
  });

  it('returns true for single video type', () => {
    expect(isBlobInput({ name: 'Video', type: 'video' })).toBe(true);
  });

  it('returns true for collection of images', () => {
    expect(isBlobInput({ name: 'Images', type: 'collection', itemType: 'image' })).toBe(true);
  });

  it('returns true for collection of audio', () => {
    expect(isBlobInput({ name: 'AudioFiles', type: 'collection', itemType: 'audio' })).toBe(true);
  });

  it('returns true for collection of video', () => {
    expect(isBlobInput({ name: 'Videos', type: 'collection', itemType: 'video' })).toBe(true);
  });

  it('returns false for string type', () => {
    expect(isBlobInput({ name: 'Prompt', type: 'string' })).toBe(false);
  });

  it('returns false for integer type', () => {
    expect(isBlobInput({ name: 'Count', type: 'integer' })).toBe(false);
  });

  it('returns false for collection without blob itemType', () => {
    expect(isBlobInput({ name: 'Items', type: 'collection', itemType: 'string' })).toBe(false);
  });

  it('returns false for undefined type', () => {
    expect(isBlobInput({ name: 'Unknown' })).toBe(false);
  });
});

describe('getExtensionsForBlobType', () => {
  it('returns image extensions for image type', () => {
    const extensions = getExtensionsForBlobType('image');
    expect(extensions).toContain('png');
    expect(extensions).toContain('jpg');
    expect(extensions).toContain('jpeg');
    expect(extensions).toContain('webp');
    expect(extensions).toContain('gif');
  });

  it('returns audio extensions for audio type', () => {
    const extensions = getExtensionsForBlobType('audio');
    expect(extensions).toContain('mp3');
    expect(extensions).toContain('wav');
    expect(extensions).toContain('ogg');
    expect(extensions).toContain('flac');
  });

  it('returns video extensions for video type', () => {
    const extensions = getExtensionsForBlobType('video');
    expect(extensions).toContain('mp4');
    expect(extensions).toContain('webm');
    expect(extensions).toContain('mov');
    expect(extensions).toContain('mkv');
  });

  it('returns empty array for unknown type', () => {
    expect(getExtensionsForBlobType('unknown')).toEqual([]);
  });
});

describe('createBlobFieldConfig', () => {
  it('creates file field config for single image input', () => {
    const input: ProducerInputDef = {
      name: 'MaskImage',
      type: 'image',
      description: 'Mask for editing',
    };

    const field = createBlobFieldConfig(input);

    expect(field).not.toBeNull();
    expect(field?.name).toBe('MaskImage');
    expect(field?.type).toBe('file');
    expect(field?.blobType).toBe('image');
    expect(field?.description).toBe('Mask for editing');
    expect(field?.fileExtensions).toContain('png');
  });

  it('creates file-collection field config for image collection', () => {
    const input: ProducerInputDef = {
      name: 'SourceImages',
      type: 'collection',
      itemType: 'image',
      description: 'Images to process',
    };

    const field = createBlobFieldConfig(input);

    expect(field).not.toBeNull();
    expect(field?.name).toBe('SourceImages');
    expect(field?.type).toBe('file-collection');
    expect(field?.blobType).toBe('image');
    expect(field?.description).toBe('Images to process');
  });

  it('returns null for non-blob input', () => {
    const input: ProducerInputDef = {
      name: 'Prompt',
      type: 'string',
    };

    expect(createBlobFieldConfig(input)).toBeNull();
  });
});
