import path from 'node:path';
import {
  createWorkspaceService,
  readCliConfig,
  type SwitchWorkspaceRootMode,
} from '@gorenku/core';
import {
  persistProviderTokenPayload,
  readSettingsApiTokens,
  type ProviderTokenPayload,
  type SettingsApiTokens,
} from './api-tokens.js';

export interface ViewerSettingsSnapshot {
  storageRoot: string;
  storageFolderName: string;
  apiTokens: SettingsApiTokens;
}

export interface UpdateViewerStorageRootOptions {
  storageRoot: string;
  migrateContent: boolean;
  catalogPath: string;
}

export interface UpdateViewerStorageRootResult {
  storageRoot: string;
  catalogRoot: string;
  mode: SwitchWorkspaceRootMode;
}

const workspaceService = createWorkspaceService();

export async function readViewerSettingsSnapshot(): Promise<ViewerSettingsSnapshot> {
  const cliConfig = await readCliConfig();
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  const apiTokens = await readSettingsApiTokens();

  return {
    storageRoot: cliConfig.storage.root,
    storageFolderName: getStorageFolderName(cliConfig.storage.root),
    apiTokens,
  };
}

export async function updateViewerStorageRoot(
  options: UpdateViewerStorageRootOptions
): Promise<UpdateViewerStorageRootResult> {
  const storageRoot = options.storageRoot.trim();
  if (storageRoot === '') {
    throw new Error('storageRoot is required');
  }

  const catalogPath = options.catalogPath.trim();
  if (catalogPath === '') {
    throw new Error(
      'Server has no catalog path configured. Restart using "renku launch".'
    );
  }

  const result = await workspaceService.switchWorkspaceRoot({
    targetRootFolder: storageRoot,
    catalogSourceRoot: catalogPath,
    migrateContent: options.migrateContent,
    requireExistingWorkspace: false,
    syncCatalog: true,
  });

  return {
    storageRoot: result.rootFolder,
    catalogRoot: result.catalogRoot,
    mode: result.mode,
  };
}

export async function updateViewerApiTokens(
  payload: ProviderTokenPayload
): Promise<string> {
  return persistProviderTokenPayload(payload);
}

function getStorageFolderName(storageRoot: string): string {
  const parsed = path.parse(storageRoot);
  if (parsed.base.length > 0) {
    return parsed.base;
  }
  return parsed.root;
}
