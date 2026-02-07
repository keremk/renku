import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBlueprintBundle } from '../../src/lib/blueprint-loader/index.js';
import { buildProducerOptionsFromBlueprint } from '@gorenku/core';
import { CATALOG_ROOT, CLI_FIXTURES_BLUEPRINTS } from '../test-catalog-paths.js';

describe('integration: provider config merging', () => {
  it('retains clip artifact configuration when overriding nested fields', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'ken-burns', 'image-audio.yaml');
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath, { catalogRoot: CATALOG_ROOT });

    // Use the ken-burns blueprint directory for resolving relative paths
    const baseDir = resolve(CLI_FIXTURES_BLUEPRINTS, 'ken-burns');

    // Provide selections for all producers in the blueprint
    const options = await buildProducerOptionsFromBlueprint(blueprint, [
      {
        producerId: 'ScriptProducer',
        provider: 'openai',
        model: 'gpt-5-mini',
        config: { text_format: 'json_schema' },
      },
      {
        producerId: 'ImagePromptProducer',
        provider: 'openai',
        model: 'gpt-5-mini',
        config: { text_format: 'json_schema' },
      },
      {
        producerId: 'ImageProducer',
        provider: 'replicate',
        model: 'bytedance/seedream-4',
        // SDK mappings now come from producer YAML mappings section, not from selection
      },
      {
        producerId: 'AudioProducer',
        provider: 'replicate',
        model: 'minimax/speech-2.6-hd',
        // SDK mappings now come from producer YAML mappings section, not from selection
      },
      {
        producerId: 'TimelineComposer',
        provider: 'renku',
        model: 'timeline/ordered',
        config: {
          timeline: {
            audioClip: { artifact: 'AudioSegments', volume: 0.9 },
            imageClip: { artifact: 'ImageSegments[Image]' },
            tracks: ['Image', 'Audio'],
            masterTracks: ['Audio'],
            numTracks: 2,
          },
        },
      },
    ], true, { baseDir });

    const timelineOptions = options.get('TimelineComposer');
    const primary = timelineOptions?.[0];
    const timeline = primary?.config?.timeline as Record<string, unknown> | undefined;
    expect(timeline?.audioClip).toMatchObject({
      artifact: 'AudioSegments',
      volume: 0.9,
    });
    expect(timeline?.imageClip).toMatchObject({
      artifact: 'ImageSegments[Image]',
    });
  });
});
