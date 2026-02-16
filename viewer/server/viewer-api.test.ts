import type { IncomingMessage } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockResponse } from './generation/test-utils.js';

const {
  handleBlueprintRequestMock,
  handlePlanRequestMock,
  handleExecuteRequestMock,
  handleJobsListRequestMock,
  handleJobStatusRequestMock,
  handleStreamRequestMock,
  handleCancelRequestMock,
  sendMethodNotAllowedMock,
} = vi.hoisted(() => ({
  handleBlueprintRequestMock: vi.fn(),
  handlePlanRequestMock: vi.fn(),
  handleExecuteRequestMock: vi.fn(),
  handleJobsListRequestMock: vi.fn(),
  handleJobStatusRequestMock: vi.fn(),
  handleStreamRequestMock: vi.fn(),
  handleCancelRequestMock: vi.fn(),
  sendMethodNotAllowedMock: vi.fn(),
}));

vi.mock('./blueprints/index.js', () => ({
  handleBlueprintRequest: handleBlueprintRequestMock,
}));

vi.mock('./generation/index.js', () => ({
  handlePlanRequest: handlePlanRequestMock,
  handleExecuteRequest: handleExecuteRequestMock,
  handleJobsListRequest: handleJobsListRequestMock,
  handleJobStatusRequest: handleJobStatusRequestMock,
  handleStreamRequest: handleStreamRequestMock,
  handleCancelRequest: handleCancelRequestMock,
  sendMethodNotAllowed: sendMethodNotAllowedMock,
}));

import { createViewerApiHandler } from './viewer-api.js';

function createMockApiRequest(url: string, method = 'GET'): IncomingMessage {
  return { url, method } as IncomingMessage;
}

describe('createViewerApiHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles async blueprint route errors without crashing', async () => {
    handleBlueprintRequestMock.mockRejectedValueOnce(new Error('parse failed'));

    const handler = createViewerApiHandler();
    const req = createMockApiRequest(
      '/viewer-api/blueprints/parse?path=/tmp/blueprint.yaml'
    );
    const res = createMockResponse();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handled = await handler(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('Internal Server Error');
    expect(handleBlueprintRequestMock).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith('[viewer-api]', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('handles async generate route errors without crashing', async () => {
    handlePlanRequestMock.mockRejectedValueOnce(new Error('plan failed'));

    const handler = createViewerApiHandler();
    const req = createMockApiRequest('/viewer-api/generate/plan', 'POST');
    const res = createMockResponse();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handled = await handler(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('Internal Server Error');
    expect(handlePlanRequestMock).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith('[viewer-api]', expect.any(Error));

    consoleSpy.mockRestore();
  });
});
