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
  formatProducerAlias,
  formatCanonicalInputId,
  formatCanonicalArtifactId,
  formatCanonicalProducerId,
  formatProducerScopedInputId,
  // Utilities
  parseQualifiedProducerName,
  createInputIdResolver,
  looksLikeDecomposedArtifactPath,
} from './canonical-ids.js';
import type { BlueprintTreeNode } from '../types.js';

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
  describe('formatProducerAlias', () => {
    it('returns producerName when aliasPath is empty', () => {
      expect(formatProducerAlias([], 'ScriptProducer')).toBe('ScriptProducer');
    });

    it('returns aliasPath when non-empty (alias takes precedence)', () => {
      expect(formatProducerAlias(['MyAlias'], 'InternalName')).toBe('MyAlias');
    });

    it('joins multi-segment aliasPath', () => {
      expect(formatProducerAlias(['Level1', 'Level2'], 'Name')).toBe('Level1.Level2');
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

describe('InputIdResolver', () => {
  // Helper to create a minimal blueprint tree for testing
  function createTestTree(): BlueprintTreeNode {
    return {
      id: 'TestBlueprint',
      namespacePath: [],
      document: {
        meta: { id: 'TestBlueprint', name: 'Test Blueprint' },
        inputs: [
          { name: 'Topic', type: 'string', required: true },
          { name: 'Count', type: 'int', required: false, defaultValue: 5 },
        ],
        artefacts: [],
        producers: [],
        producerImports: [],
        edges: [],
      },
      children: new Map([
        ['ChildProducer', {
          id: 'ChildProducer',
          namespacePath: ['ChildProducer'],
          document: {
            meta: { id: 'ChildProducer', name: 'Child Producer' },
            inputs: [
              { name: 'Prompt', type: 'string', required: true },
            ],
            artefacts: [],
            producers: [],
            producerImports: [],
            edges: [],
          },
          children: new Map(),
        }],
      ]),
    };
  }

  describe('resolve() - strict mode', () => {
    it('accepts valid canonical Input ID', () => {
      const resolver = createInputIdResolver(createTestTree());
      expect(resolver.resolve('Input:Topic')).toBe('Input:Topic');
    });

    it('throws for non-canonical ID (qualified name)', () => {
      const resolver = createInputIdResolver(createTestTree());
      expect(() => resolver.resolve('Topic')).toThrow('Expected canonical Input ID');
    });

    it('throws for unknown canonical ID', () => {
      const resolver = createInputIdResolver(createTestTree());
      expect(() => resolver.resolve('Input:Unknown')).toThrow('Unknown canonical input id');
    });

    it('provides helpful error message for qualified names', () => {
      const resolver = createInputIdResolver(createTestTree());
      expect(() => resolver.resolve('Topic')).toThrow('Use resolver.toCanonical()');
    });
  });

  describe('toCanonical() - conversion mode', () => {
    it('returns canonical ID as-is', () => {
      const resolver = createInputIdResolver(createTestTree());
      expect(resolver.toCanonical('Input:Topic')).toBe('Input:Topic');
    });

    it('converts qualified name to canonical ID', () => {
      const resolver = createInputIdResolver(createTestTree());
      expect(resolver.toCanonical('Topic')).toBe('Input:Topic');
    });

    it('converts nested qualified name to canonical ID', () => {
      const resolver = createInputIdResolver(createTestTree());
      expect(resolver.toCanonical('ChildProducer.Prompt')).toBe('Input:ChildProducer.Prompt');
    });

    it('throws for unknown qualified name', () => {
      const resolver = createInputIdResolver(createTestTree());
      expect(() => resolver.toCanonical('Unknown')).toThrow('Unknown input');
    });

    it('throws for unknown canonical ID', () => {
      const resolver = createInputIdResolver(createTestTree());
      expect(() => resolver.toCanonical('Input:Unknown')).toThrow('Unknown canonical input id');
    });
  });

  describe('has()', () => {
    it('returns true for existing canonical ID', () => {
      const resolver = createInputIdResolver(createTestTree());
      expect(resolver.has('Input:Topic')).toBe(true);
      expect(resolver.has('Input:ChildProducer.Prompt')).toBe(true);
    });

    it('returns false for non-existing canonical ID', () => {
      const resolver = createInputIdResolver(createTestTree());
      expect(resolver.has('Input:Unknown')).toBe(false);
    });

    it('returns false for qualified names (not canonical)', () => {
      const resolver = createInputIdResolver(createTestTree());
      expect(resolver.has('Topic')).toBe(false);
    });
  });

  describe('entries', () => {
    it('contains all inputs from tree', () => {
      const resolver = createInputIdResolver(createTestTree());
      const ids = resolver.entries.map((e) => e.canonicalId);
      expect(ids).toContain('Input:Topic');
      expect(ids).toContain('Input:Count');
      expect(ids).toContain('Input:ChildProducer.Prompt');
    });
  });
});

describe('Edge cases', () => {
  describe('formatProducerAlias edge cases', () => {
    it('handles empty aliasPath (uses producerName)', () => {
      expect(formatProducerAlias([], 'MyProducer')).toBe('MyProducer');
    });

    it('handles single segment aliasPath', () => {
      expect(formatProducerAlias(['SingleAlias'], 'InternalName')).toBe('SingleAlias');
    });

    it('handles maximum depth aliasPath', () => {
      const deepPath = ['Level1', 'Level2', 'Level3', 'Level4', 'Level5'];
      expect(formatProducerAlias(deepPath, 'DeepName')).toBe('Level1.Level2.Level3.Level4.Level5');
    });
  });

  describe('Producer-scoped input ID round-trip', () => {
    it('formats and parses producer-scoped input ID correctly', () => {
      const formatted = formatProducerScopedInputId(['MyProducer'], 'InternalName', 'provider');
      expect(formatted).toBe('Input:MyProducer.provider');
      expect(isCanonicalInputId(formatted)).toBe(true);
      const parsed = parseCanonicalInputId(formatted);
      expect(parsed.path).toEqual(['MyProducer']);
      expect(parsed.name).toBe('provider');
    });

    it('formats and parses nested producer-scoped input ID', () => {
      const formatted = formatProducerScopedInputId(['Outer', 'Inner'], 'Producer', 'config.timeout');
      expect(formatted).toBe('Input:Outer.Inner.config.timeout');
      expect(isCanonicalInputId(formatted)).toBe(true);
    });
  });

  describe('Invalid input handling', () => {
    it('parseCanonicalInputId throws for non-canonical ID', () => {
      expect(() => parseCanonicalInputId('NotCanonical')).toThrow();
    });

    it('parseCanonicalArtifactId throws for non-canonical ID', () => {
      expect(() => parseCanonicalArtifactId('NotCanonical')).toThrow();
    });

    it('parseCanonicalProducerId throws for non-canonical ID', () => {
      expect(() => parseCanonicalProducerId('NotCanonical')).toThrow();
    });

    it('assertCanonicalInputId throws with clear message', () => {
      expect(() => assertCanonicalInputId('Topic')).toThrow('Expected canonical Input ID');
    });

    it('assertCanonicalArtifactId throws with clear message', () => {
      expect(() => assertCanonicalArtifactId('Output')).toThrow('Expected canonical Artifact ID');
    });

    it('assertCanonicalProducerId throws with clear message', () => {
      expect(() => assertCanonicalProducerId('Producer')).toThrow('Expected canonical Producer ID');
    });
  });

  describe('Artifact ID with indices round-trip', () => {
    it('parses artifact with single numeric index', () => {
      const id = 'Artifact:Producer.Output[0]';
      expect(isCanonicalArtifactId(id)).toBe(true);
      const parsed = parseCanonicalArtifactId(id);
      expect(parsed.path).toEqual(['Producer']);
      expect(parsed.name).toBe('Output');
      expect(parsed.indices).toEqual([0]);
    });

    it('parses artifact with multiple numeric indices', () => {
      const id = 'Artifact:Producer.Output[0][2]';
      expect(isCanonicalArtifactId(id)).toBe(true);
      const parsed = parseCanonicalArtifactId(id);
      expect(parsed.path).toEqual(['Producer']);
      expect(parsed.name).toBe('Output');
      expect(parsed.indices).toEqual([0, 2]);
    });

    it('handles named indices by preserving them in name', () => {
      // Named indices like [segment=0] are preserved in the name field
      // Only numeric indices [0] are extracted
      const id = 'Artifact:Producer.Output[segment=0]';
      expect(isCanonicalArtifactId(id)).toBe(true);
      const parsed = parseCanonicalArtifactId(id);
      expect(parsed.path).toEqual(['Producer']);
      expect(parsed.name).toBe('Output[segment=0]');
      expect(parsed.indices).toEqual([]);
    });
  });
});

describe('looksLikeDecomposedArtifactPath', () => {
  describe('returns true for decomposed artifact paths', () => {
    it('detects simple producer.artifact[index] pattern', () => {
      expect(looksLikeDecomposedArtifactPath('ScriptProducer.NarrationScript[0]')).toBe(true);
    });

    it('detects deeply nested paths with single index', () => {
      expect(looksLikeDecomposedArtifactPath('DocProducer.VideoScript.Segments[0]')).toBe(true);
    });

    it('detects paths with multiple indices', () => {
      expect(looksLikeDecomposedArtifactPath('DocProducer.VideoScript.Segments[0].ImagePrompts[0]')).toBe(true);
    });

    it('detects paths with large indices', () => {
      expect(looksLikeDecomposedArtifactPath('Producer.Output[123]')).toBe(true);
    });

    it('detects paths with consecutive indices', () => {
      expect(looksLikeDecomposedArtifactPath('ImageProducer.SegmentImage[0][1]')).toBe(true);
    });

    it('detects paths starting with just an artifact name', () => {
      expect(looksLikeDecomposedArtifactPath('Segments[0].Script')).toBe(true);
    });

    it('detects paths with index at the end', () => {
      expect(looksLikeDecomposedArtifactPath('VideoScript.Segments[0].ImagePrompts[2]')).toBe(true);
    });
  });

  describe('returns false for non-decomposed paths', () => {
    it('rejects simple input names', () => {
      expect(looksLikeDecomposedArtifactPath('Topic')).toBe(false);
    });

    it('rejects qualified names without indices', () => {
      expect(looksLikeDecomposedArtifactPath('Producer.Input')).toBe(false);
    });

    it('rejects deeply nested paths without indices', () => {
      expect(looksLikeDecomposedArtifactPath('Level1.Level2.Level3.Name')).toBe(false);
    });

    it('rejects paths with named placeholders (not numeric)', () => {
      expect(looksLikeDecomposedArtifactPath('VideoScript.Segments[segment]')).toBe(false);
    });

    it('rejects paths with dimension selectors', () => {
      expect(looksLikeDecomposedArtifactPath('VideoScript.Segments[segment=0]')).toBe(false);
    });

    it('rejects empty strings', () => {
      expect(looksLikeDecomposedArtifactPath('')).toBe(false);
    });

    it('rejects paths with empty brackets', () => {
      expect(looksLikeDecomposedArtifactPath('Producer.Output[]')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles index zero correctly', () => {
      expect(looksLikeDecomposedArtifactPath('Output[0]')).toBe(true);
    });

    it('handles multi-digit indices', () => {
      expect(looksLikeDecomposedArtifactPath('Output[99]')).toBe(true);
      expect(looksLikeDecomposedArtifactPath('Output[100]')).toBe(true);
    });

    it('rejects mixed placeholder and numeric', () => {
      // This has a numeric index, so it should return true
      expect(looksLikeDecomposedArtifactPath('Output[segment][0]')).toBe(true);
    });

    it('handles paths with numbers in names', () => {
      expect(looksLikeDecomposedArtifactPath('Producer2.Output3[0]')).toBe(true);
    });
  });
});
