import {
  persistProviderTokenPayload,
  readSettingsSnapshot,
  updateWorkspaceArtifactsSettings,
  updateWorkspaceConcurrency,
  updateWorkspaceStorageRoot,
  type CliArtifactsConfig,
  type ProviderTokenPayload,
  type SettingsSnapshot,
  type UpdateWorkspaceStorageRootResult,
  type SwitchWorkspaceRootMode,
  type ArtifactMaterializationMode,
} from '@gorenku/core';

export type ViewerSettingsSnapshot = SettingsSnapshot;

export type ViewerArtifactsSettings = CliArtifactsConfig;

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

export interface UpdateViewerArtifactsSettingsOptions {
  enabled: boolean;
  mode: ArtifactMaterializationMode;
}

export interface UpdateViewerConcurrencyOptions {
  concurrency: number;
}

export async function readViewerSettingsSnapshot(): Promise<ViewerSettingsSnapshot> {
  return readSettingsSnapshot();
}

export async function updateViewerStorageRoot(
  options: UpdateViewerStorageRootOptions
): Promise<UpdateViewerStorageRootResult> {
  const result: UpdateWorkspaceStorageRootResult =
    await updateWorkspaceStorageRoot({
      storageRoot: options.storageRoot,
      catalogPath: options.catalogPath,
      migrateContent: options.migrateContent,
    });

  return {
    storageRoot: result.storageRoot,
    catalogRoot: result.catalogRoot,
    mode: result.mode,
  };
}

export async function updateViewerApiTokens(
  payload: ProviderTokenPayload
): Promise<string> {
  return persistProviderTokenPayload(payload);
}

export async function updateViewerArtifactsSettings(
  options: UpdateViewerArtifactsSettingsOptions
): Promise<ViewerArtifactsSettings> {
  return updateWorkspaceArtifactsSettings({
    enabled: options.enabled,
    mode: options.mode,
  });
}

export async function updateViewerConcurrency(
  options: UpdateViewerConcurrencyOptions
): Promise<number> {
  return updateWorkspaceConcurrency({
    concurrency: options.concurrency,
  });
}
