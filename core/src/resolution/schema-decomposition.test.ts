import { describe, it, expect } from 'vitest';
import { decomposeJsonSchema, deriveDimensionName } from './schema-decomposition.js';
import type { JsonSchemaDefinition, ArrayDimensionMapping } from '../types.js';

describe('decomposeJsonSchema', () => {
  it('should decompose flat object properties', () => {
    const schema: JsonSchemaDefinition = {
      name: 'SimpleOutput',
      schema: {
        type: 'object',
        properties: {
          Title: { type: 'string' },
          Count: { type: 'number' },
        },
      },
    };

    const result = decomposeJsonSchema(schema, 'SimpleOutput', []);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      path: 'SimpleOutput.Title',
      jsonPath: 'Title',
      type: 'string',
      dimensions: [],
      dimensionCountInputs: {},
    });
    expect(result).toContainEqual({
      path: 'SimpleOutput.Count',
      jsonPath: 'Count',
      type: 'number',
      dimensions: [],
      dimensionCountInputs: {},
    });
  });

  it('should decompose nested objects', () => {
    const schema: JsonSchemaDefinition = {
      name: 'Nested',
      schema: {
        type: 'object',
        properties: {
          Metadata: {
            type: 'object',
            properties: {
              Author: { type: 'string' },
              Version: { type: 'integer' },
            },
          },
        },
      },
    };

    const result = decomposeJsonSchema(schema, 'Nested', []);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      path: 'Nested.Metadata.Author',
      jsonPath: 'Metadata.Author',
      type: 'string',
      dimensions: [],
      dimensionCountInputs: {},
    });
    expect(result).toContainEqual({
      path: 'Nested.Metadata.Version',
      jsonPath: 'Metadata.Version',
      type: 'integer',
      dimensions: [],
      dimensionCountInputs: {},
    });
  });

  it('should decompose array with dimension mapping', () => {
    const schema: JsonSchemaDefinition = {
      name: 'VideoScript',
      schema: {
        type: 'object',
        properties: {
          Title: { type: 'string' },
          Clips: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                Script: { type: 'string' },
              },
            },
          },
        },
      },
    };

    const arrayMappings: ArrayDimensionMapping[] = [
      { path: 'Clips', countInput: 'NumOfClips' },
    ];

    const result = decomposeJsonSchema(schema, 'VideoScript', arrayMappings);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      path: 'VideoScript.Title',
      jsonPath: 'Title',
      type: 'string',
      dimensions: [],
      dimensionCountInputs: {},
    });
    expect(result).toContainEqual({
      path: 'VideoScript.Clips[clip].Script',
      jsonPath: 'Clips[clip].Script',
      type: 'string',
      dimensions: ['clip'],
      dimensionCountInputs: { clip: 'NumOfClips' },
    });
  });

  it('should decompose nested arrays with multiple dimensions', () => {
    const schema: JsonSchemaDefinition = {
      name: 'VideoScript',
      schema: {
        type: 'object',
        properties: {
          Clips: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                Script: { type: 'string' },
                ImagePrompts: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
    };

    const arrayMappings: ArrayDimensionMapping[] = [
      { path: 'Clips', countInput: 'NumOfClips' },
      { path: 'Clips.ImagePrompts', countInput: 'NumOfImagesPerClip' },
    ];

    const result = decomposeJsonSchema(schema, 'VideoScript', arrayMappings);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      path: 'VideoScript.Clips[clip].Script',
      jsonPath: 'Clips[clip].Script',
      type: 'string',
      dimensions: ['clip'],
      dimensionCountInputs: { clip: 'NumOfClips' },
    });
    expect(result).toContainEqual({
      path: 'VideoScript.Clips[clip].ImagePrompts[image]',
      jsonPath: 'Clips[clip].ImagePrompts[image]',
      type: 'string',
      dimensions: ['clip', 'image'],
      dimensionCountInputs: {
        clip: 'NumOfClips',
        image: 'NumOfImagesPerClip',
      },
    });
  });

  it('should skip arrays without dimension mapping', () => {
    const schema: JsonSchemaDefinition = {
      name: 'Output',
      schema: {
        type: 'object',
        properties: {
          Tags: {
            type: 'array',
            items: { type: 'string' },
          },
          Name: { type: 'string' },
        },
      },
    };

    const result = decomposeJsonSchema(schema, 'Output', []);

    // Only Name should be decomposed, Tags is skipped
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: 'Output.Name',
      jsonPath: 'Name',
      type: 'string',
      dimensions: [],
      dimensionCountInputs: {},
    });
  });

  it('should handle the documentary-prompt schema structure', () => {
    const schema: JsonSchemaDefinition = {
      name: 'VideoScript',
      schema: {
        type: 'object',
        properties: {
          Title: { type: 'string' },
          Summary: { type: 'string' },
          CharacterPrompt: { type: 'string' },
          MusicPrompt: { type: 'string' },
          Clips: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                Script: { type: 'string' },
                NarrationType: { type: 'string' },
                UseNarrationAudio: { type: 'boolean' },
                ImagePrompts: {
                  type: 'array',
                  items: { type: 'string' },
                },
                VideoPrompt: { type: 'string' },
              },
            },
          },
        },
      },
    };

    const arrayMappings: ArrayDimensionMapping[] = [
      { path: 'Clips', countInput: 'NumOfClips' },
      { path: 'Clips.ImagePrompts', countInput: 'NumOfImagesPerClip' },
    ];

    const result = decomposeJsonSchema(schema, 'VideoScript', arrayMappings);

    // Should have: Title, Summary, CharacterPrompt, MusicPrompt (4 root fields)
    // Plus per-clip: Script, NarrationType, UseNarrationAudio, VideoPrompt (4 fields)
    // Plus per-clip-image: ImagePrompts (1 field)
    const rootFields = result.filter((a) => a.dimensions.length === 0);
    const clipFields = result.filter((a) => a.dimensions.length === 1);
    const imageFields = result.filter((a) => a.dimensions.length === 2);

    expect(rootFields).toHaveLength(4);
    expect(clipFields).toHaveLength(4);
    expect(imageFields).toHaveLength(1);

    // Check specific paths
    expect(result.map((a) => a.path)).toContain('VideoScript.Title');
    expect(result.map((a) => a.path)).toContain('VideoScript.Clips[clip].Script');
    expect(result.map((a) => a.path)).toContain('VideoScript.Clips[clip].ImagePrompts[image]');
  });
});

