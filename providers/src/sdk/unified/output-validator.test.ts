import { describe, it, expect, vi } from 'vitest';
import { validateOutput, validateOutputWithLogging } from './output-validator.js';
import type { SchemaFile } from './schema-file.js';

describe('validateOutput', () => {
  describe('without output schema', () => {
    it('returns valid with skipped=true when no output schema', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: undefined,
        definitions: {},
      };

      const result = validateOutput({ some: 'data' }, schemaFile);

      expect(result.valid).toBe(true);
      expect(result.skipped).toBe(true);
    });
  });

  describe('with simple output schema', () => {
    it('validates valid output against schema', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            seed: { type: 'integer' },
          },
          required: ['url'],
        },
        definitions: {},
      };

      const output = { url: 'https://example.com/image.png', seed: 12345 };
      const result = validateOutput(output, schemaFile);

      expect(result.valid).toBe(true);
      expect(result.skipped).toBeUndefined();
    });

    it('returns invalid for missing required field', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
          },
          required: ['url'],
        },
        definitions: {},
      };

      const output = { other: 'data' };
      const result = validateOutput(output, schemaFile);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('returns invalid for wrong type', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            seed: { type: 'integer' },
          },
        },
        definitions: {},
      };

      const output = { seed: 'not a number' };
      const result = validateOutput(output, schemaFile);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe('with $ref resolution', () => {
    it('validates output with $ref to definition', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            images: {
              type: 'array',
              items: { $ref: '#/File' },
            },
          },
        },
        definitions: {
          File: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              content_type: { type: 'string' },
            },
            required: ['url'],
          },
        },
      };

      const output = {
        images: [
          { url: 'https://example.com/1.png', content_type: 'image/png' },
          { url: 'https://example.com/2.png', content_type: 'image/png' },
        ],
      };
      const result = validateOutput(output, schemaFile);

      expect(result.valid).toBe(true);
    });

    it('fails validation when $ref item is invalid', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            video: { $ref: '#/VideoFile' },
          },
        },
        definitions: {
          VideoFile: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              fps: { type: 'number' },
            },
            required: ['url'],
          },
        },
      };

      // Missing required 'url' field
      const output = { video: { fps: 30 } };
      const result = validateOutput(output, schemaFile);

      expect(result.valid).toBe(false);
    });
  });

  describe('caching', () => {
    it('caches validators for same schema file', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
        definitions: {},
      };

      // Call twice with same schema
      const result1 = validateOutput({ x: 1 }, schemaFile);
      const result2 = validateOutput({ x: 2 }, schemaFile);

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });
  });
});

describe('validateOutputWithLogging', () => {
  it('logs warning when validation fails', () => {
    const schemaFile: SchemaFile = {
      inputSchema: { type: 'object' },
      outputSchema: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
      definitions: {},
    };

    const warnSpy = vi.fn();
    const logger = { warn: warnSpy };

    const result = validateOutputWithLogging(
      { invalid: 'data' },
      schemaFile,
      logger,
      { provider: 'test-provider', model: 'test-model', jobId: 'job-1' }
    );

    expect(result.valid).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      'providers.unified.output.validation.warning',
      expect.objectContaining({
        provider: 'test-provider',
        model: 'test-model',
        jobId: 'job-1',
        errors: expect.any(Array),
      })
    );
  });

  it('does not log when validation passes', () => {
    const schemaFile: SchemaFile = {
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object', properties: { url: { type: 'string' } } },
      definitions: {},
    };

    const warnSpy = vi.fn();
    const logger = { warn: warnSpy };

    const result = validateOutputWithLogging({ url: 'https://example.com' }, schemaFile, logger);

    expect(result.valid).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not log when validation is skipped', () => {
    const schemaFile: SchemaFile = {
      inputSchema: { type: 'object' },
      outputSchema: undefined,
      definitions: {},
    };

    const warnSpy = vi.fn();
    const logger = { warn: warnSpy };

    const result = validateOutputWithLogging({ any: 'data' }, schemaFile, logger);

    expect(result.valid).toBe(true);
    expect(result.skipped).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
