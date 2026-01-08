import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  getDefaultCliConfigPath,
  writeCliConfig,
  writeEnvTemplate,
  type CliConfig,
} from '../lib/cli-config.js';
import { expandPath } from '../lib/path.js';
import {
  catalogExists,
  copyBundledCatalogAssets,
  getCliCatalogRoot,
} from '../lib/config-assets.js';

const GITIGNORE_CONTENT = `# Renku build data (large binary files)
**/builds/

# Artifact symlinks (only work locally, useless without builds)
**/artifacts/
`;

export interface InitOptions {
  rootFolder: string;
  /** Optional config path override (used in tests) */
  configPath?: string;
  /** Optional env file path override (used in tests) */
  envPath?: string;
}

export interface InitResult {
  rootFolder: string;
  cliConfigPath: string;
  envFilePath: string;
  envFileCreated: boolean;
  gitignoreCreated: boolean;
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  if (!options.rootFolder || options.rootFolder.trim() === '') {
    throw new Error('--root is required. Please specify the root directory for Renku storage.');
  }

  const rootFolder = expandPath(options.rootFolder);
  const catalogRoot = getCliCatalogRoot(rootFolder);

  // Check if this folder is already initialized
  if (await catalogExists(catalogRoot)) {
    throw new Error(
      `Workspace already initialized at "${rootFolder}". Use "renku update" to update the catalog.`,
    );
  }

  const cliConfigPath = options.configPath ?? getDefaultCliConfigPath();

  await mkdir(rootFolder, { recursive: true });
  await copyBundledCatalogAssets(catalogRoot);

  // Generate .gitignore (only if it doesn't exist)
  const gitignorePath = resolve(rootFolder, '.gitignore');
  const gitignoreCreated = await writeGitignore(gitignorePath);

  const cliConfig: CliConfig = {
    storage: {
      root: rootFolder,
      basePath: 'builds',
    },
    catalog: {
      root: catalogRoot,
    },
    concurrency: 1,
  };
  await writeCliConfig(cliConfig, cliConfigPath);

  const envResult = await writeEnvTemplate(options.envPath);

  return {
    rootFolder,
    cliConfigPath,
    envFilePath: envResult.path,
    envFileCreated: envResult.created,
    gitignoreCreated,
  };
}

async function writeGitignore(path: string): Promise<boolean> {
  try {
    await access(path);
    // File exists, don't overwrite
    return false;
  } catch {
    // File doesn't exist, create it
    await writeFile(path, GITIGNORE_CONTENT, 'utf8');
    return true;
  }
}
