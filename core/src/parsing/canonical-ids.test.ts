import { describe, expect, it } from 'vitest';
import {
  // Validators
  isCanonicalInputId,
  isCanonicalArtifactId,
  isCanonicalProducerId,
  isCanonicalId,
  getCanonicalIdType,
  // Parsers
  parseCanonicalInputId,
  parseCanonicalProducerId,
  parseCanonicalArtifactId,
  // Assertions
  assertCanonicalInputId,
  assertCanonicalArtifactId,
  assertCanonicalProducerId,
  assertCanonicalId,
  // Formatters
  formatProducerPath,
  formatCanonicalInputId,
  formatCanonicalArtifactId,
  formatCanonicalProducerId,
  formatProducerScopedInputId,
  // Utilities
  parseQualifiedProducerName,
} from './canonical-ids.js';

describe('Validators', () => {
  describe('isCanonicalInputId', () => {
    it('returns true for valid Input IDs', () => {
      expect(isCanonicalInputId('Input:Topic')).toBe(true);
      expect(isCanonicalInputId('Input:ScriptProducer.InquiryPrompt')).toBe(true);
    });

    it('returns false for non-Input IDs', () => {
      expect(isCanonicalInputId('Artifact:Image')).toBe(false);
      expect(isCanonicalInputId('Producer:Script')).toBe(false);
      expect(isCanonicalInputId('Topic')).toBe(false);
      expect(isCanonicalInputId('')).toBe(false);
    });
  });

  describe('isCanonicalArtifactId', () => {
    it('returns true for valid Artifact IDs', () => {
      expect(isCanonicalArtifactId('Artifact:Image')).toBe(true);
      expect(isCanonicalArtifactId('Artifact:SegmentImage[0][1]')).toBe(true);
    });

    it('returns false for non-Artifact IDs', () => {
      expect(isCanonicalArtifactId('Input:Topic')).toBe(false);
      expect(isCanonicalArtifactId('Producer:Script')).toBe(false);
    });
  });

  describe('isCanonicalProducerId', () => {
    it('returns true for valid Producer IDs', () => {
      expect(isCanonicalProducerId('Producer:ScriptProducer')).toBe(true);
      expect(isCanonicalProducerId('Producer:Audio')).toBe(true);
    });

    it('returns false for non-Producer IDs', () => {
      expect(isCanonicalProducerId('Input:Topic')).toBe(false);
      expect(isCanonicalProducerId('Artifact:Image')).toBe(false);
    });
  });

  describe('isCanonicalId', () => {
    it('returns true for any valid canonical ID', () => {
      expect(isCanonicalId('Input:Topic')).toBe(true);
      expect(isCanonicalId('Artifact:Image')).toBe(true);
      expect(isCanonicalId('Producer:Script')).toBe(true);
    });

    it('returns false for non-canonical IDs', () => {
      expect(isCanonicalId('Topic')).toBe(false);
      expect(isCanonicalId('Invalid:Something')).toBe(false);
      expect(isCanonicalId('')).toBe(false);
    });
  });

  describe('getCanonicalIdType', () => {
    it('returns correct type for valid IDs', () => {
      expect(getCanonicalIdType('Input:Topic')).toBe('Input');
      expect(getCanonicalIdType('Artifact:Image')).toBe('Artifact');
      expect(getCanonicalIdType('Producer:Script')).toBe('Producer');
    });

    it('returns null for invalid IDs', () => {
      expect(getCanonicalIdType('Topic')).toBe(null);
      expect(getCanonicalIdType('Invalid:Something')).toBe(null);
      expect(getCanonicalIdType('')).toBe(null);
    });
  });
});

