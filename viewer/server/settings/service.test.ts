import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  persistProviderTokenPayloadMock,
  readSettingsSnapshotMock,
  updateWorkspaceArtifactsSettingsMock,
  updateWorkspaceConcurrencyMock,
  updateWorkspaceStorageRootMock,
} = vi.hoisted(() => ({
  persistProviderTokenPayloadMock: vi.fn(),
  readSettingsSnapshotMock: vi.fn(),
  updateWorkspaceArtifactsSettingsMock: vi.fn(),
  updateWorkspaceConcurrencyMock: vi.fn(),
  updateWorkspaceStorageRootMock: vi.fn(),
}));

vi.mock('@gorenku/core', () => ({
  persistProviderTokenPayload: persistProviderTokenPayloadMock,
  readSettingsSnapshot: readSettingsSnapshotMock,
  updateWorkspaceArtifactsSettings: updateWorkspaceArtifactsSettingsMock,
  updateWorkspaceConcurrency: updateWorkspaceConcurrencyMock,
  updateWorkspaceStorageRoot: updateWorkspaceStorageRootMock,
}));

import { updateViewerStorageRoot } from './service.js';

describe('updateViewerStorageRoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    updateWorkspaceStorageRootMock.mockResolvedValue({
      storageRoot: '/Users/test/NewRenku',
      catalogRoot: '/Users/test/NewRenku/catalog',
      mode: 'initialized',
    });
  });

  it('uses explicit catalog path when provided', async () => {
    await updateViewerStorageRoot({
      storageRoot: '/Users/test/NewRenku',
      migrateContent: false,
      allowNonEmptyTarget: false,
      catalogPath: '/catalog/source',
    });

    expect(updateWorkspaceStorageRootMock).toHaveBeenCalledWith({
      storageRoot: '/Users/test/NewRenku',
      migrateContent: false,
      allowNonEmptyTarget: false,
      catalogPath: '/catalog/source',
    });
    expect(readSettingsSnapshotMock).not.toHaveBeenCalled();
  });

  it('passes undefined catalog path to core resolution when missing', async () => {
    await updateViewerStorageRoot({
      storageRoot: '/Users/test/NewRenku',
      migrateContent: false,
      allowNonEmptyTarget: false,
    });

    expect(readSettingsSnapshotMock).not.toHaveBeenCalled();
    expect(updateWorkspaceStorageRootMock).toHaveBeenCalledWith({
      storageRoot: '/Users/test/NewRenku',
      migrateContent: false,
      allowNonEmptyTarget: false,
      catalogPath: undefined,
    });
  });

  it('passes blank catalog path through for core normalization', async () => {
    await updateViewerStorageRoot({
      storageRoot: '/Users/test/NewRenku',
      migrateContent: false,
      allowNonEmptyTarget: false,
      catalogPath: '   ',
    });

    expect(readSettingsSnapshotMock).not.toHaveBeenCalled();
    expect(updateWorkspaceStorageRootMock).toHaveBeenCalledWith({
      storageRoot: '/Users/test/NewRenku',
      migrateContent: false,
      allowNonEmptyTarget: false,
      catalogPath: '   ',
    });
  });
});
