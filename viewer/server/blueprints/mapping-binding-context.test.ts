import { describe, expect, it } from 'vitest';
import {
  buildProducerBindingSummary,
  collectProducerBindingEntries,
} from './mapping-binding-context.js';

describe('mapping-binding-context', () => {
  it('re-exports binding helpers from core', () => {
    expect(typeof collectProducerBindingEntries).toBe('function');
    expect(typeof buildProducerBindingSummary).toBe('function');
  });
});
