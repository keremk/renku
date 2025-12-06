import { describe, expect, it, vi } from 'vitest';
import { runReplicateWithRetries } from '../../src/sdk/replicate/retry.js';

describe('integration: replicate retries', () => {
  it('waits at least retry_after + 1 second between attempts', async () => {
    const callTimes: number[] = [];
    const run = vi
      .fn()
      .mockImplementation(() => {
        callTimes.push(Date.now());
        if (callTimes.length < 3) {
          return Promise.reject({
            status: 429,
            body: { retry_after: 1 },
            message: '429 Too Many Requests',
          });
        }
        return Promise.resolve('ok');
      });

    const result = await runReplicateWithRetries({
      replicate: { run },
      modelIdentifier: 'owner/model:version',
      input: { foo: 'bar' },
      logger: { info: vi.fn(), debug: vi.fn() } as any,
      jobId: 'job-retry',
      model: 'owner/model',
      plannerContext: {},
      maxAttempts: 3,
      defaultRetryMs: 500,
    });

    expect(result).toBe('ok');
    expect(callTimes).toHaveLength(3);

    const firstGap = callTimes[1] - callTimes[0];
    const secondGap = callTimes[2] - callTimes[1];
    expect(firstGap).toBeGreaterThanOrEqual(1900);
    expect(secondGap).toBeGreaterThanOrEqual(1900);
  });
});
