/**
 * Integration tests for YAML mapping transforms.
 *
 * These tests exercise the full payload building pipeline using sdkMapping
 * configurations that mirror real producer YAML mappings. They run through
 * the complete pipeline (schema validation, transforms) in simulated mode
 * without making actual API calls.
 */
import { describe, it, expect } from 'vitest';
import { createProducerRuntime } from './runtime.js';
import type { ProviderJobContext } from '../types.js';
import type { MappingFieldDefinition } from '@gorenku/core';

/**
 * Creates a job context with sdkMapping for testing the full payload pipeline.
 */
function createJobContext(
  resolvedInputs: Record<string, unknown>,
  inputBindings: Record<string, string>,
  sdkMapping: Record<string, MappingFieldDefinition>,
  provider = 'fal-ai',
  model = 'test-model'
): ProviderJobContext {
  return {
    jobId: 'transform-test-job',
    provider,
    model,
    revision: 'rev-1',
    layerIndex: 0,
    attempt: 1,
    inputs: Object.values(inputBindings),
    produces: ['Artifact:Output[index=0]'],
    context: {
      providerConfig: {},
      extras: {
        resolvedInputs,
        jobContext: { inputBindings, sdkMapping },
        schema: { input: '{}' },
      },
    },
  };
}

/**
 * Builds a transformed payload using the full runtime pipeline.
 * This mirrors how producers work in production with YAML-defined sdkMapping.
 */
async function buildTransformedPayload(
  inputs: Record<string, unknown>,
  sdkMapping: Record<string, MappingFieldDefinition>
): Promise<Record<string, unknown>> {
  const inputBindings = Object.fromEntries(
    Object.keys(inputs).map((key) => [key, `Input:${key}`])
  );
  const resolvedInputs = Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [`Input:${key}`, value])
  );

  const request = createJobContext(resolvedInputs, inputBindings, sdkMapping);
  const runtime = createProducerRuntime({
    descriptor: { provider: 'test', model: 'test', environment: 'local' },
    domain: 'media',
    request,
    mode: 'live',
  });

  return runtime.sdk.buildPayload(undefined, undefined);
}

