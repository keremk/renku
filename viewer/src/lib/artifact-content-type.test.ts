import { describe, it, expect } from 'vitest';
import {
  inferDisplayType,
  parseBooleanContent,
} from './artifact-content-type';

describe('inferDisplayType', () => {
  it('returns boolean for "true"', () => {
    expect(inferDisplayType('true')).toBe('boolean');
  });

  it('returns boolean for "false"', () => {
    expect(inferDisplayType('false')).toBe('boolean');
  });

  it('returns boolean for whitespace-padded "true"', () => {
    expect(inferDisplayType('  true  ')).toBe('boolean');
  });

  it('returns boolean for whitespace-padded "false"', () => {
    expect(inferDisplayType('\nfalse\n')).toBe('boolean');
  });

  it('returns compact for short single-line text', () => {
    expect(inferDisplayType('mysterious')).toBe('compact');
  });

  it('returns compact for empty string', () => {
    expect(inferDisplayType('')).toBe('compact');
  });

  it('returns compact for short phrase under word limit', () => {
    expect(inferDisplayType('A short phrase')).toBe('compact');
  });

  it('returns text for multi-word sentence under 100 chars', () => {
    expect(inferDisplayType('The crystal is gone. Only shadows remain.')).toBe('text');
  });

  it('returns text for content with newlines even if short', () => {
    expect(inferDisplayType('line1\nline2')).toBe('text');
  });

  it('returns text for long single-line content', () => {
    const long = 'x'.repeat(100);
    expect(inferDisplayType(long)).toBe('text');
  });

  it('returns text for multi-paragraph content', () => {
    const content = 'A nimble fourteen-year-old fox girl with orange fur and bright amber eyes, wearing a tattered green tunic.\n\nShe carries a small crystal pendant.';
    expect(inferDisplayType(content)).toBe('text');
  });

  it('does not treat "TRUE" as boolean (case-sensitive)', () => {
    expect(inferDisplayType('TRUE')).toBe('compact');
  });

  it('does not treat "True" as boolean (case-sensitive)', () => {
    expect(inferDisplayType('True')).toBe('compact');
  });

  it('returns compact for a number string', () => {
    expect(inferDisplayType('42')).toBe('compact');
  });

  it('returns compact for text at exactly 99 chars', () => {
    expect(inferDisplayType('x'.repeat(99))).toBe('compact');
  });
});

describe('parseBooleanContent', () => {
  it('parses "true" to true', () => {
    expect(parseBooleanContent('true')).toBe(true);
  });

  it('parses "false" to false', () => {
    expect(parseBooleanContent('false')).toBe(false);
  });

  it('parses whitespace-padded "true"', () => {
    expect(parseBooleanContent('  true  ')).toBe(true);
  });

  it('parses whitespace-padded "false"', () => {
    expect(parseBooleanContent('  false\n')).toBe(false);
  });
});
