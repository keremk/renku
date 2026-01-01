import { describe, expect, it } from 'vitest';
import {
  buildProducerOptionsFromBlueprint,
  collectVariants,
} from './producer-options.js';
import type { BlueprintTreeNode, ProducerConfig, ModelSelection } from '@gorenku/core';

// Helper to create a minimal blueprint tree node
function createBlueprintNode(
  id: string,
  producers: ProducerConfig[],
  namespacePath: string[] = [],
): BlueprintTreeNode {
  return {
    id,
    namespacePath,
    document: {
      meta: { id, name: id },
      inputs: [],
      artefacts: [],
      producers,
      producerImports: [],
      edges: [],
    },
    children: new Map(),
    sourcePath: '/test/mock-blueprint.yaml',
  };
}

describe('collectVariants', () => {
  it('returns empty array for interface-only producer (no models)', () => {
    const producer: ProducerConfig = {
      name: 'ImageProducer',
    };

    const variants = collectVariants(producer);

    expect(variants).toEqual([]);
  });

  it('returns variants from producer models array', () => {
    const producer: ProducerConfig = {
      name: 'ImageProducer',
      models: [
        {
          provider: 'replicate',
          model: 'google/nano-banana',
          inputs: {
            Prompt: { field: 'prompt' },
            AspectRatio: { field: 'aspect_ratio' },
          },
        },
      ],
    };

    const variants = collectVariants(producer);

    expect(variants).toHaveLength(1);
    expect(variants[0].provider).toBe('replicate');
    expect(variants[0].model).toBe('google/nano-banana');
    expect(variants[0].sdkMapping).toEqual({
      Prompt: { field: 'prompt' },
      AspectRatio: { field: 'aspect_ratio' },
    });
  });

  it('returns variants from legacy inline provider/model', () => {
    const producer: ProducerConfig = {
      name: 'LegacyProducer',
      provider: 'openai',
      model: 'gpt-4o',
      config: { temperature: 0.7 },
    };

    const variants = collectVariants(producer);

    expect(variants).toHaveLength(1);
    expect(variants[0].provider).toBe('openai');
    expect(variants[0].model).toBe('gpt-4o');
    expect(variants[0].config).toEqual({ temperature: 0.7 });
  });
});

describe('buildProducerOptionsFromBlueprint', () => {
  it('builds options for interface-only producer using selection', async () => {
    const blueprint = createBlueprintNode('TestBlueprint', [
      { name: 'ImageProducer' },
    ]);

    const selections: ModelSelection[] = [
      {
        producerId: 'ImageProducer',
        provider: 'fal-ai',
        model: 'bytedance/seedream',
        inputs: {
          Prompt: { field: 'prompt' },
          AspectRatio: {
            field: 'image_size',
            transform: {
              '16:9': 'landscape_16_9',
              '1:1': 'square',
            },
          },
        },
      },
    ];

    const optionsMap = await buildProducerOptionsFromBlueprint(blueprint, selections, true);

    const options = optionsMap.get('ImageProducer');
    expect(options).toBeDefined();
    expect(options).toHaveLength(1);
    expect(options![0].provider).toBe('fal-ai');
    expect(options![0].model).toBe('bytedance/seedream');
    expect(options![0].sdkMapping).toEqual({
      Prompt: { field: 'prompt' },
      AspectRatio: {
        field: 'image_size',
        transform: {
          '16:9': 'landscape_16_9',
          '1:1': 'square',
        },
      },
    });
  });

  it('builds options for LLM producer with inline config (no file loading)', async () => {
    const blueprint = createBlueprintNode('TestBlueprint', [
      { name: 'ScriptProducer' },
    ]);

    // When no baseDir is provided, promptFile/outputSchema paths are stored but not loaded
    const selections: ModelSelection[] = [
      {
        producerId: 'ScriptProducer',
        provider: 'openai',
        model: 'gpt-5-mini',
        systemPrompt: 'You are a script writer.',
        config: {
          text_format: 'json_schema',
        },
      },
    ];

    const optionsMap = await buildProducerOptionsFromBlueprint(blueprint, selections, true);

    const options = optionsMap.get('ScriptProducer');
    expect(options).toBeDefined();
    expect(options![0].provider).toBe('openai');
    expect(options![0].model).toBe('gpt-5-mini');
    expect(options![0].config).toMatchObject({
      text_format: 'json_schema',
      systemPrompt: 'You are a script writer.',
    });
  });

  it('builds options for producer with inline LLM config from selection', async () => {
    const blueprint = createBlueprintNode('TestBlueprint', [
      { name: 'ChatProducer' },
    ]);

    const selections: ModelSelection[] = [
      {
        producerId: 'ChatProducer',
        provider: 'openai',
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Answer: {{question}}',
        textFormat: 'text',
        variables: ['question'],
      },
    ];

    const optionsMap = await buildProducerOptionsFromBlueprint(blueprint, selections, true);

    const options = optionsMap.get('ChatProducer');
    expect(options).toBeDefined();
    expect(options![0].config).toMatchObject({
      systemPrompt: 'You are a helpful assistant.',
      userPrompt: 'Answer: {{question}}',
      variables: ['question'],
    });
  });

  it('throws error for interface-only producer without selection', async () => {
    const blueprint = createBlueprintNode('TestBlueprint', [
      { name: 'ImageProducer' },
    ]);

    await expect(
      buildProducerOptionsFromBlueprint(blueprint, [], false),
    ).rejects.toThrow(/has no model configuration/);
  });

  it('merges selection config with variant config', async () => {
    const blueprint = createBlueprintNode('TestBlueprint', [
      {
        name: 'ConfigProducer',
        models: [
          {
            provider: 'openai',
            model: 'gpt-4o',
            config: { temperature: 0.5 },
          },
        ],
      },
    ]);

    const selections: ModelSelection[] = [
      {
        producerId: 'ConfigProducer',
        provider: 'openai',
        model: 'gpt-4o',
        config: { max_tokens: 1000 },
      },
    ];

    const optionsMap = await buildProducerOptionsFromBlueprint(blueprint, selections, true);

    const options = optionsMap.get('ConfigProducer');
    expect(options).toBeDefined();
    expect(options![0].config).toMatchObject({
      temperature: 0.5,
      max_tokens: 1000,
    });
  });
});
