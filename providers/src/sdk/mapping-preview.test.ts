import { describe, expect, it } from 'vitest';
import type { MappingFieldDefinition } from '@gorenku/core';
import {
  deriveMappingContractFields,
  evaluateResolutionMappingPreview,
  type EvaluateResolutionMappingPreviewArgs,
} from './mapping-preview.js';

function evaluate(
  args: Partial<EvaluateResolutionMappingPreviewArgs> & {
    mapping: Record<string, MappingFieldDefinition>;
  }
) {
  return evaluateResolutionMappingPreview({
    context: {
      inputs: {},
      inputBindings: {},
    },
    connectedAliases: new Set<string>(),
    ...args,
  });
}

describe('evaluateResolutionMappingPreview', () => {
  it('projects resolution to aspect_ratio when mapping is connected', () => {
    const fields = evaluate({
      mapping: {
        ResolutionAspectRatio: {
          input: 'Resolution',
          field: 'aspect_ratio',
          resolution: { mode: 'aspectRatio' },
        },
      },
      context: {
        inputs: {
          'Input:Resolution': { width: 1920, height: 1080 },
        },
        inputBindings: {
          Resolution: 'Input:Resolution',
        },
      },
      connectedAliases: new Set(['Resolution']),
    });

    expect(fields).toEqual([
      expect.objectContaining({
        field: 'aspect_ratio',
        value: '16:9',
        status: 'ok',
        connected: true,
      }),
    ]);
  });

  it('warns when relevant sdk mapping is not connected in the graph', () => {
    const fields = evaluate({
      mapping: {
        ResolutionAspectRatio: {
          input: 'Resolution',
          field: 'aspect_ratio',
          resolution: { mode: 'aspectRatio' },
        },
      },
      context: {
        inputs: {},
        inputBindings: {},
      },
      connectedAliases: new Set(),
    });

    expect(fields).toEqual([
      expect.objectContaining({
        field: 'aspect_ratio',
        status: 'warning',
        connected: false,
      }),
    ]);
    expect(fields[0]?.warnings.join(' ')).toContain('No graph connection');
  });

  it('warns when combine mapping is missing one required alias connection', () => {
    const fields = evaluate({
      mapping: {
        ImageSize: {
          field: 'image_size',
          combine: {
            inputs: ['AspectRatio', 'Resolution'],
            table: {
              '16:9+1K': { width: 1920, height: 1080 },
            },
          },
        },
      },
      context: {
        inputs: {
          'Input:Resolution': { width: 1280, height: 720 },
        },
        inputBindings: {
          Resolution: 'Input:Resolution',
        },
      },
      connectedAliases: new Set(['Resolution']),
    });

    expect(fields).toEqual([
      expect.objectContaining({
        field: 'image_size',
        status: 'warning',
      }),
    ]);
    expect(fields[0]?.warnings.join(' ')).toContain(
      'Missing graph connections'
    );
    expect(fields[0]?.warnings.join(' ')).toContain('AspectRatio');
  });

  it('warns when sizeTokenNearest had to choose a non-exact token', () => {
    const fields = evaluate({
      mapping: {
        ResolutionSize: {
          input: 'Resolution',
          field: 'size',
          resolution: { mode: 'sizeTokenNearest' },
        },
      },
      context: {
        inputs: {
          'Input:Resolution': { width: 1280, height: 720 },
        },
        inputBindings: {
          Resolution: 'Input:Resolution',
        },
      },
      connectedAliases: new Set(['Resolution']),
    });

    expect(fields).toEqual([
      expect.objectContaining({
        field: 'size',
        value: '1K',
        status: 'warning',
      }),
    ]);
    expect(fields[0]?.warnings.join(' ')).toContain('nearest supported size');
  });

  it('warns when aspect ratio was snapped outside tolerance', () => {
    const fields = evaluate({
      mapping: {
        ResolutionAspectRatio: {
          input: 'Resolution',
          field: 'aspect_ratio',
          resolution: { mode: 'aspectRatio' },
        },
      },
      context: {
        inputs: {
          'Input:Resolution': { width: 1000, height: 700 },
        },
        inputBindings: {
          Resolution: 'Input:Resolution',
        },
      },
      connectedAliases: new Set(['Resolution']),
    });

    expect(fields).toEqual([
      expect.objectContaining({
        field: 'aspect_ratio',
        value: '3:2',
        status: 'warning',
      }),
    ]);
    expect(fields[0]?.warnings.join(' ')).toContain('outside 2% tolerance');
  });

  it('supports single-resolution expansion to aspect_ratio and size token', () => {
    const fields = evaluate({
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
      context: {
        inputs: {
          'Input:Resolution': { width: 1280, height: 720 },
        },
        inputBindings: {
          Resolution: 'Input:Resolution',
        },
      },
      connectedAliases: new Set(['Resolution']),
    });

    expect(fields).toEqual([
      expect.objectContaining({
        field: 'aspect_ratio',
        value: '16:9',
        status: 'ok',
      }),
      expect.objectContaining({
        field: 'resolution',
        value: '1K',
        status: 'warning',
      }),
    ]);
  });

  it('surfaces transform errors as field errors', () => {
    const fields = evaluate({
      mapping: {
        ResolutionPreset: {
          input: 'Resolution',
          field: 'resolution',
          resolution: { mode: 'preset' },
        },
      },
      context: {
        inputs: {
          'Input:Resolution': '1080p',
        },
        inputBindings: {
          Resolution: 'Input:Resolution',
        },
      },
      connectedAliases: new Set(['Resolution']),
    });

    expect(fields).toEqual([
      expect.objectContaining({
        field: 'resolution',
        status: 'error',
      }),
    ]);
    expect(fields[0]?.errors.join(' ')).toContain('requires an object');
  });

  it('does not add graph-connection warning when field already has an error', () => {
    const fields = evaluate({
      mapping: {
        Resolution: {
          field: 'resolution',
          resolution: { mode: 'preset' },
        },
      },
      context: {
        inputs: {
          'Input:Resolution': '720p',
        },
        inputBindings: {
          Resolution: 'Input:Resolution',
        },
      },
      connectedAliases: new Set(),
    });

    expect(fields).toEqual([
      expect.objectContaining({
        field: 'resolution',
        status: 'error',
      }),
    ]);
    expect(fields[0]?.errors.join(' ')).toContain('requires an object');
    expect(fields[0]?.warnings.join(' ')).not.toContain('graph connection');
  });

  it('applies compatibility normalization warnings from schema enums', () => {
    const fields = evaluate({
      mapping: {
        ResolutionAspectRatio: {
          input: 'Resolution',
          field: 'aspect_ratio',
          resolution: { mode: 'aspectRatio' },
        },
      },
      context: {
        inputs: {
          'Input:Resolution': { width: 1024, height: 1024 },
        },
        inputBindings: {
          Resolution: 'Input:Resolution',
        },
      },
      connectedAliases: new Set(['Resolution']),
      inputSchema: {
        type: 'object',
        properties: {
          aspect_ratio: {
            type: 'string',
            enum: ['16:9', '9:16'],
          },
        },
      },
    });

    expect(fields).toEqual([
      expect.objectContaining({
        field: 'aspect_ratio',
        status: 'warning',
        enumOptions: ['16:9', '9:16'],
      }),
    ]);
    expect(fields[0]?.value === '16:9' || fields[0]?.value === '9:16').toBe(
      true
    );
    expect(fields[0]?.warnings.join(' ')).toContain(
      'Normalized by model constraints'
    );
  });
});

describe('deriveMappingContractFields', () => {
  it('derives expanded resolution object fields even when runtime preview may skip values', () => {
    const fields = deriveMappingContractFields({
      Resolution: {
        expand: true,
        resolution: {
          mode: 'aspectRatioAndSizeTokenObject',
          aspectRatioField: 'aspect_ratio',
          sizeTokenField: 'resolution',
        },
      },
    });

    expect(fields).toEqual([
      { field: 'aspect_ratio', sourceAliases: ['Resolution'] },
      { field: 'resolution', sourceAliases: ['Resolution'] },
    ]);
  });

  it('keeps declared schema field mappings for non-expand aliases', () => {
    const fields = deriveMappingContractFields({
      LanguageCode: {
        field: 'languageCode',
      },
    });

    expect(fields).toEqual([
      { field: 'languageCode', sourceAliases: ['LanguageCode'] },
    ]);
  });

  it('throws for expand mappings without explicit target field metadata', () => {
    expect(() =>
      deriveMappingContractFields({
        Resolution: {
          expand: true,
        },
      })
    ).toThrowError('uses expand:true without a supported field declaration');
  });
});
