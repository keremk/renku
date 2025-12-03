import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { loadBlueprintBundle } from '../blueprint-loader/index.js';
import { buildProducerOptionsFromBlueprint } from '../producer-options.js';
import { resolveBlueprintSpecifier } from '../config-assets.js';
import type { ModelSelection } from '../producer-options.js';
import type { BlueprintTreeNode } from '@renku/core';

const CLI_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

describe('producer options', () => {
  it('includes prompt metadata for LLM producers (system/user/variables)', async () => {
    const blueprintPath = await resolveBlueprintSpecifier(
      'video-audio-music.yaml',
      { cliRoot: CLI_ROOT },
    );
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath);

    const selections: ModelSelection[] = [
      { producerId: 'ScriptProducer', provider: 'openai', model: 'gpt-5-mini' },
      { producerId: 'VideoPromptProducer', provider: 'openai', model: 'gpt-5-mini' },
      { producerId: 'VideoProducer', provider: 'replicate', model: 'bytedance/seedance-1-pro-fast' },
      { producerId: 'AudioProducer', provider: 'replicate', model: 'minimax/speech-2.6-hd' },
      { producerId: 'MusicPromptProducer', provider: 'openai', model: 'gpt-5-mini' },
      { producerId: 'MusicProducer', provider: 'replicate', model: 'stability-ai/stable-audio-2.5' },
      { producerId: 'TimelineComposer', provider: 'renku', model: 'OrderedTimeline' },
      { producerId: 'VideoExporter', provider: 'renku', model: 'Mp4Exporter' },
    ];

    const options = buildProducerOptionsFromBlueprint(blueprint, selections);
    const scriptOptions = options.get('ScriptProducer');
    expect(scriptOptions).toBeDefined();
    const primary = scriptOptions?.[0];
    expect(primary?.config).toBeDefined();
    const config = primary?.config as Record<string, unknown>;

    expect(typeof config?.systemPrompt).toBe('string');
    expect((config?.systemPrompt as string).length).toBeGreaterThan(0);
    expect(typeof config?.userPrompt).toBe('string');
    expect((config?.userPrompt as string).length).toBeGreaterThan(0);
    expect(Array.isArray(config?.variables)).toBe(true);
    expect((config?.variables as unknown[]).length).toBeGreaterThan(0);

    const responseFormat = config?.responseFormat as { type?: string; schema?: unknown } | undefined;
    expect(responseFormat?.type ?? config?.textFormat ?? config?.text_format).toBeDefined();
  });

  it('only attaches responseFormat schema when text_format is json_schema', async () => {
    const blueprintPath = await resolveBlueprintSpecifier(
      'video-audio-music.yaml',
      { cliRoot: CLI_ROOT },
    );
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath);

    const selections: ModelSelection[] = [
      { producerId: 'ScriptProducer', provider: 'openai', model: 'gpt-5-mini' },
      { producerId: 'VideoPromptProducer', provider: 'openai', model: 'gpt-5-mini' },
      { producerId: 'VideoProducer', provider: 'replicate', model: 'bytedance/seedance-1-pro-fast' },
      { producerId: 'AudioProducer', provider: 'replicate', model: 'minimax/speech-2.6-hd' },
      { producerId: 'MusicProducer', provider: 'replicate', model: 'stability-ai/stable-audio-2.5' },
    ];

    const options = buildProducerOptionsFromBlueprint(blueprint, selections);
    const scriptConfig = options.get('ScriptProducer')?.[0]?.config as Record<string, unknown> | undefined;
    const videoPromptConfig = options.get('VideoPromptProducer')?.[0]?.config as Record<string, unknown> | undefined;

    expect(scriptConfig?.text_format ?? scriptConfig?.textFormat).toBe('json_schema');
    expect((scriptConfig?.responseFormat as { type?: string; schema?: unknown } | undefined)?.type).toBe('json_schema');
    expect((scriptConfig?.responseFormat as { schema?: unknown } | undefined)?.schema).toBeDefined();

    expect(videoPromptConfig?.text_format ?? videoPromptConfig?.textFormat).toBe('text');
    expect((videoPromptConfig?.responseFormat as Record<string, unknown> | undefined)?.type).toBeUndefined();
  });

  it('throws when a json_schema variant is missing outputSchema', () => {
    const blueprint: BlueprintTreeNode = {
      id: 'test-node',
      namespacePath: [],
      document: {
        meta: { id: 'test-blueprint', name: 'Test', description: 'test blueprint' },
        inputs: [],
        artefacts: [],
        subBlueprints: [],
        edges: [],
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

    expect(() => buildProducerOptionsFromBlueprint(blueprint)).toThrow(/missing outputSchema/i);
  });
});
