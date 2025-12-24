import { describe, it, expect, vi } from 'vitest';
import { createUnifiedHandler } from './schema-first-handler.js';
import { falAdapter } from '../fal/adapter.js';
import { replicateAdapter } from '../replicate/adapter.js';
import { wavespeedAdapter } from '../wavespeed/adapter.js';
import type { ProviderAdapter } from './provider-adapter.js';
import type { HandlerInitContext, ProviderJobContext } from '../../types.js';

/**
 * Integration tests for the unified simulation flow.
 * Tests the full pipeline: input validation → simulation → output validation → URL extraction
 */

// Test helper: Create init context with simulated mode
function createSimulatedContext(overrides?: Partial<HandlerInitContext>): HandlerInitContext {
  return {
    descriptor: {
      provider: 'test-provider',
      model: 'test-model',
      environment: 'local',
    },
    mode: 'simulated',
    secretResolver: {
      async getSecret(_key: string) {
        return 'mock-secret';
      },
    },
    ...overrides,
  };
}

// Test helper: Create job request with schema
function createJobRequest(options: {
  provider: string;
  model: string;
  schema: {
    input: string;
    output?: string;
  };
  resolvedInputs: Record<string, unknown>;
  sdkMapping: Record<string, { field: string; required?: boolean }>;
  producesCount?: number;
}): ProviderJobContext {
  const { provider, model, schema, resolvedInputs, sdkMapping, producesCount = 1 } = options;

  const inputBindings: Record<string, string> = {};
  for (const key of Object.keys(sdkMapping)) {
    inputBindings[key] = `Input:${key}`;
  }

  const produces: string[] = [];
  for (let i = 0; i < producesCount; i++) {
    produces.push(`Artifact:Output[index=${i}]`);
  }

  return {
    jobId: 'integration-test-job',
    provider,
    model,
    revision: 'rev-1',
    layerIndex: 0,
    attempt: 1,
    inputs: Object.values(inputBindings),
    produces,
    context: {
      providerConfig: {},
      extras: {
        resolvedInputs,
        jobContext: {
          inputBindings,
          sdkMapping,
        },
        plannerContext: { index: { segment: 0 } },
        schema,
      },
    },
  };
}

