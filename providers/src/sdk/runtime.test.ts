import { describe, it, expect } from 'vitest';
import { createProducerRuntime } from './runtime.js';
import type { ProviderJobContext } from '../types.js';
import { SdkErrorCode } from '@gorenku/core';

// Helper to create a minimal job context for testing
function createTestJobContext(
  resolvedInputs: Record<string, unknown>,
  inputBindings: Record<string, string>,
  sdkMapping: Record<
    string,
    { field: string; transform?: Record<string, unknown>; expand?: boolean }
  >
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
  });
});
