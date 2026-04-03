import { describe, expect, it, vi } from 'vitest';
import { runReplicateWithRetries } from './retry.js';

describe('runReplicateWithRetries', () => {
  it('retries on 429 and logs retry delays', async () => {
    vi.useFakeTimers();
    const run = vi
      .fn()
      .mockRejectedValueOnce({
        status: 429,
        body: { retry_after: 1 },
        message: '429 Too Many Requests',
      })
      .mockRejectedValueOnce({
        status: 429,
        body: { retry_after: 1 },
        message: '429 Too Many Requests',
      })
      .mockResolvedValue('ok');

    const logger = { info: vi.fn(), debug: vi.fn() } as any;
    try {
      const promise = runReplicateWithRetries({
        replicate: { run },
        modelIdentifier: 'owner/model:version',
        input: { foo: 'bar' },
        logger,
        jobId: 'job-1',
        model: 'owner/model',
        plannerContext: {},
        maxAttempts: 3,
        defaultRetryMs: 500,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('ok');
      expect(run).toHaveBeenCalledTimes(3);

      const retryLogs = logger.debug.mock.calls.filter(
        ([event]: [string]) => event === 'providers.replicate.retry',
      );
      expect(retryLogs).toHaveLength(2);
      expect(retryLogs[0][1].retryAfterMs).toBe(2000);
      expect(retryLogs[1][1].retryAfterMs).toBe(2000);

      const waitedLogs = logger.debug.mock.calls.filter(
        ([event]: [string]) => event === 'providers.replicate.retry.waited',
      );
      expect(waitedLogs).toHaveLength(2);
      expect(waitedLogs[0][1].waitedMs).toBeGreaterThanOrEqual(2000);
      expect(waitedLogs[1][1].waitedMs).toBeGreaterThanOrEqual(2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after max attempts and throws a rate-limit error', async () => {
    const run = vi.fn().mockRejectedValue({
      status: 429,
      body: { retry_after: 0 },
      message: '429 Too Many Requests',
    });
    await expect(
      runReplicateWithRetries({
        replicate: { run },
        modelIdentifier: 'owner/model',
        input: {},
        logger: { warn: vi.fn(), info: vi.fn() } as any,
        jobId: 'job-2',
        model: 'owner/model',
        plannerContext: {},
        maxAttempts: 2,
        defaultRetryMs: 10,
      }),
    ).rejects.toThrow(/replicate rate limit/i);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-429 errors', async () => {
    const run = vi.fn().mockRejectedValue({ status: 400, message: 'bad request' });
    await expect(
      runReplicateWithRetries({
        replicate: { run },
        modelIdentifier: 'owner/model',
        input: {},
        logger: { warn: vi.fn(), info: vi.fn() } as any,
        jobId: 'job-3',
        model: 'owner/model',
        plannerContext: {},
      }),
    ).rejects.toThrow(/bad request/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries transient 5xx failures and succeeds', async () => {
    vi.useFakeTimers();
    const run = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, message: 'service unavailable' })
      .mockResolvedValueOnce('ok');

    try {
      const promise = runReplicateWithRetries({
        replicate: { run },
        modelIdentifier: 'owner/model',
        input: {},
        logger: { info: vi.fn(), debug: vi.fn() } as any,
        jobId: 'job-4',
        model: 'owner/model',
        plannerContext: {},
        maxAttempts: 2,
        defaultRetryMs: 10,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('ok');
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses Retry-After header when present', async () => {
    vi.useFakeTimers();
    const run = vi
      .fn()
      .mockRejectedValueOnce({
        status: 429,
        headers: { 'retry-after': '2' },
        message: 'Too Many Requests',
      })
      .mockResolvedValueOnce('ok');
    const logger = { info: vi.fn(), debug: vi.fn() } as any;

    try {
      const promise = runReplicateWithRetries({
        replicate: { run },
        modelIdentifier: 'owner/model',
        input: {},
        logger,
        jobId: 'job-5',
        model: 'owner/model',
        plannerContext: {},
        maxAttempts: 2,
        defaultRetryMs: 10,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('ok');
      expect(run).toHaveBeenCalledTimes(2);
      const retryLog = logger.debug.mock.calls.find(
        ([event]: [string]) => event === 'providers.replicate.retry'
      );
      expect(retryLog?.[1].retryAfterMs).toBe(3000);
    } finally {
      vi.useRealTimers();
    }
  });
});
