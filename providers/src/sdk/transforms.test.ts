import { describe, it, expect } from 'vitest';
import {
  applyMapping,
  setNestedValue,
  collectElementBindings,
  type TransformContext,
} from './transforms.js';
import { SdkErrorCode, type MappingFieldDefinition } from '@gorenku/core';

describe('transforms', () => {
  // Helper to create a basic context
  function createContext(
    inputs: Record<string, unknown>,
    bindings?: Record<string, string>
  ): TransformContext {
    const inputBindings =
      bindings ??
      Object.fromEntries(
        Object.keys(inputs).map((key) => [key, `Input:${key}`])
      );
    const resolvedInputs = Object.fromEntries(
      Object.entries(inputs).map(([key, value]) => [`Input:${key}`, value])
    );
    return { inputs: resolvedInputs, inputBindings };
  }

  describe('simple transform (direct field rename)', () => {
    it('maps input to a different field name', () => {
      const context = createContext({ Prompt: 'Generate an image' });
      const mapping: MappingFieldDefinition = { field: 'prompt' };

      const result = applyMapping('Prompt', mapping, context);

      expect(result).toEqual({ field: 'prompt', value: 'Generate an image' });
    });

    it('handles nested dot notation paths', () => {
      const context = createContext({ VoiceId: 'en-US-female' });
      const mapping: MappingFieldDefinition = {
        field: 'voice_setting.voice_id',
      };

      const result = applyMapping('VoiceId', mapping, context);

      expect(result).toEqual({
        field: 'voice_setting.voice_id',
        value: 'en-US-female',
      });
    });

    it('returns undefined for missing input', () => {
      const context = createContext({});
      const mapping: MappingFieldDefinition = { field: 'prompt' };

      const result = applyMapping('Prompt', mapping, context);

      expect(result).toBeUndefined();
    });

    it('returns undefined for undefined input value', () => {
      const context = createContext({ Prompt: undefined });
      const mapping: MappingFieldDefinition = { field: 'prompt' };

      const result = applyMapping('Prompt', mapping, context);

      expect(result).toBeUndefined();
    });
  });

  describe('transform (value lookup table)', () => {
    it('transforms string value using lookup table', () => {
      const context = createContext({ AspectRatio: '16:9' });
      const mapping: MappingFieldDefinition = {
        field: 'image_size',
        transform: {
          '16:9': 'landscape_16_9',
          '9:16': 'portrait_16_9',
          '1:1': 'square_hd',
        },
      };

      const result = applyMapping('AspectRatio', mapping, context);

      expect(result).toEqual({ field: 'image_size', value: 'landscape_16_9' });
    });

    it('transforms boolean value using lookup table', () => {
      const context = createContext({ EnhancePrompt: true });
      const mapping: MappingFieldDefinition = {
        field: 'enhance_prompt_mode',
        transform: {
          true: 'standard',
          false: 'fast',
        },
      };

      const result = applyMapping('EnhancePrompt', mapping, context);

      expect(result).toEqual({
        field: 'enhance_prompt_mode',
        value: 'standard',
      });
    });

    it('returns original value when no matching transform', () => {
      const context = createContext({ AspectRatio: '4:5' });
      const mapping: MappingFieldDefinition = {
        field: 'image_size',
        transform: {
          '16:9': 'landscape_16_9',
          '1:1': 'square_hd',
        },
      };

      const result = applyMapping('AspectRatio', mapping, context);

      expect(result).toEqual({ field: 'image_size', value: '4:5' });
    });

    it('transforms to object value', () => {
      const context = createContext({ AspectRatio: '16:9' });
      const mapping: MappingFieldDefinition = {
        field: 'image_size',
        transform: {
          '16:9': { width: 1920, height: 1080 },
          '1:1': { width: 1024, height: 1024 },
        },
      };

      const result = applyMapping('AspectRatio', mapping, context);

      expect(result).toEqual({
        field: 'image_size',
        value: { width: 1920, height: 1080 },
      });
    });
  });

  describe('combine transform (multiple inputs)', () => {
    it('combines two inputs to produce a value', () => {
      const context = createContext({
        AspectRatio: '16:9',
        Resolution: '2K',
      });
      const mapping: MappingFieldDefinition = {
        field: 'image_size',
        combine: {
          inputs: ['AspectRatio', 'Resolution'],
          table: {
            '16:9+2K': 'auto_2K',
            '16:9+4K': 'auto_4K',
            '1:1+2K': 'auto_2K',
          },
        },
      };

      const result = applyMapping('ImageSize', mapping, context);

      expect(result).toEqual({ field: 'image_size', value: 'auto_2K' });
    });

    it('handles empty first input in combine', () => {
      const context = createContext({
        Resolution: '2K',
      });
      const mapping: MappingFieldDefinition = {
        field: 'image_size',
        combine: {
          inputs: ['AspectRatio', 'Resolution'],
          table: {
            '+2K': 'auto_2K',
            '+4K': 'auto_4K',
          },
        },
      };

      const result = applyMapping('ImageSize', mapping, context);

      expect(result).toEqual({ field: 'image_size', value: 'auto_2K' });
    });

    it('handles empty second input in combine', () => {
      const context = createContext({
        AspectRatio: '16:9',
      });
      const mapping: MappingFieldDefinition = {
        field: 'image_size',
        combine: {
          inputs: ['AspectRatio', 'Resolution'],
          table: {
            '16:9+': 'landscape_16_9',
            '1:1+': 'square_hd',
          },
        },
      };

      const result = applyMapping('ImageSize', mapping, context);

      expect(result).toEqual({ field: 'image_size', value: 'landscape_16_9' });
    });

    it('returns undefined when no combine inputs have values', () => {
      const context = createContext({});
      const mapping: MappingFieldDefinition = {
        field: 'image_size',
        combine: {
          inputs: ['AspectRatio', 'Resolution'],
          table: {
            '16:9+2K': 'auto_2K',
          },
        },
      };

      const result = applyMapping('ImageSize', mapping, context);

      expect(result).toBeUndefined();
    });

    it('returns undefined when no matching combination in table', () => {
      const context = createContext({
        AspectRatio: '4:3',
        Resolution: '1K',
      });
      const mapping: MappingFieldDefinition = {
        field: 'image_size',
        combine: {
          inputs: ['AspectRatio', 'Resolution'],
          table: {
            '16:9+2K': 'auto_2K',
          },
        },
      };

      const result = applyMapping('ImageSize', mapping, context);

      expect(result).toBeUndefined();
    });

    it('combine with expand produces expanded object', () => {
      const context = createContext({
        AspectRatio: '16:9',
        Resolution: '1K',
      });
      const mapping: MappingFieldDefinition = {
        expand: true,
        combine: {
          inputs: ['AspectRatio', 'Resolution'],
          table: {
            '16:9+1K': { width: 1920, height: 1080 },
          },
        },
      };

      const result = applyMapping('ImageSize', mapping, context);

      expect(result).toEqual({ expand: { width: 1920, height: 1080 } });
    });
  });

  describe('conditional transform', () => {
    it('applies mapping when equals condition is met', () => {
      const context = createContext({
        Width: 1920,
        AspectRatio: '16:9',
      });
      const mapping: MappingFieldDefinition = {
        conditional: {
          when: { input: 'Width', equals: 1920 },
          then: { field: 'aspect_ratio' },
        },
      };

      const result = applyMapping('AspectRatio', mapping, context);

      expect(result).toEqual({ field: 'aspect_ratio', value: '16:9' });
    });

    it('skips mapping when equals condition is not met', () => {
      const context = createContext({
        Width: 1024,
        AspectRatio: '16:9',
      });
      const mapping: MappingFieldDefinition = {
        conditional: {
          when: { input: 'Width', equals: 1920 },
          then: { field: 'aspect_ratio' },
        },
      };

      const result = applyMapping('AspectRatio', mapping, context);

      expect(result).toBeUndefined();
    });

    it('applies mapping when notEmpty condition is met', () => {
      const context = createContext({
        Width: 1920,
        AspectRatio: '16:9',
      });
      const mapping: MappingFieldDefinition = {
        conditional: {
          when: { input: 'Width', notEmpty: true },
          then: { field: 'aspect_ratio' },
        },
      };

      const result = applyMapping('AspectRatio', mapping, context);

      expect(result).toEqual({ field: 'aspect_ratio', value: '16:9' });
    });

    it('skips mapping when notEmpty condition is not met', () => {
      const context = createContext({
        AspectRatio: '16:9',
      });
      const mapping: MappingFieldDefinition = {
        conditional: {
          when: { input: 'Width', notEmpty: true },
          then: { field: 'aspect_ratio' },
        },
      };

      const result = applyMapping('AspectRatio', mapping, context);

      expect(result).toBeUndefined();
    });

    it('applies mapping when empty condition is met', () => {
      const context = createContext({
        AspectRatio: '16:9',
        Resolution: '2K',
      });
      const mapping: MappingFieldDefinition = {
        conditional: {
          when: { input: 'Width', empty: true },
          then: {
            field: 'image_size',
            combine: {
              inputs: ['AspectRatio', 'Resolution'],
              table: { '16:9+2K': 'auto_2K' },
            },
          },
        },
      };

      const result = applyMapping('ImageSize', mapping, context);

      expect(result).toEqual({ field: 'image_size', value: 'auto_2K' });
    });

    it('skips mapping when empty condition is not met', () => {
      const context = createContext({
        Width: 1920,
        AspectRatio: '16:9',
      });
      const mapping: MappingFieldDefinition = {
        conditional: {
          when: { input: 'Width', empty: true },
          then: { field: 'aspect_ratio' },
        },
      };

      const result = applyMapping('AspectRatio', mapping, context);

      expect(result).toBeUndefined();
    });
  });

  describe('firstOf transform (array to single)', () => {
    it('extracts first element from array', () => {
      const context = createContext({
        Images: ['img1.png', 'img2.png', 'img3.png'],
      });
      const mapping: MappingFieldDefinition = { field: 'image', firstOf: true };

      const result = applyMapping('Images', mapping, context);

      expect(result).toEqual({ field: 'image', value: 'img1.png' });
    });

    it('returns undefined for empty array', () => {
      const context = createContext({ Images: [] });
      const mapping: MappingFieldDefinition = { field: 'image', firstOf: true };

      const result = applyMapping('Images', mapping, context);

      expect(result).toBeUndefined();
    });

    it('returns value as-is for non-array', () => {
      const context = createContext({ Image: 'single.png' });
      const mapping: MappingFieldDefinition = { field: 'image', firstOf: true };

      const result = applyMapping('Image', mapping, context);

      expect(result).toEqual({ field: 'image', value: 'single.png' });
    });
  });

  describe('invert transform (boolean flip)', () => {
    it('flips true to false', () => {
      const context = createContext({ Enabled: true });
      const mapping: MappingFieldDefinition = {
        field: 'disabled',
        invert: true,
      };

      const result = applyMapping('Enabled', mapping, context);

      expect(result).toEqual({ field: 'disabled', value: false });
    });

    it('flips false to true', () => {
      const context = createContext({ Enabled: false });
      const mapping: MappingFieldDefinition = {
        field: 'disabled',
        invert: true,
      };

      const result = applyMapping('Enabled', mapping, context);

      expect(result).toEqual({ field: 'disabled', value: true });
    });

    it('treats truthy non-boolean as true', () => {
      const context = createContext({ Value: 'some string' });
      const mapping: MappingFieldDefinition = {
        field: 'inverted',
        invert: true,
      };

      const result = applyMapping('Value', mapping, context);

      expect(result).toEqual({ field: 'inverted', value: false });
    });

    it('treats falsy non-boolean as false', () => {
      const context = createContext({ Value: 0 });
      const mapping: MappingFieldDefinition = {
        field: 'inverted',
        invert: true,
      };

      const result = applyMapping('Value', mapping, context);

      expect(result).toEqual({ field: 'inverted', value: true });
    });
  });

  describe('intToString transform', () => {
    it('converts integer to string', () => {
      const context = createContext({ Duration: 10 });
      const mapping: MappingFieldDefinition = {
        field: 'duration',
        intToString: true,
      };

      const result = applyMapping('Duration', mapping, context);

      expect(result).toEqual({ field: 'duration', value: '10' });
    });

    it('converts float to string', () => {
      const context = createContext({ Duration: 10.5 });
      const mapping: MappingFieldDefinition = {
        field: 'duration',
        intToString: true,
      };

      const result = applyMapping('Duration', mapping, context);

      expect(result).toEqual({ field: 'duration', value: '10.5' });
    });

    it('leaves string as-is', () => {
      const context = createContext({ Duration: '10' });
      const mapping: MappingFieldDefinition = {
        field: 'duration',
        intToString: true,
      };

      const result = applyMapping('Duration', mapping, context);

      expect(result).toEqual({ field: 'duration', value: '10' });
    });
  });

  describe('intToSecondsString transform', () => {
    it('converts integer to string with "s" suffix', () => {
      const context = createContext({ Duration: 8 });
      const mapping: MappingFieldDefinition = {
        field: 'duration',
        intToSecondsString: true,
      };

      const result = applyMapping('Duration', mapping, context);

      expect(result).toEqual({ field: 'duration', value: '8s' });
    });

    it('converts float to string with "s" suffix', () => {
      const context = createContext({ Duration: 10.5 });
      const mapping: MappingFieldDefinition = {
        field: 'duration',
        intToSecondsString: true,
      };

      const result = applyMapping('Duration', mapping, context);

      expect(result).toEqual({ field: 'duration', value: '10.5s' });
    });

    it('leaves string as-is', () => {
      const context = createContext({ Duration: '8s' });
      const mapping: MappingFieldDefinition = {
        field: 'duration',
        intToSecondsString: true,
      };

      const result = applyMapping('Duration', mapping, context);

      expect(result).toEqual({ field: 'duration', value: '8s' });
    });
  });

  describe('durationToFrames transform', () => {
    it('converts seconds to frames at 24 fps', () => {
      const context = createContext({ Duration: 10 });
      const mapping: MappingFieldDefinition = {
        field: 'num_frames',
        durationToFrames: { fps: 24 },
      };

      const result = applyMapping('Duration', mapping, context);

      expect(result).toEqual({ field: 'num_frames', value: 240 });
    });

    it('converts seconds to frames at 30 fps', () => {
      const context = createContext({ Duration: 5 });
      const mapping: MappingFieldDefinition = {
        field: 'num_frames',
        durationToFrames: { fps: 30 },
      };

      const result = applyMapping('Duration', mapping, context);

      expect(result).toEqual({ field: 'num_frames', value: 150 });
    });

    it('rounds fractional frame counts', () => {
      const context = createContext({ Duration: 1.5 });
      const mapping: MappingFieldDefinition = {
        field: 'num_frames',
        durationToFrames: { fps: 24 },
      };

      const result = applyMapping('Duration', mapping, context);

      expect(result).toEqual({ field: 'num_frames', value: 36 });
    });

    it('leaves non-number as-is', () => {
      const context = createContext({ Duration: '10' });
      const mapping: MappingFieldDefinition = {
        field: 'num_frames',
        durationToFrames: { fps: 24 },
      };

      const result = applyMapping('Duration', mapping, context);

      expect(result).toEqual({ field: 'num_frames', value: '10' });
    });
  });

  describe('expand transform', () => {
    it('expands object value into payload', () => {
      const context = createContext({
        ImageSize: { width: 1920, height: 1080 },
      });
      const mapping: MappingFieldDefinition = { expand: true };

      const result = applyMapping('ImageSize', mapping, context);

      expect(result).toEqual({ expand: { width: 1920, height: 1080 } });
    });

    it('throws error for non-object expand', () => {
      const context = createContext({ Value: 'not an object' });
      const mapping: MappingFieldDefinition = { expand: true };

      expect(() => applyMapping('Value', mapping, context)).toThrow(
        /Cannot expand non-object value/
      );
    });

    it('throws error for array expand', () => {
      const context = createContext({ Value: [1, 2, 3] });
      const mapping: MappingFieldDefinition = { expand: true };

      expect(() => applyMapping('Value', mapping, context)).toThrow(
        /Cannot expand non-object value/
      );
    });
  });

  describe('chained transforms', () => {
    it('applies firstOf then transform', () => {
      const context = createContext({ AspectRatios: ['16:9', '1:1'] });
      const mapping: MappingFieldDefinition = {
        field: 'image_size',
        firstOf: true,
        transform: {
          '16:9': 'landscape',
          '1:1': 'square',
        },
      };

      const result = applyMapping('AspectRatios', mapping, context);

      expect(result).toEqual({ field: 'image_size', value: 'landscape' });
    });

    it('applies intToString then used in conditional', () => {
      const context = createContext({ Duration: 10 });
      const mapping: MappingFieldDefinition = {
        field: 'duration',
        intToString: true,
      };

      const result = applyMapping('Duration', mapping, context);

      expect(result).toEqual({ field: 'duration', value: '10' });
    });
  });

  describe('setNestedValue', () => {
    it('sets simple path', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'prompt', 'hello');
      expect(obj).toEqual({ prompt: 'hello' });
    });

    it('sets nested path with two levels', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'voice_setting.voice_id', 'en-US');
      expect(obj).toEqual({ voice_setting: { voice_id: 'en-US' } });
    });

    it('sets nested path with three levels', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'config.audio.voice_id', 'en-US');
      expect(obj).toEqual({ config: { audio: { voice_id: 'en-US' } } });
    });

    it('preserves existing sibling properties', () => {
      const obj: Record<string, unknown> = { existing: 'value' };
      setNestedValue(obj, 'voice_setting.voice_id', 'en-US');
      expect(obj).toEqual({
        existing: 'value',
        voice_setting: { voice_id: 'en-US' },
      });
    });

    it('preserves existing nested sibling properties', () => {
      const obj: Record<string, unknown> = {
        voice_setting: { speed: 1.0 },
      };
      setNestedValue(obj, 'voice_setting.voice_id', 'en-US');
      expect(obj).toEqual({
        voice_setting: { speed: 1.0, voice_id: 'en-US' },
      });
    });

    it('overwrites existing value at path', () => {
      const obj: Record<string, unknown> = {
        voice_setting: { voice_id: 'old-value' },
      };
      setNestedValue(obj, 'voice_setting.voice_id', 'new-value');
      expect(obj).toEqual({
        voice_setting: { voice_id: 'new-value' },
      });
    });

    it('replaces non-object intermediate with object', () => {
      const obj: Record<string, unknown> = {
        voice_setting: 'not an object',
      };
      setNestedValue(obj, 'voice_setting.voice_id', 'en-US');
      expect(obj).toEqual({
        voice_setting: { voice_id: 'en-US' },
      });
    });

    it('handles null intermediate', () => {
      const obj: Record<string, unknown> = {
        voice_setting: null,
      };
      setNestedValue(obj, 'voice_setting.voice_id', 'en-US');
      expect(obj).toEqual({
        voice_setting: { voice_id: 'en-US' },
      });
    });
  });

  describe('collectElementBindings', () => {
    it('finds matching element bindings', () => {
      const bindings = {
        'Foo[0]': 'artifact1',
        'Foo[1]': 'artifact2',
        'FooBar[0]': 'artifact3', // Should NOT match "Foo"
        Bar: 'artifact4',
      };

      const result = collectElementBindings('Foo', bindings);

      expect(result).toEqual([
        { index: 0, canonicalId: 'artifact1' },
        { index: 1, canonicalId: 'artifact2' },
      ]);
    });

    it('sorts by index', () => {
      const bindings = {
        'Items[2]': 'artifact3',
        'Items[0]': 'artifact1',
        'Items[1]': 'artifact2',
      };

      const result = collectElementBindings('Items', bindings);

      expect(result).toEqual([
        { index: 0, canonicalId: 'artifact1' },
        { index: 1, canonicalId: 'artifact2' },
        { index: 2, canonicalId: 'artifact3' },
      ]);
    });

    it('returns empty array when no matches', () => {
      const bindings = {
        'Other[0]': 'artifact1',
        Different: 'artifact2',
      };

      const result = collectElementBindings('Foo', bindings);

      expect(result).toEqual([]);
    });

    it('handles multi-digit indices', () => {
      const bindings = {
        'Foo[10]': 'artifact10',
        'Foo[100]': 'artifact100',
        'Foo[1]': 'artifact1',
      };

      const result = collectElementBindings('Foo', bindings);

      expect(result).toEqual([
        { index: 1, canonicalId: 'artifact1' },
        { index: 10, canonicalId: 'artifact10' },
        { index: 100, canonicalId: 'artifact100' },
      ]);
    });
  });

  describe('collection input mapping', () => {
    it('reconstructs array from element-level bindings', () => {
      const context: TransformContext = {
        inputs: {
          'Artifact:Image1': 'http://example.com/image1.jpg',
          'Artifact:Image2': 'http://example.com/image2.jpg',
        },
        inputBindings: {
          'ReferenceImages[0]': 'Artifact:Image1',
          'ReferenceImages[1]': 'Artifact:Image2',
        },
      };

      const mapping = { field: 'image_urls' };
      const result = applyMapping('ReferenceImages', mapping, context);

      expect(result).toEqual({
        field: 'image_urls',
        value: [
          'http://example.com/image1.jpg',
          'http://example.com/image2.jpg',
        ],
      });
    });

    it('handles single element binding', () => {
      const context: TransformContext = {
        inputs: {
          'Artifact:Image1': 'http://example.com/image1.jpg',
        },
        inputBindings: {
          'ReferenceImages[0]': 'Artifact:Image1',
        },
      };

      const mapping = { field: 'image_urls' };
      const result = applyMapping('ReferenceImages', mapping, context);

      expect(result).toEqual({
        field: 'image_urls',
        value: ['http://example.com/image1.jpg'],
      });
    });

    it('reconstructs compact array from sparse element bindings', () => {
      const context: TransformContext = {
        inputs: {
          'Artifact:Image0': 'http://example.com/image0.jpg',
          'Artifact:Image2': 'http://example.com/image2.jpg',
        },
        inputBindings: {
          'ReferenceImages[0]': 'Artifact:Image0',
          'ReferenceImages[2]': 'Artifact:Image2',
        },
      };

      const mapping = { field: 'image_urls' };
      const result = applyMapping('ReferenceImages', mapping, context);

      expect(result).toEqual({
        field: 'image_urls',
        value: [
          'http://example.com/image0.jpg',
          'http://example.com/image2.jpg',
        ],
      });
    });

    it('returns undefined when no bindings exist', () => {
      const context: TransformContext = {
        inputs: {},
        inputBindings: {},
      };

      const mapping = { field: 'image_urls' };
      const result = applyMapping('ReferenceImages', mapping, context);

      expect(result).toBeUndefined();
    });

    it('whole collection binding still works', () => {
      const context: TransformContext = {
        inputs: {
          'Artifact:AllImages': [
            'http://example.com/1.jpg',
            'http://example.com/2.jpg',
          ],
        },
        inputBindings: {
          ReferenceImages: 'Artifact:AllImages',
        },
      };

      const mapping = { field: 'image_urls' };
      const result = applyMapping('ReferenceImages', mapping, context);

      expect(result).toEqual({
        field: 'image_urls',
        value: ['http://example.com/1.jpg', 'http://example.com/2.jpg'],
      });
    });

    it('prefers whole collection binding over element bindings when value exists', () => {
      const context: TransformContext = {
        inputs: {
          'Artifact:AllImages': ['whole1.jpg', 'whole2.jpg'],
          'Artifact:Image1': 'element1.jpg',
          'Artifact:Image2': 'element2.jpg',
        },
        inputBindings: {
          ReferenceImages: 'Artifact:AllImages',
          'ReferenceImages[0]': 'Artifact:Image1',
          'ReferenceImages[1]': 'Artifact:Image2',
        },
      };

      const mapping = { field: 'image_urls' };
      const result = applyMapping('ReferenceImages', mapping, context);

      // Direct binding takes precedence when value exists
      expect(result).toEqual({
        field: 'image_urls',
        value: ['whole1.jpg', 'whole2.jpg'],
      });
    });

    it('falls back to element bindings when direct binding has no value', () => {
      const context: TransformContext = {
        inputs: {
          // No value for 'Input:Unresolved'
          'Artifact:Image1': 'element1.jpg',
          'Artifact:Image2': 'element2.jpg',
        },
        inputBindings: {
          ReferenceImages: 'Input:Unresolved', // Points to unresolved input
          'ReferenceImages[0]': 'Artifact:Image1',
          'ReferenceImages[1]': 'Artifact:Image2',
        },
      };

      const mapping = { field: 'image_urls' };
      const result = applyMapping('ReferenceImages', mapping, context);

      // Falls back to element bindings
      expect(result).toEqual({
        field: 'image_urls',
        value: ['element1.jpg', 'element2.jpg'],
      });
    });

    it('resolves indexed canonical input from parent array input', () => {
      const context: TransformContext = {
        inputs: {
          'Input:CelebrityThenImages': ['img0.jpg', 'img1.jpg', 'img2.jpg'],
        },
        inputBindings: {
          SourceImages: 'Input:CelebrityThenImages[1]',
        },
      };

      const mapping = { field: 'image_url' };
      const result = applyMapping('SourceImages', mapping, context);

      expect(result).toEqual({
        field: 'image_url',
        value: 'img1.jpg',
      });
    });

    it('resolves nested indexed canonical input from parent arrays', () => {
      const context: TransformContext = {
        inputs: {
          'Input:Grid': [
            ['r0c0', 'r0c1'],
            ['r1c0', 'r1c1'],
          ],
        },
        inputBindings: {
          Cell: 'Input:Grid[1][0]',
        },
      };

      const mapping = { field: 'cell' };
      const result = applyMapping('Cell', mapping, context);

      expect(result).toEqual({
        field: 'cell',
        value: 'r1c0',
      });
    });

    it('throws a descriptive error when indexed canonical input is out of bounds', () => {
      const context: TransformContext = {
        inputs: {
          'Input:CelebrityThenImages': ['img0.jpg'],
        },
        inputBindings: {
          SourceImages: 'Input:CelebrityThenImages[2]',
        },
      };

      const mapping = { field: 'image_url' };

      try {
        applyMapping('SourceImages', mapping, context);
        expect.fail('Expected applyMapping to throw for out-of-bounds index');
      } catch (error) {
        const providerError = error as { code?: string; message?: string };
        expect(providerError.code).toBe(
          SdkErrorCode.INVALID_INDEXED_INPUT_ACCESS
        );
        expect(providerError.message).toContain('index 2 is out of bounds');
      }
    });

    it('throws a descriptive error when indexed canonical parent is not an array', () => {
      const context: TransformContext = {
        inputs: {
          'Input:CelebrityThenImages': 'not-an-array',
        },
        inputBindings: {
          SourceImages: 'Input:CelebrityThenImages[0]',
        },
      };

      const mapping = { field: 'image_url' };

      try {
        applyMapping('SourceImages', mapping, context);
        expect.fail(
          'Expected applyMapping to throw when indexed parent is not an array'
        );
      } catch (error) {
        const providerError = error as { code?: string; message?: string };
        expect(providerError.code).toBe(
          SdkErrorCode.INVALID_INDEXED_INPUT_ACCESS
        );
        expect(providerError.message).toContain('is not an array');
      }
    });
  });

  describe('LTX video_size pattern (combine with object into field)', () => {
    it('combine produces object value into field (not expanded)', () => {
      const context = createContext({
        AspectRatio: '16:9',
        Resolution: '720p',
      });
      const mapping: MappingFieldDefinition = {
        field: 'video_size',
        combine: {
          inputs: ['AspectRatio', 'Resolution'],
          table: {
            '16:9+720p': { width: 1280, height: 720 },
            '16:9+480p': { width: 848, height: 480 },
            '9:16+720p': { width: 720, height: 1280 },
          },
        },
      };

      const result = applyMapping('VideoSize', mapping, context);

      // Object goes INTO field, not expanded
      expect(result).toEqual({
        field: 'video_size',
        value: { width: 1280, height: 720 },
      });
    });

    it('combine produces string preset when resolution not specified', () => {
      const context = createContext({
        AspectRatio: '16:9',
        // No Resolution
      });
      const mapping: MappingFieldDefinition = {
        field: 'video_size',
        combine: {
          inputs: ['AspectRatio', 'Resolution'],
          table: {
            '16:9+720p': { width: 1280, height: 720 },
            '16:9+': 'landscape_16_9',
            '9:16+': 'portrait_16_9',
          },
        },
      };

      const result = applyMapping('VideoSize', mapping, context);

      expect(result).toEqual({
        field: 'video_size',
        value: 'landscape_16_9',
      });
    });

    it('combine with durationToFrames for num_frames', () => {
      const context = createContext({
        Duration: 5,
      });
      const mapping: MappingFieldDefinition = {
        field: 'num_frames',
        durationToFrames: { fps: 25 },
      };

      const result = applyMapping('Duration', mapping, context);

      expect(result).toEqual({
        field: 'num_frames',
        value: 125, // 5 seconds * 25 fps
      });
    });

    it('throws error when combine has no field and no expand', () => {
      const context = createContext({
        AspectRatio: '16:9',
        Resolution: '720p',
      });
      const mapping: MappingFieldDefinition = {
        // Missing field: and expand:
        combine: {
          inputs: ['AspectRatio', 'Resolution'],
          table: {
            '16:9+720p': { width: 1280, height: 720 },
          },
        },
      };

      expect(() => applyMapping('VideoSize', mapping, context)).toThrow(
        /Combine transform requires 'field' unless using 'expand'/
      );
    });

    it('combine with expand spreads object into payload', () => {
      const context = createContext({
        AspectRatio: '16:9',
        Resolution: '720p',
      });
      const mapping: MappingFieldDefinition = {
        expand: true,
        combine: {
          inputs: ['AspectRatio', 'Resolution'],
          table: {
            '16:9+720p': { width: 1280, height: 720 },
          },
        },
      };

      const result = applyMapping('ImageSize', mapping, context);

      // With expand: true, object is returned for spreading
      expect(result).toEqual({
        expand: { width: 1280, height: 720 },
      });
    });
  });
});
