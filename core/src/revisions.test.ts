import { describe, expect, it } from 'vitest';
import {
  compareRevisionIds,
  latestRevisionId,
  nextRevisionId,
} from './revisions.js';

describe('compareRevisionIds', () => {
  it('compares revision suffixes numerically', () => {
    expect(compareRevisionIds('rev-9999', 'rev-10000')).toBeLessThan(0);
    expect(compareRevisionIds('rev-10000', 'rev-9999')).toBeGreaterThan(0);
    expect(compareRevisionIds('rev-10000', 'rev-10000')).toBe(0);
  });
});

describe('latestRevisionId', () => {
  it('returns the numerically latest revision', () => {
    expect(latestRevisionId('rev-9999', 'rev-10000')).toBe('rev-10000');
    expect(latestRevisionId('rev-10000', 'rev-9999')).toBe('rev-10000');
  });

  it('handles missing revisions', () => {
    expect(latestRevisionId(null, 'rev-0002')).toBe('rev-0002');
    expect(latestRevisionId('rev-0002', undefined)).toBe('rev-0002');
  });
});

describe('nextRevisionId', () => {
  it('increments numeric revision suffix', () => {
    expect(nextRevisionId('rev-0001')).toBe('rev-0002');
    expect(nextRevisionId('rev-0099')).toBe('rev-0100');
  });

  it('defaults to rev-0001 when current is nullish', () => {
    expect(nextRevisionId(null)).toBe('rev-0001');
    expect(nextRevisionId(undefined)).toBe('rev-0001');
  });

  it('handles malformed revision ids gracefully', () => {
    expect(nextRevisionId('rev-alpha' as unknown as `rev-${string}`)).toBe('rev-0001');
  });
});
