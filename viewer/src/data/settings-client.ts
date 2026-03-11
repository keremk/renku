export interface SettingsApiTokens {
  fal: string;
  replicate: string;
  elevenlabs: string;
  openai: string;
  vercelGateway: string;
}

export interface ViewerSettingsSnapshot {
  storageRoot: string;
  storageFolderName: string;
  apiTokens: SettingsApiTokens;
  artifacts: ViewerArtifactsSettings;
  concurrency: number;
}

export type ArtifactMaterializationMode = 'copy' | 'symlink';

export interface ViewerArtifactsSettings {
  enabled: boolean;
  mode: ArtifactMaterializationMode;
}

export type StorageRootUpdateMode =
  | 'switched-existing'
  | 'initialized'
  | 'migrated';

export interface UpdateStorageRootResponse {
  ok: true;
  storageRoot: string;
  catalogRoot: string;
  mode: StorageRootUpdateMode;
}

export interface UpdateArtifactsSettingsResponse {
  ok: true;
  artifacts: ViewerArtifactsSettings;
}

export interface UpdateConcurrencySettingsResponse {
  ok: true;
  concurrency: number;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error && body.error.trim().length > 0) {
      return body.error;
    }
  } catch {
    // Ignore JSON parse failures and use status text fallback.
  }
  return response.statusText || 'Unknown error';
}

export async function fetchViewerSettings(): Promise<ViewerSettingsSnapshot> {
  const response = await fetch('/viewer-api/settings');
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json() as Promise<ViewerSettingsSnapshot>;
}

export async function updateViewerStorageRoot(options: {
  storageRoot: string;
  migrateContent: boolean;
}): Promise<UpdateStorageRootResponse> {
  const response = await fetch('/viewer-api/settings/storage-root', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json() as Promise<UpdateStorageRootResponse>;
}

export async function updateViewerApiTokens(
  apiTokens: SettingsApiTokens
): Promise<void> {
  const response = await fetch('/viewer-api/settings/api-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providers: {
        fal: { apiKey: apiTokens.fal },
        replicate: { apiKey: apiTokens.replicate },
        elevenlabs: { apiKey: apiTokens.elevenlabs },
      },
      promptProviders: {
        openai: { apiKey: apiTokens.openai },
        vercelGateway: { apiKey: apiTokens.vercelGateway },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}

export async function updateViewerArtifactsSettings(options: {
  enabled: boolean;
  mode: ArtifactMaterializationMode;
}): Promise<UpdateArtifactsSettingsResponse> {
  const response = await fetch('/viewer-api/settings/artifacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json() as Promise<UpdateArtifactsSettingsResponse>;
}

export async function updateViewerConcurrency(options: {
  concurrency: number;
}): Promise<UpdateConcurrencySettingsResponse> {
  const response = await fetch('/viewer-api/settings/concurrency', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json() as Promise<UpdateConcurrencySettingsResponse>;
}