describe('Parsers', () => {
  describe('parseCanonicalInputId', () => {
    it('parses simple Input ID', () => {
      const result = parseCanonicalInputId('Input:Topic');
      expect(result).toEqual({
        type: 'Input',
        path: [],
        name: 'Topic',
      });
    });

    it('parses Input ID with path', () => {
      const result = parseCanonicalInputId('Input:ScriptProducer.InquiryPrompt');
      expect(result).toEqual({
        type: 'Input',
        path: ['ScriptProducer'],
        name: 'InquiryPrompt',
      });
    });

    it('parses Input ID with deep path', () => {
      const result = parseCanonicalInputId('Input:Level1.Level2.Name');
      expect(result).toEqual({
        type: 'Input',
        path: ['Level1', 'Level2'],
        name: 'Name',
      });
    });

    it('throws for non-Input ID', () => {
      expect(() => parseCanonicalInputId('Artifact:Image')).toThrow('Expected canonical Input ID');
    });

    it('throws for empty body', () => {
      expect(() => parseCanonicalInputId('Input:')).toThrow('empty body');
    });
  });

  describe('parseCanonicalProducerId', () => {
    it('parses simple Producer ID', () => {
      const result = parseCanonicalProducerId('Producer:ScriptProducer');
      expect(result).toEqual({
        type: 'Producer',
        path: [],
        name: 'ScriptProducer',
      });
    });

    it('throws for non-Producer ID', () => {
      expect(() => parseCanonicalProducerId('Input:Topic')).toThrow('Expected canonical Producer ID');
    });
  });

  describe('parseCanonicalArtifactId', () => {
    it('parses simple Artifact ID', () => {
      const result = parseCanonicalArtifactId('Artifact:Image');
      expect(result).toEqual({
        type: 'Artifact',
        path: [],
        name: 'Image',
        indices: [],
      });
    });

    it('parses Artifact ID with indices', () => {
      const result = parseCanonicalArtifactId('Artifact:SegmentImage[0][1]');
      expect(result).toEqual({
        type: 'Artifact',
        path: [],
        name: 'SegmentImage',
        indices: [0, 1],
      });
    });

    it('parses Artifact ID with path and indices', () => {
      const result = parseCanonicalArtifactId('Artifact:Producer.Image[2]');
      expect(result).toEqual({
        type: 'Artifact',
        path: ['Producer'],
        name: 'Image',
        indices: [2],
      });
    });

    it('throws for non-Artifact ID', () => {
      expect(() => parseCanonicalArtifactId('Input:Topic')).toThrow('Expected canonical Artifact ID');
    });
  });
});

describe('Assertions', () => {
  describe('assertCanonicalInputId', () => {
    it('does not throw for valid Input ID', () => {
      expect(() => assertCanonicalInputId('Input:Topic')).not.toThrow();
    });

    it('throws for invalid Input ID', () => {
      expect(() => assertCanonicalInputId('Artifact:Image')).toThrow();
      expect(() => assertCanonicalInputId('Input:')).toThrow();
    });
  });

  describe('assertCanonicalArtifactId', () => {
    it('does not throw for valid Artifact ID', () => {
      expect(() => assertCanonicalArtifactId('Artifact:Image')).not.toThrow();
      expect(() => assertCanonicalArtifactId('Artifact:Image[0]')).not.toThrow();
    });

    it('throws for invalid Artifact ID', () => {
      expect(() => assertCanonicalArtifactId('Input:Topic')).toThrow();
    });
  });

  describe('assertCanonicalProducerId', () => {
    it('does not throw for valid Producer ID', () => {
      expect(() => assertCanonicalProducerId('Producer:Script')).not.toThrow();
    });

    it('throws for invalid Producer ID', () => {
      expect(() => assertCanonicalProducerId('Input:Topic')).toThrow();
    });
  });

  describe('assertCanonicalId', () => {
    it('does not throw for any valid canonical ID', () => {
      expect(() => assertCanonicalId('Input:Topic')).not.toThrow();
      expect(() => assertCanonicalId('Artifact:Image')).not.toThrow();
      expect(() => assertCanonicalId('Producer:Script')).not.toThrow();
    });

    it('throws for invalid canonical ID', () => {
      expect(() => assertCanonicalId('Topic')).toThrow();
      expect(() => assertCanonicalId('Invalid:Something')).toThrow();
    });
  });
});

