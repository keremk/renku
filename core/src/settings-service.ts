import path from 'node:path';
import {
  getCliArtifactsConfig,
  normalizeCliArtifactsConfig,
  normalizeCliConcurrency,
  readApiKeysEnvFile,
  readCliConfig,
  writeApiKeysEnvFile,
  writeCliConfig,
  type ApiKeyValues,
  type ArtifactMaterializationMode,
  type CliArtifactsConfig,
} from './workspace.js';
import {
  createWorkspaceService,
  type SwitchWorkspaceRootMode,
} from './workspace-service.js';

export interface ProviderTokenPayload {
  providers?: {
    fal?: { apiKey?: string };
    replicate?: { apiKey?: string };
    elevenlabs?: { apiKey?: string };
  };
  promptProviders?: {
    openai?: { apiKey?: string };
    vercelGateway?: { apiKey?: string };
  };
}

export interface SettingsApiTokens {
  fal: string;
  replicate: string;
  elevenlabs: string;
  openai: string;
  vercelGateway: string;
}

export interface SettingsSnapshot {
  storageRoot: string;
  storageFolderName: string;
  apiTokens: SettingsApiTokens;
  artifacts: CliArtifactsConfig;
  concurrency: number;
}

export interface UpdateWorkspaceStorageRootOptions {
  storageRoot: string;
  migrateContent: boolean;
  catalogPath: string;
  configPath?: string;
}

export interface UpdateWorkspaceStorageRootResult {
  storageRoot: string;
  catalogRoot: string;
  mode: SwitchWorkspaceRootMode;
}

export interface UpdateWorkspaceArtifactsSettingsOptions {
  enabled: boolean;
  mode: ArtifactMaterializationMode;
  configPath?: string;
}

export interface UpdateWorkspaceConcurrencyOptions {
  concurrency: number;
  configPath?: string;
}

const workspaceService = createWorkspaceService();

export function mapProviderTokenPayloadToApiKeyValues(
  payload: ProviderTokenPayload
): ApiKeyValues {
  return {
    FAL_KEY: payload.providers?.fal?.apiKey,
    REPLICATE_API_TOKEN: payload.providers?.replicate?.apiKey,
    ELEVENLABS_API_KEY: payload.providers?.elevenlabs?.apiKey,
    OPENAI_API_KEY: payload.promptProviders?.openai?.apiKey,
    AI_GATEWAY_API_KEY: payload.promptProviders?.vercelGateway?.apiKey,
  };
}

export async function persistProviderTokenPayload(
  payload: ProviderTokenPayload,
  envFilePath?: string
): Promise<string> {
  const apiKeys = mapProviderTokenPayloadToApiKeyValues(payload);
  return writeApiKeysEnvFile(apiKeys, envFilePath);
}

export async function readSettingsApiTokens(
  envFilePath?: string
): Promise<SettingsApiTokens> {
  const apiKeys = await readApiKeysEnvFile(envFilePath);
  return {
    fal: apiKeys.FAL_KEY ?? '',
    replicate: apiKeys.REPLICATE_API_TOKEN ?? '',
    elevenlabs: apiKeys.ELEVENLABS_API_KEY ?? '',
    openai: apiKeys.OPENAI_API_KEY ?? '',
    vercelGateway: apiKeys.AI_GATEWAY_API_KEY ?? '',
  };
}

export async function readSettingsSnapshot(options?: {
  configPath?: string;
  envFilePath?: string;
}): Promise<SettingsSnapshot> {
  const cliConfig = await readCliConfig(options?.configPath);
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  const apiTokens = await readSettingsApiTokens(options?.envFilePath);

  return {
    storageRoot: cliConfig.storage.root,
    storageFolderName: getStorageFolderName(cliConfig.storage.root),
    apiTokens,
    artifacts: getCliArtifactsConfig(cliConfig),
    concurrency: normalizeCliConcurrency(cliConfig.concurrency),
  };
}

export async function updateWorkspaceStorageRoot(
  options: UpdateWorkspaceStorageRootOptions
): Promise<UpdateWorkspaceStorageRootResult> {
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
    configPath: options.configPath,
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

export async function updateWorkspaceArtifactsSettings(
  options: UpdateWorkspaceArtifactsSettingsOptions
): Promise<CliArtifactsConfig> {
  const cliConfig = await readCliConfig(options.configPath);
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  const artifacts = normalizeCliArtifactsConfig({
    enabled: options.enabled,
    mode: options.mode,
  });

  await writeCliConfig({ ...cliConfig, artifacts }, options.configPath);
  return artifacts;
}

export async function updateWorkspaceConcurrency(
  options: UpdateWorkspaceConcurrencyOptions
): Promise<number> {
  const cliConfig = await readCliConfig(options.configPath);
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  const concurrency = normalizeCliConcurrency(options.concurrency);
  await writeCliConfig({ ...cliConfig, concurrency }, options.configPath);
  return concurrency;
}

function getStorageFolderName(storageRoot: string): string {
  const parsed = path.parse(storageRoot);
  if (parsed.base.length > 0) {
    return parsed.base;
  }
  return parsed.root;
}
