/**
 * Workspace initialization and configuration management.
 *
 * Shared between CLI and viewer server — no external dependencies beyond Node.js built-ins.
 */

import {
  access,
  copyFile,
  mkdir,
  rename,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, parse, resolve } from 'node:path';
import os from 'node:os';
import process from 'node:process';
import {
  DEFAULT_CLI_CONCURRENCY,
  normalizeCliConcurrency,
} from './concurrency.js';

export {
  DEFAULT_CLI_CONCURRENCY,
  MAX_CLI_CONCURRENCY,
  MIN_CLI_CONCURRENCY,
  normalizeCliConcurrency,
} from './concurrency.js';

// ---------------------------------------------------------------------------
// Config type
// ---------------------------------------------------------------------------

export interface CliConfig {
  storage: {
    root: string;
    basePath: string;
  };
  artifacts?: CliArtifactsConfig;
  catalog?: {
    root: string;
  };
  concurrency?: number;
  lastMovieId?: string;
  lastGeneratedAt?: string;
  viewer?: {
    port?: number;
    host?: string;
  };
}

export type ArtifactMaterializationMode = 'copy' | 'symlink';

export interface CliArtifactsConfig {
  enabled: boolean;
  mode: ArtifactMaterializationMode;
}

export const DEFAULT_CLI_ARTIFACTS_CONFIG: CliArtifactsConfig = {
  enabled: true,
  mode: 'copy',
};

// ---------------------------------------------------------------------------
// Config path helpers
// ---------------------------------------------------------------------------

export function getDefaultCliConfigPath(): string {
  const envPath = process.env.RENKU_CLI_CONFIG;
  if (envPath) {
    return resolve(envPath);
  }
  return resolve(os.homedir(), '.config', 'renku', 'cli-config.json');
}

// ---------------------------------------------------------------------------
// Read / write config
// ---------------------------------------------------------------------------

function normalizeArtifactMaterializationMode(
  value: string | undefined
): ArtifactMaterializationMode {
  if (value === undefined) {
    return DEFAULT_CLI_ARTIFACTS_CONFIG.mode;
  }
  if (value !== 'copy' && value !== 'symlink') {
    throw new Error(
      `Artifacts mode must be "copy" or "symlink", got "${value}".`
    );
  }
  return value;
}

export function normalizeCliArtifactsConfig(
  value: Partial<CliArtifactsConfig> | undefined
): CliArtifactsConfig {
  if (value === undefined) {
    return { ...DEFAULT_CLI_ARTIFACTS_CONFIG };
  }

  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new Error('Artifacts enabled flag must be a boolean.');
  }

  return {
    enabled: value.enabled ?? DEFAULT_CLI_ARTIFACTS_CONFIG.enabled,
    mode: normalizeArtifactMaterializationMode(value.mode),
  };
}

export function getCliArtifactsConfig(config: CliConfig): CliArtifactsConfig {
  return normalizeCliArtifactsConfig(config.artifacts);
}

export async function readCliConfig(
  configPath?: string
): Promise<CliConfig | null> {
  const targetPath = resolve(configPath ?? getDefaultCliConfigPath());
  try {
    const contents = await readFile(targetPath, 'utf8');
    const parsed = JSON.parse(contents) as Partial<CliConfig>;
    if (!parsed.storage) {
      return null;
    }
    return {
      storage: parsed.storage,
      artifacts: normalizeCliArtifactsConfig(parsed.artifacts),
      catalog: parsed.catalog,
      concurrency: normalizeCliConcurrency(parsed.concurrency),
      lastMovieId: parsed.lastMovieId,
      lastGeneratedAt: parsed.lastGeneratedAt,
      viewer: parsed.viewer,
    };
  } catch {
    return null;
  }
}

export async function writeCliConfig(
  config: CliConfig,
  configPath?: string
): Promise<string> {
  const targetPath = resolve(configPath ?? getDefaultCliConfigPath());
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(
    targetPath,
    JSON.stringify(
      {
        ...config,
        artifacts: normalizeCliArtifactsConfig(config.artifacts),
        concurrency: normalizeCliConcurrency(config.concurrency),
      },
      null,
      2
    ),
    'utf8'
  );
  return targetPath;
}

// ---------------------------------------------------------------------------
// Initialization check
// ---------------------------------------------------------------------------

