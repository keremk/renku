import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadBlueprintBundle } from './blueprint-loader/index.js';
import { buildProducerOptionsFromBlueprint } from './producer-options.js';
import type { ModelSelection } from './producer-options.js';
import type { BlueprintTreeNode } from '@gorenku/core';
import { CATALOG_BLUEPRINTS_ROOT } from '../../tests/test-catalog-paths.js';

describe('producer options', () => {
  it('builds options with SDK mappings from producer YAML (not from selection)', async () => {
    // Use root catalog (source of truth), not cli/catalog
    const blueprintPath = resolve(CATALOG_BLUEPRINTS_ROOT, 'audio-only', 'audio-only.yaml');
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath);

    // Verify the ScriptProducer child node has the expected meta with promptFile/outputSchema
    const scriptProducerNode = blueprint.children.get('ScriptProducer');
    expect(scriptProducerNode).toBeDefined();
    expect(scriptProducerNode!.document.meta.promptFile).toBe('./script.toml');
    expect(scriptProducerNode!.document.meta.outputSchema).toBe('./script-output.json');
    expect(scriptProducerNode!.sourcePath).toContain('script.yaml');

    // Selections provide model configuration since producers are interface-only
    // Note: 'inputs' field was removed from ModelSelection - SDK mappings now come from producer YAML
    const selections: ModelSelection[] = [
      {
        producerId: 'ScriptProducer',
        provider: 'openai',
        model: 'gpt-5-mini',
        config: { text_format: 'json_schema' },
      },
      {
        producerId: 'AudioProducer',
        provider: 'replicate',
        model: 'minimax/speech-2.6-hd',
        // SDK mappings now come from producer YAML mappings section, not from selection
      },
    ];

    const options = await buildProducerOptionsFromBlueprint(blueprint, selections, true);

    // AudioProducer - SDK mappings come from producer YAML mappings section
    const audioOptions = options.get('AudioProducer');
    expect(audioOptions).toBeDefined();
    expect(audioOptions![0].provider).toBe('replicate');
    expect(audioOptions![0].model).toBe('minimax/speech-2.6-hd');
    // sdkMapping is populated from the producer YAML's mappings section
    expect(audioOptions![0].sdkMapping).toBeDefined();
    expect(audioOptions![0].sdkMapping?.Text).toEqual({ field: 'text' });
    expect(audioOptions![0].sdkMapping?.VoiceId).toEqual({ field: 'voice_id' });
    expect(audioOptions![0].sdkMapping?.Emotion).toEqual({ field: 'emotion' });

    // ScriptProducer should have LLM config loaded from promptFile (defined in producer meta)
    const scriptOptions = options.get('ScriptProducer');
    expect(scriptOptions).toBeDefined();
    expect(scriptOptions![0].provider).toBe('openai');
    // outputSchema should be the loaded JSON content from producer meta's outputSchema path
    expect(scriptOptions![0].outputSchema).toBeDefined();
    expect(scriptOptions![0].config).toMatchObject({
      text_format: 'json_schema',
      systemPrompt: expect.stringContaining('documentary'),
    });
  });

  it('throws when a json_schema variant is missing outputSchema', async () => {
    const blueprint: BlueprintTreeNode = {
      id: 'test-node',
      namespacePath: [],
      document: {
        meta: { id: 'test-blueprint', name: 'Test', description: 'test blueprint' },
        inputs: [],
        artefacts: [],
        edges: [],
        producerImports: [],
        producers: [
          {
            name: 'BrokenProducer',
            models: [
              {
                provider: 'openai',
                model: 'missing-schema',
                textFormat: 'json_schema',
              },
            ],
          },
        ],
      },
      children: new Map(),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    await expect(buildProducerOptionsFromBlueprint(blueprint)).rejects.toThrow(/missing outputSchema/i);
  });
});
