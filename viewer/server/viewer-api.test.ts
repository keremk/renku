import type { IncomingMessage } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockResponse } from './generation/test-utils.js';

const {
  handleBlueprintRequestMock,
  handlePlanRequestMock,
  handleProducerSchedulingRequestMock,
  handleExecuteRequestMock,
  handleJobsListRequestMock,
  handleJobStatusRequestMock,
  handleStreamRequestMock,
  handleCancelRequestMock,
  sendMethodNotAllowedMock,
  handleOnboardingRequestMock,
  handleSettingsRequestMock,
} = vi.hoisted(() => ({
  handleBlueprintRequestMock: vi.fn(),
  handlePlanRequestMock: vi.fn(),
  handleProducerSchedulingRequestMock: vi.fn(),
  handleExecuteRequestMock: vi.fn(),
  handleJobsListRequestMock: vi.fn(),
  handleJobStatusRequestMock: vi.fn(),
  handleStreamRequestMock: vi.fn(),
  handleCancelRequestMock: vi.fn(),
  sendMethodNotAllowedMock: vi.fn(),
  handleOnboardingRequestMock: vi.fn(),
  handleSettingsRequestMock: vi.fn(),
}));

vi.mock('./blueprints/index.js', () => ({
  handleBlueprintRequest: handleBlueprintRequestMock,
}));

vi.mock('./generation/index.js', () => ({
  handlePlanRequest: handlePlanRequestMock,
  handleProducerSchedulingRequest: handleProducerSchedulingRequestMock,
  handleExecuteRequest: handleExecuteRequestMock,
  handleJobsListRequest: handleJobsListRequestMock,
  handleJobStatusRequest: handleJobStatusRequestMock,
  handleStreamRequest: handleStreamRequestMock,
  handleCancelRequest: handleCancelRequestMock,
  sendMethodNotAllowed: sendMethodNotAllowedMock,
}));

vi.mock('./onboarding/index.js', () => ({
  handleOnboardingRequest: handleOnboardingRequestMock,
}));

vi.mock('./settings/index.js', () => ({
  handleSettingsRequest: handleSettingsRequestMock,
}));

import {
  createViewerApiHandler,
  createViewerApiMiddleware,
} from './viewer-api.js';

function createMockApiRequest(url: string, method = 'GET'): IncomingMessage {
  return { url, method } as IncomingMessage;
}

describe('createViewerApiHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns liveness payload from the health endpoint', async () => {
    const handler = createViewerApiHandler();
    const req = createMockApiRequest('/viewer-api/health', 'GET');
    const res = createMockResponse();

    const handled = await handler(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
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

  it('routes producer scheduling requests to the dedicated handler', async () => {
    handleProducerSchedulingRequestMock.mockResolvedValueOnce(true);

    const handler = createViewerApiHandler();
    const req = createMockApiRequest(
      '/viewer-api/generate/producer-scheduling',
      'POST'
    );
    const res = createMockResponse();

    const handled = await handler(req, res);

    expect(handled).toBe(true);
    expect(handleProducerSchedulingRequestMock).toHaveBeenCalledWith(req, res);
  });

  it('passes configured catalog path to settings requests', async () => {
    handleSettingsRequestMock.mockResolvedValueOnce(true);

    const handler = createViewerApiHandler({ catalogPath: '/catalog' });
    const req = createMockApiRequest('/viewer-api/settings', 'GET');
    const res = createMockResponse();

    const handled = await handler(req, res);

    expect(handled).toBe(true);
    expect(handleSettingsRequestMock).toHaveBeenCalledWith(
      req,
      res,
      [],
      '/catalog'
    );
  });

  it('passes middleware catalog options into API handler', async () => {
    handleSettingsRequestMock.mockResolvedValueOnce(true);

    const middleware = createViewerApiMiddleware({ catalogPath: '/catalog' });
    const req = createMockApiRequest('/viewer-api/settings', 'GET');
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(handleSettingsRequestMock).toHaveBeenCalledWith(
      req,
      res,
      [],
      '/catalog'
    );
    expect(next).not.toHaveBeenCalled();
  });
});