export async function isWorkspaceInitialized(
  configPath?: string
): Promise<boolean> {
  const config = await readCliConfig(configPath);
  if (!config) {
    return false;
  }
  const catalogRoot = config.catalog?.root;
  if (!catalogRoot) {
    return false;
  }
  try {
    await access(catalogRoot);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Workspace init
// ---------------------------------------------------------------------------

const GITIGNORE_CONTENT = `# Renku build data (large binary files)
**/builds/

# Artifact symlinks (only work locally, useless without builds)
**/artifacts/
`;

export interface InitWorkspaceOptions {
  rootFolder: string;
  catalogSourceRoot: string;
  configPath?: string;
}

export interface InitWorkspaceResult {
  rootFolder: string;
  cliConfigPath: string;
  gitignoreCreated: boolean;
}

const REQUIRED_CATALOG_DIRECTORIES = [
  'blueprints',
  'models',
  'producers',
] as const;

export interface UpdateWorkspaceCatalogOptions {
  rootFolder: string;
  catalogSourceRoot: string;
  configuredCatalogRoot?: string;
}

export interface UpdateWorkspaceCatalogResult {
  catalogRoot: string;
}

export async function initWorkspace(
  options: InitWorkspaceOptions
): Promise<InitWorkspaceResult> {
  const { rootFolder, catalogSourceRoot, configPath } = options;
  const catalogRoot = resolve(rootFolder, 'catalog');

  // 1. mkdir(rootFolder, recursive)
  await mkdir(rootFolder, { recursive: true });

  // 2. replace workspace catalog using canonical update flow
  await updateWorkspaceCatalog({
    rootFolder,
    catalogSourceRoot,
    configuredCatalogRoot: catalogRoot,
  });

  // 3. write cli-config.json
  const cliConfig: CliConfig = {
    storage: {
      root: rootFolder,
      basePath: 'builds',
    },
    artifacts: {
      ...DEFAULT_CLI_ARTIFACTS_CONFIG,
    },
    catalog: {
      root: catalogRoot,
    },
    concurrency: DEFAULT_CLI_CONCURRENCY,
  };
  const cliConfigPath = await writeCliConfig(cliConfig, configPath);

  // 4. write .gitignore (if not exists)
  const gitignorePath = resolve(rootFolder, '.gitignore');
  const gitignoreCreated = await writeFileIfMissing(
    gitignorePath,
    GITIGNORE_CONTENT
  );

  return { rootFolder, cliConfigPath, gitignoreCreated };
}

export async function updateWorkspaceCatalog(
  options: UpdateWorkspaceCatalogOptions
): Promise<UpdateWorkspaceCatalogResult> {
  const rootFolder = resolve(options.rootFolder);
  assertSafeWorkspaceRoot(rootFolder);

  const catalogSourceRoot = resolve(options.catalogSourceRoot);
  await assertValidCatalogSourceRoot(catalogSourceRoot);

  const canonicalCatalogRoot = resolve(rootFolder, 'catalog');
  if (options.configuredCatalogRoot !== undefined) {
    const configuredCatalogRoot = resolve(options.configuredCatalogRoot);
    if (configuredCatalogRoot !== canonicalCatalogRoot) {
      throw new Error(
        `Configured catalog root "${configuredCatalogRoot}" does not match canonical workspace catalog root "${canonicalCatalogRoot}".`
      );
    }
  }

  await mkdir(rootFolder, { recursive: true });

  const operationId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stagingCatalogRoot = resolve(
    rootFolder,
    `.renku-catalog-update-staging-${operationId}`
  );
  const backupCatalogRoot = resolve(
    rootFolder,
    `.renku-catalog-update-backup-${operationId}`
  );

  await copyDirectory(catalogSourceRoot, stagingCatalogRoot, {
    overwrite: false,
  });

  const hadExistingCatalog = await pathExists(canonicalCatalogRoot);
  if (hadExistingCatalog) {
    await rename(canonicalCatalogRoot, backupCatalogRoot);
  }

  try {
    await rename(stagingCatalogRoot, canonicalCatalogRoot);
  } catch (error) {
    await rollbackCatalogSwap({
      canonicalCatalogRoot,
      backupCatalogRoot,
      stagingCatalogRoot,
      hadExistingCatalog,
    });
    throw new Error(
      `Failed to replace catalog at "${canonicalCatalogRoot}": ${getErrorMessage(error)}`
    );
  }

  if (hadExistingCatalog) {
    await rm(backupCatalogRoot, { recursive: true, force: true });
  }

  return { catalogRoot: canonicalCatalogRoot };
}

async function writeFileIfMissing(
  filePath: string,
  content: string
): Promise<boolean> {
  try {
    await access(filePath);
    return false;
  } catch {
    await writeFile(filePath, content, 'utf8');
    return true;
  }
}

interface CopyDirectoryOptions {
  overwrite: boolean;
}

interface RollbackCatalogSwapOptions {
  canonicalCatalogRoot: string;
  backupCatalogRoot: string;
  stagingCatalogRoot: string;
  hadExistingCatalog: boolean;
}

async function copyDirectory(
  source: string,
  target: string,
  options: CopyDirectoryOptions
): Promise<void> {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = resolve(source, entry.name);
    const targetPath = resolve(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, options);
    } else if (entry.isFile()) {
      if (!options.overwrite) {
        try {
          await access(targetPath);
          continue; // skip existing
        } catch {
          // target doesn't exist, proceed with copy
        }
      }
      await copyFile(sourcePath, targetPath);
    }
  }
}