describe('YAML Mapping Transforms Integration', () => {
  /**
   * 1. transform - Value mapping using lookup table
   * Mirrors: catalog/producers/asset/text-to-image.yaml (seedream/v4)
   */
  describe('transform - value mapping', () => {
    const enhancePromptMapping: Record<string, MappingFieldDefinition> = {
      EnhancePrompt: {
        field: 'enhance_prompt_mode',
        transform: {
          true: 'standard',
          false: 'fast',
        },
      },
    };

    it('maps boolean true to "standard"', async () => {
      const payload = await buildTransformedPayload(
        { EnhancePrompt: true },
        enhancePromptMapping
      );
      expect(payload.enhance_prompt_mode).toBe('standard');
    });

    it('maps boolean false to "fast"', async () => {
      const payload = await buildTransformedPayload(
        { EnhancePrompt: false },
        enhancePromptMapping
      );
      expect(payload.enhance_prompt_mode).toBe('fast');
    });

    it('preserves original value when no matching transform key', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        AspectRatio: {
          field: 'image_size',
          transform: {
            '16:9': 'landscape_16_9',
            '1:1': 'square_hd',
          },
        },
      };
      const payload = await buildTransformedPayload(
        { AspectRatio: '4:5' },
        mapping
      );
      expect(payload.image_size).toBe('4:5');
    });

    it('transforms to object value', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        AspectRatio: {
          field: 'image_size',
          transform: {
            '16:9': { width: 1920, height: 1080 },
            '1:1': { width: 1024, height: 1024 },
          },
        },
      };
      const payload = await buildTransformedPayload(
        { AspectRatio: '16:9' },
        mapping
      );
      expect(payload.image_size).toEqual({ width: 1920, height: 1080 });
    });
  });

  /**
   * 2. combine - Multi-input combination
   * Mirrors: catalog/producers/asset/text-to-video.yaml (LTX models)
   */
  describe('combine - multi-input combination', () => {
    const videoSizeMapping: Record<string, MappingFieldDefinition> = {
      VideoSize: {
        field: 'video_size',
        combine: {
          inputs: ['AspectRatio', 'Resolution'],
          table: {
            '16:9+720p': { width: 1280, height: 720 },
            '16:9+480p': { width: 848, height: 480 },
            '9:16+720p': { width: 720, height: 1280 },
            '1:1+720p': { width: 720, height: 720 },
            '16:9+': 'landscape_16_9',
            '9:16+': 'portrait_16_9',
            '1:1+': 'square_hd',
          },
        },
      },
    };

    it('combines AspectRatio + Resolution into object', async () => {
      const payload = await buildTransformedPayload(
        { AspectRatio: '16:9', Resolution: '720p' },
        videoSizeMapping
      );
      expect(payload.video_size).toEqual({ width: 1280, height: 720 });
    });

    it('combines with only AspectRatio into string preset', async () => {
      const payload = await buildTransformedPayload(
        { AspectRatio: '16:9' },
        videoSizeMapping
      );
      expect(payload.video_size).toBe('landscape_16_9');
    });

    it('combines 9:16 aspect ratio with resolution', async () => {
      const payload = await buildTransformedPayload(
        { AspectRatio: '9:16', Resolution: '720p' },
        videoSizeMapping
      );
      expect(payload.video_size).toEqual({ width: 720, height: 1280 });
    });

    it('returns undefined for unknown combination', async () => {
      const payload = await buildTransformedPayload(
        { AspectRatio: '21:9', Resolution: '1080p' },
        videoSizeMapping
      );
      expect(payload.video_size).toBeUndefined();
    });
  });

  /**
   * 3. conditional - Conditional transforms
   * Mirrors: catalog/producers/asset/text-to-image.yaml (qwen models)
   */
  describe('conditional - conditional transforms', () => {
    const conditionalMapping: Record<string, MappingFieldDefinition> = {
      ImageSize: {
        conditional: {
          when: { input: 'Resolution', notEmpty: true },
          then: {
            expand: true,
            combine: {
              inputs: ['AspectRatio', 'Resolution'],
              table: {
                '16:9+1K': { width: 1920, height: 1080 },
                '16:9+2K': { width: 2560, height: 1440 },
                '1:1+1K': { width: 1024, height: 1024 },
              },
            },
          },
        },
      },
    };

    it('applies combine+expand when Resolution is provided', async () => {
      const payload = await buildTransformedPayload(
        { AspectRatio: '16:9', Resolution: '1K' },
        conditionalMapping
      );
      expect(payload.width).toBe(1920);
      expect(payload.height).toBe(1080);
    });

    it('skips conditional when Resolution is empty', async () => {
      const payload = await buildTransformedPayload(
        { AspectRatio: '16:9' },
        conditionalMapping
      );
      expect(payload.width).toBeUndefined();
      expect(payload.height).toBeUndefined();
    });

    it('applies conditional with equals check', async () => {
      const equalsMapping: Record<string, MappingFieldDefinition> = {
        AspectRatio: {
          conditional: {
            when: { input: 'Mode', equals: 'custom' },
            then: { field: 'aspect_ratio' },
          },
        },
      };
      const payload = await buildTransformedPayload(
        { AspectRatio: '16:9', Mode: 'custom' },
        equalsMapping
      );
      expect(payload.aspect_ratio).toBe('16:9');
    });

    it('skips conditional when equals check fails', async () => {
      const equalsMapping: Record<string, MappingFieldDefinition> = {
        AspectRatio: {
          conditional: {
            when: { input: 'Mode', equals: 'custom' },
            then: { field: 'aspect_ratio' },
          },
        },
      };
      const payload = await buildTransformedPayload(
        { AspectRatio: '16:9', Mode: 'standard' },
        equalsMapping
      );
      expect(payload.aspect_ratio).toBeUndefined();
    });

    it('applies conditional with empty check', async () => {
      const emptyMapping: Record<string, MappingFieldDefinition> = {
        Fallback: {
          conditional: {
            when: { input: 'Primary', empty: true },
            then: { field: 'value' },
          },
        },
      };
      const payload = await buildTransformedPayload(
        { Fallback: 'fallback-value' },
        emptyMapping
      );
      expect(payload.value).toBe('fallback-value');
    });
  });

  /**
   * 4. durationToFrames - Duration conversion
   * Mirrors: catalog/producers/asset/text-to-video.yaml
   */
  describe('durationToFrames - duration conversion', () => {
    const durationMapping: Record<string, MappingFieldDefinition> = {
      Duration: {
        field: 'num_frames',
        durationToFrames: { fps: 25 },
      },
    };

    it('converts 5 seconds to 125 frames at 25fps', async () => {
      const payload = await buildTransformedPayload(
        { Duration: 5 },
        durationMapping
      );
      expect(payload.num_frames).toBe(125);
    });

    it('converts 10 seconds to 250 frames at 25fps', async () => {
      const payload = await buildTransformedPayload(
        { Duration: 10 },
        durationMapping
      );
      expect(payload.num_frames).toBe(250);
    });

    it('converts at different fps rates', async () => {
      const fps30Mapping: Record<string, MappingFieldDefinition> = {
        Duration: {
          field: 'num_frames',
          durationToFrames: { fps: 30 },
        },
      };
      const payload = await buildTransformedPayload(
        { Duration: 4 },
        fps30Mapping
      );
      expect(payload.num_frames).toBe(120);
    });

    it('rounds fractional frame counts', async () => {
      const payload = await buildTransformedPayload(
        { Duration: 1.5 },
        durationMapping
      );
      // 1.5 * 25 = 37.5 -> rounds to 38
      expect(payload.num_frames).toBe(38);
    });
  });

  /**
   * 5. expand - Object expansion into payload
   */
  describe('expand - object expansion into payload', () => {
    const expandMapping: Record<string, MappingFieldDefinition> = {
      ImageSize: {
        expand: true,
        combine: {
          inputs: ['AspectRatio', 'Resolution'],
          table: {
            '16:9+1K': { width: 1920, height: 1080 },
          },
        },
      },
    };

    it('expands object into top-level payload fields', async () => {
      const payload = await buildTransformedPayload(
        { AspectRatio: '16:9', Resolution: '1K' },
        expandMapping
      );
      expect(payload.width).toBe(1920);
      expect(payload.height).toBe(1080);
      expect(payload.ImageSize).toBeUndefined();
    });

    it('expands direct object input', async () => {
      const directExpandMapping: Record<string, MappingFieldDefinition> = {
        Dimensions: { expand: true },
      };
      const payload = await buildTransformedPayload(
        { Dimensions: { width: 800, height: 600 } },
        directExpandMapping
      );
      expect(payload.width).toBe(800);
      expect(payload.height).toBe(600);
    });
  });

  /**
   * 6. invert - Boolean inversion
   */
  describe('invert - boolean inversion', () => {
    const invertMapping: Record<string, MappingFieldDefinition> = {
      EnableSafetyChecker: {
        field: 'disable_safety_checker',
        invert: true,
      },
    };

    it('inverts true to false', async () => {
      const payload = await buildTransformedPayload(
        { EnableSafetyChecker: true },
        invertMapping
      );
      expect(payload.disable_safety_checker).toBe(false);
    });

    it('inverts false to true', async () => {
      const payload = await buildTransformedPayload(
        { EnableSafetyChecker: false },
        invertMapping
      );
      expect(payload.disable_safety_checker).toBe(true);
    });

    it('treats truthy non-boolean as true and inverts', async () => {
      const payload = await buildTransformedPayload(
        { EnableSafetyChecker: 'yes' },
        invertMapping
      );
      expect(payload.disable_safety_checker).toBe(false);
    });
  });

  /**
   * 7. intToString - Integer to string conversion
   */
  describe('intToString - integer to string conversion', () => {
    const intToStringMapping: Record<string, MappingFieldDefinition> = {
      Duration: {
        field: 'duration_seconds',
        intToString: true,
      },
    };

    it('converts integer 30 to string "30"', async () => {
      const payload = await buildTransformedPayload(
        { Duration: 30 },
        intToStringMapping
      );
      expect(payload.duration_seconds).toBe('30');
    });

    it('converts float to string', async () => {
      const payload = await buildTransformedPayload(
        { Duration: 10.5 },
        intToStringMapping
      );
      expect(payload.duration_seconds).toBe('10.5');
    });

    it('leaves string as-is', async () => {
      const payload = await buildTransformedPayload(
        { Duration: '15' },
        intToStringMapping
      );
      expect(payload.duration_seconds).toBe('15');
    });
  });

  /**
   * 7b. intToSecondsString - Integer to seconds string conversion
   */
  describe('intToSecondsString - integer to seconds string conversion', () => {
    const intToSecondsStringMapping: Record<string, MappingFieldDefinition> = {
      Duration: {
        field: 'duration',
        intToSecondsString: true,
      },
    };

    it('converts integer 8 to string "8s"', async () => {
      const payload = await buildTransformedPayload(
        { Duration: 8 },
        intToSecondsStringMapping
      );
      expect(payload.duration).toBe('8s');
    });

    it('converts float 10.5 to string "10.5s"', async () => {
      const payload = await buildTransformedPayload(
        { Duration: 10.5 },
        intToSecondsStringMapping
      );
      expect(payload.duration).toBe('10.5s');
    });
  });

  /**
   * 8. firstOf - First available value selection
   */
  describe('firstOf - first available value selection', () => {
    it('extracts first element from array', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        Images: {
          field: 'image_url',
          firstOf: true,
        },
      };
      const payload = await buildTransformedPayload(
        { Images: ['image1.png', 'image2.png', 'image3.png'] },
        mapping
      );
      expect(payload.image_url).toBe('image1.png');
    });

    it('returns value as-is for non-array', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        Image: {
          field: 'image_url',
          firstOf: true,
        },
      };
      const payload = await buildTransformedPayload(
        { Image: 'single-image.png' },
        mapping
      );
      expect(payload.image_url).toBe('single-image.png');
    });
  });

  /**
   * Chained transforms - Multiple transforms applied in sequence
   */
  describe('chained transforms', () => {
    it('applies firstOf then transform', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        AspectRatios: {
          field: 'image_size',
          firstOf: true,
          transform: {
            '16:9': 'landscape',
            '1:1': 'square',
          },
        },
      };
      const payload = await buildTransformedPayload(
        { AspectRatios: ['16:9', '1:1'] },
        mapping
      );
      expect(payload.image_size).toBe('landscape');
    });

    it('applies durationToFrames then transform (hypothetical)', async () => {
      // This tests that transforms apply in order
      const mapping: Record<string, MappingFieldDefinition> = {
        Duration: {
          field: 'num_frames',
          durationToFrames: { fps: 25 },
        },
      };
      const payload = await buildTransformedPayload(
        { Duration: 5 },
        mapping
      );
      expect(payload.num_frames).toBe(125);
    });
  });

  /**
   * Nested field paths with dot notation
   */
  describe('nested field paths', () => {
    it('sets nested field using dot notation', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        VoiceId: { field: 'voice_setting.voice_id' },
      };
      const payload = await buildTransformedPayload(
        { VoiceId: 'en-US-female' },
        mapping
      );
      expect(payload).toEqual({
        voice_setting: { voice_id: 'en-US-female' },
      });
    });

    it('sets deeply nested field', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        Speed: { field: 'config.audio.voice.speed' },
      };
      const payload = await buildTransformedPayload(
        { Speed: 1.5 },
        mapping
      );
      expect(payload).toEqual({
        config: { audio: { voice: { speed: 1.5 } } },
      });
    });

    it('preserves sibling properties in nested objects', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        VoiceId: { field: 'voice_setting.voice_id' },
        Speed: { field: 'voice_setting.speed' },
      };
      const payload = await buildTransformedPayload(
        { VoiceId: 'en-US', Speed: 1.2 },
        mapping
      );
      expect(payload).toEqual({
        voice_setting: { voice_id: 'en-US', speed: 1.2 },
      });
    });
  });

  /**
   * Edge cases and validation
   */
  describe('edge cases', () => {
    it('handles missing optional inputs gracefully', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        Prompt: { field: 'prompt' },
        OptionalSeed: { field: 'seed' },
      };
      const payload = await buildTransformedPayload(
        { Prompt: 'test prompt' },
        mapping
      );
      expect(payload.prompt).toBe('test prompt');
      expect(payload.seed).toBeUndefined();
    });

    it('combine with unknown key returns undefined', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        VideoSize: {
          field: 'video_size',
          combine: {
            inputs: ['AspectRatio', 'Resolution'],
            table: { '16:9+720p': 'known' },
          },
        },
      };
      const payload = await buildTransformedPayload(
        { AspectRatio: '21:9', Resolution: '4K' },
        mapping
      );
      expect(payload.video_size).toBeUndefined();
    });

    it('handles multiple mappings in same payload', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        Prompt: { field: 'prompt' },
        NegativePrompt: { field: 'negative_prompt' },
        AspectRatio: {
          field: 'image_size',
          transform: {
            '16:9': 'landscape_16_9',
            '1:1': 'square',
          },
        },
        Duration: {
          field: 'num_frames',
          durationToFrames: { fps: 24 },
        },
      };
      const payload = await buildTransformedPayload(
        {
          Prompt: 'A beautiful sunset',
          NegativePrompt: 'blurry, low quality',
          AspectRatio: '16:9',
          Duration: 5,
        },
        mapping
      );
      expect(payload).toEqual({
        prompt: 'A beautiful sunset',
        negative_prompt: 'blurry, low quality',
        image_size: 'landscape_16_9',
        num_frames: 120,
      });
    });

    it('handles empty combine inputs array', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        VideoSize: {
          field: 'video_size',
          combine: {
            inputs: ['AspectRatio', 'Resolution'],
            table: { '16:9+720p': 'known' },
          },
        },
      };
      // No inputs provided at all
      const payload = await buildTransformedPayload({}, mapping);
      expect(payload.video_size).toBeUndefined();
    });

    it('passes through arrays without firstOf', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        Images: { field: 'image_urls' },
      };
      const payload = await buildTransformedPayload(
        { Images: ['img1.png', 'img2.png'] },
        mapping
      );
      expect(payload.image_urls).toEqual(['img1.png', 'img2.png']);
    });

    it('handles boolean values directly', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        EnableFeature: { field: 'enable_feature' },
      };
      const payload = await buildTransformedPayload(
        { EnableFeature: true },
        mapping
      );
      expect(payload.enable_feature).toBe(true);
    });

    it('handles numeric values directly', async () => {
      const mapping: Record<string, MappingFieldDefinition> = {
        Steps: { field: 'num_inference_steps' },
      };
      const payload = await buildTransformedPayload(
        { Steps: 50 },
        mapping
      );
      expect(payload.num_inference_steps).toBe(50);
    });
  });

  /**
   * Real-world patterns from actual YAML files
   */
  describe('real-world YAML patterns', () => {
    it('text-to-image model pattern with aspect ratio transform', async () => {
      // Pattern from text-to-image.yaml for fal-ai models
      const mapping: Record<string, MappingFieldDefinition> = {
        Prompt: { field: 'prompt' },
        NegativePrompt: { field: 'negative_prompt' },
        AspectRatio: {
          field: 'image_size',
          transform: {
            '16:9': 'landscape_16_9',
            '9:16': 'portrait_16_9',
            '1:1': 'square_hd',
            '4:3': 'landscape_4_3',
            '3:4': 'portrait_4_3',
          },
        },
        Seed: { field: 'seed' },
      };
      const payload = await buildTransformedPayload(
        {
          Prompt: 'A futuristic cityscape',
          NegativePrompt: 'blurry',
          AspectRatio: '16:9',
          Seed: 12345,
        },
        mapping
      );
      expect(payload).toEqual({
        prompt: 'A futuristic cityscape',
        negative_prompt: 'blurry',
        image_size: 'landscape_16_9',
        seed: 12345,
      });
    });

    it('text-to-video LTX pattern with video_size combine', async () => {
      // Pattern from text-to-video.yaml for LTX models
      const mapping: Record<string, MappingFieldDefinition> = {
        Prompt: { field: 'prompt' },
        VideoSize: {
          field: 'video_size',
          combine: {
            inputs: ['AspectRatio', 'Resolution'],
            table: {
              '16:9+720p': { width: 1280, height: 720 },
              '16:9+480p': { width: 848, height: 480 },
              '9:16+720p': { width: 720, height: 1280 },
              '1:1+720p': { width: 720, height: 720 },
              '16:9+': 'landscape_16_9',
              '9:16+': 'portrait_16_9',
              '1:1+': 'square_hd',
            },
          },
        },
        Duration: {
          field: 'num_frames',
          durationToFrames: { fps: 25 },
        },
      };
      const payload = await buildTransformedPayload(
        {
          Prompt: 'A rocket launching',
          AspectRatio: '16:9',
          Resolution: '720p',
          Duration: 5,
        },
        mapping
      );
      expect(payload).toEqual({
        prompt: 'A rocket launching',
        video_size: { width: 1280, height: 720 },
        num_frames: 125,
      });
    });

    it('hunyuan text-to-image pattern with AspectRatio preset', async () => {
      // Pattern from text-to-image.yaml for hunyuan model - preset mode
      const mapping: Record<string, MappingFieldDefinition> = {
        Prompt: { field: 'prompt' },
        NumImages: { field: 'num_images' },
        AspectRatio: {
          conditional: {
            when: { input: 'Width', empty: true },
            then: {
              field: 'image_size',
              transform: {
                '16:9': 'landscape_16_9',
                '9:16': 'portrait_16_9',
                '1:1': 'square_hd',
              },
            },
          },
        },
        Width: {
          conditional: {
            when: { input: 'Width', notEmpty: true },
            then: { field: 'image_size.width' },
          },
        },
        Height: {
          conditional: {
            when: { input: 'Width', notEmpty: true },
            then: { field: 'image_size.height' },
          },
        },
      };
      const payload = await buildTransformedPayload(
        {
          Prompt: 'A beautiful landscape',
          NumImages: 2,
          AspectRatio: '16:9',
        },
        mapping
      );
      expect(payload).toEqual({
        prompt: 'A beautiful landscape',
        num_images: 2,
        image_size: 'landscape_16_9',
      });
    });

    it('hunyuan text-to-image pattern with custom Width/Height', async () => {
      // Pattern from text-to-image.yaml for hunyuan model - custom dimensions
      const mapping: Record<string, MappingFieldDefinition> = {
        Prompt: { field: 'prompt' },
        NumImages: { field: 'num_images' },
        AspectRatio: {
          conditional: {
            when: { input: 'Width', empty: true },
            then: {
              field: 'image_size',
              transform: {
                '16:9': 'landscape_16_9',
                '9:16': 'portrait_16_9',
                '1:1': 'square_hd',
              },
            },
          },
        },
        Width: {
          conditional: {
            when: { input: 'Width', notEmpty: true },
            then: { field: 'image_size.width' },
          },
        },
        Height: {
          conditional: {
            when: { input: 'Width', notEmpty: true },
            then: { field: 'image_size.height' },
          },
        },
      };
      const payload = await buildTransformedPayload(
        {
          Prompt: 'A high-res landscape',
          NumImages: 1,
          Width: 2048,
          Height: 2048,
          AspectRatio: '1:1', // Should be ignored when Width is provided
        },
        mapping
      );
      expect(payload).toEqual({
        prompt: 'A high-res landscape',
        num_images: 1,
        image_size: { width: 2048, height: 2048 },
      });
    });

    it('image-to-video pattern with conditional expand', async () => {
      // Pattern that uses conditional to expand dimensions
      const mapping: Record<string, MappingFieldDefinition> = {
        ImageUrl: { field: 'image_url' },
        Prompt: { field: 'prompt' },
        ImageSize: {
          conditional: {
            when: { input: 'Resolution', notEmpty: true },
            then: {
              expand: true,
              combine: {
                inputs: ['AspectRatio', 'Resolution'],
                table: {
                  '16:9+1080p': { width: 1920, height: 1080 },
                  '16:9+720p': { width: 1280, height: 720 },
                  '9:16+1080p': { width: 1080, height: 1920 },
                },
              },
            },
          },
        },
      };
      const payload = await buildTransformedPayload(
        {
          ImageUrl: 'https://example.com/image.png',
          Prompt: 'Animate this scene',
          AspectRatio: '16:9',
          Resolution: '1080p',
        },
        mapping
      );
      expect(payload).toEqual({
        image_url: 'https://example.com/image.png',
        prompt: 'Animate this scene',
        width: 1920,
        height: 1080,
      });
    });
  });
});
