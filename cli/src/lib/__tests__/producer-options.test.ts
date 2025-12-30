import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { loadBlueprintBundle } from '../blueprint-loader/index.js';
import { buildProducerOptionsFromBlueprint } from '../producer-options.js';
import { resolveBlueprintSpecifier } from '../config-assets.js';
import type { ModelSelection } from '../producer-options.js';
import type { BlueprintTreeNode } from '@gorenku/core';
import { CATALOG_BLUEPRINTS_ROOT } from '../../../tests/test-catalog-paths.js';

const CLI_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

describe('producer options', () => {
  it('builds options with SDK mappings from selection', async () => {
    const blueprintPath = await resolveBlueprintSpecifier(
      'audio-only.yaml',
      { cliRoot: CLI_ROOT },
    );
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath);

    // Use the catalog input template's base directory for relative path resolution
    const baseDir = resolve(CATALOG_BLUEPRINTS_ROOT, 'audio-only');

    // Selections provide model configuration since producers are interface-only
    const selections: ModelSelection[] = [
      {
        producerId: 'ScriptProducer',
        provider: 'openai',
        model: 'gpt-5-mini',
        promptFile: '../../producers/script/script.toml',
        outputSchema: '../../producers/script/script-output.json',
        config: { text_format: 'json_schema' },
      },
      {
        producerId: 'AudioProducer',
        provider: 'replicate',
        model: 'minimax/speech-2.6-hd',
        inputs: {
          TextInput: { field: 'text' },
          Emotion: { field: 'emotion' },
          VoiceId: { field: 'voice_id' },
        },
      },
    ];

    const options = await buildProducerOptionsFromBlueprint(blueprint, selections, true, { baseDir });

    // AudioProducer should have SDK mappings from selection
    const audioOptions = options.get('AudioProducer');
    expect(audioOptions).toBeDefined();
    expect(audioOptions![0].provider).toBe('replicate');
    expect(audioOptions![0].model).toBe('minimax/speech-2.6-hd');
    expect(audioOptions![0].sdkMapping).toEqual({
      TextInput: { field: 'text' },
      Emotion: { field: 'emotion' },
      VoiceId: { field: 'voice_id' },
    });

    // ScriptProducer should have LLM config loaded from promptFile
    const scriptOptions = options.get('ScriptProducer');
    expect(scriptOptions).toBeDefined();
    expect(scriptOptions![0].provider).toBe('openai');
    // outputSchema should be the loaded JSON content
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
    };

    await expect(buildProducerOptionsFromBlueprint(blueprint)).rejects.toThrow(/missing outputSchema/i);
  });
});
