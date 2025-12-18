import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  getDefaultCliConfigPath,
  writeCliConfig,
  writeEnvTemplate,
  type CliConfig,
} from '../lib/cli-config.js';
import { expandPath } from '../lib/path.js';
import {
  copyBundledCatalogAssets,
  getCliCatalogRoot,
} from '../lib/config-assets.js';

export interface InitOptions {
  rootFolder: string;
  /** Optional config path override (used in tests) */
  configPath?: string;
  /** Optional env file path override (used in tests) */
  envPath?: string;
}

export interface InitResult {
  rootFolder: string;
  buildsFolder: string;
  cliConfigPath: string;
  envFilePath: string;
  envFileCreated: boolean;
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  if (!options.rootFolder || options.rootFolder.trim() === '') {
    throw new Error('--root-folder is required. Please specify the root directory for Renku storage.');
  }

  const rootFolder = expandPath(options.rootFolder);
  const buildsFolder = resolve(rootFolder, 'builds');
  const cliConfigPath = options.configPath ?? getDefaultCliConfigPath();

  await mkdir(rootFolder, { recursive: true });
  await mkdir(buildsFolder, { recursive: true });
  await copyBundledCatalogAssets(getCliCatalogRoot(rootFolder));

  const cliConfig: CliConfig = {
    storage: {
      root: rootFolder,
      basePath: 'builds',
    },
    catalog: {
      root: getCliCatalogRoot(rootFolder),
    },
    concurrency: 1,
  };
  await writeCliConfig(cliConfig, cliConfigPath);

  const envResult = await writeEnvTemplate(options.envPath);

  return {
    rootFolder,
    buildsFolder,
    cliConfigPath,
    envFilePath: envResult.path,
    envFileCreated: envResult.created,
  };
}
