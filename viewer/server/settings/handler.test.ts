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
} = vi.hoisted(() => ({
  readViewerSettingsSnapshotMock: vi.fn(),
  updateViewerStorageRootMock: vi.fn(),
  updateViewerApiTokensMock: vi.fn(),
  updateViewerArtifactsSettingsMock: vi.fn(),
}));

vi.mock('./service.js', () => ({
  readViewerSettingsSnapshot: readViewerSettingsSnapshotMock,
  updateViewerStorageRoot: updateViewerStorageRootMock,
  updateViewerApiTokens: updateViewerApiTokensMock,
  updateViewerArtifactsSettings: updateViewerArtifactsSettingsMock,
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
      catalogPath: '/catalog',
    });
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      storageRoot: '/Users/test/NewRenku',
      catalogRoot: '/Users/test/NewRenku/catalog',
      mode: 'migrated',
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
});
