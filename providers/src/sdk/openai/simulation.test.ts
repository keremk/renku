import { describe, it, expect } from 'vitest';
import {
  simulateOpenAiGeneration,
  type SimulationSizeHints,
} from './simulation.js';
import type { ProviderJobContext } from '../../types.js';
import type { OpenAiLlmConfig } from './config.js';

function createBasicRequest(
  produces: string[] = ['Artifact:Producer.Output']
): ProviderJobContext {
  return {
    jobId: 'test-job',
    provider: 'openai',
    model: 'gpt-4',
    revision: 'rev-1',
    layerIndex: 0,
    attempt: 1,
    inputs: [],
    produces,
    context: {},
  };
}

function createJsonSchemaConfig(schema: object): OpenAiLlmConfig {
  return {
    responseFormat: {
      type: 'json_schema',
      schema,
      name: 'test_schema',
    },
  } as OpenAiLlmConfig;
}

describe('simulateOpenAiGeneration', () => {
  describe('basic simulation', () => {
    it('generates simulated data for json_schema response format', () => {
      const request = createBasicRequest();
      const config = createJsonSchemaConfig({
        type: 'object',
        properties: {
          title: { type: 'string' },
          count: { type: 'number' },
        },
      });

      const result = simulateOpenAiGeneration({ request, config });

      expect(result.data).toBeDefined();
      expect(typeof (result.data as Record<string, unknown>).title).toBe(
        'string'
      );
      expect(typeof (result.data as Record<string, unknown>).count).toBe(
        'number'
      );
    });

    it('returns simulated text for non-json response format', () => {
      const request = createBasicRequest();
      const config = {
        responseFormat: { type: 'text' },
      } as OpenAiLlmConfig;

      const result = simulateOpenAiGeneration({ request, config });

      expect(typeof result.data).toBe('string');
      expect(result.data).toContain('Simulated');
    });
  });

  describe('alternating mode for booleans', () => {
    it('alternates boolean values when condition hints are in alternating mode', () => {
      const produces = [
        'Artifact:Producer.Output[0]',
        'Artifact:Producer.Output[1]',
        'Artifact:Producer.Output[2]',
      ];
      const request = createBasicRequest(produces);
      const config = createJsonSchemaConfig({
        type: 'object',
        properties: {
          Items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
              },
            },
          },
        },
      });
      const sizeHints: SimulationSizeHints = {
        arrayLengths: { Items: [3] },
        conditionHints: {
          varyingFields: [],
          mode: 'alternating',
        },
      };

      const result = simulateOpenAiGeneration({ request, config, sizeHints });

      const data = result.data as { Items: Array<{ enabled: boolean }> };
      // With alternating mode, booleans should alternate: true, false, true
      expect(data.Items[0]?.enabled).toBe(true);
      expect(data.Items[1]?.enabled).toBe(false);
      expect(data.Items[2]?.enabled).toBe(true);
    });

    it('uses fixed true value when not in alternating mode', () => {
      const produces = [
        'Artifact:Producer.Output[0]',
        'Artifact:Producer.Output[1]',
      ];
      const request = createBasicRequest(produces);
      const config = createJsonSchemaConfig({
        type: 'object',
        properties: {
          Items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
              },
            },
          },
        },
      });
      // No condition hints = first-value mode (default legacy behavior)
      const sizeHints: SimulationSizeHints = {
        arrayLengths: { Items: [2] },
      };

      const result = simulateOpenAiGeneration({ request, config, sizeHints });

      const data = result.data as { Items: Array<{ enabled: boolean }> };
      // All booleans should be true (default)
      expect(data.Items[0]?.enabled).toBe(true);
      expect(data.Items[1]?.enabled).toBe(true);
    });
  });

  describe('alternating mode for enums', () => {
    it('cycles through enum values when in alternating mode', () => {
      const produces = [
        'Artifact:Producer.Output[0]',
        'Artifact:Producer.Output[1]',
        'Artifact:Producer.Output[2]',
      ];
      const request = createBasicRequest(produces);
      const config = createJsonSchemaConfig({
        type: 'object',
        properties: {
          Items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['A', 'B', 'C'] },
              },
            },
          },
        },
      });
      const sizeHints: SimulationSizeHints = {
        arrayLengths: { Items: [3] },
        conditionHints: {
          varyingFields: [],
          mode: 'alternating',
        },
      };

      const result = simulateOpenAiGeneration({ request, config, sizeHints });

      const data = result.data as { Items: Array<{ type: string }> };
      // With alternating mode, enums should cycle: A, B, C
      expect(data.Items[0]?.type).toBe('A');
      expect(data.Items[1]?.type).toBe('B');
      expect(data.Items[2]?.type).toBe('C');
    });

    it('uses first enum value when not in alternating mode', () => {
      const produces = [
        'Artifact:Producer.Output[0]',
        'Artifact:Producer.Output[1]',
      ];
      const request = createBasicRequest(produces);
      const config = createJsonSchemaConfig({
        type: 'object',
        properties: {
          Items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['First', 'Second'] },
              },
            },
          },
        },
      });
      const sizeHints: SimulationSizeHints = {
        arrayLengths: { Items: [2] },
      };

      const result = simulateOpenAiGeneration({ request, config, sizeHints });

      const data = result.data as { Items: Array<{ type: string }> };
      // All should be first enum value
      expect(data.Items[0]?.type).toBe('First');
      expect(data.Items[1]?.type).toBe('First');
    });
  });

  describe('varying field hints', () => {
    it('uses varying field hint values when path matches', () => {
      const produces = [
        'Artifact:Producer.Output[0]',
        'Artifact:Producer.Output[1]',
      ];
      const request = createBasicRequest(produces);
      const config = createJsonSchemaConfig({
        type: 'object',
        properties: {
          Items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['active', 'inactive', 'pending'],
                },
              },
            },
          },
        },
      });
      const sizeHints: SimulationSizeHints = {
        arrayLengths: { Items: [2] },
        conditionHints: {
          varyingFields: [
            {
              artifactId: 'Artifact:Producer.Output.Items.status',
              values: ['active', 'inactive'],
            },
          ],
          mode: 'alternating',
        },
      };

      const result = simulateOpenAiGeneration({ request, config, sizeHints });

      const data = result.data as { Items: Array<{ status: string }> };
      // Should cycle through the varying field values
      expect(data.Items[0]?.status).toBe('active');
      expect(data.Items[1]?.status).toBe('inactive');
    });

    it('applies varying hints only for the produced artifact path', () => {
      const produces = [
        'Artifact:ProducerB.Output[0]',
        'Artifact:ProducerB.Output[1]',
      ];
      const request = createBasicRequest(produces);
      const config = createJsonSchemaConfig({
        type: 'object',
        properties: {
          Items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['active', 'inactive', 'draft', 'final'],
                },
              },
            },
          },
        },
      });
      const sizeHints: SimulationSizeHints = {
        arrayLengths: { Items: [2] },
        conditionHints: {
          varyingFields: [
            {
              artifactId: 'Artifact:ProducerA.Output.Items.status',
              values: ['active', 'inactive'],
            },
            {
              artifactId: 'Artifact:ProducerB.Output.Items.status',
              values: ['draft', 'final'],
            },
          ],
          mode: 'alternating',
        },
      };

      const result = simulateOpenAiGeneration({ request, config, sizeHints });
      const data = result.data as { Items: Array<{ status: string }> };

      expect(data.Items[0]?.status).toBe('draft');
      expect(data.Items[1]?.status).toBe('final');
    });

    it('throws when condition hints match multiple produced artifact paths', () => {
      const produces = [
        'Artifact:ProducerA.Output[0]',
        'Artifact:ProducerB.Output[0]',
      ];
      const request = createBasicRequest(produces);
      const config = createJsonSchemaConfig({
        type: 'object',
        properties: {
          Items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['active', 'inactive', 'draft', 'final'],
                },
              },
            },
          },
        },
      });
      const sizeHints: SimulationSizeHints = {
        arrayLengths: { Items: [2] },
        conditionHints: {
          varyingFields: [
            {
              artifactId: 'Artifact:ProducerA.Output.Items.status',
              values: ['active', 'inactive'],
            },
            {
              artifactId: 'Artifact:ProducerB.Output.Items.status',
              values: ['draft', 'final'],
            },
          ],
          mode: 'alternating',
        },
      };

      expect(() =>
        simulateOpenAiGeneration({ request, config, sizeHints })
      ).toThrow('Simulation condition hints are ambiguous');
    });

    it('generates varied nested boolean matrices for multi-dimensional hints', () => {
      const request = createBasicRequest(['Artifact:StoryProducer.Storyboard']);
      const config = createJsonSchemaConfig({
        type: 'object',
        properties: {
          Scenes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                CharacterPresent: {
                  type: 'array',
                  items: { type: 'boolean' },
                },
              },
              required: ['CharacterPresent'],
            },
          },
        },
        required: ['Scenes'],
      });
      const sizeHints: SimulationSizeHints = {
        arrayLengths: {
          Scenes: [3],
          CharacterPresent: [3],
        },
        conditionHints: {
          varyingFields: [
            {
              artifactId:
                'Artifact:StoryProducer.Storyboard.Scenes[scene].CharacterPresent[character]',
              values: [true, false],
              dimension: 'scene',
            },
          ],
          mode: 'alternating',
        },
      };

      const result = simulateOpenAiGeneration({ request, config, sizeHints });
      const data = result.data as {
        Scenes: Array<{
          CharacterPresent: boolean[];
        }>;
      };

      const matrix = data.Scenes.map((scene) => scene.CharacterPresent);
      expect(matrix).toHaveLength(3);
      expect(matrix.every((row) => row.length === 3)).toBe(true);

      const flattened = matrix.flat();
      expect(flattened.some((value) => value)).toBe(true);
      expect(flattened.some((value) => !value)).toBe(true);

      const uniqueRows = new Set(
        matrix.map((row) => row.map((value) => (value ? '1' : '0')).join(''))
      );
      expect(uniqueRows.size).toBeGreaterThan(1);

      for (let characterIndex = 0; characterIndex < 3; characterIndex += 1) {
        const column = matrix.map((row) => row[characterIndex]!);
        expect(column.some((value) => value)).toBe(true);
        expect(column.some((value) => !value)).toBe(true);
      }
    });
  });

  describe('token usage', () => {
    it('returns zero token usage for simulated responses', () => {
      const request = createBasicRequest();
      const config = createJsonSchemaConfig({
        type: 'object',
        properties: { name: { type: 'string' } },
      });

      const result = simulateOpenAiGeneration({ request, config });

      expect(result.usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    });
  });

  describe('wrapped schema structure (like documentary-output.json)', () => {
    // This tests the exact schema structure used in condition-example blueprint
    const wrappedSchema = {
      name: 'VideoScript',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          Title: { type: 'string' },
          Segments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                Script: { type: 'string' },
                NarrationType: {
                  type: 'string',
                  enum: ['ImageNarration', 'TalkingHead', 'VideoNarration'],
                },
                UseNarrationAudio: { type: 'boolean' },
              },
              required: ['Script', 'NarrationType', 'UseNarrationAudio'],
            },
          },
        },
        required: ['Title', 'Segments'],
      },
    };

    it('unwraps nested schema and generates proper types', () => {
      const produces = [
        'Artifact:DocProducer.VideoScript.Title',
        'Artifact:DocProducer.VideoScript.Segments[0].Script',
        'Artifact:DocProducer.VideoScript.Segments[0].NarrationType',
        'Artifact:DocProducer.VideoScript.Segments[0].UseNarrationAudio',
      ];
      const request = createBasicRequest(produces);
      const config = createJsonSchemaConfig(wrappedSchema);
      const sizeHints: SimulationSizeHints = {
        arrayLengths: { Segments: [1] },
      };

      const result = simulateOpenAiGeneration({ request, config, sizeHints });

      const data = result.data as {
        Title: unknown;
        Segments: Array<{
          Script: unknown;
          NarrationType: unknown;
          UseNarrationAudio: unknown;
        }>;
      };

      // Title should be a string (not "Simulated value" specifically)
      expect(typeof data.Title).toBe('string');

      // Segments should be an array with 1 item
      expect(Array.isArray(data.Segments)).toBe(true);
      expect(data.Segments).toHaveLength(1);

      // Script should be a string
      expect(typeof data.Segments[0]?.Script).toBe('string');

      // NarrationType should be one of the enum values
      expect(['ImageNarration', 'TalkingHead', 'VideoNarration']).toContain(
        data.Segments[0]?.NarrationType
      );

      // UseNarrationAudio MUST be a boolean, NOT a string
      expect(typeof data.Segments[0]?.UseNarrationAudio).toBe('boolean');
    });

    it('generates boolean values that alternate per array index', () => {
      const produces = [
        'Artifact:DocProducer.VideoScript.Segments[0].UseNarrationAudio',
        'Artifact:DocProducer.VideoScript.Segments[1].UseNarrationAudio',
        'Artifact:DocProducer.VideoScript.Segments[2].UseNarrationAudio',
      ];
      const request = createBasicRequest(produces);
      const config = createJsonSchemaConfig(wrappedSchema);
      const sizeHints: SimulationSizeHints = {
        arrayLengths: { Segments: [3] },
        conditionHints: {
          varyingFields: [],
          mode: 'alternating',
        },
      };

      const result = simulateOpenAiGeneration({ request, config, sizeHints });

      const data = result.data as {
        Segments: Array<{ UseNarrationAudio: boolean }>;
      };

      // With alternating mode, boolean values should alternate: true, false, true
      expect(data.Segments[0]?.UseNarrationAudio).toBe(true);
      expect(data.Segments[1]?.UseNarrationAudio).toBe(false);
      expect(data.Segments[2]?.UseNarrationAudio).toBe(true);

      // Verify they're actual booleans, not strings
      expect(typeof data.Segments[0]?.UseNarrationAudio).toBe('boolean');
      expect(typeof data.Segments[1]?.UseNarrationAudio).toBe('boolean');
      expect(typeof data.Segments[2]?.UseNarrationAudio).toBe('boolean');
    });

    it('generates enum values that cycle per array index', () => {
      const produces = [
        'Artifact:DocProducer.VideoScript.Segments[0].NarrationType',
        'Artifact:DocProducer.VideoScript.Segments[1].NarrationType',
        'Artifact:DocProducer.VideoScript.Segments[2].NarrationType',
      ];
      const request = createBasicRequest(produces);
      const config = createJsonSchemaConfig(wrappedSchema);
      const sizeHints: SimulationSizeHints = {
        arrayLengths: { Segments: [3] },
        conditionHints: {
          varyingFields: [],
          mode: 'alternating',
        },
      };

      const result = simulateOpenAiGeneration({ request, config, sizeHints });

      const data = result.data as {
        Segments: Array<{ NarrationType: string }>;
      };

      // With alternating mode, enums should cycle through values
      expect(data.Segments[0]?.NarrationType).toBe('ImageNarration');
      expect(data.Segments[1]?.NarrationType).toBe('TalkingHead');
      expect(data.Segments[2]?.NarrationType).toBe('VideoNarration');
    });
  });
});
