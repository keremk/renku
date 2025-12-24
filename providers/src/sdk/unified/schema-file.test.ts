import { describe, it, expect } from 'vitest';
import {
  parseSchemaFile,
  extractInputSchemaString,
  extractOutputSchemaString,
  hasOutputSchema,
} from './schema-file.js';

describe('parseSchemaFile', () => {
  describe('new format (input_schema/output_schema)', () => {
    it('parses schema file with input_schema and output_schema', () => {
      const content = JSON.stringify({
        input_schema: {
          type: 'object',
          properties: { prompt: { type: 'string' } },
          required: ['prompt'],
        },
        output_schema: {
          type: 'object',
          properties: {
            images: { type: 'array', items: { $ref: '#/File' } },
            seed: { type: 'integer' },
          },
        },
        File: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri' },
            content_type: { type: 'string' },
          },
        },
      });

      const result = parseSchemaFile(content);

      expect(result.inputSchema).toEqual({
        type: 'object',
        properties: { prompt: { type: 'string' } },
        required: ['prompt'],
      });
      expect(result.outputSchema).toEqual({
        type: 'object',
        properties: {
          images: { type: 'array', items: { $ref: '#/File' } },
          seed: { type: 'integer' },
        },
      });
      expect(result.definitions).toEqual({
        File: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri' },
            content_type: { type: 'string' },
          },
        },
      });
    });

    it('parses schema file with only input_schema (no output)', () => {
      const content = JSON.stringify({
        input_schema: {
          type: 'object',
          properties: { prompt: { type: 'string' } },
        },
      });

      const result = parseSchemaFile(content);

      expect(result.inputSchema).toEqual({
        type: 'object',
        properties: { prompt: { type: 'string' } },
      });
      expect(result.outputSchema).toBeUndefined();
      expect(result.definitions).toEqual({});
    });

    it('extracts multiple definitions', () => {
      const content = JSON.stringify({
        input_schema: { type: 'object' },
        output_schema: { type: 'object' },
        ImageSize: { type: 'object', properties: { width: { type: 'integer' } } },
        File: { type: 'object', properties: { url: { type: 'string' } } },
        VideoFile: { type: 'object', properties: { url: { type: 'string' }, fps: { type: 'number' } } },
      });

      const result = parseSchemaFile(content);

      expect(Object.keys(result.definitions)).toHaveLength(3);
      expect(result.definitions).toHaveProperty('ImageSize');
      expect(result.definitions).toHaveProperty('File');
      expect(result.definitions).toHaveProperty('VideoFile');
    });
  });

  describe('old format (flat input schema)', () => {
    it('parses flat schema as input schema', () => {
      const content = JSON.stringify({
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          size: { enum: ['1K', '2K', '4K'] },
        },
        required: ['prompt'],
      });

      const result = parseSchemaFile(content);

      expect(result.inputSchema).toEqual({
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          size: { enum: ['1K', '2K', '4K'] },
        },
        required: ['prompt'],
      });
      expect(result.outputSchema).toBeUndefined();
      expect(result.definitions).toEqual({});
    });

    it('handles replicate-style flat schema', () => {
      const content = JSON.stringify({
        type: 'object',
        title: 'Input',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', title: 'Prompt' },
          width: { type: 'integer', minimum: 1024, maximum: 4096 },
        },
      });

      const result = parseSchemaFile(content);

      expect(result.inputSchema.type).toBe('object');
      expect(result.inputSchema.title).toBe('Input');
      expect(result.outputSchema).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('throws on invalid JSON', () => {
      expect(() => parseSchemaFile('not valid json')).toThrow(/Invalid schema file JSON/);
    });

    it('throws on non-object JSON', () => {
      expect(() => parseSchemaFile('"just a string"')).toThrow(/Schema file must be a JSON object/);
    });

    it('throws on null', () => {
      expect(() => parseSchemaFile('null')).toThrow(/Schema file must be a JSON object/);
    });
  });
});

describe('extractInputSchemaString', () => {
  it('extracts input schema from new format', () => {
    const content = JSON.stringify({
      input_schema: { type: 'object', properties: { prompt: { type: 'string' } } },
      output_schema: { type: 'object' },
    });

    const result = extractInputSchemaString(content);

    expect(JSON.parse(result)).toEqual({
      type: 'object',
      properties: { prompt: { type: 'string' } },
    });
  });

  it('extracts input schema from old format', () => {
    const content = JSON.stringify({
      type: 'object',
      properties: { prompt: { type: 'string' } },
    });

    const result = extractInputSchemaString(content);

    expect(JSON.parse(result)).toEqual({
      type: 'object',
      properties: { prompt: { type: 'string' } },
    });
  });
});

describe('extractOutputSchemaString', () => {
  it('extracts output schema when present', () => {
    const content = JSON.stringify({
      input_schema: { type: 'object' },
      output_schema: { type: 'object', properties: { url: { type: 'string' } } },
    });

    const result = extractOutputSchemaString(content);

    expect(result).toBeDefined();
    expect(JSON.parse(result!)).toEqual({
      type: 'object',
      properties: { url: { type: 'string' } },
    });
  });

  it('returns undefined when output schema is missing', () => {
    const content = JSON.stringify({
      input_schema: { type: 'object' },
    });

    const result = extractOutputSchemaString(content);

    expect(result).toBeUndefined();
  });

  it('returns undefined for old format', () => {
    const content = JSON.stringify({
      type: 'object',
      properties: { prompt: { type: 'string' } },
    });

    const result = extractOutputSchemaString(content);

    expect(result).toBeUndefined();
  });
});

describe('hasOutputSchema', () => {
  it('returns true when output schema is present', () => {
    const content = JSON.stringify({
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
    });

    expect(hasOutputSchema(content)).toBe(true);
  });

  it('returns false when output schema is missing', () => {
    const content = JSON.stringify({
      input_schema: { type: 'object' },
    });

    expect(hasOutputSchema(content)).toBe(false);
  });

  it('returns false for old format', () => {
    const content = JSON.stringify({
      type: 'object',
      properties: {},
    });

    expect(hasOutputSchema(content)).toBe(false);
  });
});
