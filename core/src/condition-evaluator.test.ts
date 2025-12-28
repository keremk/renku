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

describe('evaluateCondition', () => {
  describe('is operator', () => {
    it('satisfies when string values are equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Output', is: 'value' };
      const context = createContext({ 'Artifact:Producer': { Output: 'value' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when number values are equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Count', is: 42 };
      const context = createContext({ 'Artifact:Producer': { Count: 42 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when boolean values are equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Enabled', is: true };
      const context = createContext({ 'Artifact:Producer': { Enabled: true } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when object values are deeply equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Data', is: { a: 1, b: 2 } };
      const context = createContext({ 'Artifact:Producer': { Data: { a: 1, b: 2 } } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when array values are deeply equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Items', is: [1, 2, 3] };
      const context = createContext({ 'Artifact:Producer': { Items: [1, 2, 3] } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when both values are null', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Value', is: null };
      const context = createContext({ 'Artifact:Producer': { Value: null } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when values differ', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Output', is: 'expected' };
      const context = createContext({ 'Artifact:Producer': { Output: 'actual' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('!==');
    });

    it('fails when types differ', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Value', is: '5' };
      const context = createContext({ 'Artifact:Producer': { Value: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });
  });

  describe('isNot operator', () => {
    it('satisfies when values differ', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Type', isNot: 'video' };
      const context = createContext({ 'Artifact:Producer': { Type: 'audio' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when values are equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Type', isNot: 'video' };
      const context = createContext({ 'Artifact:Producer': { Type: 'video' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('===');
    });

    it('satisfies when types differ', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Value', isNot: '5' };
      const context = createContext({ 'Artifact:Producer': { Value: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });
  });

  describe('contains operator', () => {
    it('satisfies when string contains substring', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Text', contains: 'hello' };
      const context = createContext({ 'Artifact:Producer': { Text: 'say hello world' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when string does not contain substring', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Text', contains: 'goodbye' };
      const context = createContext({ 'Artifact:Producer': { Text: 'say hello world' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('does not contain');
    });

    it('satisfies when array contains primitive element', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Tags', contains: 'important' };
      const context = createContext({ 'Artifact:Producer': { Tags: ['urgent', 'important', 'new'] } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when array contains object element (deep equality)', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Items', contains: { id: 2 } };
      const context = createContext({ 'Artifact:Producer': { Items: [{ id: 1 }, { id: 2 }, { id: 3 }] } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when array does not contain element', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Tags', contains: 'missing' };
      const context = createContext({ 'Artifact:Producer': { Tags: ['a', 'b', 'c'] } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('handles empty string contains check', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Text', contains: '' };
      const context = createContext({ 'Artifact:Producer': { Text: 'anything' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('handles empty array contains check', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Items', contains: 'x' };
      const context = createContext({ 'Artifact:Producer': { Items: [] } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });
  });

  describe('greaterThan operator', () => {
    it('satisfies when value is greater', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Count', greaterThan: 5 };
      const context = createContext({ 'Artifact:Producer': { Count: 10 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value is equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Count', greaterThan: 5 };
      const context = createContext({ 'Artifact:Producer': { Count: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('is not >');
    });

    it('fails when value is less', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Count', greaterThan: 5 };
      const context = createContext({ 'Artifact:Producer': { Count: 3 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('works with float values', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Score', greaterThan: 3.14 };
      const context = createContext({ 'Artifact:Producer': { Score: 3.15 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('works with negative numbers', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Offset', greaterThan: -10 };
      const context = createContext({ 'Artifact:Producer': { Offset: -5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value is not a number', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Value', greaterThan: 5 };
      const context = createContext({ 'Artifact:Producer': { Value: 'ten' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('requires numeric values');
    });
  });

  describe('lessThan operator', () => {
    it('satisfies when value is less', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Count', lessThan: 10 };
      const context = createContext({ 'Artifact:Producer': { Count: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value is equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Count', lessThan: 5 };
      const context = createContext({ 'Artifact:Producer': { Count: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('is not <');
    });

    it('fails when value is greater', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Count', lessThan: 5 };
      const context = createContext({ 'Artifact:Producer': { Count: 10 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('fails when value is not a number', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Value', lessThan: 5 };
      const context = createContext({ 'Artifact:Producer': { Value: null } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('requires numeric values');
    });
  });

  describe('greaterOrEqual operator', () => {
    it('satisfies when value is greater', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Count', greaterOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer': { Count: 10 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when value is equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Count', greaterOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer': { Count: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value is less', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Count', greaterOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer': { Count: 3 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('is not >=');
    });

    it('fails when value is not a number', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Value', greaterOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer': { Value: undefined } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('requires numeric values');
    });
  });

  describe('lessOrEqual operator', () => {
    it('satisfies when value is less', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Count', lessOrEqual: 10 };
      const context = createContext({ 'Artifact:Producer': { Count: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when value is equal', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Count', lessOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer': { Count: 5 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value is greater', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Count', lessOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer': { Count: 10 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('is not <=');
    });

    it('fails when value is not a number', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Value', lessOrEqual: 5 };
      const context = createContext({ 'Artifact:Producer': { Value: [] } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('requires numeric values');
    });
  });

  describe('exists operator', () => {
    it('satisfies when value exists and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Field', exists: true };
      const context = createContext({ 'Artifact:Producer': { Field: 'value' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when value is 0 and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Field', exists: true };
      const context = createContext({ 'Artifact:Producer': { Field: 0 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when value is empty string and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Field', exists: true };
      const context = createContext({ 'Artifact:Producer': { Field: '' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when value is false and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Field', exists: true };
      const context = createContext({ 'Artifact:Producer': { Field: false } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value is null and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Field', exists: true };
      const context = createContext({ 'Artifact:Producer': { Field: null } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('does not exist');
    });

    it('fails when value is undefined and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Field', exists: true };
      const context = createContext({ 'Artifact:Producer': { Field: undefined } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('fails when field is missing and exists: true', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Missing', exists: true };
      const context = createContext({ 'Artifact:Producer': { Other: 'value' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('satisfies when value is undefined and exists: false', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Field', exists: false };
      const context = createContext({ 'Artifact:Producer': { Field: undefined } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('satisfies when value is null and exists: false', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Field', exists: false };
      const context = createContext({ 'Artifact:Producer': { Field: null } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value exists and exists: false', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Field', exists: false };
      const context = createContext({ 'Artifact:Producer': { Field: 'value' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('exists but should not');
    });
  });

  describe('matches operator', () => {
    it('satisfies when value matches regex pattern', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Email', matches: '^[a-z]+@[a-z]+\\.[a-z]+$' };
      const context = createContext({ 'Artifact:Producer': { Email: 'test@example.com' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when value does not match regex pattern', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Email', matches: '^[a-z]+@[a-z]+\\.[a-z]+$' };
      const context = createContext({ 'Artifact:Producer': { Email: 'invalid-email' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('does not match');
    });

    it('fails when regex is invalid', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Value', matches: '[invalid(' };
      const context = createContext({ 'Artifact:Producer': { Value: 'test' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('Invalid regex');
    });

    it('fails when value is not a string', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Value', matches: '.*' };
      const context = createContext({ 'Artifact:Producer': { Value: 123 } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('requires string values');
    });

    it('handles special regex characters', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Path', matches: '^\\/api\\/v[0-9]+$' };
      const context = createContext({ 'Artifact:Producer': { Path: '/api/v1' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });
  });

  describe('path resolution with dimensions', () => {
    it('resolves path with single dimension', () => {
      const condition: EdgeConditionClause = { when: 'Script.Segments[segment].Type', is: 'video' };
      const context = createContext({
        'Artifact:Script.Segments[2]': { Type: 'video' },
      });
      const result = evaluateCondition(condition, { segment: 2 }, context);
      expect(result.satisfied).toBe(true);
    });

    it('resolves path with multiple dimensions', () => {
      const condition: EdgeConditionClause = { when: 'Script.Segments[segment].Images[image].Alt', is: 'desc' };
      const context = createContext({
        'Artifact:Script.Segments[1].Images[3]': { Alt: 'desc' },
      });
      const result = evaluateCondition(condition, { segment: 1, image: 3 }, context);
      expect(result.satisfied).toBe(true);
    });

    it('resolves path with qualified dimension symbols', () => {
      const condition: EdgeConditionClause = { when: 'Producer.Items[item].Value', is: 42 };
      const context = createContext({
        'Artifact:Producer.Items[0]': { Value: 42 },
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
      const condition: EdgeConditionClause = { when: 'Producer.Field', is: 'value' };
      const context = createContext({ 'Artifact:Producer': { Field: 'value' } });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('accesses deeply nested field', () => {
      const condition: EdgeConditionClause = { when: 'Producer.A.B.C.D', is: 'deep' };
      const context = createContext({
        'Artifact:Producer': { A: { B: { C: { D: 'deep' } } } },
      });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('returns undefined for missing nested field', () => {
      const condition: EdgeConditionClause = { when: 'Producer.A.B.Missing', exists: true };
      const context = createContext({
        'Artifact:Producer': { A: { B: { C: 'value' } } },
      });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
    });

    it('handles null in path gracefully', () => {
      const condition: EdgeConditionClause = { when: 'Producer.A.B.C', exists: true };
      const context = createContext({
        'Artifact:Producer': { A: { B: null } },
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
            { when: 'Producer.Type', is: 'image' },
            { when: 'Producer.Count', greaterThan: 0 },
          ],
        };
        const context = createContext({
          'Artifact:Producer': { Type: 'image', Count: 5 },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(true);
      });

      it('fails when first condition fails', () => {
        const condition: EdgeConditionGroup = {
          all: [
            { when: 'Producer.Type', is: 'video' },
            { when: 'Producer.Count', greaterThan: 0 },
          ],
        };
        const context = createContext({
          'Artifact:Producer': { Type: 'image', Count: 5 },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(false);
      });

      it('fails when last condition fails', () => {
        const condition: EdgeConditionGroup = {
          all: [
            { when: 'Producer.Type', is: 'image' },
            { when: 'Producer.Count', greaterThan: 10 },
          ],
        };
        const context = createContext({
          'Artifact:Producer': { Type: 'image', Count: 5 },
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
            { when: 'Producer.Type', is: 'image' },
            { when: 'Producer.Type', is: 'video' },
          ],
        };
        const context = createContext({
          'Artifact:Producer': { Type: 'image' },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(true);
      });

      it('satisfies when last condition passes', () => {
        const condition: EdgeConditionGroup = {
          any: [
            { when: 'Producer.Type', is: 'audio' },
            { when: 'Producer.Type', is: 'image' },
          ],
        };
        const context = createContext({
          'Artifact:Producer': { Type: 'image' },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(true);
      });

      it('fails when no conditions pass', () => {
        const condition: EdgeConditionGroup = {
          any: [
            { when: 'Producer.Type', is: 'audio' },
            { when: 'Producer.Type', is: 'video' },
          ],
        };
        const context = createContext({
          'Artifact:Producer': { Type: 'image' },
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
          all: [{ when: 'Producer.Enabled', is: true }],
          any: [
            { when: 'Producer.Type', is: 'image' },
            { when: 'Producer.Type', is: 'video' },
          ],
        };
        const context = createContext({
          'Artifact:Producer': { Enabled: true, Type: 'image' },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(true);
      });

      it('fails when all fails even if any passes', () => {
        const condition: EdgeConditionGroup = {
          all: [{ when: 'Producer.Enabled', is: true }],
          any: [{ when: 'Producer.Type', is: 'image' }],
        };
        const context = createContext({
          'Artifact:Producer': { Enabled: false, Type: 'image' },
        });
        const result = evaluateCondition(condition, {}, context);
        expect(result.satisfied).toBe(false);
      });
    });
  });

  describe('array of conditions (implicit AND)', () => {
    it('satisfies when all conditions in array pass', () => {
      const conditions: EdgeConditionClause[] = [
        { when: 'Producer.Type', is: 'image' },
        { when: 'Producer.Count', greaterThan: 0 },
      ];
      const context = createContext({
        'Artifact:Producer': { Type: 'image', Count: 5 },
      });
      const result = evaluateCondition(conditions, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when any condition in array fails', () => {
      const conditions: EdgeConditionClause[] = [
        { when: 'Producer.Type', is: 'image' },
        { when: 'Producer.Count', greaterThan: 10 },
      ];
      const context = createContext({
        'Artifact:Producer': { Type: 'image', Count: 5 },
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
        when: 'Producer.Value',
        greaterThan: 0,
        lessThan: 100,
      };
      const context = createContext({
        'Artifact:Producer': { Value: 50 },
      });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });

    it('fails when one operator fails', () => {
      const condition: EdgeConditionClause = {
        when: 'Producer.Value',
        greaterThan: 0,
        lessThan: 100,
      };
      const context = createContext({
        'Artifact:Producer': { Value: 150 },
      });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('is not <');
    });

    it('satisfies with greaterOrEqual and lessOrEqual (inclusive range)', () => {
      const condition: EdgeConditionClause = {
        when: 'Producer.Value',
        greaterOrEqual: 0,
        lessOrEqual: 100,
      };
      const context = createContext({
        'Artifact:Producer': { Value: 0 },
      });
      const result = evaluateCondition(condition, {}, context);
      expect(result.satisfied).toBe(true);
    });
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
        condition: { when: 'Producer.Type', is: 'image' },
        indices: {},
      },
    };
    const context = createContext({
      'Artifact:Producer': { Type: 'image' },
    });
    const result = evaluateInputConditions(inputConditions, context);
    expect(result.size).toBe(1);
    expect(result.get('Artifact:Script.Segments[0]')?.satisfied).toBe(true);
  });

  it('evaluates multiple input conditions with mixed results', () => {
    const inputConditions: Record<string, InputConditionInfo> = {
      input1: {
        condition: { when: 'Producer.Type', is: 'image' },
        indices: {},
      },
      input2: {
        condition: { when: 'Producer.Type', is: 'video' },
        indices: {},
      },
    };
    const context = createContext({
      'Artifact:Producer': { Type: 'image' },
    });
    const result = evaluateInputConditions(inputConditions, context);
    expect(result.size).toBe(2);
    expect(result.get('input1')?.satisfied).toBe(true);
    expect(result.get('input2')?.satisfied).toBe(false);
  });

  it('passes indices to condition evaluation', () => {
    const inputConditions: Record<string, InputConditionInfo> = {
      'Artifact:Items[0]': {
        condition: { when: 'Script.Segments[segment].Type', is: 'audio' },
        indices: { segment: 2 },
      },
    };
    const context = createContext({
      'Artifact:Script.Segments[2]': { Type: 'audio' },
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
});
