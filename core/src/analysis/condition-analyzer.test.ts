import { describe, expect, it } from 'vitest';
import {
  analyzeConditions,
  conditionAnalysisToVaryingHints,
  type ConditionFieldInfo,
} from './condition-analyzer.js';
import type { BlueprintDocument } from '../types.js';

function createMinimalBlueprint(overrides: Partial<BlueprintDocument> = {}): BlueprintDocument {
  return {
    meta: { id: 'test', name: 'Test Blueprint' },
    inputs: [],
    artefacts: [],
    producers: [],
    producerImports: [],
    edges: [],
    ...overrides,
  };
}

describe('analyzeConditions', () => {
  describe('named conditions', () => {
    it('extracts fields from simple is condition', () => {
      const blueprint = createMinimalBlueprint({
        conditions: {
          isImageNarration: {
            when: 'DocProducer.VideoScript.Segments[segment].NarrationType',
            is: 'ImageNarration',
          },
        },
      });

      const result = analyzeConditions(blueprint);

      expect(result.namedConditions).toContain('isImageNarration');
      expect(result.conditionFields.length).toBe(1);

      const field = result.conditionFields[0]!;
      expect(field.artifactPath).toBe('DocProducer.VideoScript');
      expect(field.fieldPath).toEqual(['Segments', '[segment]', 'NarrationType']);
      expect(field.operator).toBe('is');
      expect(field.expectedValues).toEqual(['ImageNarration']);
      expect(field.dimensions).toEqual(['segment']);
    });

    it('extracts fields from isNot condition', () => {
      const blueprint = createMinimalBlueprint({
        conditions: {
          notTalkingHead: {
            when: 'DocProducer.VideoScript.Type',
            isNot: 'TalkingHead',
          },
        },
      });

      const result = analyzeConditions(blueprint);

      const field = result.conditionFields[0]!;
      expect(field.operator).toBe('isNot');
      expect(field.expectedValues).toEqual(['TalkingHead']);
    });

    it('extracts fields from condition group with any', () => {
      const blueprint = createMinimalBlueprint({
        conditions: {
          isAudioNeeded: {
            any: [
              { when: 'Producer.Output.NarrationType', is: 'TalkingHead' },
              { when: 'Producer.Output.UseNarrationAudio', is: true },
            ],
          },
        },
      });

      const result = analyzeConditions(blueprint);

      expect(result.conditionFields.length).toBe(2);
      expect(result.conditionFields.map((f) => f.expectedValues)).toEqual([
        ['TalkingHead'],
        [true],
      ]);
    });

    it('extracts fields from condition group with all', () => {
      const blueprint = createMinimalBlueprint({
        conditions: {
          bothRequired: {
            all: [
              { when: 'Producer.Output.FieldA', is: 'ValueA' },
              { when: 'Producer.Output.FieldB', is: 'ValueB' },
            ],
          },
        },
      });

      const result = analyzeConditions(blueprint);

      expect(result.conditionFields.length).toBe(2);
    });
  });

  describe('edge conditions', () => {
    it('tracks conditional producers from edges with if reference', () => {
      const blueprint = createMinimalBlueprint({
        conditions: {
          isImageNarration: {
            when: 'DocProducer.VideoScript.Type',
            is: 'ImageNarration',
          },
        },
        edges: [
          { from: 'Input:Prompt', to: 'ImageProducer.Prompt', if: 'isImageNarration' },
          { from: 'Input:Text', to: 'TextProducer.Text' },
        ],
      });

      const result = analyzeConditions(blueprint);

      expect(result.conditionalProducers).toContain('ImageProducer');
      expect(result.conditionalProducers).not.toContain('TextProducer');
    });

    it('extracts fields from inline edge conditions', () => {
      const blueprint = createMinimalBlueprint({
        edges: [
          {
            from: 'Input:Prompt',
            to: 'ImageProducer.Prompt',
            conditions: {
              when: 'DocProducer.VideoScript.Enabled',
              is: true,
            },
          },
        ],
      });

      const result = analyzeConditions(blueprint);

      expect(result.conditionFields.length).toBe(1);
      expect(result.conditionFields[0]!.expectedValues).toEqual([true]);
    });
  });

  describe('dimension extraction', () => {
    it('extracts single dimension', () => {
      const blueprint = createMinimalBlueprint({
        conditions: {
          test: {
            when: 'Producer.Output.Items[item].Value',
            is: 'X',
          },
        },
      });

      const result = analyzeConditions(blueprint);

      expect(result.conditionFields[0]!.dimensions).toEqual(['item']);
    });

    it('extracts multiple dimensions', () => {
      const blueprint = createMinimalBlueprint({
        conditions: {
          test: {
            when: 'Producer.Output.Rows[row].Cols[col].Value',
            is: 'X',
          },
        },
      });

      const result = analyzeConditions(blueprint);

      expect(result.conditionFields[0]!.dimensions).toEqual(['row', 'col']);
    });

    it('ignores numeric indices (not dimensions)', () => {
      const blueprint = createMinimalBlueprint({
        conditions: {
          test: {
            when: 'Producer.Output.Items[0].Value',
            is: 'X',
          },
        },
      });

      const result = analyzeConditions(blueprint);

      // Numeric indices like [0] are not dimension symbols
      expect(result.conditionFields[0]!.dimensions).toEqual([]);
    });
  });

  describe('deduplication', () => {
    it('deduplicates identical condition fields', () => {
      const blueprint = createMinimalBlueprint({
        conditions: {
          condA: {
            when: 'Producer.Output.Field',
            is: 'Value',
          },
          condB: {
            when: 'Producer.Output.Field',
            is: 'Value',
          },
        },
      });

      const result = analyzeConditions(blueprint);

      // Should deduplicate to one field
      expect(result.conditionFields.length).toBe(1);
    });

    it('merges expected values from different conditions on same field', () => {
      const blueprint = createMinimalBlueprint({
        conditions: {
          condA: {
            when: 'Producer.Output.Type',
            is: 'A',
          },
          condB: {
            when: 'Producer.Output.Type',
            is: 'B',
          },
        },
      });

      const result = analyzeConditions(blueprint);

      // Different values for same field/operator get merged
      expect(result.conditionFields.length).toBe(1);
      expect(result.conditionFields[0]!.expectedValues).toContain('A');
      expect(result.conditionFields[0]!.expectedValues).toContain('B');
    });
  });
});

