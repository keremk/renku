import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBlueprintBundle } from '../../src/lib/blueprint-loader/index.js';
import { buildProducerOptionsFromBlueprint } from '../../src/lib/producer-options.js';
import { CATALOG_BLUEPRINTS_ROOT } from '../test-catalog-paths.js';

describe('integration: provider config merging', () => {
  it('retains default clip artifacts when overriding nested fields', async () => {
    const blueprintRoot = CATALOG_BLUEPRINTS_ROOT;
    const blueprintPath = resolve(blueprintRoot, 'kenn-burns', 'image-audio.yaml');
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath);

    const options = buildProducerOptionsFromBlueprint(blueprint, [
      {
        producerId: 'ImageProducer',
        provider: 'replicate',
        model: 'bytedance/seedream-4',
      },
      {
        producerId: 'AudioProducer',
        provider: 'replicate',
        model: 'minimax/speech-2.6-hd',
      },
      {
        producerId: 'TimelineComposer',
        provider: 'renku',
        model: 'timeline/ordered',
        config: {
          audioClip: { volume: 0.9 },
          tracks: ['Image', 'Audio'],
          masterTracks: ['Audio'],
          numTracks: 2,
        },
      },
    ]);

    const timelineOptions = options.get('TimelineComposer');
    const primary = timelineOptions?.[0];
    expect(primary?.config?.audioClip).toMatchObject({
      artifact: 'AudioSegments',
      volume: 0.9,
    });
    expect(primary?.config?.imageClip).toMatchObject({
      artifact: 'ImageSegments[Image]',
    });
    expect(primary?.config?.videoClip).toMatchObject({
      artifact: 'VideoSegments',
    });
    expect(primary?.config?.musicClip).toMatchObject({
      artifact: 'Music',
    });
  });
});
