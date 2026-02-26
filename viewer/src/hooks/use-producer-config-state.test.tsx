/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProducerConfigState } from './use-producer-config-state';
import type {
  ModelSelectionValue,
  ProducerConfigSchemas,
} from '@/types/blueprint-graph';

describe('useProducerConfigState', () => {
  it('maps legacy TimelineComposer config into timeline object value', () => {
    const configSchemas: Record<string, ProducerConfigSchemas> = {
      TimelineComposer: {
        producerId: 'TimelineComposer',
        category: 'asset',
        modelSchemas: {
          'renku/timeline/ordered': {
            provider: 'renku',
            model: 'timeline/ordered',
            properties: [
              {
                key: 'timeline',
                required: false,
                schema: { type: 'object' },
              },
            ],
          },
        },
      },
    };

    const currentSelections: ModelSelectionValue[] = [
      {
        producerId: 'TimelineComposer',
        provider: 'renku',
        model: 'timeline/ordered',
        config: {
          tracks: ['Video', 'Music'],
          masterTracks: ['Video'],
          videoClip: { artifact: 'VideoSegments' },
          musicClip: { artifact: 'Music', volume: 0.4 },
        },
      },
    ];

    const { result } = renderHook(() =>
      useProducerConfigState({
        configSchemas,
        currentSelections,
      })
    );

    expect(
      result.current.configValuesByProducer.TimelineComposer
    ).toMatchObject({
      timeline: {
        tracks: ['Video', 'Music'],
        masterTracks: ['Video'],
        videoClip: { artifact: 'VideoSegments' },
        musicClip: { artifact: 'Music', volume: 0.4 },
      },
    });
  });
});
