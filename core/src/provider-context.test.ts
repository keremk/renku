import { describe, expect, it } from 'vitest';
import { prepareJobContext } from './provider-context.js';
import type { JobDescriptor } from './types.js';

describe('prepareJobContext', () => {
  it('keeps canonical entries as-is', () => {
    const job = createJobDescriptor();
    const baseInputs = {
      'Input:ImagePromptGenerator.NumOfImagesPerNarrative': 1,
    };

    const { resolvedInputs } = prepareJobContext(job, baseInputs);

    expect(resolvedInputs['Input:ImagePromptGenerator.NumOfImagesPerNarrative']).toBe(1);
  });

  it('throws when provided non-canonical inputs', () => {
    const job = createJobDescriptor();
    const baseInputs = { NumOfSegments: 3 };
    expect(() => prepareJobContext(job, baseInputs)).toThrow(/canonical ids/i);
  });
});

function createJobDescriptor(): JobDescriptor {
  return {
    jobId: 'Producer:ImagePromptGenerator[segment=0]',
    producer: 'ImagePromptProducer',
    inputs: [],
    produces: [],
    provider: 'openai',
    providerModel: 'gpt-5-mini',
    rateKey: 'openai:gpt-5-mini',
    context: {
      namespacePath: ['ImagePromptGenerator'],
      indices: {},
      qualifiedName: 'ImagePromptGenerator',
      inputs: [],
      produces: [],
      inputBindings: {
        NumOfImagesPerNarrative: 'Input:ImagePromptGenerator.NumOfImagesPerNarrative',
      },
    },
  };
}
