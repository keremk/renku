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

interface SettingsErrorPayload {
  error?: string;
  code?: string;
}

interface SettingsRequestError extends Error {
  status: number;
  code?: string;
}

async function readErrorDetails(
  response: Response
): Promise<{ message: string; code?: string }> {
  try {
    const body = (await response.json()) as SettingsErrorPayload;
    if (body.error && body.error.trim().length > 0) {
      return {
        message: body.error,
        code: body.code,
      };
    }
  } catch {
    // Ignore JSON parse failures and use status text fallback.
  }

  return {
    message: response.statusText || 'Unknown error',
  };
}

async function createRequestError(
  response: Response
): Promise<SettingsRequestError> {
  const { message, code } = await readErrorDetails(response);
  const error = new Error(message) as SettingsRequestError;
  error.status = response.status;
  if (code) {
    error.code = code;
  }
  return error;
}

export async function fetchViewerSettings(): Promise<ViewerSettingsSnapshot> {
  const response = await fetch('/viewer-api/settings');
  if (!response.ok) {
    throw await createRequestError(response);
  }
  return response.json() as Promise<ViewerSettingsSnapshot>;
}

export async function updateViewerStorageRoot(options: {
  storageRoot: string;
  migrateContent: boolean;
  allowNonEmptyTarget?: boolean;
}): Promise<UpdateStorageRootResponse> {
  const response = await fetch('/viewer-api/settings/storage-root', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    throw await createRequestError(response);
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
    throw await createRequestError(response);
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
    throw await createRequestError(response);
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
    throw await createRequestError(response);
  }
  return response.json() as Promise<UpdateConcurrencySettingsResponse>;
}