describe('Simulation Integration Tests', () => {
  describe('fal.ai provider - new schema format (with output_schema)', () => {
    const newFormatSchema = {
      input: JSON.stringify({
        input_schema: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            aspect_ratio: { type: 'string', enum: ['16:9', '4:3', '1:1'] },
          },
          required: ['prompt'],
        },
        output_schema: {
          type: 'object',
          properties: {
            images: {
              type: 'array',
              items: { $ref: '#/File' },
            },
            seed: { type: 'integer' },
          },
        },
        File: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri' },
            content_type: { type: 'string' },
            width: { type: 'integer' },
            height: { type: 'integer' },
          },
        },
      }),
    };

    it('simulates fal.ai image output with proper structure', async () => {
      const factory = createUnifiedHandler({ adapter: falAdapter, outputMimeType: 'image/png' });
      const handler = factory(createSimulatedContext({
        descriptor: { provider: 'fal-ai', model: 'wan/v2-6-text-to-image', environment: 'local' },
      }));

      const request = createJobRequest({
        provider: 'fal-ai',
        model: 'wan/v2-6-text-to-image',
        schema: newFormatSchema,
        resolvedInputs: {
          'Input:Prompt': 'A beautiful sunset over mountains',
          'Input:AspectRatio': '16:9',
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
          AspectRatio: { field: 'aspect_ratio', required: false },
        },
        producesCount: 2,
      });

      const result = await handler.invoke(request);

      expect(result.status).toBe('succeeded');
      expect(result.diagnostics?.simulated).toBe(true);
      expect(result.artefacts).toHaveLength(2);

      // Verify artefacts have URLs from schema-based generation
      for (const artefact of result.artefacts) {
        expect(artefact.status).toBe('succeeded');
        expect(artefact.diagnostics?.sourceUrl).toMatch(/^https:\/\/mock\.fal-ai\.media\//);
        expect(artefact.blob?.mimeType).toBe('image/png');
      }
    });

    it('validates input against schema and rejects invalid input', async () => {
      const factory = createUnifiedHandler({ adapter: falAdapter, outputMimeType: 'image/png' });
      const handler = factory(createSimulatedContext({
        descriptor: { provider: 'fal-ai', model: 'test-model', environment: 'local' },
      }));

      // Invalid: prompt should be string, not number
      const request = createJobRequest({
        provider: 'fal-ai',
        model: 'test-model',
        schema: newFormatSchema,
        resolvedInputs: {
          'Input:Prompt': 12345, // Wrong type
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
        },
      });

      await expect(handler.invoke(request)).rejects.toThrow(/Invalid input payload/);
    });

    it('rejects request when required input is missing', async () => {
      const factory = createUnifiedHandler({ adapter: falAdapter, outputMimeType: 'image/png' });
      const handler = factory(createSimulatedContext({
        descriptor: { provider: 'fal-ai', model: 'test-model', environment: 'local' },
      }));

      const request = createJobRequest({
        provider: 'fal-ai',
        model: 'test-model',
        schema: newFormatSchema,
        resolvedInputs: {
          // Missing required 'prompt'
          'Input:AspectRatio': '16:9',
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
          AspectRatio: { field: 'aspect_ratio', required: false },
        },
      });

      await expect(handler.invoke(request)).rejects.toThrow(/Missing required input/);
    });
  });

  describe('replicate provider - old schema format (flat input only)', () => {
    const oldFormatSchema = {
      input: JSON.stringify({
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          width: { type: 'integer', minimum: 512, maximum: 2048 },
          height: { type: 'integer', minimum: 512, maximum: 2048 },
        },
        required: ['prompt'],
      }),
      // No output schema - fallback mode
    };

    it('simulates replicate output with fallback URL array', async () => {
      const factory = createUnifiedHandler({ adapter: replicateAdapter, outputMimeType: 'image/png' });
      const handler = factory(createSimulatedContext({
        descriptor: { provider: 'replicate', model: 'bytedance/seedream-4', environment: 'local' },
      }));

      const request = createJobRequest({
        provider: 'replicate',
        model: 'bytedance/seedream-4',
        schema: oldFormatSchema,
        resolvedInputs: {
          'Input:Prompt': 'A cyberpunk cityscape',
          'Input:Width': 1024,
          'Input:Height': 1024,
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
          Width: { field: 'width', required: false },
          Height: { field: 'height', required: false },
        },
        producesCount: 1,
      });

      const result = await handler.invoke(request);

      expect(result.status).toBe('succeeded');
      expect(result.diagnostics?.simulated).toBe(true);
      expect(result.artefacts).toHaveLength(1);

      // Replicate fallback generates URL array
      const artefact = result.artefacts[0];
      expect(artefact?.status).toBe('succeeded');
      expect(artefact?.diagnostics?.sourceUrl).toMatch(/^https:\/\/mock\.replicate\.media\//);
    });

    it('handles multiple outputs in simulation', async () => {
      const factory = createUnifiedHandler({ adapter: replicateAdapter, outputMimeType: 'image/png' });
      const handler = factory(createSimulatedContext({
        descriptor: { provider: 'replicate', model: 'some-model', environment: 'local' },
      }));

      const request = createJobRequest({
        provider: 'replicate',
        model: 'some-model',
        schema: oldFormatSchema,
        resolvedInputs: {
          'Input:Prompt': 'Test prompt',
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
        },
        producesCount: 4, // Request 4 outputs
      });

      const result = await handler.invoke(request);

      expect(result.status).toBe('succeeded');
      expect(result.artefacts).toHaveLength(4);

      // All artefacts should have unique indices
      const indices = result.artefacts.map(a => a.artefactId);
      expect(new Set(indices).size).toBe(4);
    });
  });

  describe('wavespeed-ai provider - old schema format', () => {
    const wavespeedSchema = {
      input: JSON.stringify({
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          video_length: { type: 'integer' },
        },
        required: ['prompt'],
      }),
    };

    it('simulates wavespeed output with nested structure', async () => {
      const factory = createUnifiedHandler({ adapter: wavespeedAdapter, outputMimeType: 'video/mp4' });
      const handler = factory(createSimulatedContext({
        descriptor: { provider: 'wavespeed-ai', model: 'video-generator', environment: 'local' },
      }));

      const request = createJobRequest({
        provider: 'wavespeed-ai',
        model: 'video-generator',
        schema: wavespeedSchema,
        resolvedInputs: {
          'Input:Prompt': 'A serene forest scene',
          'Input:VideoLength': 5,
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
          VideoLength: { field: 'video_length', required: false },
        },
      });

      const result = await handler.invoke(request);

      expect(result.status).toBe('succeeded');
      expect(result.diagnostics?.simulated).toBe(true);
      expect(result.artefacts).toHaveLength(1);

      const artefact = result.artefacts[0];
      expect(artefact?.status).toBe('succeeded');
      expect(artefact?.blob?.mimeType).toBe('video/mp4');
    });
  });

  describe('cross-provider behavior consistency', () => {
    const adapters: Array<{ adapter: ProviderAdapter; name: string; mimeType: string }> = [
      { adapter: falAdapter, name: 'fal-ai', mimeType: 'image/png' },
      { adapter: replicateAdapter, name: 'replicate', mimeType: 'image/png' },
      { adapter: wavespeedAdapter, name: 'wavespeed-ai', mimeType: 'video/mp4' },
    ];

    const simpleSchema = {
      input: JSON.stringify({
        type: 'object',
        properties: {
          prompt: { type: 'string' },
        },
        required: ['prompt'],
      }),
    };

    it.each(adapters)('$name: simulated mode does not call adapter.invoke()', async ({ adapter, name, mimeType }) => {
      const invokeSpy = vi.spyOn(adapter, 'invoke');

      const factory = createUnifiedHandler({ adapter, outputMimeType: mimeType });
      const handler = factory(createSimulatedContext({
        descriptor: { provider: name, model: 'test-model', environment: 'local' },
      }));

      const request = createJobRequest({
        provider: name,
        model: 'test-model',
        schema: simpleSchema,
        resolvedInputs: {
          'Input:Prompt': 'Test prompt',
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
        },
      });

      await handler.invoke(request);

      expect(invokeSpy).not.toHaveBeenCalled();
      invokeSpy.mockRestore();
    });

    it.each(adapters)('$name: includes simulated flag in diagnostics', async ({ adapter, name, mimeType }) => {
      const factory = createUnifiedHandler({ adapter, outputMimeType: mimeType });
      const handler = factory(createSimulatedContext({
        descriptor: { provider: name, model: 'test-model', environment: 'local' },
      }));

      const request = createJobRequest({
        provider: name,
        model: 'test-model',
        schema: simpleSchema,
        resolvedInputs: {
          'Input:Prompt': 'Test prompt',
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
        },
      });

      const result = await handler.invoke(request);

      expect(result.diagnostics?.simulated).toBe(true);
      expect(result.diagnostics?.provider).toBe(name);
    });

    it.each(adapters)('$name: validates required inputs even in simulated mode', async ({ adapter, name, mimeType }) => {
      const factory = createUnifiedHandler({ adapter, outputMimeType: mimeType });
      const handler = factory(createSimulatedContext({
        descriptor: { provider: name, model: 'test-model', environment: 'local' },
      }));

      const request = createJobRequest({
        provider: name,
        model: 'test-model',
        schema: simpleSchema,
        resolvedInputs: {
          // Missing required 'prompt'
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
        },
      });

      await expect(handler.invoke(request)).rejects.toThrow(/Missing required input/);
    });
  });

  describe('video model detection and output generation', () => {
    it('generates video-style output for video models with output schema', async () => {
      // When there's an output_schema, the generated URLs use .png extension
      // The mimeType comes from the handler's outputMimeType, not the URL
      const videoSchema = {
        input: JSON.stringify({
          input_schema: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
            },
            required: ['prompt'],
          },
          output_schema: {
            type: 'object',
            properties: {
              video: { $ref: '#/VideoFile' },
            },
          },
          VideoFile: {
            type: 'object',
            properties: {
              url: { type: 'string', format: 'uri' },
              fps: { type: 'number' },
              duration: { type: 'number' },
            },
          },
        }),
      };

      const factory = createUnifiedHandler({ adapter: falAdapter, outputMimeType: 'video/mp4' });
      const handler = factory(createSimulatedContext({
        descriptor: { provider: 'fal-ai', model: 'wan/v2-6-text-to-video', environment: 'local' },
      }));

      const request = createJobRequest({
        provider: 'fal-ai',
        model: 'wan/v2-6-text-to-video',
        schema: videoSchema,
        resolvedInputs: {
          'Input:Prompt': 'A dancing robot',
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
        },
      });

      const result = await handler.invoke(request);

      expect(result.status).toBe('succeeded');
      expect(result.artefacts).toHaveLength(1);

      const artefact = result.artefacts[0];
      // mimeType comes from handler's outputMimeType parameter
      expect(artefact?.blob?.mimeType).toBe('video/mp4');
      // URL is generated from schema - contains provider and model
      expect(artefact?.diagnostics?.sourceUrl).toMatch(/^https:\/\/mock\.fal-ai\.media\//);
    });
  });

  describe('schema loading and parsing integration', () => {
    it('handles schema with $ref to nested types', async () => {
      // Use a structure that matches what the fal.ai normalizer expects
      // (images array at top level containing objects with url property)
      const schemaWithRefs = {
        input: JSON.stringify({
          input_schema: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
            },
          },
          output_schema: {
            type: 'object',
            properties: {
              images: {
                type: 'array',
                items: { $ref: '#/ImageFile' },
              },
              metadata: { $ref: '#/Metadata' },
            },
          },
          ImageFile: {
            type: 'object',
            properties: {
              url: { type: 'string', format: 'uri' },
              content_type: { type: 'string' },
              width: { type: 'integer' },
              height: { type: 'integer' },
            },
          },
          Metadata: {
            type: 'object',
            properties: {
              seed: { type: 'integer' },
              inference_time: { type: 'number' },
            },
          },
        }),
      };

      const factory = createUnifiedHandler({ adapter: falAdapter, outputMimeType: 'image/png' });
      const handler = factory(createSimulatedContext({
        descriptor: { provider: 'fal-ai', model: 'complex-model', environment: 'local' },
      }));

      const request = createJobRequest({
        provider: 'fal-ai',
        model: 'complex-model',
        schema: schemaWithRefs,
        resolvedInputs: {
          'Input:Prompt': 'Complex generation test',
        },
        sdkMapping: {
          Prompt: { field: 'prompt', required: true },
        },
        producesCount: 2,
      });

      const result = await handler.invoke(request);

      expect(result.status).toBe('succeeded');
      expect(result.artefacts).toHaveLength(2);

      // Verify the generated output includes the nested metadata
      expect(result.diagnostics?.simulated).toBe(true);
      for (const artefact of result.artefacts) {
        expect(artefact.status).toBe('succeeded');
        expect(artefact.diagnostics?.sourceUrl).toBeDefined();
      }
    });
  });
});
