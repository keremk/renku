import { beforeEach, describe, expect, it } from 'vitest';
import { handleExecuteRequest } from './execute-handler.js';
import { getJobManager, resetJobManager } from './job-manager.js';
import {
  createMockRequest,
  createMockResponse,
  parseResponseJson,
} from './test-utils.js';

describe('handleExecuteRequest', () => {
  beforeEach(() => {
    resetJobManager();
  });

  it('returns 400 when concurrency is not an integer', async () => {
    const req = createMockRequest({ planId: 'plan-test', concurrency: 1.5 });
    const res = createMockResponse();

    const handled = await handleExecuteRequest(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(parseResponseJson<{ error: string }>(res)).toEqual({
      error: 'concurrency must be an integer',
    });
    expect(getJobManager().listJobs()).toHaveLength(0);
  });

  it('returns 400 when concurrency is a string value', async () => {
    const req = createMockRequest({
      planId: 'plan-test',
      concurrency: '2',
    });
    const res = createMockResponse();

    const handled = await handleExecuteRequest(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(parseResponseJson<{ error: string }>(res)).toEqual({
      error: 'concurrency must be an integer',
    });
    expect(getJobManager().listJobs()).toHaveLength(0);
  });
});
