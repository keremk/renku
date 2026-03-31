import { RuntimeErrorCode } from '@gorenku/core';
import { describe, expect, it } from 'vitest';
import {
  assertPreviewSubsetOfDescriptors,
  buildFieldDescriptors,
  deriveFieldMappingMeta,
} from './models-pane-contract.js';

function createSchemaFileWithResolutionUnion(): any {
  return {
    definitions: {
      ImageSizeEnum: {
        type: 'string',
        enum: ['square_hd', 'landscape_16_9'],
      },
      ImageSizeCustom: {
        type: 'object',
        properties: {
          width: { type: 'integer', minimum: 1 },
          height: { type: 'integer', minimum: 1 },
        },
        required: ['width', 'height'],
      },
    },
    inputSchema: {
      type: 'object',
      properties: {
        image_size: {
          anyOf: [
            {
              $ref: '#/ImageSizeEnum',
            },
            {
              $ref: '#/ImageSizeCustom',
            },
          ],
        },
      },
      required: ['image_size'],
    },
    nestedModels: [],
    viewer: {
      input: {
        pointer: '/input_schema',
        schemaPointer: '/input_schema',
        component: 'object',
        order: ['image_size'],
        fields: {
          image_size: {
            pointer: '/input_schema/properties/image_size',
            schemaPointer: '/input_schema/properties/image_size',
            component: 'union',
            label: 'Image Size',
            presentation: 'enum-or-dimensions',
            unionEditor: {
              type: 'enum-dimensions',
              enumVariantId: 'preset',
              customVariantId: 'custom',
              customSelection: {
                source: 'virtual-option',
                label: 'Custom Size',
              },
            },
            variants: [
              {
                id: 'preset',
                pointer: '/ImageSizeEnum',
                schemaPointer: '/ImageSizeEnum',
                component: 'string-enum',
                label: 'Preset',
              },
              {
                id: 'custom',
                pointer: '/ImageSizeCustom',
                schemaPointer: '/ImageSizeCustom',
                component: 'object',
                label: 'Custom Size',
                order: ['width', 'height'],
                fields: {
                  width: {
                    pointer: '/ImageSizeCustom/properties/width',
                    schemaPointer: '/ImageSizeCustom/properties/width',
                    component: 'integer',
                    label: 'Width',
                  },
                  height: {
                    pointer: '/ImageSizeCustom/properties/height',
                    schemaPointer: '/ImageSizeCustom/properties/height',
                    component: 'integer',
                    label: 'Height',
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
}

function createSchemaFileWithNullableNumber(): any {
  return {
    inputSchema: {
      type: 'object',
      properties: {
        guidance_scale: {
          anyOf: [
            {
              type: 'number',
              minimum: 1,
              maximum: 50,
            },
            {
              type: 'null',
            },
          ],
        },
      },
    },
    definitions: {},
    nestedModels: [],
    viewer: {
      input: {
        pointer: '/input_schema',
        component: 'object',
        order: ['guidance_scale'],
        fields: {
          guidance_scale: {
            pointer: '/input_schema/properties/guidance_scale',
            component: 'nullable',
            label: 'Guidance Scale',
            value: {
              pointer: '/input_schema/properties/guidance_scale/anyOf/0',
              component: 'number',
              label: 'Guidance Scale',
            },
          },
        },
      },
    },
  };
}

function createSchemaFileWithPointerAndSchemaPointerMerge(): any {
  return {
    inputSchema: {
      type: 'object',
      properties: {
        resolution: {
          allOf: [{ $ref: '#/ResolutionEnum' }],
          default: '2K',
          description: 'Resolution of the generated image',
        },
      },
    },
    definitions: {
      ResolutionEnum: {
        type: 'string',
        enum: ['1K', '2K', '4K'],
      },
    },
    nestedModels: [],
    viewer: {
      input: {
        pointer: '/input_schema',
        component: 'object',
        order: ['resolution'],
        fields: {
          resolution: {
            pointer: '/input_schema/properties/resolution',
            schemaPointer: '/ResolutionEnum',
            component: 'string-enum',
            label: 'Resolution',
          },
        },
      },
    },
  };
}

describe('models-pane-contract', () => {
  it('builds enum-or-dimensions union descriptors from schema annotations', () => {
    const schemaFile = createSchemaFileWithResolutionUnion();

    const fields = buildFieldDescriptors({
      schemaFile,
      fieldMapping: new Map(),
      producerId: 'ImageProducer',
      provider: 'fal-ai',
      model: 'example/model',
    });

    expect(fields).toHaveLength(1);
    const imageSizeField = fields[0];
    expect(imageSizeField.component).toBe('union');
    expect(imageSizeField.presentation).toBe('enum-or-dimensions');

    const enumVariant = imageSizeField.variants?.find(
      (variant) => variant.component === 'string-enum'
    );
    expect(enumVariant).toBeDefined();
    expect(enumVariant?.schema?.enum).toEqual(['square_hd', 'landscape_16_9']);

    const customVariant = imageSizeField.variants?.find(
      (variant) => variant.component === 'object'
    );
    expect(customVariant).toBeDefined();

    const widthField = customVariant?.fields?.find((field) =>
      field.keyPath.endsWith('.width')
    );
    const heightField = customVariant?.fields?.find((field) =>
      field.keyPath.endsWith('.height')
    );
    expect(widthField?.component).toBe('integer');
    expect(heightField?.component).toBe('integer');
  });

  it('propagates custom renderer overrides from viewer annotations', () => {
    const schemaFile = createSchemaFileWithResolutionUnion();
    schemaFile.viewer.input.fields.image_size.custom = 'color-picker';
    schemaFile.viewer.input.fields.image_size.custom_config = {
      allow_custom: true,
      options: [
        {
          value: 'foo',
          label: 'Foo',
        },
      ],
    };

    const fields = buildFieldDescriptors({
      schemaFile,
      fieldMapping: new Map(),
      producerId: 'ImageProducer',
      provider: 'fal-ai',
      model: 'example/model',
    });

    expect(fields[0]?.custom).toBe('color-picker');
    expect(fields[0]?.customConfig).toEqual({
      allow_custom: true,
      options: [
        {
          value: 'foo',
          label: 'Foo',
        },
      ],
    });
  });

  it('fails fast when enum-object unions omit presentation metadata', () => {
    const schemaFile = createSchemaFileWithResolutionUnion();
    (
      schemaFile.viewer.input.fields.image_size as { presentation?: string }
    ).presentation = undefined;

    expect(() =>
      buildFieldDescriptors({
        schemaFile,
        fieldMapping: new Map(),
        producerId: 'ImageProducer',
        provider: 'fal-ai',
        model: 'example/model',
      })
    ).toThrowError(
      'must declare x-renku-viewer.presentation when mixing enum and object variants'
    );
  });

  it('fails fast when enum-or-dimensions unions omit explicit unionEditor metadata', () => {
    const schemaFile = createSchemaFileWithResolutionUnion();
    schemaFile.viewer.input.fields.image_size.unionEditor = undefined;

    expect(() =>
      buildFieldDescriptors({
        schemaFile,
        fieldMapping: new Map(),
        producerId: 'ImageProducer',
        provider: 'fal-ai',
        model: 'example/model',
      })
    ).toThrowError('must declare x-renku-viewer.unionEditor.type');
  });

  it('rejects preview fields outside descriptor contract', () => {
    const schemaFile = createSchemaFileWithResolutionUnion();
    const fields = buildFieldDescriptors({
      schemaFile,
      fieldMapping: new Map(),
      producerId: 'ImageProducer',
      provider: 'fal-ai',
      model: 'example/model',
    });

    expect(() =>
      assertPreviewSubsetOfDescriptors({
        producerId: 'ImageProducer',
        provider: 'fal-ai',
        model: 'example/model',
        descriptorFields: fields,
        previewFields: [{ field: 'rogue_field' }],
      })
    ).toThrowError(
      expect.objectContaining({
        code: RuntimeErrorCode.MODELS_PANE_PREVIEW_FIELD_OUTSIDE_DESCRIPTOR,
      })
    );
  });

  it('resolves array-based schema pointers for nullable value descriptors', () => {
    const schemaFile = createSchemaFileWithNullableNumber();

    const fields = buildFieldDescriptors({
      schemaFile,
      fieldMapping: new Map(),
      producerId: 'LipsyncVideoProducer',
      provider: 'fal-ai',
      model: 'ltx-2.3/audio-to-video',
    });

    expect(fields).toHaveLength(1);
    expect(fields[0].component).toBe('nullable');
    expect(fields[0].value?.component).toBe('number');
    expect(fields[0].value?.schema?.minimum).toBe(1);
    expect(fields[0].value?.schema?.maximum).toBe(50);
  });

  it('merges pointer and schemaPointer metadata so enum defaults remain visible', () => {
    const schemaFile = createSchemaFileWithPointerAndSchemaPointerMerge();

    const fields = buildFieldDescriptors({
      schemaFile,
      fieldMapping: new Map(),
      producerId: 'StartImageProducer',
      provider: 'replicate',
      model: 'google/nano-banana-pro',
    });

    expect(fields).toHaveLength(1);
    expect(fields[0].component).toBe('string-enum');
    expect(fields[0].schema?.enum).toEqual(['1K', '2K', '4K']);
    expect(fields[0].schema?.default).toBe('2K');
  });

  it('treats disconnected aliases with no metadata as unmapped instead of failing', () => {
    const schemaFile: any = {
      inputSchema: {
        type: 'object',
        properties: {
          language_code: {
            type: 'string',
          },
        },
      },
      definitions: {},
      nestedModels: [],
      viewer: {
        input: {
          pointer: '/input_schema',
          component: 'object',
          order: ['language_code'],
          fields: {
            language_code: {
              pointer: '/input_schema/properties/language_code',
              component: 'string',
              label: 'Language Code',
            },
          },
        },
      },
    };

    const fieldMapping = deriveFieldMappingMeta({
      schemaFile,
      mapping: {
        LanguageCode: {
          field: 'language_code',
        },
      },
      bindingSummary: {
        resolvedInputs: {},
        mappingInputBindings: {},
        connectedAliases: new Set<string>(),
        aliasSources: new Map<string, Set<'input' | 'artifact'>>(),
      },
      producerId: 'NarrationAudioProducer',
      provider: 'fal-ai',
      model: 'elevenlabs/tts/eleven-v3',
    });

    expect(fieldMapping.get('language_code')?.source).toBe('none');
    expect(fieldMapping.get('language_code')?.aliases).toEqual([
      'LanguageCode',
    ]);
  });

  it('fails when connected aliases are missing binding metadata', () => {
    const schemaFile: any = {
      inputSchema: {
        type: 'object',
        properties: {
          language_code: {
            type: 'string',
          },
        },
      },
      definitions: {},
      nestedModels: [],
      viewer: {
        input: {
          pointer: '/input_schema',
          component: 'object',
          order: ['language_code'],
          fields: {
            language_code: {
              pointer: '/input_schema/properties/language_code',
              component: 'string',
              label: 'Language Code',
            },
          },
        },
      },
    };

    expect(() =>
      deriveFieldMappingMeta({
        schemaFile,
        mapping: {
          LanguageCode: {
            field: 'language_code',
          },
        },
        bindingSummary: {
          resolvedInputs: {},
          mappingInputBindings: {},
          connectedAliases: new Set(['LanguageCode']),
          aliasSources: new Map<string, Set<'input' | 'artifact'>>(),
        },
        producerId: 'NarrationAudioProducer',
        provider: 'fal-ai',
        model: 'elevenlabs/tts/eleven-v3',
      })
    ).toThrowError(
      expect.objectContaining({
        code: RuntimeErrorCode.MODELS_PANE_MISSING_BINDING_METADATA_ALIAS,
      })
    );
  });

  it('derives mapping metadata from expand resolution contracts without runtime preview values', () => {
    const schemaFile: any = {
      inputSchema: {
        type: 'object',
        properties: {
          aspect_ratio: { type: 'string' },
          resolution: { type: 'string' },
        },
      },
      definitions: {},
      nestedModels: [],
      viewer: {
        input: {
          pointer: '/input_schema',
          component: 'object',
          order: ['aspect_ratio', 'resolution'],
          fields: {
            aspect_ratio: {
              pointer: '/input_schema/properties/aspect_ratio',
              component: 'string-enum',
              label: 'Aspect Ratio',
            },
            resolution: {
              pointer: '/input_schema/properties/resolution',
              component: 'string-enum',
              label: 'Resolution',
            },
          },
        },
      },
    };

    const fieldMapping = deriveFieldMappingMeta({
      schemaFile,
      mapping: {
        Resolution: {
          expand: true,
          resolution: {
            mode: 'aspectRatioAndSizeTokenObject',
            aspectRatioField: 'aspect_ratio',
            sizeTokenField: 'resolution',
          },
        },
      },
      bindingSummary: {
        resolvedInputs: {},
        mappingInputBindings: {},
        connectedAliases: new Set(['Resolution']),
        aliasSources: new Map([
          ['Resolution', new Set<'input' | 'artifact'>(['input'])],
        ]),
      },
      producerId: 'StartImageProducer',
      provider: 'replicate',
      model: 'google/nano-banana-pro',
    });

    expect(fieldMapping.get('aspect_ratio')?.source).toBe('input');
    expect(fieldMapping.get('resolution')?.source).toBe('input');
    expect(fieldMapping.get('aspect_ratio')?.aliases).toEqual(['Resolution']);
    expect(fieldMapping.get('resolution')?.aliases).toEqual(['Resolution']);
  });
});
