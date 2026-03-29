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
            fields: [
              {
                keyPath: 'timeline',
                component: 'object',
                label: 'Timeline',
                required: false,
                mappingSource: 'none',
                mappedAliases: [],
              },
            ],
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

  it('hides nested provider/model fields already controlled by nested selector', () => {
    const configSchemas: Record<string, ProducerConfigSchemas> = {
      TranscriptionProducer: {
        producerId: 'TranscriptionProducer',
        category: 'asset',
        modelSchemas: {
          'renku/speech/transcription': {
            provider: 'renku',
            model: 'speech/transcription',
            fields: [
              {
                keyPath: 'stt',
                component: 'object',
                label: 'Stt',
                required: true,
                mappingSource: 'none',
                mappedAliases: [],
                fields: [
                  {
                    keyPath: 'stt.provider',
                    component: 'string',
                    label: 'Provider',
                    required: true,
                    mappingSource: 'none',
                    mappedAliases: [],
                  },
                  {
                    keyPath: 'stt.model',
                    component: 'string',
                    label: 'Model',
                    required: true,
                    mappingSource: 'none',
                    mappedAliases: [],
                  },
                ],
              },
            ],
            properties: [],
          },
        },
        nestedModels: [
          {
            declaration: {
              name: 'stt',
              description: 'Speech-to-text backend model',
              configPath: 'stt',
              providerField: 'provider',
              modelField: 'model',
              required: true,
            },
            availableModels: [
              { provider: 'fal-ai', model: 'elevenlabs/speech-to-text' },
            ],
            modelSchemas: {
              'fal-ai/elevenlabs/speech-to-text': {
                provider: 'fal-ai',
                model: 'elevenlabs/speech-to-text',
                fields: [
                  {
                    keyPath: 'provider',
                    component: 'string',
                    label: 'Provider',
                    required: true,
                    mappingSource: 'none',
                    mappedAliases: [],
                  },
                  {
                    keyPath: 'model',
                    component: 'string',
                    label: 'Model',
                    required: true,
                    mappingSource: 'none',
                    mappedAliases: [],
                  },
                  {
                    keyPath: 'diarize',
                    component: 'boolean',
                    label: 'Diarize',
                    required: false,
                    mappingSource: 'none',
                    mappedAliases: [],
                  },
                ],
                properties: [],
              },
            },
          },
        ],
      },
    };

    const currentSelections: ModelSelectionValue[] = [
      {
        producerId: 'TranscriptionProducer',
        provider: 'renku',
        model: 'speech/transcription',
        config: {
          stt: {
            provider: 'fal-ai',
            model: 'elevenlabs/speech-to-text',
            diarize: true,
          },
        },
      },
    ];

    const { result } = renderHook(() =>
      useProducerConfigState({
        configSchemas,
        currentSelections,
      })
    );

    const fields =
      result.current.configFieldsByProducer.TranscriptionProducer ?? [];
    const keyPaths = fields.map((field) => field.keyPath);

    expect(keyPaths).not.toContain('stt.provider');
    expect(keyPaths).not.toContain('stt.model');
    expect(keyPaths).toContain('stt.diarize');
  });
});
