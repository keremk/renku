import { describe, it, expect } from 'vitest';
import { generateOutputFromSchema } from './output-generator.js';
import type { SchemaFile } from './schema-file.js';

describe('generateOutputFromSchema', () => {
  describe('fallback output (no output schema)', () => {
    it('generates replicate-style URL array', () => {
      const result = generateOutputFromSchema(undefined, {
        provider: 'replicate',
        model: 'bytedance/seedream-4',
        producesCount: 2,
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect((result as string[])[0]).toMatch(/^https:\/\/mock\.replicate\.media\//);
    });

    it('generates wavespeed-style nested output', () => {
      const result = generateOutputFromSchema(undefined, {
        provider: 'wavespeed-ai',
        model: 'video-upscaler-pro',
        producesCount: 1,
      }) as { data: { outputs: string[]; status: string } };

      expect(result.data).toBeDefined();
      expect(result.data.status).toBe('completed');
      expect(result.data.outputs).toHaveLength(1);
    });

    it('generates fal.ai-style image output', () => {
      const result = generateOutputFromSchema(undefined, {
        provider: 'fal-ai',
        model: 'wan/v2-6-text-to-image',
        producesCount: 1,
      }) as { images: Array<{ url: string }> };

      expect(result.images).toBeDefined();
      expect(result.images).toHaveLength(1);
      expect(result.images[0].url).toMatch(/^https:\/\/mock\.fal-ai\.media\//);
    });

    it('generates fal.ai-style video output when model name contains video', () => {
      // Model name must contain 'video' keyword for video fallback
      const result = generateOutputFromSchema(undefined, {
        provider: 'fal-ai',
        model: 'text-to-video-model',
        producesCount: 1,
      }) as { video: { url: string } };

      expect(result.video).toBeDefined();
      expect(result.video.url).toMatch(/\.mp4$/);
    });
  });

  describe('schema-based output', () => {
    it('generates simple object from schema', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            seed: { type: 'integer' },
            status: { type: 'string' },
          },
        },
        definitions: {},
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'test-provider',
        model: 'test-model',
      }) as { seed: number; status: string };

      expect(typeof result.seed).toBe('number');
      expect(typeof result.status).toBe('string');
    });

    it('generates URL for string with format: uri', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            output_url: { type: 'string', format: 'uri' },
          },
        },
        definitions: {},
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'fal-ai',
        model: 'test-model',
      }) as { output_url: string };

      expect(result.output_url).toMatch(/^https:\/\/mock\.fal-ai\.media\//);
    });

    it('generates array of correct length for URI arrays', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            images: {
              type: 'array',
              items: { type: 'string', format: 'uri' },
            },
          },
        },
        definitions: {},
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'test-provider',
        model: 'test-model',
        producesCount: 3,
      }) as { images: string[] };

      expect(result.images).toHaveLength(3);
      result.images.forEach((url) => {
        expect(url).toMatch(/^https:\/\/mock\.test-provider\.media\//);
      });
    });

    it('generates array length 1 for non-URI arrays', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        definitions: {},
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'test-provider',
        model: 'test-model',
        producesCount: 5, // Should be ignored for non-URI arrays
      }) as { tags: string[] };

      expect(result.tags).toHaveLength(1);
    });

    it('resolves $ref to definitions', () => {
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
              url: { type: 'string', format: 'uri' },
              fps: { type: 'number' },
              duration: { type: 'number' },
            },
          },
        },
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'fal-ai',
        model: 'wan-video',
      }) as { video: { url: string; fps: number; duration: number } };

      expect(result.video.url).toMatch(/^https:\/\/mock\.fal-ai\.media\//);
      expect(typeof result.video.fps).toBe('number');
      expect(typeof result.video.duration).toBe('number');
    });

    it('handles anyOf by using first option', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            size: {
              anyOf: [
                { type: 'string', enum: ['small', 'medium', 'large'] },
                { type: 'integer' },
              ],
            },
          },
        },
        definitions: {},
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'test',
        model: 'test',
      }) as { size: string };

      expect(result.size).toBe('small');
    });

    it('generates nested objects', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            file: {
              type: 'object',
              properties: {
                url: { type: 'string', format: 'uri' },
                metadata: {
                  type: 'object',
                  properties: {
                    size: { type: 'integer' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        definitions: {},
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'test',
        model: 'test',
      }) as { file: { url: string; metadata: { size: number; name: string } } };

      expect(result.file.url).toMatch(/^https:\/\/mock\.test\.media\//);
      expect(typeof result.file.metadata.size).toBe('number');
      expect(typeof result.file.metadata.name).toBe('string');
    });

    it('handles boolean type', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        definitions: {},
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'test',
        model: 'test',
      }) as { success: boolean };

      expect(result.success).toBe(true);
    });

    it('uses first enum value', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'completed', 'failed'] },
          },
        },
        definitions: {},
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'test',
        model: 'test',
      }) as { status: string };

      expect(result.status).toBe('pending');
    });

    it('uses schema default values when available', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            count: { type: 'integer', default: 42 },
            ratio: { type: 'number', default: 1.5 },
            enabled: { type: 'boolean', default: false },
          },
        },
        definitions: {},
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'test',
        model: 'test',
      }) as { count: number; ratio: number; enabled: boolean };

      expect(result.count).toBe(42);
      expect(result.ratio).toBe(1.5);
      expect(result.enabled).toBe(false);
    });

    it('uses schema minimum values when available', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            width: { type: 'integer', minimum: 1024 },
            quality: { type: 'number', minimum: 0.5 },
          },
        },
        definitions: {},
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'test',
        model: 'test',
      }) as { width: number; quality: number };

      expect(result.width).toBe(1024);
      expect(result.quality).toBe(0.5);
    });
  });

  describe('array with $ref items', () => {
    it('uses producesCount for arrays with $ref to types containing URIs', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: { $ref: '#/ImageFile' },
            },
          },
        },
        definitions: {
          ImageFile: {
            type: 'object',
            properties: {
              url: { type: 'string', format: 'uri' },
              width: { type: 'integer' },
            },
          },
        },
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'test',
        model: 'test',
        producesCount: 3,
      }) as { results: Array<{ url: string; width: number }> };

      expect(result.results).toHaveLength(3);
      result.results.forEach((item) => {
        expect(item.url).toMatch(/^https:\/\/mock\.test\.media\//);
        expect(typeof item.width).toBe('number');
      });
    });

    it('respects minItems constraint', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            outputs: {
              type: 'array',
              items: { type: 'string', format: 'uri' },
              minItems: 5,
            },
          },
        },
        definitions: {},
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'test',
        model: 'test',
        producesCount: 2, // Less than minItems
      }) as { outputs: string[] };

      expect(result.outputs).toHaveLength(5); // Should use minItems
    });
  });

  describe('unique URL generation', () => {
    it('generates unique URLs for each URI field', () => {
      const schemaFile: SchemaFile = {
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: {
            primary: { type: 'string', format: 'uri' },
            secondary: { type: 'string', format: 'uri' },
            items: {
              type: 'array',
              items: { type: 'string', format: 'uri' },
            },
          },
        },
        definitions: {},
        nestedModels: [],
      };

      const result = generateOutputFromSchema(schemaFile, {
        provider: 'test',
        model: 'test',
        producesCount: 2,
      }) as { primary: string; secondary: string; items: string[] };

      // All URLs should be unique
      const allUrls = [result.primary, result.secondary, ...result.items];
      const uniqueUrls = new Set(allUrls);
      expect(uniqueUrls.size).toBe(allUrls.length);
    });
  });
});
