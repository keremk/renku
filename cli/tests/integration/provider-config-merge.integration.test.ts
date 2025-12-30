import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBlueprintBundle } from '../../src/lib/blueprint-loader/index.js';
import { buildProducerOptionsFromBlueprint } from '../../src/lib/producer-options.js';
import { CATALOG_BLUEPRINTS_ROOT } from '../test-catalog-paths.js';

describe('integration: provider config merging', () => {
  it('retains clip artifact configuration when overriding nested fields', async () => {
    const blueprintRoot = CATALOG_BLUEPRINTS_ROOT;
    const blueprintPath = resolve(blueprintRoot, 'kenn-burns', 'image-audio.yaml');
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath);

    // Use the kenn-burns blueprint directory for resolving relative paths
    const baseDir = resolve(blueprintRoot, 'kenn-burns');

    // Provide selections for all producers in the blueprint
    const options = await buildProducerOptionsFromBlueprint(blueprint, [
      {
        producerId: 'ScriptProducer',
        provider: 'openai',
        model: 'gpt-5-mini',
        promptFile: '../../producers/script/script.toml',
        outputSchema: '../../producers/script/script-output.json',
        config: { text_format: 'json_schema' },
      },
      {
        producerId: 'ImagePromptProducer',
        provider: 'openai',
        model: 'gpt-5-mini',
        promptFile: '../../producers/image-prompt/image-prompt.toml',
        outputSchema: '../../producers/image-prompt/image-prompt-output.json',
        config: { text_format: 'json_schema' },
      },
      {
        producerId: 'ImageProducer',
        provider: 'replicate',
        model: 'bytedance/seedream-4',
        inputs: { Prompt: { field: 'prompt' }, AspectRatio: { field: 'aspect_ratio' } },
      },
      {
        producerId: 'AudioProducer',
        provider: 'replicate',
        model: 'minimax/speech-2.6-hd',
        inputs: { TextInput: { field: 'text' }, Emotion: { field: 'emotion' }, VoiceId: { field: 'voice_id' } },
      },
      {
        producerId: 'TimelineComposer',
        provider: 'renku',
        model: 'timeline/ordered',
        config: {
          audioClip: { artifact: 'AudioSegments', volume: 0.9 },
          imageClip: { artifact: 'ImageSegments[Image]' },
          tracks: ['Image', 'Audio'],
          masterTracks: ['Audio'],
          numTracks: 2,
        },
      },
    ], true, { baseDir });

    const timelineOptions = options.get('TimelineComposer');
    const primary = timelineOptions?.[0];
    expect(primary?.config?.audioClip).toMatchObject({
      artifact: 'AudioSegments',
      volume: 0.9,
    });
    expect(primary?.config?.imageClip).toMatchObject({
      artifact: 'ImageSegments[Image]',
    });
  });
});
