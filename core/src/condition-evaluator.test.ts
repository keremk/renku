import { describe, it, expect } from 'vitest';
import {
  evaluateCondition,
  evaluateInputConditions,
  type ConditionEvaluationContext,
} from './condition-evaluator.js';
import type { EdgeConditionClause, EdgeConditionGroup, InputConditionInfo } from './types.js';

// Helper to create a context with resolved artifacts
function createContext(artifacts: Record<string, unknown>): ConditionEvaluationContext {
  return { resolvedArtifacts: artifacts };
}

// Note: Condition paths use the format: <Producer>.<ArtifactName>.<FieldPath>
// The first two segments form the artifact ID, everything after is the field path

describe('evaluateCondition', () => {
  describe('is operator', () => {
    it('satisfies when string values are equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Output.value', is: 'testvalue' };
      const context = createContext({ 'Artifact:Producer.Output': { value: 'testvalue' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when number values are equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Stats.Count', is: 42 };
      const context = createContext({ 'Artifact:Producer.Stats': { Count: 42 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when boolean values are equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Config.Enabled', is: true };
      const context = createContext({ 'Artifact:Producer.Config': { Enabled: true } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when object values are deeply equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Result.Data', is: { a: 1, b: 2 } };
      const context = createContext({ 'Artifact:Producer.Result': { Data: { a: 1, b: 2 } } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when array values are deeply equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Result.Items', is: [1, 2, 3] };
      const context = createContext({ 'Artifact:Producer.Result': { Items: [1, 2, 3] } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when both values are null', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Result.Value', is: null };
      const context = createContext({ 'Artifact:Producer.Result': { Value: null } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when values differ', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Output.value', is: 'expected' };
      const context = createContext({ 'Artifact:Producer.Output': { value: 'actual' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('!==');
    });

    it('fails when types differ and cannot be coerced', () => {
      // String "5" comparing against number 5 - coercion works here
      const condition: EdgeConditionClause = { when: 'Producer.Result.Value', is: 5 };
      const context = createContext({ 'Artifact:Producer.Result': { Value: '5' } });
      const result = evaluateCondition(condition, {}, context);
      // With coercion, "5" becomes 5 and matches
      expect(result.satisfied).toBe(true);
    });

    it('fails when string cannot be coerced to expected number', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Result.Value', is: 5 };
      const context = createContext({ 'Artifact:Producer.Result': { Value: 'not-a-number' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });
  });

  describe('is operator with type coercion (blob text/plain content)', () => {
    // These tests verify that string values from blob content (text/plain)
    // are correctly coerced to match the expected type from YAML conditions

    it('coerces string "true" to boolean true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Config.HasFeature', is: true };
      // Blob content stored as text/plain contains the string "true"
      const context = createContext({ 'Artifact:Producer.Config': { HasFeature: 'true' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('coerces string "false" to boolean false', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Config.IsDisabled', is: false };
      // Blob content stored as text/plain contains the string "false"
      const context = createContext({ 'Artifact:Producer.Config': { IsDisabled: 'false' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('correctly fails when string "true" compared to is: false', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Config.HasFeature', is: false };
      const context = createContext({ 'Artifact:Producer.Config': { HasFeature: 'true' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('correctly fails when string "false" compared to is: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Config.HasFeature', is: true };
      const context = createContext({ 'Artifact:Producer.Config': { HasFeature: 'false' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('coerces numeric string to number', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Stats.Count', is: 42 };
      const context = createContext({ 'Artifact:Producer.Stats': { Count: '42' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('coerces numeric string for greaterThan', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Stats.Count', greaterThan: 10 };
      const context = createContext({ 'Artifact:Producer.Stats': { Count: '42' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('coerces numeric string for lessThan', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Stats.Count', lessThan: 50 };
      const context = createContext({ 'Artifact:Producer.Stats': { Count: '42' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('does not coerce non-matching strings', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Config.HasFeature', is: true };
      // String "yes" should not be coerced to true
      const context = createContext({ 'Artifact:Producer.Config': { HasFeature: 'yes' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('does not coerce when value is already correct type', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Config.HasFeature', is: true };
      // Already a boolean, no coercion needed
      const context = createContext({ 'Artifact:Producer.Config': { HasFeature: true } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });
  });

  describe('isNot operator', () => {
    it('satisfies when values differ', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Type', isNot: 'video' };
      const context = createContext({ 'Artifact:Producer.Data': { Type: 'audio' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when values are equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Type', isNot: 'video' };
      const context = createContext({ 'Artifact:Producer.Data': { Type: 'video' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('===');
    });

    it('satisfies when types differ', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Value', isNot: '5' };
      const context = createContext({ 'Artifact:Producer.Data': { Value: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });
  });

  describe('contains operator', () => {
    it('satisfies when string contains substring', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Text', contains: 'hello' };
      const context = createContext({ 'Artifact:Producer.Data': { Text: 'say hello world' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when string does not contain substring', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Text', contains: 'goodbye' };
      const context = createContext({ 'Artifact:Producer.Data': { Text: 'say hello world' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('does not contain');
    });

    it('satisfies when array contains primitive element', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Tags', contains: 'important' };
      const context = createContext({ 'Artifact:Producer.Data': { Tags: ['urgent', 'important', 'new'] } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when array contains object element (deep equality)', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Items', contains: { id: 2 } };
      const context = createContext({ 'Artifact:Producer.Data': { Items: [{ id: 1 }, { id: 2 }, { id: 3 }] } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when array does not contain element', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Tags', contains: 'missing' };
      const context = createContext({ 'Artifact:Producer.Data': { Tags: ['a', 'b', 'c'] } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('handles empty string contains check', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Text', contains: '' };
      const context = createContext({ 'Artifact:Producer.Data': { Text: 'anything' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('handles empty array contains check', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Items', contains: 'x' };
      const context = createContext({ 'Artifact:Producer.Data': { Items: [] } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });
  });

  describe('greaterThan operator', () => {
    it('satisfies when value is greater', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Count', greaterThan: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Count: 10 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value is equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Count', greaterThan: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Count: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('is not >');
    });

    it('fails when value is less', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Count', greaterThan: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Count: 3 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('works with float values', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Score', greaterThan: 3.14 };
      const context = createContext({ 'Artifact:Producer.Data': { Score: 3.15 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('works with negative numbers', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Offset', greaterThan: -10 };
      const context = createContext({ 'Artifact:Producer.Data': { Offset: -5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value is not a number', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Value', greaterThan: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Value: 'ten' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('requires numeric values');
    });
  });

  describe('lessThan operator', () => {
    it('satisfies when value is less', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Count', lessThan: 10 };
      const context = createContext({ 'Artifact:Producer.Data': { Count: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value is equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Count', lessThan: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Count: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('is not <');
    });

    it('fails when value is greater', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Count', lessThan: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Count: 10 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('fails when value is not a number', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Value', lessThan: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Value: null } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('requires numeric values');
    });
  });

  describe('greaterOrEqual operator', () => {
    it('satisfies when value is greater', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Count', greaterOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Count: 10 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when value is equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Count', greaterOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Count: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value is less', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Count', greaterOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Count: 3 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('is not >=');
    });

    it('fails when value is not a number', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Value', greaterOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Value: undefined } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('requires numeric values');
    });
  });

  describe('lessOrEqual operator', () => {
    it('satisfies when value is less', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Count', lessOrEqual: 10 };
      const context = createContext({ 'Artifact:Producer.Data': { Count: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when value is equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Count', lessOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Count: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value is greater', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Count', lessOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Count: 10 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('is not <=');
    });

    it('fails when value is not a number', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Value', lessOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer.Data': { Value: [] } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('requires numeric values');
    });
  });

  describe('exists operator', () => {
    it('satisfies when value exists and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Field', exists: true };
      const context = createContext({ 'Artifact:Producer.Data': { Field: 'value' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when value is 0 and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Field', exists: true };
      const context = createContext({ 'Artifact:Producer.Data': { Field: 0 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when value is empty string and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Field', exists: true };
      const context = createContext({ 'Artifact:Producer.Data': { Field: '' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when value is false and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Field', exists: true };
      const context = createContext({ 'Artifact:Producer.Data': { Field: false } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value is null and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Field', exists: true };
      const context = createContext({ 'Artifact:Producer.Data': { Field: null } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('does not exist');
    });

    it('fails when value is undefined and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Field', exists: true };
      const context = createContext({ 'Artifact:Producer.Data': { Field: undefined } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('fails when field is missing and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Missing', exists: true };
      const context = createContext({ 'Artifact:Producer.Data': { Other: 'value' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('satisfies when value is undefined and exists: false', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Field', exists: false };
      const context = createContext({ 'Artifact:Producer.Data': { Field: undefined } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when value is null and exists: false', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Field', exists: false };
      const context = createContext({ 'Artifact:Producer.Data': { Field: null } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value exists and exists: false', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Field', exists: false };
      const context = createContext({ 'Artifact:Producer.Data': { Field: 'value' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('exists but should not');
    });
  });

  describe('matches operator', () => {
    it('satisfies when value matches regex pattern', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Email', matches: '^[a-z]+@[a-z]+\\.[a-z]+$' };
      const context = createContext({ 'Artifact:Producer.Data': { Email: 'test@example.com' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value does not match regex pattern', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Email', matches: '^[a-z]+@[a-z]+\\.[a-z]+$' };
      const context = createContext({ 'Artifact:Producer.Data': { Email: 'invalid-email' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('does not match');
    });

    it('throws when regex is invalid', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Value', matches: '[invalid(' };
      const context = createContext({ 'Artifact:Producer.Data': { Value: 'test' } });
      expect(() => evaluateCondition(condition, {}, context)).toThrow('Invalid regex pattern');
    });

    it('fails when value is not a string', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Value', matches: '.*' };
      const context = createContext({ 'Artifact:Producer.Data': { Value: 123 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('requires string values');
    });

    it('handles special regex characters', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Path', matches: '^\\/api\\/v[0-9]+$' };
      const context = createContext({ 'Artifact:Producer.Data': { Path: '/api/v1' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });
  });

  describe('path resolution with dimensions', () => {
    it('resolves path with single dimension', () => {
      const condition: EdgeConditionClause = { when: 'Script.Output.Segments[segment].Type', is: 'video' };
      const context = createContext({
        'Artifact:Script.Output': { Segments: [{}, {}, { Type: 'video' }] },
      });
      const result = evaluateCondition(condition, { segment: 2 }, context);
      expect(result.satisfied).toBe(true);
    });

    it('resolves path with multiple dimensions', () => {
      const condition: EdgeConditionClause = { when: 'Script.Output.Segments[segment].Images[image].Alt', is: 'desc' };
      const context = createContext({
        'Artifact:Script.Output': {
          Segments: [
            { Images: [] },
            { Images: [{}, {}, {}, { Alt: 'desc' }] }, // segment 1, image 3
          ],
        },
      });
      const result = evaluateCondition(condition, { segment: 1, image: 3 }, context);
      expect(result.satisfied).toBe(true);
    });

    it('resolves path with qualified dimension symbols', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Output.Items[item].Value', is: 42 };
      const context = createContext({
        'Artifact:Producer.Output': { Items: [{ Value: 42 }] },
      });
      const result = evaluateCondition(condition, { 'loop:item': 0 }, context);
      expect(result.satisfied).toBe(true);
    });

    it('returns not satisfied when artifact not found', () => {
      const condition: EdgeConditionClause = { when: 'Missing.Path', is: 'value' };
      const context = createContext({});
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  describe('nested field access', () => {
    it('accesses single level field', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data.Field', is: 'value' };
      const context = createContext({ 'Artifact:Producer.Data': { Field: 'value' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('accesses deeply nested field', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Output.A.B.C.D', is: 'deep' };
      const context = createContext({
        'Artifact:Producer.Output': { A: { B: { C: { D: 'deep' } } } },
      });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('returns undefined for missing nested field', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Output.A.B.Missing', exists: true };
      const context = createContext({
        'Artifact:Producer.Output': { A: { B: { C: 'value' } } },
      });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('handles null in path gracefully', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Output.A.B.C', exists: true };
      const context = createContext({
        'Artifact:Producer.Output': { A: { B: null } },
      });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });
  });

  describe('condition groups', () => {
    describe('all (AND)', () => {
      it('satisfies when all conditions pass', () => {
        const condition: EdgeConditionGroup = {
          all: [
            { when: 'Producer.Data.Type', is: 'image' },
            { when: 'Producer.Data.Count', greaterThan: 0 },
          ],
        };
        const context = createContext({
          'Artifact:Producer.Data': { Type: 'image', Count: 5 },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(true);
      });

      it('fails when first condition fails', () => {
        const condition: EdgeConditionGroup = {
          all: [
            { when: 'Producer.Data.Type', is: 'video' },
            { when: 'Producer.Data.Count', greaterThan: 0 },
          ],
        };
        const context = createContext({
          'Artifact:Producer.Data': { Type: 'image', Count: 5 },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(false);
      });

      it('fails when last condition fails', () => {
        const condition: EdgeConditionGroup = {
          all: [
            { when: 'Producer.Data.Type', is: 'image' },
            { when: 'Producer.Data.Count', greaterThan: 10 },
          ],
        };
        const context = createContext({
          'Artifact:Producer.Data': { Type: 'image', Count: 5 },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(false);
      });

      it('satisfies when all array is empty', () => {
        const condition: EdgeConditionGroup = { all: [] };
        const context = createContext({});
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(true);
      });
    });

    describe('any (OR)', () => {
      it('satisfies when first condition passes', () => {
        const condition: EdgeConditionGroup = {
          any: [
            { when: 'Producer.Data.Type', is: 'image' },
            { when: 'Producer.Data.Type', is: 'video' },
          ],
        };
        const context = createContext({
          'Artifact:Producer.Data': { Type: 'image' },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(true);
      });

      it('satisfies when last condition passes', () => {
        const condition: EdgeConditionGroup = {
          any: [
            { when: 'Producer.Data.Type', is: 'audio' },
            { when: 'Producer.Data.Type', is: 'image' },
          ],
        };
        const context = createContext({
          'Artifact:Producer.Data': { Type: 'image' },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(true);
      });

      it('fails when no conditions pass', () => {
        const condition: EdgeConditionGroup = {
          any: [
            { when: 'Producer.Data.Type', is: 'audio' },
            { when: 'Producer.Data.Type', is: 'video' },
          ],
        };
        const context = createContext({
          'Artifact:Producer.Data': { Type: 'image' },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(false);
        expect(result.reason).toContain("No 'any' conditions satisfied");
      });

      it('satisfies when any array is empty with no all', () => {
        const condition: EdgeConditionGroup = { any: [] };
        const context = createContext({});
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(true);
      });
    });

    describe('mixed all and any', () => {
      it('satisfies when both all and any conditions pass', () => {
        const condition: EdgeConditionGroup = {
          all: [{ when: 'Producer.Data.Enabled', is: true }],
          any: [
            { when: 'Producer.Data.Type', is: 'image' },
            { when: 'Producer.Data.Type', is: 'video' },
          ],
        };
        const context = createContext({
          'Artifact:Producer.Data': { Enabled: true, Type: 'image' },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(true);
      });

      it('fails when all fails even if any passes', () => {
        const condition: EdgeConditionGroup = {
          all: [{ when: 'Producer.Data.Enabled', is: true }],
          any: [{ when: 'Producer.Data.Type', is: 'image' }],
        };
        const context = createContext({
          'Artifact:Producer.Data': { Enabled: false, Type: 'image' },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(false);
      });
    });
  });

  describe('array of conditions (implicit AND)', () => {
    it('satisfies when all conditions in array pass', () => {
      const conditions: EdgeConditionClause[] = [
        { when: 'Producer.Data.Type', is: 'image' },
        { when: 'Producer.Data.Count', greaterThan: 0 },
      ];
      const context = createContext({
        'Artifact:Producer.Data': { Type: 'image', Count: 5 },
      });
      const result = evaluateCondition(conditions, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when any condition in array fails', () => {
      const conditions: EdgeConditionClause[] = [
        { when: 'Producer.Data.Type', is: 'image' },
        { when: 'Producer.Data.Count', greaterThan: 10 },
      ];
      const context = createContext({
        'Artifact:Producer.Data': { Type: 'image', Count: 5 },
      });
      const result = evaluateCondition(conditions, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('satisfies when array is empty', () => {
      const conditions: EdgeConditionClause[] = [];
      const context = createContext({});
      const result = evaluateCondition(conditions, {}, context);
      expect(result.satisfied).toBe(true);
    });
  });

  describe('multiple operators on single clause', () => {
    it('satisfies when all operators pass (range check)', () => {
      const condition: EdgeConditionClause = {
        when: 'Producer.Data.Value',
        greaterThan: 0,
        lessThan: 100,
      };
      const context = createContext({
        'Artifact:Producer.Data': { Value: 50 },
      });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when one operator fails', () => {
      const condition: EdgeConditionClause = {
        when: 'Producer.Data.Value',
        greaterThan: 0,
        lessThan: 100,
      };
      const context = createContext({
        'Artifact:Producer.Data': { Value: 150 },
      });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('is not <');
    });

    it('satisfies with greaterOrEqual and lessOrEqual (inclusive range)', () => {
      const condition: EdgeConditionClause = {
        when: 'Producer.Data.Value',
        greaterOrEqual: 0,
        lessOrEqual: 100,
      };
      const context = createContext({
        'Artifact:Producer.Data': { Value: 0 },
      });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });
  });
});

describe('decomposed artifacts', () => {
  // Decomposed artifacts store each field as a separate blob with the full path as artifact ID
  // e.g., "Artifact:Producer.Output.Field[0].SubField" instead of
  // "Artifact:Producer.Output" with nested { Field: [{ SubField: value }] }

  it('finds value from decomposed artifact (full path as artifact ID)', () => {
    const condition: EdgeConditionClause = { when: 'Producer.Output.HasFeature', is: true };
    // Decomposed: the full path is the artifact ID, value is directly stored (as string from blob)
    const context = createContext({
      'Artifact:Producer.Output.HasFeature': 'true', // blob content is string "true"
    });
    const result = evaluateCondition(condition, {}, context);
    expect(result.satisfied).toBe(true);
  });

  it('finds value from decomposed artifact with array index', () => {
    const condition: EdgeConditionClause = { when: 'Producer.Output.Characters[char].HasTransition', is: true };
    // Decomposed: includes array index in artifact ID
    const context = createContext({
      'Artifact:Producer.Output.Characters[1].HasTransition': 'true',
    });
    const result = evaluateCondition(condition, { char: 1 }, context);
    expect(result.satisfied).toBe(true);
  });

  it('correctly evaluates false boolean in decomposed artifact', () => {
    const condition: EdgeConditionClause = { when: 'Producer.Output.Characters[char].HasTransition', is: true };
    const context = createContext({
      'Artifact:Producer.Output.Characters[0].HasTransition': 'false',
    });
    const result = evaluateCondition(condition, { char: 0 }, context);
    expect(result.satisfied).toBe(false);
  });

  it('prefers decomposed artifact over nested artifact when both exist', () => {
    const condition: EdgeConditionClause = { when: 'Producer.Output.Field', is: 'decomposed' };
    const context = createContext({
      // Both exist - decomposed should win
      'Artifact:Producer.Output.Field': 'decomposed',
      'Artifact:Producer.Output': { Field: 'nested' },
    });
    const result = evaluateCondition(condition, {}, context);
    expect(result.satisfied).toBe(true);
  });

  it('falls back to nested artifact when decomposed not found', () => {
    const condition: EdgeConditionClause = { when: 'Producer.Output.Field', is: 'nested' };
    const context = createContext({
      // Only nested exists
      'Artifact:Producer.Output': { Field: 'nested' },
    });
    const result = evaluateCondition(condition, {}, context);
    expect(result.satisfied).toBe(true);
  });

  it('handles deeply nested decomposed artifact path', () => {
    const condition: EdgeConditionClause = {
      when: 'Script.Output.Segments[seg].Parts[part].Type',
      is: 'video',
    };
    const context = createContext({
      'Artifact:Script.Output.Segments[1].Parts[2].Type': 'video',
    });
    const result = evaluateCondition(condition, { seg: 1, part: 2 }, context);
    expect(result.satisfied).toBe(true);
  });

  it('handles enum values in decomposed artifacts', () => {
    const condition: EdgeConditionClause = { when: 'Producer.Output.NarrationType', is: 'Voiceover' };
    const context = createContext({
      'Artifact:Producer.Output.NarrationType': 'Voiceover',
    });
    const result = evaluateCondition(condition, {}, context);
    expect(result.satisfied).toBe(true);
  });

  it('handles numeric values in decomposed artifacts with coercion', () => {
    const condition: EdgeConditionClause = { when: 'Producer.Stats.Count', greaterThan: 10 };
    const context = createContext({
      'Artifact:Producer.Stats.Count': '42', // stored as string in blob
    });
    const result = evaluateCondition(condition, {}, context);
    expect(result.satisfied).toBe(true);
  });
});

describe('evaluateInputConditions', () => {
  it('returns empty map when inputConditions is undefined', () => {
    const context = createContext({});
    const result = evaluateInputConditions(undefined, context);
    expect(result.size).toBe(0);
  });

  it('returns empty map when inputConditions is empty', () => {
    const context = createContext({});
    const result = evaluateInputConditions({}, context);
    expect(result.size).toBe(0);
  });

  it('evaluates single input condition', () => {
    const inputConditions: Record<string, InputConditionInfo> = {
      'Artifact:Script.Segments[0]': {
        condition: { when: 'Producer.Data.Type', is: 'image' },
        indices: {},
      },
    };
    const context = createContext({
      'Artifact:Producer.Data': { Type: 'image' },
    });
    const result = evaluateInputConditions(inputConditions, context);
    expect(result.size).toBe(1);
    expect(result.get('Artifact:Script.Segments[0]')?.satisfied).toBe(true);
  });

  it('evaluates multiple input conditions with mixed results', () => {
    const inputConditions: Record<string, InputConditionInfo> = {
      input1: {
        condition: { when: 'Producer.Data.Type', is: 'image' },
        indices: {},
      },
      input2: {
        condition: { when: 'Producer.Data.Type', is: 'video' },
        indices: {},
      },
    };
    const context = createContext({
      'Artifact:Producer.Data': { Type: 'image' },
    });
    const result = evaluateInputConditions(inputConditions, context);
    expect(result.size).toBe(2);
    expect(result.get('input1')?.satisfied).toBe(true);
    expect(result.get('input2')?.satisfied).toBe(false);
  });

  it('passes indices to condition evaluation', () => {
    const inputConditions: Record<string, InputConditionInfo> = {
      'Artifact:Items[0]': {
        condition: { when: 'Script.Segments.Items[idx].Type', is: 'audio' },
        indices: { idx: 2 },
      },
    };
    const context = createContext({
      'Artifact:Script.Segments': { Items: [{ Type: 'video' }, { Type: 'video' }, { Type: 'audio' }] },
    });
    const result = evaluateInputConditions(inputConditions, context);
    expect(result.get('Artifact:Items[0]')?.satisfied).toBe(true);
  });

  it('handles missing artifact gracefully', () => {
    const inputConditions: Record<string, InputConditionInfo> = {
      input1: {
        condition: { when: 'Missing.Field', is: 'value' },
        indices: {},
      },
    };
    const context = createContext({});
    const result = evaluateInputConditions(inputConditions, context);
    expect(result.get('input1')?.satisfied).toBe(false);
    expect(result.get('input1')?.reason).toContain('not found');
  });

  it('uses target node index when source and target have different indices for same dimension', () => {
    // This simulates an edge like: ThenImageProducer[character+1] -> TransitionVideoProducer[character]
    // where the source has character=2 and target has character=1.
    // The condition checks Characters[character].HasTransition which should use character=1.
    const inputConditions: Record<string, InputConditionInfo> = {
      'Artifact:ThenImageProducer.TransformedImage[2]': {
        condition: {
          when: 'DirectorProducer.Script.Characters[character].HasTransition',
          is: true,
        },
        // Indices are merged as { ...fromNode.indices, ...toNode.indices }
        // Source (ThenImageProducer) has character=2, target (TransitionVideoProducer) has character=1
        indices: {
          'ThenImageProducer.TransformedImage::ns:ThenImageProducer:0:character': 2,
          'TransitionVideoProducer.EndImage::ns:TransitionVideoProducer:0:character': 1,
        },
      },
    };
    const context = createContext({
      // HasTransition[1] is false, HasTransition[2] is true
      'Artifact:DirectorProducer.Script.Characters[1].HasTransition': 'false',
      'Artifact:DirectorProducer.Script.Characters[2].HasTransition': 'true',
    });
    const result = evaluateInputConditions(inputConditions, context);
    // The condition should use character=1 (target), so HasTransition[1] = false
    // Therefore the condition `is: true` should NOT be satisfied
    expect(result.get('Artifact:ThenImageProducer.TransformedImage[2]')?.satisfied).toBe(false);
  });

  it('uses last dimension value when indices have multiple entries with same label', () => {
    // When multiple entries have the same dimension label, the last one (target) should win
    const inputConditions: Record<string, InputConditionInfo> = {
      input1: {
        condition: {
          when: 'Producer.Data.Items[idx].Enabled',
          is: true,
        },
        indices: {
          'Source.Field::scope:idx': 5, // Source has idx=5
          'Target.Field::scope:idx': 2, // Target has idx=2 (should win)
        },
      },
    };
    const context = createContext({
      'Artifact:Producer.Data.Items[2].Enabled': true, // idx=2 has Enabled=true
      'Artifact:Producer.Data.Items[5].Enabled': false, // idx=5 has Enabled=false
    });
    const result = evaluateInputConditions(inputConditions, context);
    // Should use idx=2 (last entry), which has Enabled=true
    expect(result.get('input1')?.satisfied).toBe(true);
  });
});
