import path from 'node:path';
import os from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  llmInvocation: LlmInvocationSettings;
}

export interface LlmInvocationSettings {
  requestTimeoutMs: number | null;
  maxRetries: number | null;
}

interface ConfigSettingsFile {
  llmInvocation?: {
    requestTimeoutMs?: number | null;
    maxRetries?: number | null;
  };
  [key: string]: unknown;
}

export interface UpdateWorkspaceStorageRootOptions {
  storageRoot: string;
  migrateContent: boolean;
  allowNonEmptyTarget?: boolean;
  catalogPath?: string;
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

export interface UpdateLlmInvocationSettingsOptions {
  requestTimeoutMs: number | null;
  maxRetries: number | null;
  configSettingsPath?: string;
}

const DEFAULT_LLM_INVOCATION_SETTINGS: LlmInvocationSettings = {
  requestTimeoutMs: 6 * 60 * 1000,
  maxRetries: 2,
};

const workspaceService = createWorkspaceService();

export function getDefaultConfigSettingsPath(): string {
  return path.resolve(os.homedir(), '.config', 'renku', 'config-setting.json');
}

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
  configSettingsPath?: string;
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
    llmInvocation: await readLlmInvocationSettings(options?.configSettingsPath),
  };
}

export async function updateWorkspaceStorageRoot(
  options: UpdateWorkspaceStorageRootOptions
): Promise<UpdateWorkspaceStorageRootResult> {
  const storageRoot = options.storageRoot.trim();
  if (storageRoot === '') {
    throw new Error('storageRoot is required');
  }

  const catalogSourceRoot = await resolveCatalogSourceRoot(options);

  const result = await workspaceService.switchWorkspaceRoot({
    targetRootFolder: storageRoot,
    catalogSourceRoot,
    configPath: options.configPath,
    migrateContent: options.migrateContent,
    allowNonEmptyTarget: options.allowNonEmptyTarget,
    requireExistingWorkspace: false,
    syncCatalog: false,
  });

  return {
    storageRoot: result.rootFolder,
    catalogRoot: result.catalogRoot,
    mode: result.mode,
  };
}

async function resolveCatalogSourceRoot(
  options: UpdateWorkspaceStorageRootOptions
): Promise<string> {
  if (options.catalogPath !== undefined) {
    const explicitCatalogPath = options.catalogPath.trim();
    if (explicitCatalogPath !== '') {
      return explicitCatalogPath;
    }
  }

  const cliConfig = await readCliConfig(options.configPath);
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  const configuredCatalogRoot = cliConfig.catalog?.root;
  if (
    typeof configuredCatalogRoot === 'string' &&
    configuredCatalogRoot.trim() !== ''
  ) {
    return configuredCatalogRoot;
  }

  const storageRoot = cliConfig.storage.root;
  if (storageRoot.trim() === '') {
    throw new Error('CLI config is invalid: storage.root must be set.');
  }

  return path.resolve(storageRoot, 'catalog');
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

export async function readLlmInvocationSettings(
  configSettingsPath?: string
): Promise<LlmInvocationSettings> {
  const settings = await readConfigSettingsFile(configSettingsPath);
  return normalizeLlmInvocationSettings(settings.llmInvocation);
}

export async function updateLlmInvocationSettings(
  options: UpdateLlmInvocationSettingsOptions
): Promise<LlmInvocationSettings> {
  const targetPath = path.resolve(
    options.configSettingsPath ?? getDefaultConfigSettingsPath()
  );
  const existing = await readConfigSettingsFile(targetPath);
  const normalized = normalizeLlmInvocationSettings({
    requestTimeoutMs: options.requestTimeoutMs,
    maxRetries: options.maxRetries,
  });

  const next: ConfigSettingsFile = {
    ...existing,
    llmInvocation: {
      requestTimeoutMs: normalized.requestTimeoutMs,
      maxRetries: normalized.maxRetries,
    },
  };

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(next, null, 2), 'utf8');
  return normalized;
}

async function readConfigSettingsFile(
  configSettingsPath?: string
): Promise<ConfigSettingsFile> {
  const targetPath = path.resolve(
    configSettingsPath ?? getDefaultConfigSettingsPath()
  );

  try {
    const contents = await readFile(targetPath, 'utf8');
    const parsed = JSON.parse(contents) as unknown;
    if (!isRecord(parsed)) {
      throw new Error(
        `Config settings file at "${targetPath}" must be a JSON object.`
      );
    }
    return parsed as ConfigSettingsFile;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return {};
    }
    throw new Error(
      `Failed to read config settings from "${targetPath}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function normalizeLlmInvocationSettings(
  value: unknown
): LlmInvocationSettings {
  if (value === undefined) {
    return { ...DEFAULT_LLM_INVOCATION_SETTINGS };
  }
  if (!isRecord(value)) {
    throw new Error('llmInvocation config must be an object when provided.');
  }
  const requestTimeoutMs =
    value.requestTimeoutMs === undefined
      ? DEFAULT_LLM_INVOCATION_SETTINGS.requestTimeoutMs
      : normalizeNullableInteger(value.requestTimeoutMs, {
          field: 'llmInvocation.requestTimeoutMs',
          min: 1,
        });
  const maxRetries =
    value.maxRetries === undefined
      ? DEFAULT_LLM_INVOCATION_SETTINGS.maxRetries
      : normalizeNullableInteger(value.maxRetries, {
          field: 'llmInvocation.maxRetries',
          min: 0,
        });

  return {
    requestTimeoutMs,
    maxRetries,
  };
}

function normalizeNullableInteger(
  value: unknown,
  options: { field: string; min: number }
): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value)) {
    throw new Error(`${options.field} must be an integer or null.`);
  }
  if ((value as number) < options.min) {
    throw new Error(`${options.field} must be >= ${options.min} or null.`);
  }

  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

interface ErrorWithCode extends Error {
  code?: string;
}

function isErrnoException(error: unknown): error is ErrorWithCode {
  return error instanceof Error;
}

function getStorageFolderName(storageRoot: string): string {
  const parsed = path.parse(storageRoot);
  if (parsed.base.length > 0) {
    return parsed.base;
  }
  return parsed.root;
}
