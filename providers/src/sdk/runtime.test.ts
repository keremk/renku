import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProducerRuntime } from './runtime.js';
import type { ProviderJobContext } from '../types.js';
import { SdkErrorCode, type MappingFieldDefinition } from '@gorenku/core';
import { resolveSchemaRefs } from './unified/schema-file.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Helper to create a minimal job context for testing
function createTestJobContext(
  resolvedInputs: Record<string, unknown>,
  inputBindings: Record<string, string>,
  sdkMapping: Record<string, MappingFieldDefinition>
): ProviderJobContext {
  return {
    jobId: 'test-job',
    provider: 'test-provider',
    model: 'test-model',
    revision: 'rev-revision',
    layerIndex: 0,
    attempt: 1,
    inputs: [],
    produces: [],
    context: {
      extras: {
        resolvedInputs,
        jobContext: {
          inputBindings,
          sdkMapping,
        },
      },
    },
  };
}

function readCatalogInputSchema(filename: string): string {
  const raw = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../catalog/models/fal-ai/video', filename),
      'utf8'
    )
  ) as Record<string, unknown>;
  return JSON.stringify(
    resolveSchemaRefs(
      raw.input_schema as Record<string, unknown>,
      raw as Record<string, unknown>
    )
  );
}

describe('createProducerRuntime', () => {
  describe('sdk.buildPayload with transforms', () => {
    it('applies string-to-object transform', async () => {
      const request = createTestJobContext(
        { 'Input:Size': '1K' },
        { Size: 'Input:Size' },
        {
          Size: {
            field: 'image_size',
            transform: {
              '1K': { width: 1024, height: 1024 },
              '2K': { width: 2048, height: 2048 },
            },
          },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const payload = await runtime.sdk.buildPayload(undefined, undefined);

      expect(payload).toEqual({
        image_size: { width: 1024, height: 1024 },
      });
    });

    it('applies string-to-string transform', async () => {
      const request = createTestJobContext(
        { 'Input:Size': '2K' },
        { Size: 'Input:Size' },
        {
          Size: {
            field: 'image_size',
            transform: {
              '1K': { width: 1024, height: 1024 },
              '2K': 'auto_2K',
              '4K': 'auto_4K',
            },
          },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const payload = await runtime.sdk.buildPayload(undefined, undefined);

      expect(payload).toEqual({
        image_size: 'auto_2K',
      });
    });

    it('passes through value when no matching transform key', async () => {
      const request = createTestJobContext(
        { 'Input:Size': 'custom_value' },
        { Size: 'Input:Size' },
        {
          Size: {
            field: 'image_size',
            transform: {
              '1K': { width: 1024, height: 1024 },
              '2K': 'auto_2K',
            },
          },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const payload = await runtime.sdk.buildPayload(undefined, undefined);

      expect(payload).toEqual({
        image_size: 'custom_value',
      });
    });

    it('passes through value when no transform defined', async () => {
      const request = createTestJobContext(
        { 'Input:Prompt': 'test prompt' },
        { Prompt: 'Input:Prompt' },
        {
          Prompt: {
            field: 'prompt',
            // No transform
          },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const payload = await runtime.sdk.buildPayload(undefined, undefined);

      expect(payload).toEqual({
        prompt: 'test prompt',
      });
    });

    it('supports one Resolution mapping projected to multiple payload fields', async () => {
      const request = createTestJobContext(
        { 'Input:Resolution': { width: 1280, height: 720 } },
        { Resolution: 'Input:Resolution' },
        {
          Resolution: {
            expand: true,
            resolution: {
              mode: 'aspectRatioAndPresetObject',
              aspectRatioField: 'aspect_ratio',
              presetField: 'resolution',
            },
          },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const payload = await runtime.sdk.buildPayload(undefined, undefined);

      expect(payload).toEqual({
        aspect_ratio: '16:9',
        resolution: '720p',
      });
    });

    it('transforms numeric values using string keys', async () => {
      const request = createTestJobContext(
        { 'Input:Quality': 1 },
        { Quality: 'Input:Quality' },
        {
          Quality: {
            field: 'quality_setting',
            transform: {
              '1': 'low',
              '2': 'medium',
              '3': 'high',
            },
          },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const payload = await runtime.sdk.buildPayload(undefined, undefined);

      expect(payload).toEqual({
        quality_setting: 'low',
      });
    });

    it('handles multiple fields with and without transforms', async () => {
      const request = createTestJobContext(
        {
          'Input:Prompt': 'a beautiful sunset',
          'Input:Size': '4K',
          'Input:Style': 'cinematic',
        },
        {
          Prompt: 'Input:Prompt',
          Size: 'Input:Size',
          Style: 'Input:Style',
        },
        {
          Prompt: { field: 'prompt' },
          Size: {
            field: 'image_size',
            transform: {
              '1K': { width: 1024, height: 1024 },
              '2K': 'auto_2K',
              '4K': 'auto_4K',
            },
          },
          Style: { field: 'style' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const payload = await runtime.sdk.buildPayload(undefined, undefined);

      expect(payload).toEqual({
        prompt: 'a beautiful sunset',
        image_size: 'auto_4K',
        style: 'cinematic',
      });
    });
  });

  describe('sdk.buildPayload with expand', () => {
    it('expands transformed object into payload', async () => {
      const request = createTestJobContext(
        { 'Input:Size': '1K' },
        { Size: 'Input:Size' },
        {
          Size: {
            field: '', // field is ignored when expand is true
            transform: {
              '1K': { width: 1024, height: 1024 },
              '2K': { width: 2048, height: 2048 },
              '4K': { width: 4096, height: 4096 },
            },
            expand: true,
          },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const payload = await runtime.sdk.buildPayload(undefined, undefined);

      expect(payload).toEqual({
        width: 1024,
        height: 1024,
      });
    });

    it('expands with multiple properties from transform', async () => {
      const request = createTestJobContext(
        { 'Input:Quality': 'high' },
        { Quality: 'Input:Quality' },
        {
          Quality: {
            field: '',
            transform: {
              low: { quality: 50, compression: 'fast' },
              medium: { quality: 75, compression: 'balanced' },
              high: { quality: 100, compression: 'slow', optimize: true },
            },
            expand: true,
          },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const payload = await runtime.sdk.buildPayload(undefined, undefined);

      expect(payload).toEqual({
        quality: 100,
        compression: 'slow',
        optimize: true,
      });
    });

    it('combines expand with regular fields', async () => {
      const request = createTestJobContext(
        {
          'Input:Prompt': 'a beautiful landscape',
          'Input:Size': '2K',
        },
        {
          Prompt: 'Input:Prompt',
          Size: 'Input:Size',
        },
        {
          Prompt: { field: 'prompt' },
          Size: {
            field: '',
            transform: {
              '1K': { width: 1024, height: 1024 },
              '2K': { width: 2048, height: 2048 },
            },
            expand: true,
          },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const payload = await runtime.sdk.buildPayload(undefined, undefined);

      expect(payload).toEqual({
        prompt: 'a beautiful landscape',
        width: 2048,
        height: 2048,
      });
    });

    it('throws error when expand is true but value is not an object', async () => {
      const request = createTestJobContext(
        { 'Input:Size': 'unknown' },
        { Size: 'Input:Size' },
        {
          Size: {
            field: '',
            transform: {
              '1K': { width: 1024, height: 1024 },
            },
            expand: true,
          },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      await expect(
        runtime.sdk.buildPayload(undefined, undefined)
      ).rejects.toThrow('Cannot expand non-object value for "Size"');
    });

    it('throws error when expand is true but value is an array', async () => {
      const request = createTestJobContext(
        { 'Input:Size': 'arr' },
        { Size: 'Input:Size' },
        {
          Size: {
            field: '',
            transform: {
              arr: [1, 2, 3],
            },
            expand: true,
          },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      await expect(
        runtime.sdk.buildPayload(undefined, undefined)
      ).rejects.toThrow('Cannot expand non-object value for "Size"');
    });

    it('resolves indexed canonical input IDs from parent array values', async () => {
      const request = createTestJobContext(
        { 'Input:NarrationScript': ['segment 0', 'segment 1', 'segment 2'] },
        { Text: 'Input:NarrationScript[1]' },
        {
          Text: { field: 'text' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const payload = await runtime.sdk.buildPayload(undefined, undefined);
      expect(payload).toEqual({ text: 'segment 1' });
    });

    it('throws error when indexed canonical input ID is out of bounds', async () => {
      const request = createTestJobContext(
        { 'Input:NarrationScript': ['segment 0'] },
        { Text: 'Input:NarrationScript[2]' },
        {
          Text: { field: 'text' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      try {
        await runtime.sdk.buildPayload(undefined, undefined);
        expect.fail(
          'Expected buildPayload to throw for out-of-bounds indexed input access'
        );
      } catch (error) {
        const providerError = error as { code?: string; message?: string };
        expect(providerError.code).toBe(
          SdkErrorCode.INVALID_INDEXED_INPUT_ACCESS
        );
        expect(providerError.message).toContain('index 2 is out of bounds');
      }
    });
  });

  describe('sdk.buildPayload with schema-based required validation', () => {
    it('merges exact schema field values from provider config', async () => {
      const request = createTestJobContext(
        { 'Input:Text': 'test prompt' },
        { Text: 'Input:Text' },
        {
          Text: { field: 'text' },
          VoiceId: { field: 'voice' },
        }
      );
      request.context.providerConfig = {
        voice: 'JBFqnCBsd6RMkjVDRZzb',
      };

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string' },
          voice: { type: 'string', default: 'Rachel' },
        },
      });

      const payload = await runtime.sdk.buildPayload(undefined, schema);

      expect(payload).toEqual({
        text: 'test prompt',
        voice: 'JBFqnCBsd6RMkjVDRZzb',
      });
    });

    it('supports wrapped provider config when customAttributes are present', async () => {
      const request = createTestJobContext(
        { 'Input:Text': 'test prompt' },
        { Text: 'Input:Text' },
        {
          Text: { field: 'text' },
        }
      );
      request.context.providerConfig = {
        customAttributes: { trace: 'abc' },
        config: {
          voice: 'Rachel',
        },
      };

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string' },
          voice: { type: 'string', default: 'Rachel' },
        },
      });

      const payload = await runtime.sdk.buildPayload(undefined, schema);

      expect(payload).toEqual({
        text: 'test prompt',
        voice: 'Rachel',
      });
    });

    it('fails when provider config conflicts with a mapped payload field', async () => {
      const request = createTestJobContext(
        {
          'Input:Text': 'test prompt',
          'Input:VoiceId': 'Aria',
        },
        {
          Text: 'Input:Text',
          VoiceId: 'Input:VoiceId',
        },
        {
          Text: { field: 'text' },
          VoiceId: { field: 'voice' },
        }
      );
      request.context.providerConfig = {
        voice: 'Rachel',
      };

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string' },
          voice: { type: 'string', default: 'Rachel' },
        },
      });

      await expect(runtime.sdk.buildPayload(undefined, schema)).rejects.toThrow(
        'Provider config field "voice" conflicts with the mapped payload value'
      );
    });

    it('throws error when missing a required field (per schema)', async () => {
      const request = createTestJobContext(
        { 'Input:Style': 'cinematic' }, // Missing required 'prompt'
        { Prompt: 'Input:Prompt', Style: 'Input:Style' },
        {
          Prompt: { field: 'prompt' },
          Style: { field: 'style' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string' },
          style: { type: 'string' },
        },
      });

      await expect(runtime.sdk.buildPayload(undefined, schema)).rejects.toThrow(
        'Missing required input "Input:Prompt" for field "prompt"'
      );
    });

    it('skips optional fields (per schema) without error', async () => {
      const request = createTestJobContext(
        { 'Input:Prompt': 'test prompt' }, // Missing optional 'style'
        { Prompt: 'Input:Prompt', Style: 'Input:Style' },
        {
          Prompt: { field: 'prompt' },
          Style: { field: 'style' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        required: ['prompt'], // style is not required
        properties: {
          prompt: { type: 'string' },
          style: { type: 'string' },
        },
      });

      const payload = await runtime.sdk.buildPayload(undefined, schema);

      expect(payload).toEqual({
        prompt: 'test prompt',
      });
    });

    it('works in permissive mode when no schema is provided', async () => {
      const request = createTestJobContext(
        { 'Input:Prompt': 'test prompt' }, // Missing 'style'
        { Prompt: 'Input:Prompt', Style: 'Input:Style' },
        {
          Prompt: { field: 'prompt' },
          Style: { field: 'style' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      // No schema provided - should be permissive
      const payload = await runtime.sdk.buildPayload(undefined, undefined);

      expect(payload).toEqual({
        prompt: 'test prompt',
      });
    });

    it('skips required check for expand fields', async () => {
      const request = createTestJobContext(
        { 'Input:Prompt': 'test prompt' }, // Missing 'Size' which has expand:true
        { Prompt: 'Input:Prompt', Size: 'Input:Size' },
        {
          Prompt: { field: 'prompt' },
          Size: {
            field: '', // empty field for expand
            expand: true,
            transform: {
              '1K': { width: 1024, height: 1024 },
            },
          },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      // Even though width/height might be in schema.required, expand fields skip the check
      const schema = JSON.stringify({
        type: 'object',
        required: ['prompt', 'width', 'height'],
        properties: {
          prompt: { type: 'string' },
          width: { type: 'integer' },
          height: { type: 'integer' },
        },
      });

      // Should not throw - expand fields bypass required check
      const payload = await runtime.sdk.buildPayload(undefined, schema);

      expect(payload).toEqual({
        prompt: 'test prompt',
      });
    });

    it('handles schema with no required array (all fields optional)', async () => {
      const request = createTestJobContext(
        {}, // No inputs provided
        { Prompt: 'Input:Prompt', Style: 'Input:Style' },
        {
          Prompt: { field: 'prompt' },
          Style: { field: 'style' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        // No required array
        properties: {
          prompt: { type: 'string' },
          style: { type: 'string' },
        },
      });

      const payload = await runtime.sdk.buildPayload(undefined, schema);

      expect(payload).toEqual({});
    });

    it('skips required field with schema default (provider uses its default)', async () => {
      const request = createTestJobContext(
        { 'Input:Prompt': 'test prompt' }, // Missing 'style' which is required but has default
        { Prompt: 'Input:Prompt', Style: 'Input:Style' },
        {
          Prompt: { field: 'prompt' },
          Style: { field: 'style' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        required: ['prompt', 'style'], // style is required but has default
        properties: {
          prompt: { type: 'string' },
          style: { type: 'string', default: 'cinematic' }, // schema provides default
        },
      });

      // Should NOT throw - provider will use its default
      const payload = await runtime.sdk.buildPayload(undefined, schema);

      expect(payload).toEqual({
        prompt: 'test prompt',
        // style is NOT in payload - provider uses its own default
      });
    });

    it('throws error for required field without schema default', async () => {
      const request = createTestJobContext(
        { 'Input:Style': 'cinematic' }, // Missing 'prompt' which is required and has NO default
        { Prompt: 'Input:Prompt', Style: 'Input:Style' },
        {
          Prompt: { field: 'prompt' },
          Style: { field: 'style' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        required: ['prompt', 'style'],
        properties: {
          prompt: { type: 'string' }, // NO default
          style: { type: 'string', default: 'default-style' },
        },
      });

      await expect(runtime.sdk.buildPayload(undefined, schema)).rejects.toThrow(
        'No schema default available'
      );
    });

    it('skips multiple required fields that all have schema defaults', async () => {
      const request = createTestJobContext(
        { 'Input:Prompt': 'test prompt' }, // Missing 'style', 'quality', 'format' - all required with defaults
        {
          Prompt: 'Input:Prompt',
          Style: 'Input:Style',
          Quality: 'Input:Quality',
          Format: 'Input:Format',
        },
        {
          Prompt: { field: 'prompt' },
          Style: { field: 'style' },
          Quality: { field: 'quality' },
          Format: { field: 'format' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        required: ['prompt', 'style', 'quality', 'format'],
        properties: {
          prompt: { type: 'string' },
          style: { type: 'string', default: 'cinematic' },
          quality: { type: 'integer', default: 80 },
          format: { type: 'string', default: 'png' },
        },
      });

      const payload = await runtime.sdk.buildPayload(undefined, schema);

      // Only user-provided value in payload - provider uses defaults for rest
      expect(payload).toEqual({
        prompt: 'test prompt',
      });
    });
  });

  describe('sdk.buildPayload with blob inputs', () => {
    it('keeps blob values untouched for URI fields (resolution happens later)', async () => {
      const blobInput = {
        data: Buffer.from('image-bytes'),
        mimeType: 'image/png',
      };

      const request = createTestJobContext(
        { 'Input:Image': blobInput },
        { Image: 'Input:Image' },
        {
          Image: { field: 'image_url' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          image_url: { type: 'string', format: 'uri' },
        },
      });

      const payload = await runtime.sdk.buildPayload(undefined, schema);

      expect(payload).toEqual({
        image_url: blobInput,
      });
    });
  });

  describe('sdk.buildPayload enum normalization', () => {
    it('normalizes numeric duration to string enum value', async () => {
      const request = createTestJobContext(
        { 'Input:Duration': 10 },
        { Duration: 'Input:Duration' },
        {
          Duration: { field: 'duration' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          duration: {
            type: 'string',
            enum: ['4', '5', '6', '7', '8', '9', '10', '11', '12'],
          },
        },
      });

      const payload = await runtime.sdk.buildPayload(undefined, schema);

      expect(payload).toEqual({ duration: '10' });
    });

    it('snaps numeric duration to nearest allowed enum value', async () => {
      const request = createTestJobContext(
        { 'Input:Duration': 10 },
        { Duration: 'Input:Duration' },
        {
          Duration: { field: 'duration' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          duration: { type: 'string', enum: ['4s', '6s', '8s'] },
        },
      });

      const payload = await runtime.sdk.buildPayload(undefined, schema);

      expect(payload).toEqual({ duration: '8s' });
    });

    it('normalizes string numeric input to integer enum value', async () => {
      const request = createTestJobContext(
        { 'Input:Duration': '8' },
        { Duration: 'Input:Duration' },
        {
          Duration: { field: 'duration' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          duration: { type: 'integer', enum: [4, 8, 12] },
        },
      });

      const payload = await runtime.sdk.buildPayload(undefined, schema);

      expect(payload).toEqual({ duration: 8 });
    });

    it('normalizes SegmentDuration-bound duration to nearest enum value', async () => {
      const request = createTestJobContext(
        { 'Input:SegmentDuration': 10 },
        { Duration: 'Input:SegmentDuration' },
        {
          Duration: { field: 'duration' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          duration: { type: 'string', enum: ['4s', '6s', '8s'] },
        },
      });

      const payload = await runtime.sdk.buildPayload(undefined, schema);

      expect(payload).toEqual({ duration: '8s' });
    });

    it('normalizes using x-renku-constraints when schema enum is absent', async () => {
      const request = createTestJobContext(
        { 'Input:SegmentDuration': 9 },
        { Duration: 'Input:SegmentDuration' },
        {
          Duration: { field: 'duration' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          duration: {
            type: 'string',
            description: 'Duration in seconds.',
          },
        },
        'x-renku-constraints': {
          fields: {
            duration: {
              enum: {
                values: ['5s', '10s'],
                source: 'inferred',
                confidence: 'medium',
              },
            },
          },
        },
      });

      const payload = await runtime.sdk.buildPayload(undefined, schema);

      expect(payload).toEqual({ duration: '10s' });
    });

    it('snaps derived aspect ratio strings to nearest allowed enum value', async () => {
      const request = createTestJobContext(
        { 'Input:AspectRatio': '455:256' },
        { AspectRatio: 'Input:AspectRatio' },
        {
          AspectRatio: { field: 'aspect_ratio' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '4:3', '16:9', '9:16'],
          },
        },
      });

      const payload = await runtime.sdk.buildPayload(undefined, schema);

      expect(payload).toEqual({ aspect_ratio: '16:9' });
    });

    it('fails fast when schema enum constraints cannot be satisfied', async () => {
      const request = createTestJobContext(
        { 'Input:AspectRatio': 'hello-world' },
        { AspectRatio: 'Input:AspectRatio' },
        {
          AspectRatio: { field: 'aspect_ratio' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'test', model: 'test', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '4:3', '16:9', '9:16'],
          },
        },
      });

      await expect(runtime.sdk.buildPayload(undefined, schema)).rejects.toThrow(
        'incompatible with model constraints'
      );
    });
  });

  describe('schema-driven fan-in projection', () => {
    it('projects Seedance reference fan-in to plain provider arrays', async () => {
      const request = createTestJobContext(
        {
          'Input:ReferenceImages': {
            groupBy: 'segment',
            groups: [['Artifact:Image1'], ['Artifact:Image2']],
          },
          'Input:ReferenceVideos': {
            groupBy: 'segment',
            groups: [['Artifact:Video1']],
          },
          'Input:ReferenceAudios': {
            groupBy: 'segment',
            groups: [['Artifact:Audio1']],
          },
          'Artifact:Image1': 'image-1.png',
          'Artifact:Image2': 'image-2.png',
          'Artifact:Video1': 'video-1.mp4',
          'Artifact:Audio1': 'audio-1.wav',
        },
        {
          ReferenceImages: 'Input:ReferenceImages',
          ReferenceVideos: 'Input:ReferenceVideos',
          ReferenceAudios: 'Input:ReferenceAudios',
        },
        {
          ReferenceImages: { field: 'image_urls' },
          ReferenceVideos: { field: 'video_urls' },
          ReferenceAudios: { field: 'audio_urls' },
        }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'fal-ai', model: 'seedance', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          image_urls: { type: 'array', items: { type: 'string', format: 'uri' } },
          video_urls: { type: 'array', items: { type: 'string', format: 'uri' } },
          audio_urls: { type: 'array', items: { type: 'string', format: 'uri' } },
        },
      });

      await expect(runtime.sdk.buildPayload(undefined, schema)).resolves.toEqual({
        image_urls: ['image-1.png', 'image-2.png'],
        video_urls: ['video-1.mp4'],
        audio_urls: ['audio-1.wav'],
      });
    });

    it.each([
      [
        'standard',
        'kling-video-o3-standard-reference-to-video.json',
      ],
      [
        'pro',
        'kling-video-o3-pro-reference-to-video.json',
      ],
    ])(
      'projects Kling O3 %s top-level and nested element fan-in',
      async (_variant, schemaFile) => {
        const request = createTestJobContext(
          {
            'Input:Prompt': '@Image1 introduces @Element1, then @Element2.',
            'Input:StartImage': 'start.png',
            'Input:EndImage': 'end.png',
            'Input:ReferenceImages': {
              groupBy: 'segment',
              groups: [['Artifact:Style1'], ['Artifact:Style2']],
            },
            'Input:ElementFrontalImages': {
              groupBy: 'element',
              groups: [['Artifact:HeroFront'], ['Artifact:GuideFront']],
            },
            'Input:ElementReferenceImages': {
              groupBy: 'element',
              groups: [
                ['Artifact:HeroRef1', 'Artifact:HeroRef2'],
                ['Artifact:GuideRef1'],
              ],
            },
            'Artifact:Style1': 'style-1.png',
            'Artifact:Style2': 'style-2.png',
            'Artifact:HeroFront': 'hero-front.png',
            'Artifact:GuideFront': 'guide-front.png',
            'Artifact:HeroRef1': 'hero-ref-1.png',
            'Artifact:HeroRef2': 'hero-ref-2.png',
            'Artifact:GuideRef1': 'guide-ref-1.png',
          },
          {
            Prompt: 'Input:Prompt',
            StartImage: 'Input:StartImage',
            EndImage: 'Input:EndImage',
            ReferenceImages: 'Input:ReferenceImages',
            ElementFrontalImages: 'Input:ElementFrontalImages',
            ElementReferenceImages: 'Input:ElementReferenceImages',
          },
          {
            Prompt: { field: 'prompt' },
            StartImage: { field: 'start_image_url' },
            EndImage: { field: 'end_image_url' },
            ReferenceImages: { field: 'image_urls' },
            ElementFrontalImages: { field: 'elements[].frontal_image_url' },
            ElementReferenceImages: {
              field: 'elements[].reference_image_urls',
            },
          }
        );

        const runtime = createProducerRuntime({
          descriptor: { provider: 'fal-ai', model: 'kling-o3', environment: 'local' },
          domain: 'media',
          request,
          mode: 'live',
        });

        await expect(
          runtime.sdk.buildPayload(undefined, readCatalogInputSchema(schemaFile))
        ).resolves.toEqual({
          prompt: '@Image1 introduces @Element1, then @Element2.',
          start_image_url: 'start.png',
          end_image_url: 'end.png',
          image_urls: ['style-1.png', 'style-2.png'],
          elements: [
            {
              frontal_image_url: 'hero-front.png',
              reference_image_urls: ['hero-ref-1.png', 'hero-ref-2.png'],
            },
            {
              frontal_image_url: 'guide-front.png',
              reference_image_urls: ['guide-ref-1.png'],
            },
          ],
        });
      }
    );

    it('does not emit sparse arrays for nested fan-in groups with earlier empty groups', async () => {
      const request = createTestJobContext(
        {
          'Input:ElementVideos': {
            groupBy: 'element',
            groups: [[], ['Artifact:Element2Video']],
          },
          'Artifact:Element2Video': 'element-2.mp4',
        },
        { ElementVideos: 'Input:ElementVideos' },
        { ElementVideos: { field: 'elements[].video_url' } }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'fal-ai', model: 'kling-o3', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          elements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                video_url: { type: 'string', format: 'uri' },
              },
            },
          },
        },
      });

      await expect(runtime.sdk.buildPayload(undefined, schema)).resolves.toEqual({
        elements: [{ video_url: 'element-2.mp4' }],
      });
    });

    it('fails when a fan-in collection is mapped to a scalar field', async () => {
      const request = createTestJobContext(
        {
          'Input:StartImage': {
            groupBy: 'segment',
            groups: [['Artifact:Start']],
          },
          'Artifact:Start': 'start.png',
        },
        { StartImage: 'Input:StartImage' },
        { StartImage: { field: 'start_image_url' } }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'fal-ai', model: 'kling-o3', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          start_image_url: { type: 'string', format: 'uri' },
        },
      });

      await expect(runtime.sdk.buildPayload(undefined, schema)).rejects.toThrow(
        'Fan-in input mapped to scalar field "start_image_url"'
      );
    });

    it('fails when a fan-in member is unresolved', async () => {
      const request = createTestJobContext(
        {
          'Input:ReferenceImages': {
            groupBy: 'segment',
            groups: [['Artifact:Missing']],
          },
        },
        { ReferenceImages: 'Input:ReferenceImages' },
        { ReferenceImages: { field: 'image_urls' } }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'fal-ai', model: 'seedance', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          image_urls: { type: 'array', items: { type: 'string', format: 'uri' } },
        },
      });

      await expect(runtime.sdk.buildPayload(undefined, schema)).rejects.toThrow(
        'Fan-in member "Artifact:Missing" was not resolved'
      );
    });

    it('preserves grouped fan-in for Renku-owned schema fields', async () => {
      const request = createTestJobContext(
        {
          'Input:VideoSegments': {
            groupBy: 'segment',
            orderBy: 'segment',
            groups: [['Artifact:Video1'], ['Artifact:Video2']],
          },
          'Artifact:Video1': 'video-1.mp4',
          'Artifact:Video2': 'video-2.mp4',
        },
        { VideoSegments: 'Input:VideoSegments' },
        { VideoSegments: { field: 'videoSegments' } }
      );

      const runtime = createProducerRuntime({
        descriptor: { provider: 'renku', model: 'timeline/ordered', environment: 'local' },
        domain: 'media',
        request,
        mode: 'live',
      });

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          videoSegments: {
            'x-renku-shape': 'fanIn',
            'x-renku-itemType': 'video',
          },
        },
      });

      await expect(runtime.inputs.buildModelInput(undefined, schema)).resolves.toEqual({
        videoSegments: {
          groupBy: 'segment',
          orderBy: 'segment',
          groups: [
            [{ id: 'Artifact:Video1', value: 'video-1.mp4' }],
            [{ id: 'Artifact:Video2', value: 'video-2.mp4' }],
          ],
        },
      });
    });
  });
});
