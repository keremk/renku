import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  serializeInputsToYaml,
  toSerializableModelSelection,
  mergeInputValues,
  type RawInputsData,
} from './input-serializer.js';
import type { ModelSelection } from './input-loader.js';

describe('serializeInputsToYaml', () => {
  describe('inputs serialization', () => {
    it('serializes simple key-value pairs', () => {
      const data: RawInputsData = {
        inputs: {
          Topic: 'Space exploration',
          Duration: 30,
        },
        models: [],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.inputs.Topic).toBe('Space exploration');
      expect(parsed.inputs.Duration).toBe(30);
    });

    it('strips Input: prefix from canonical keys', () => {
      const data: RawInputsData = {
        inputs: {
          'Input:Topic': 'Test topic',
          'Input:NumOfSegments': 5,
        },
        models: [],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.inputs.Topic).toBe('Test topic');
      expect(parsed.inputs.NumOfSegments).toBe(5);
      expect(parsed.inputs['Input:Topic']).toBeUndefined();
    });

    it('quotes strings with special characters', () => {
      const data: RawInputsData = {
        inputs: {
          SpecialString: 'Line1\nLine2',
          ColonString: 'key: value',
        },
        models: [],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.inputs.SpecialString).toBe('Line1\nLine2');
      expect(parsed.inputs.ColonString).toBe('key: value');
    });

    it('serializes booleans as true/false', () => {
      const data: RawInputsData = {
        inputs: {
          Enabled: true,
          Disabled: false,
        },
        models: [],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.inputs.Enabled).toBe(true);
      expect(parsed.inputs.Disabled).toBe(false);
    });

    it('serializes numbers correctly', () => {
      const data: RawInputsData = {
        inputs: {
          IntValue: 42,
          FloatValue: 3.14,
          NegativeValue: -10,
        },
        models: [],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.inputs.IntValue).toBe(42);
      expect(parsed.inputs.FloatValue).toBe(3.14);
      expect(parsed.inputs.NegativeValue).toBe(-10);
    });

    it('handles empty inputs object', () => {
      const data: RawInputsData = {
        inputs: {},
        models: [],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.inputs).toEqual({});
    });

    it('handles array values', () => {
      const data: RawInputsData = {
        inputs: {
          Tags: ['tag1', 'tag2', 'tag3'],
        },
        models: [],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.inputs.Tags).toEqual(['tag1', 'tag2', 'tag3']);
    });
  });

  describe('models serialization', () => {
    it('serializes array of model selections', () => {
      const data: RawInputsData = {
        inputs: {},
        models: [
          { producerId: 'ScriptProducer', provider: 'openai', model: 'gpt-4' },
          { producerId: 'ImageProducer', provider: 'replicate', model: 'sdxl' },
        ],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.models).toHaveLength(2);
      expect(parsed.models[0].producerId).toBe('ScriptProducer');
      expect(parsed.models[0].provider).toBe('openai');
      expect(parsed.models[0].model).toBe('gpt-4');
      expect(parsed.models[1].producerId).toBe('ImageProducer');
    });

    it('serializes config section', () => {
      const data: RawInputsData = {
        inputs: {},
        models: [
          {
            producerId: 'AudioProducer',
            provider: 'elevenlabs',
            model: 'v2',
            config: {
              voice_id: 'Bella',
              stability: 0.5,
            },
          },
        ],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.models[0].config).toEqual({
        voice_id: 'Bella',
        stability: 0.5,
      });
    });

    it('serializes LLM-specific fields inside config', () => {
      const data: RawInputsData = {
        inputs: {},
        models: [
          {
            producerId: 'ChatProducer',
            provider: 'openai',
            model: 'gpt-4',
            config: {
              systemPrompt: 'You are helpful.',
              userPrompt: 'Answer: {{question}}',
              textFormat: 'json_schema',
              variables: ['question'],
            },
          },
        ],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.models[0].config.systemPrompt).toBe('You are helpful.');
      expect(parsed.models[0].config.userPrompt).toBe('Answer: {{question}}');
      expect(parsed.models[0].config.textFormat).toBe('json_schema');
      expect(parsed.models[0].config.variables).toEqual(['question']);
    });

    it('handles empty models array', () => {
      const data: RawInputsData = {
        inputs: { Topic: 'test' },
        models: [],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.models).toBeUndefined();
    });

    it('handles models without config', () => {
      const data: RawInputsData = {
        inputs: {},
        models: [
          { producerId: 'SimpleProducer', provider: 'test', model: 'v1' },
        ],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.models[0].config).toBeUndefined();
      expect(parsed.models[0].producerId).toBe('SimpleProducer');
    });
  });

  describe('round-trip tests', () => {
    it('serialize -> parse produces same input data', () => {
      const data: RawInputsData = {
        inputs: {
          Topic: 'Space',
          Duration: 60,
          Enabled: true,
        },
        models: [],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.inputs.Topic).toBe(data.inputs.Topic);
      expect(parsed.inputs.Duration).toBe(data.inputs.Duration);
      expect(parsed.inputs.Enabled).toBe(data.inputs.Enabled);
    });

    it('preserves all model selection fields through round-trip', () => {
      const data: RawInputsData = {
        inputs: {},
        models: [
          {
            producerId: 'TestProducer',
            provider: 'openai',
            model: 'gpt-4',
            config: {
              temperature: 0.7,
              systemPrompt: 'Be helpful',
              userPrompt: 'Answer {{q}}',
              textFormat: 'json',
              variables: ['q'],
            },
          },
        ],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      const model = parsed.models[0];
      expect(model.producerId).toBe('TestProducer');
      expect(model.provider).toBe('openai');
      expect(model.model).toBe('gpt-4');
      expect(model.config).toEqual({
        temperature: 0.7,
        systemPrompt: 'Be helpful',
        userPrompt: 'Answer {{q}}',
        textFormat: 'json',
        variables: ['q'],
      });
    });

    it('handles special characters in strings through round-trip', () => {
      const data: RawInputsData = {
        inputs: {
          Prompt: 'Line 1\nLine 2\tTabbed',
          Quote: 'He said "hello"',
        },
        models: [],
      };

      const yaml = serializeInputsToYaml(data);
      const parsed = parseYaml(yaml);

      expect(parsed.inputs.Prompt).toBe('Line 1\nLine 2\tTabbed');
      expect(parsed.inputs.Quote).toBe('He said "hello"');
    });
  });
});

describe('toSerializableModelSelection', () => {
  it('converts full ModelSelection to serializable form', () => {
    const full: ModelSelection = {
      producerId: 'TestProducer',
      provider: 'openai',
      model: 'gpt-4',
      config: { temp: 0.5, systemPrompt: 'Be helpful' },
      namespacePath: ['Root', 'Child'],
      outputs: { result: { type: 'string' } },
    };

    const serializable = toSerializableModelSelection(full);

    expect(serializable.producerId).toBe('TestProducer');
    expect(serializable.provider).toBe('openai');
    expect(serializable.model).toBe('gpt-4');
    expect(serializable.config).toEqual({ temp: 0.5, systemPrompt: 'Be helpful' });
    // Runtime fields should be stripped
    expect('namespacePath' in serializable).toBe(false);
    expect('outputs' in serializable).toBe(false);
  });

  it('omits empty config', () => {
    const full: ModelSelection = {
      producerId: 'TestProducer',
      provider: 'openai',
      model: 'gpt-4',
      config: {},
    };

    const serializable = toSerializableModelSelection(full);

    expect(serializable.config).toBeUndefined();
  });

  it('omits undefined optional fields', () => {
    const full: ModelSelection = {
      producerId: 'TestProducer',
      provider: 'openai',
      model: 'gpt-4',
    };

    const serializable = toSerializableModelSelection(full);

    expect(serializable.config).toBeUndefined();
  });
});

describe('mergeInputValues', () => {
  it('merges new values into existing inputs', () => {
    const existing = { Topic: 'Old topic', Duration: 30 };
    const updates = { Topic: 'New topic' };

    const result = mergeInputValues(existing, updates);

    expect(result.Topic).toBe('New topic');
    expect(result.Duration).toBe(30);
  });

  it('handles canonical Input: prefix in existing', () => {
    const existing = { 'Input:Topic': 'Old topic' };
    const updates = { 'Input:Topic': 'New topic' };

    const result = mergeInputValues(existing, updates);

    expect(result['Input:Topic']).toBe('New topic');
  });

  it('handles mixed prefix formats', () => {
    const existing = { 'Input:Topic': 'Old', NumOfSegments: 3 };
    const updates = { Topic: 'New', NumOfSegments: 5 };

    const result = mergeInputValues(existing, updates);

    expect(result['Input:Topic']).toBe('New');
    expect(result.NumOfSegments).toBe(5);
  });

  it('adds new keys without prefix', () => {
    const existing = { Topic: 'Test' };
    const updates = { NewField: 'value' };

    const result = mergeInputValues(existing, updates);

    expect(result.NewField).toBe('value');
    expect(result['Input:NewField']).toBeUndefined();
  });

  it('preserves existing keys not in updates', () => {
    const existing = { A: 1, B: 2, C: 3 };
    const updates = { B: 20 };

    const result = mergeInputValues(existing, updates);

    expect(result.A).toBe(1);
    expect(result.B).toBe(20);
    expect(result.C).toBe(3);
  });
});

describe('file write and read integration', () => {
  it('writes valid YAML file that can be read back', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-serializer-'));
    const filePath = join(workdir, 'inputs.yaml');

    const data: RawInputsData = {
      inputs: {
        Topic: 'Integration test',
        Duration: 45,
      },
      models: [
        { producerId: 'TestProducer', provider: 'openai', model: 'gpt-4' },
      ],
    };

    const yaml = serializeInputsToYaml(data);
    await writeFile(filePath, yaml, 'utf8');

    const content = await readFile(filePath, 'utf8');
    const parsed = parseYaml(content);

    expect(parsed.inputs.Topic).toBe('Integration test');
    expect(parsed.inputs.Duration).toBe(45);
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0].producerId).toBe('TestProducer');
  });
});