describe('conditionAnalysisToVaryingHints', () => {
  it('generates varying hints for is conditions with string values', () => {
    const analysis = {
      conditionFields: [
        {
          artifactPath: 'DocProducer.VideoScript',
          fieldPath: ['Segments', '[segment]', 'NarrationType'],
          expectedValues: ['ImageNarration'],
          operator: 'is' as const,
          dimensions: ['segment'],
        },
      ],
      conditionalProducers: ['ImageProducer'],
      namedConditions: ['isImageNarration'],
    };

    const hints = conditionAnalysisToVaryingHints(analysis);

    expect(hints.length).toBe(1);
    expect(hints[0]!.path).toBe('Segments.[segment].NarrationType');
    expect(hints[0]!.values).toContain('ImageNarration');
    expect(hints[0]!.values).toContain('NOT_ImageNarration');
    expect(hints[0]!.dimension).toBe('segment');
    expect(hints[0]!.artifactPath).toBe('DocProducer.VideoScript');
  });

  it('generates varying hints for is conditions with boolean values', () => {
    const analysis = {
      conditionFields: [
        {
          artifactPath: 'Producer.Output',
          fieldPath: ['Enabled'],
          expectedValues: [true],
          operator: 'is' as const,
          dimensions: [],
        },
      ],
      conditionalProducers: [],
      namedConditions: [],
    };

    const hints = conditionAnalysisToVaryingHints(analysis);

    expect(hints.length).toBe(1);
    expect(hints[0]!.values).toEqual([true, false]);
  });

  it('generates varying hints for isNot conditions', () => {
    const analysis = {
      conditionFields: [
        {
          artifactPath: 'Producer.Output',
          fieldPath: ['Type'],
          expectedValues: ['Forbidden'],
          operator: 'isNot' as const,
          dimensions: [],
        },
      ],
      conditionalProducers: [],
      namedConditions: [],
    };

    const hints = conditionAnalysisToVaryingHints(analysis);

    expect(hints.length).toBe(1);
    // For isNot, we want to sometimes use the forbidden value to trigger the skip
    expect(hints[0]!.values).toContain('Forbidden');
  });

  it('returns empty hints for non-is/isNot conditions', () => {
    const analysis = {
      conditionFields: [
        {
          artifactPath: 'Producer.Output',
          fieldPath: ['Count'],
          expectedValues: [5],
          operator: 'greaterThan' as const,
          dimensions: [],
        },
      ],
      conditionalProducers: [],
      namedConditions: [],
    };

    const hints = conditionAnalysisToVaryingHints(analysis);

    // greaterThan conditions don't generate varying hints
    expect(hints.length).toBe(0);
  });

  it('includes alternative values from expectedValues', () => {
    const analysis = {
      conditionFields: [
        {
          artifactPath: 'Producer.Output',
          fieldPath: ['Type'],
          expectedValues: ['TypeA', 'TypeB', 'TypeC'],
          operator: 'is' as const,
          dimensions: [],
        },
      ],
      conditionalProducers: [],
      namedConditions: [],
    };

    const hints = conditionAnalysisToVaryingHints(analysis);

    expect(hints.length).toBe(1);
    // Should use the alternative values from expectedValues
    expect(hints[0]!.values).toContain('TypeA');
    expect(hints[0]!.values).toContain('TypeB');
    expect(hints[0]!.values).toContain('TypeC');
  });
});
