import type { IncomingMessage } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockRequest,
  createMockResponse,
} from '../generation/test-utils.js';

const {
  readViewerSettingsSnapshotMock,
  updateViewerStorageRootMock,
  updateViewerApiTokensMock,
  updateViewerArtifactsSettingsMock,
  updateViewerConcurrencyMock,
} = vi.hoisted(() => ({
  readViewerSettingsSnapshotMock: vi.fn(),
  updateViewerStorageRootMock: vi.fn(),
  updateViewerApiTokensMock: vi.fn(),
  updateViewerArtifactsSettingsMock: vi.fn(),
  updateViewerConcurrencyMock: vi.fn(),
}));

vi.mock('./service.js', () => ({
  readViewerSettingsSnapshot: readViewerSettingsSnapshotMock,
  updateViewerStorageRoot: updateViewerStorageRootMock,
  updateViewerApiTokens: updateViewerApiTokensMock,
  updateViewerArtifactsSettings: updateViewerArtifactsSettingsMock,
  updateViewerConcurrency: updateViewerConcurrencyMock,
}));

import { handleSettingsEndpoint } from './handler.js';

function createRequest(method = 'GET'): IncomingMessage {
  return { method } as IncomingMessage;
}

describe('handleSettingsEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns current settings snapshot', async () => {
    readViewerSettingsSnapshotMock.mockResolvedValue({
      storageRoot: '/Users/test/Renku',
      storageFolderName: 'Renku',
      apiTokens: {
        fal: 'fal-token',
        replicate: '',
        elevenlabs: '',
        openai: 'openai-token',
        vercelGateway: '',
      },
      artifacts: {
        enabled: true,
        mode: 'copy',
      },
      concurrency: 1,
    });

    const req = createRequest('GET');
    const res = createMockResponse();

    const handled = await handleSettingsEndpoint(req, res, '', '/catalog');

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(readViewerSettingsSnapshotMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.body)).toEqual({
      storageRoot: '/Users/test/Renku',
      storageFolderName: 'Renku',
      apiTokens: {
        fal: 'fal-token',
        replicate: '',
        elevenlabs: '',
        openai: 'openai-token',
        vercelGateway: '',
      },
      artifacts: {
        enabled: true,
        mode: 'copy',
      },
      concurrency: 1,
    });
  });

  it('updates storage root with migrateContent option', async () => {
    updateViewerStorageRootMock.mockResolvedValue({
      storageRoot: '/Users/test/NewRenku',
      catalogRoot: '/Users/test/NewRenku/catalog',
      mode: 'migrated',
    });

    const req = createMockRequest(
      {
        storageRoot: '/Users/test/NewRenku',
        migrateContent: true,
      },
      'POST'
    );
    const res = createMockResponse();

    const handled = await handleSettingsEndpoint(
      req,
      res,
      'storage-root',
      '/catalog'
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(updateViewerStorageRootMock).toHaveBeenCalledWith({
      storageRoot: '/Users/test/NewRenku',
      migrateContent: true,
      allowNonEmptyTarget: false,
      catalogPath: '/catalog',
    });
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      storageRoot: '/Users/test/NewRenku',
      catalogRoot: '/Users/test/NewRenku/catalog',
      mode: 'migrated',
    });
  });

  it('updates storage root even when server catalogPath is undefined', async () => {
    updateViewerStorageRootMock.mockResolvedValue({
      storageRoot: '/Users/test/NewRenku',
      catalogRoot: '/Users/test/NewRenku/catalog',
      mode: 'initialized',
    });

    const req = createMockRequest(
      {
        storageRoot: '/Users/test/NewRenku',
        migrateContent: false,
      },
      'POST'
    );
    const res = createMockResponse();

    const handled = await handleSettingsEndpoint(
      req,
      res,
      'storage-root',
      undefined
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(updateViewerStorageRootMock).toHaveBeenCalledWith({
      storageRoot: '/Users/test/NewRenku',
      migrateContent: false,
      allowNonEmptyTarget: false,
      catalogPath: undefined,
    });
  });

  it('returns 400 when migrateContent is missing', async () => {
    const req = createMockRequest(
      {
        storageRoot: '/Users/test/NewRenku',
      },
      'POST'
    );
    const res = createMockResponse();

    const handled = await handleSettingsEndpoint(
      req,
      res,
      'storage-root',
      '/catalog'
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(updateViewerStorageRootMock).not.toHaveBeenCalled();
    expect(JSON.parse(res.body)).toEqual({
      error: 'migrateContent must be a boolean',
    });
  });

  it('returns 409 when switching to non-empty target requires confirmation', async () => {
    const confirmationError = Object.assign(
      new Error('Target folder has existing files.'),
      { code: 'WORKSPACE_SWITCH_CONFIRMATION_REQUIRED' }
    );

    updateViewerStorageRootMock.mockRejectedValue(confirmationError);

    const req = createMockRequest(
      {
        storageRoot: '/Users/test/NewRenku',
        migrateContent: false,
      },
      'POST'
    );
    const res = createMockResponse();

    const handled = await handleSettingsEndpoint(
      req,
      res,
      'storage-root',
      '/catalog'
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Target folder has existing files.',
      code: 'WORKSPACE_SWITCH_CONFIRMATION_REQUIRED',
    });
  });

  it('updates API tokens', async () => {
    updateViewerApiTokensMock.mockResolvedValue('/tmp/.env');

    const req = createMockRequest(
      {
        providers: {
          fal: { apiKey: 'fal-updated' },
        },
        promptProviders: {
          openai: { apiKey: 'openai-updated' },
        },
      },
      'POST'
    );
    const res = createMockResponse();

    const handled = await handleSettingsEndpoint(
      req,
      res,
      'api-tokens',
      '/catalog'
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(updateViewerApiTokensMock).toHaveBeenCalledWith({
      providers: {
        fal: { apiKey: 'fal-updated' },
      },
      promptProviders: {
        openai: { apiKey: 'openai-updated' },
      },
    });
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('updates artifact settings', async () => {
    updateViewerArtifactsSettingsMock.mockResolvedValue({
      enabled: false,
      mode: 'symlink',
    });

    const req = createMockRequest(
      {
        enabled: false,
        mode: 'symlink',
      },
      'POST'
    );
    const res = createMockResponse();

    const handled = await handleSettingsEndpoint(
      req,
      res,
      'artifacts',
      '/catalog'
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(updateViewerArtifactsSettingsMock).toHaveBeenCalledWith({
      enabled: false,
      mode: 'symlink',
    });
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      artifacts: {
        enabled: false,
        mode: 'symlink',
      },
    });
  });

  it('updates concurrency setting', async () => {
    updateViewerConcurrencyMock.mockResolvedValue(4);

    const req = createMockRequest(
      {
        concurrency: 4,
      },
      'POST'
    );
    const res = createMockResponse();

    const handled = await handleSettingsEndpoint(
      req,
      res,
      'concurrency',
      '/catalog'
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(updateViewerConcurrencyMock).toHaveBeenCalledWith({
      concurrency: 4,
    });
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      concurrency: 4,
    });
  });

  it('returns normalized concurrency when out-of-range value is provided', async () => {
    updateViewerConcurrencyMock.mockResolvedValue(10);

    const req = createMockRequest(
      {
        concurrency: 13,
      },
      'POST'
    );
    const res = createMockResponse();

    const handled = await handleSettingsEndpoint(
      req,
      res,
      'concurrency',
      '/catalog'
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(updateViewerConcurrencyMock).toHaveBeenCalledWith({
      concurrency: 13,
    });
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      concurrency: 10,
    });
  });

  it('rejects non-integer concurrency', async () => {
    const req = createMockRequest(
      {
        concurrency: 1.5,
      },
      'POST'
    );
    const res = createMockResponse();

    const handled = await handleSettingsEndpoint(
      req,
      res,
      'concurrency',
      '/catalog'
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(updateViewerConcurrencyMock).not.toHaveBeenCalled();
    expect(JSON.parse(res.body)).toEqual({
      error: 'concurrency must be an integer',
    });
  });
});
