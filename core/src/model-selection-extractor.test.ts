import { describe, it, expect } from 'vitest';
import { extractModelSelectionsFromInputs } from './model-selection-extractor.js';

describe('extractModelSelectionsFromInputs', () => {
  it('extracts provider/model pairs into ModelSelection array', () => {
    const inputs = {
      'ScriptProducer.provider': 'openai',
      'ScriptProducer.model': 'gpt-4o',
      'ImageProducer.provider': 'replicate',
      'ImageProducer.model': 'flux-schnell',
      'SomeInput': 'value',
    };

    const result = extractModelSelectionsFromInputs(inputs);

    expect(result.modelSelections).toHaveLength(2);
    expect(result.modelSelections).toContainEqual({
      producerId: 'ScriptProducer',
      provider: 'openai',
      model: 'gpt-4o',
    });
    expect(result.modelSelections).toContainEqual({
      producerId: 'ImageProducer',
      provider: 'replicate',
      model: 'flux-schnell',
    });
    expect(result.remainingInputs).toEqual({ 'SomeInput': 'value' });
  });

  it('handles STT nested config (sttProvider/sttModel)', () => {
    const inputs = {
      'AudioProducer.provider': 'elevenlabs',
      'AudioProducer.model': 'eleven_multilingual_v2',
      'AudioProducer.sttProvider': 'google',
      'AudioProducer.sttModel': 'chirp',
    };

    const result = extractModelSelectionsFromInputs(inputs);

    expect(result.modelSelections).toHaveLength(1);
    expect(result.modelSelections[0]).toEqual({
      producerId: 'AudioProducer',
      provider: 'elevenlabs',
      model: 'eleven_multilingual_v2',
      config: {
        sttProvider: 'google',
        sttModel: 'chirp',
      },
    });
    expect(result.remainingInputs).toEqual({});
  });

  it('skips incomplete pairs (provider without model)', () => {
    const inputs = {
      'ScriptProducer.provider': 'openai',
      // Missing: 'ScriptProducer.model'
      'OtherInput': 'value',
    };

    const result = extractModelSelectionsFromInputs(inputs);

    expect(result.modelSelections).toHaveLength(0);
    // Incomplete pair keys should remain in remainingInputs
    expect(result.remainingInputs).toEqual({
      'ScriptProducer.provider': 'openai',
      'OtherInput': 'value',
    });
  });

  it('skips incomplete pairs (model without provider)', () => {
    const inputs = {
      'ScriptProducer.model': 'gpt-4o',
      // Missing: 'ScriptProducer.provider'
      'OtherInput': 'value',
    };

    const result = extractModelSelectionsFromInputs(inputs);

    expect(result.modelSelections).toHaveLength(0);
    expect(result.remainingInputs).toEqual({
      'ScriptProducer.model': 'gpt-4o',
      'OtherInput': 'value',
    });
  });

  it('returns non-model inputs in remainingInputs', () => {
    const inputs = {
      'Duration': 60,
      'NumOfSegments': 5,
      'TopicDescription': 'A video about cats',
      'ImageProducer.provider': 'replicate',
      'ImageProducer.model': 'flux-schnell',
    };

    const result = extractModelSelectionsFromInputs(inputs);

    expect(result.modelSelections).toHaveLength(1);
    expect(result.remainingInputs).toEqual({
      'Duration': 60,
      'NumOfSegments': 5,
      'TopicDescription': 'A video about cats',
    });
  });

  it('handles empty inputs', () => {
    const result = extractModelSelectionsFromInputs({});

    expect(result.modelSelections).toEqual([]);
    expect(result.remainingInputs).toEqual({});
  });

  it('handles null/undefined inputs', () => {
    const result1 = extractModelSelectionsFromInputs(null as unknown as Record<string, unknown>);
    const result2 = extractModelSelectionsFromInputs(undefined as unknown as Record<string, unknown>);

    expect(result1.modelSelections).toEqual([]);
    expect(result1.remainingInputs).toEqual({});
    expect(result2.modelSelections).toEqual([]);
    expect(result2.remainingInputs).toEqual({});
  });

  it('handles non-string provider/model values', () => {
    const inputs = {
      'Producer1.provider': 123, // number, not string
      'Producer1.model': 'some-model',
      'Producer2.provider': 'valid-provider',
      'Producer2.model': { nested: true }, // object, not string
      'OtherInput': 'value',
    };

    const result = extractModelSelectionsFromInputs(inputs);

    // Neither should be extracted since values are not strings
    expect(result.modelSelections).toHaveLength(0);
    expect(result.remainingInputs).toEqual({
      'Producer1.provider': 123,
      'Producer1.model': 'some-model',
      'Producer2.provider': 'valid-provider',
      'Producer2.model': { nested: true },
      'OtherInput': 'value',
    });
  });

  it('handles multiple producers with mixed completeness', () => {
    const inputs = {
      'Complete.provider': 'openai',
      'Complete.model': 'gpt-4o',
      'IncompleteA.provider': 'replicate',
      // Missing: 'IncompleteA.model'
      'IncompleteB.model': 'flux',
      // Missing: 'IncompleteB.provider'
      'AlsoComplete.provider': 'anthropic',
      'AlsoComplete.model': 'claude-3',
      'RegularInput': 'hello',
    };

    const result = extractModelSelectionsFromInputs(inputs);

    expect(result.modelSelections).toHaveLength(2);
    expect(result.modelSelections.map(s => s.producerId).sort()).toEqual(['AlsoComplete', 'Complete']);
    expect(result.remainingInputs).toEqual({
      'IncompleteA.provider': 'replicate',
      'IncompleteB.model': 'flux',
      'RegularInput': 'hello',
    });
  });

  it('includes STT config only when both sttProvider and sttModel are present', () => {
    const inputs = {
      'Producer1.provider': 'elevenlabs',
      'Producer1.model': 'eleven_v2',
      'Producer1.sttProvider': 'google',
      // Missing: 'Producer1.sttModel'
      'Producer2.provider': 'elevenlabs',
      'Producer2.model': 'eleven_v2',
      'Producer2.sttModel': 'chirp',
      // Missing: 'Producer2.sttProvider'
    };

    const result = extractModelSelectionsFromInputs(inputs);

    expect(result.modelSelections).toHaveLength(2);
    // Neither should have config since STT pairs are incomplete
    expect(result.modelSelections.find(s => s.producerId === 'Producer1')?.config).toBeUndefined();
    expect(result.modelSelections.find(s => s.producerId === 'Producer2')?.config).toBeUndefined();
  });
});