describe('deriveDimensionName', () => {
  describe('prefix removal', () => {
    it('removes NumOf prefix', () => {
      expect(deriveDimensionName('NumOfClips')).toBe('clip');
    });

    it('removes NumberOf prefix', () => {
      expect(deriveDimensionName('NumberOfItems')).toBe('item');
    });

    it('removes CountOf prefix', () => {
      expect(deriveDimensionName('CountOfPages')).toBe('page');
    });

    it('removes Num prefix', () => {
      expect(deriveDimensionName('NumImages')).toBe('image');
    });
  });

  describe('suffix removal', () => {
    it('removes Count suffix', () => {
      expect(deriveDimensionName('SegmentCount')).toBe('segment');
    });

    it('removes Number suffix', () => {
      expect(deriveDimensionName('SegmentNumber')).toBe('segment');
    });

    it('removes Num suffix', () => {
      expect(deriveDimensionName('SegmentNum')).toBe('segment');
    });
  });

  describe('Per pattern removal', () => {
    it('removes PerClip suffix', () => {
      expect(deriveDimensionName('NumOfImagesPerClip')).toBe('image');
    });

    it('removes PerChapter suffix', () => {
      expect(deriveDimensionName('NumOfPagesPerChapter')).toBe('page');
    });

    it('handles ImagesPerClip directly', () => {
      expect(deriveDimensionName('ImagesPerClip')).toBe('image');
    });
  });

  describe('pluralization', () => {
    it('singularizes plural names', () => {
      expect(deriveDimensionName('NumOfClips')).toBe('clip');
      expect(deriveDimensionName('NumOfImages')).toBe('image');
      expect(deriveDimensionName('NumOfPages')).toBe('page');
    });

    it('keeps singular names unchanged', () => {
      expect(deriveDimensionName('NumOfItem')).toBe('item');
    });

    it('does not remove s from short names', () => {
      // Single character after removing 's' would result in empty string
      // The function handles this by keeping the name as-is
      expect(deriveDimensionName('As')).toBe('a');
    });
  });

  describe('lowercase conversion', () => {
    it('converts CamelCase to lowercase', () => {
      expect(deriveDimensionName('NumOfImagePrompts')).toBe('imageprompt');
    });

    it('converts uppercase to lowercase', () => {
      expect(deriveDimensionName('SEGMENTS')).toBe('segment');
    });
  });

  describe('edge cases', () => {
    it('returns "item" for empty result', () => {
      // After all transformations, if the name becomes empty
      expect(deriveDimensionName('NumOf')).toBe('item');
    });

    it('handles combined prefix and suffix', () => {
      // NumOf is removed first, then Count suffix is removed, then singularized
      expect(deriveDimensionName('NumOfClipsCount')).toBe('clip');
    });

    it('handles simple names without patterns', () => {
      expect(deriveDimensionName('Segments')).toBe('segment');
      expect(deriveDimensionName('Images')).toBe('image');
    });

    it('handles single word input that is a suffix', () => {
      // "Count" is a suffix - after removal, empty string returns "item"
      expect(deriveDimensionName('Count')).toBe('item');
    });
  });

  describe('real-world examples', () => {
    it('handles NumOfClips', () => {
      expect(deriveDimensionName('NumOfClips')).toBe('clip');
    });

    it('handles NumOfImagesPerClip', () => {
      expect(deriveDimensionName('NumOfImagesPerClip')).toBe('image');
    });

    it('handles SegmentCount', () => {
      expect(deriveDimensionName('SegmentCount')).toBe('segment');
    });

    it('handles TotalFrames', () => {
      expect(deriveDimensionName('TotalFrames')).toBe('totalframe');
    });
  });
});