async function assertValidCatalogSourceRoot(sourceRoot: string): Promise<void> {
  const missingDirectories: string[] = [];
  for (const requiredDirectory of REQUIRED_CATALOG_DIRECTORIES) {
    const candidate = resolve(sourceRoot, requiredDirectory);
    if (!(await directoryExists(candidate))) {
      missingDirectories.push(requiredDirectory);
    }
  }

  if (missingDirectories.length > 0) {
    throw new Error(
      `Invalid catalog source root "${sourceRoot}". Missing required directories: ${missingDirectories.join(', ')}.`
    );
  }
}

function assertSafeWorkspaceRoot(rootFolder: string): void {
  const rootPath = parse(rootFolder).root;
  if (rootFolder === rootPath) {
    throw new Error(
      `Refusing to update catalog for workspace root "${rootFolder}" because it is a filesystem root.`
    );
  }
}

async function rollbackCatalogSwap(
  options: RollbackCatalogSwapOptions
): Promise<void> {
  const {
    canonicalCatalogRoot,
    backupCatalogRoot,
    stagingCatalogRoot,
    hadExistingCatalog,
  } = options;

  if (hadExistingCatalog) {
    const backupExists = await pathExists(backupCatalogRoot);
    const canonicalExists = await pathExists(canonicalCatalogRoot);
    if (backupExists && !canonicalExists) {
      await rename(backupCatalogRoot, canonicalCatalogRoot);
    }
    if (backupExists && canonicalExists) {
      throw new Error(
        `Rollback aborted: both backup "${backupCatalogRoot}" and catalog "${canonicalCatalogRoot}" exist.`
      );
    }
  }

  if (await pathExists(stagingCatalogRoot)) {
    await rm(stagingCatalogRoot, { recursive: true, force: true });
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const entry = await stat(path);
    return entry.isDirectory();
  } catch {
    return false;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') {
    return undefined;
  }

  return code;
}

// ---------------------------------------------------------------------------
// API key env file
// ---------------------------------------------------------------------------

export interface ApiKeyValues {
  FAL_KEY?: string;
  REPLICATE_API_TOKEN?: string;
  ELEVENLABS_API_KEY?: string;
  OPENAI_API_KEY?: string;
  AI_GATEWAY_API_KEY?: string;
}

const API_KEY_NAMES = [
  'FAL_KEY',
  'REPLICATE_API_TOKEN',
  'ELEVENLABS_API_KEY',
  'OPENAI_API_KEY',
  'AI_GATEWAY_API_KEY',
] as const;

type ApiKeyName = (typeof API_KEY_NAMES)[number];

export function getUserEnvFilePath(): string {
  return resolve(os.homedir(), '.config', 'renku', '.env');
}

export async function readApiKeysEnvFile(
  envFilePath?: string
): Promise<ApiKeyValues> {
  const targetPath = resolve(envFilePath ?? getUserEnvFilePath());

  let existingContent = '';
  try {
    existingContent = await readFile(targetPath, 'utf8');
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return {};
    }
    throw error;
  }

  const keySet = new Set<ApiKeyName>(API_KEY_NAMES);
  const values: ApiKeyValues = {};

  for (const line of existingContent.split('\n')) {
    const match = /^(?:\s*export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1];
    if (!keySet.has(key as ApiKeyName)) {
      continue;
    }

    const value = match[2].trim().replace(/^["']|["']$/g, '');
    values[key as ApiKeyName] = value;
  }

  return values;
}

export async function writeApiKeysEnvFile(
  keys: ApiKeyValues,
  envFilePath?: string
): Promise<string> {
  const targetPath = resolve(envFilePath ?? getUserEnvFilePath());
  await mkdir(dirname(targetPath), { recursive: true });

  // Read existing content if file exists
  let existingContent = '';
  try {
    existingContent = await readFile(targetPath, 'utf8');
  } catch {
    // File doesn't exist, start fresh
  }

  const lines = existingContent === '' ? [] : existingContent.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  const keyLineIndex = new Map<string, number>();
  const keyPrefix = new Map<string, string>();

  const rebuildKeyIndexes = () => {
    keyLineIndex.clear();
    keyPrefix.clear();

    for (let index = 0; index < lines.length; index += 1) {
      const match = /^(\s*(?:export\s+)?)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(
        lines[index]
      );
      if (!match) {
        continue;
      }
      keyLineIndex.set(match[2], index);
      keyPrefix.set(match[2], match[1] ?? '');
    }
  };

  rebuildKeyIndexes();

  for (const [key, value] of Object.entries(keys)) {
    if (value === undefined) {
      continue;
    }

    const index = keyLineIndex.get(key);
    if (value === '') {
      if (index !== undefined) {
        lines.splice(index, 1);
        rebuildKeyIndexes();
      }

      delete process.env[key];
      continue;
    }

    const line = `${keyPrefix.get(key) ?? ''}${key}=${value}`;
    if (index === undefined) {
      lines.push(line);
      keyLineIndex.set(key, lines.length - 1);
    } else {
      lines[index] = line;
    }

    process.env[key] = value;
  }

  const content = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  await writeFile(targetPath, content, 'utf8');
  return targetPath;
}
