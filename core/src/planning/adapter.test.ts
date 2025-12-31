import { describe, expect, it } from 'vitest';
import { createPlanAdapter } from './adapter.js';

describe('createPlanAdapter', () => {
  it('creates adapter with default options', () => {
    const adapter = createPlanAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.compute).toBeDefined();
    expect(typeof adapter.compute).toBe('function');
  });

  it('creates adapter with custom options', () => {
    const mockLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    const mockClock = { now: () => '2024-01-01T00:00:00Z' };

    const adapter = createPlanAdapter({
      logger: mockLogger,
      clock: mockClock,
    });

    expect(adapter).toBeDefined();
    expect(adapter.compute).toBeDefined();
  });

  it('creates adapter with partial options', () => {
    const adapter = createPlanAdapter({
      clock: { now: () => '2024-01-01T00:00:00Z' },
    });

    expect(adapter).toBeDefined();
    expect(adapter.compute).toBeDefined();
  });
});
