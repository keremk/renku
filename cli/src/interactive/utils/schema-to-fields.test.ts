import { describe, it, expect } from 'vitest';
import {
  extractProducerInputMappings,
  categorizeSchemaFields,
} from './schema-to-fields.js';
import type { SchemaFile } from '@gorenku/providers';
import type { ProducerInputMapping } from './schema-to-fields.js';

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
});
