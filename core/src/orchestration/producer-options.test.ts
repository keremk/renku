import { describe, expect, it } from 'vitest';
import {
  getProducerOptionsForCanonicalProducerId,
  setProducerOptionsForCanonicalProducerId,
  type ProducerOptionsMap,
} from './producer-options.js';

describe('canonical producer option lookup', () => {
  it('reads and writes producer options by canonical producer ID', () => {
    const options: ProducerOptionsMap = new Map();

    setProducerOptionsForCanonicalProducerId(options, 'Producer:SceneVideoProducer', [
      {
        priority: 'main',
        provider: 'fal-ai',
        model: 'veo3-fast',
        environment: 'local',
        attachments: [],
        selectionInputKeys: ['provider', 'model'],
        configInputPaths: [],
        configDefaults: {},
      },
    ]);

    expect(
      getProducerOptionsForCanonicalProducerId(
        options,
        'Producer:SceneVideoProducer'
      )
    ).toEqual(options.get('SceneVideoProducer'));
  });

  it('supports nested canonical producer IDs without reconstructing aliases from job IDs', () => {
    const options: ProducerOptionsMap = new Map([
      [
        'CelebrityVideoProducer.MeetingVideoProducer',
        [
          {
            priority: 'main',
            provider: 'fal-ai',
            model: 'veo3-fast',
            environment: 'local',
            attachments: [],
            selectionInputKeys: ['provider', 'model'],
            configInputPaths: [],
            configDefaults: {},
          },
        ],
      ],
    ]);

    expect(
      getProducerOptionsForCanonicalProducerId(
        options,
        'Producer:CelebrityVideoProducer.MeetingVideoProducer'
      )
    ).toEqual(options.get('CelebrityVideoProducer.MeetingVideoProducer'));
  });
});