describe('Formatters', () => {
  describe('formatProducerPath', () => {
    it('returns producerName when aliasPath is empty', () => {
      expect(formatProducerPath([], 'ScriptProducer')).toBe('ScriptProducer');
    });

    it('returns aliasPath when non-empty (alias takes precedence)', () => {
      expect(formatProducerPath(['MyAlias'], 'InternalName')).toBe('MyAlias');
    });

    it('joins multi-segment aliasPath', () => {
      expect(formatProducerPath(['Level1', 'Level2'], 'Name')).toBe('Level1.Level2');
    });
  });

  describe('formatCanonicalInputId', () => {
    it('formats simple Input ID', () => {
      expect(formatCanonicalInputId([], 'Topic')).toBe('Input:Topic');
    });

    it('formats Input ID with path', () => {
      expect(formatCanonicalInputId(['ScriptProducer'], 'Prompt')).toBe('Input:ScriptProducer.Prompt');
    });
  });

  describe('formatCanonicalArtifactId', () => {
    it('formats simple Artifact ID', () => {
      expect(formatCanonicalArtifactId([], 'Image')).toBe('Artifact:Image');
    });

    it('formats Artifact ID with path', () => {
      expect(formatCanonicalArtifactId(['Producer'], 'Output')).toBe('Artifact:Producer.Output');
    });
  });

  describe('formatCanonicalProducerId', () => {
    it('formats simple Producer ID', () => {
      expect(formatCanonicalProducerId([], 'ScriptProducer')).toBe('Producer:ScriptProducer');
    });

    it('formats Producer ID with alias (alias takes precedence)', () => {
      expect(formatCanonicalProducerId(['MyAlias'], 'InternalName')).toBe('Producer:MyAlias');
    });
  });

  describe('formatProducerScopedInputId', () => {
    it('formats producer-scoped input ID', () => {
      expect(formatProducerScopedInputId([], 'AudioProducer', 'provider')).toBe('Input:AudioProducer.provider');
    });

    it('formats producer-scoped input ID with alias path', () => {
      expect(formatProducerScopedInputId(['MyAlias'], 'InternalName', 'model')).toBe('Input:MyAlias.model');
    });
  });
});

describe('Utilities', () => {
  describe('parseQualifiedProducerName', () => {
    it('parses simple producer name', () => {
      const result = parseQualifiedProducerName('ScriptProducer');
      expect(result).toEqual({
        namespacePath: [],
        producerName: 'ScriptProducer',
      });
    });

    it('parses qualified producer name with path', () => {
      const result = parseQualifiedProducerName('Namespace.ScriptProducer');
      expect(result).toEqual({
        namespacePath: ['Namespace'],
        producerName: 'ScriptProducer',
      });
    });

    it('throws for empty producer name', () => {
      expect(() => parseQualifiedProducerName('')).toThrow('non-empty');
    });
  });
});

describe('Round-trip parsing', () => {
  it('format then parse produces same result for Input ID', () => {
    const original = formatCanonicalInputId(['Producer'], 'Input');
    const parsed = parseCanonicalInputId(original);
    expect(parsed.path).toEqual(['Producer']);
    expect(parsed.name).toBe('Input');
  });

  it('format then parse produces same result for Artifact ID', () => {
    const original = formatCanonicalArtifactId(['Producer'], 'Output');
    const parsed = parseCanonicalArtifactId(original);
    expect(parsed.path).toEqual(['Producer']);
    expect(parsed.name).toBe('Output');
    expect(parsed.indices).toEqual([]);
  });

  it('format then parse produces same result for Producer ID', () => {
    const original = formatCanonicalProducerId([], 'ScriptProducer');
    const parsed = parseCanonicalProducerId(original);
    expect(parsed.path).toEqual([]);
    expect(parsed.name).toBe('ScriptProducer');
  });
});
