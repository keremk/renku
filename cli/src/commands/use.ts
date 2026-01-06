import {
  readCliConfig,
  writeCliConfig,
  type CliConfig,
} from '../lib/cli-config.js';
import { expandPath } from '../lib/path.js';
import {
  getCliCatalogRoot,
  isValidWorkspace,
} from '../lib/config-assets.js';

export interface UseOptions {
  rootFolder: string;
  /** Optional config path override (used in tests) */
  configPath?: string;
}

export interface UseResult {
  rootFolder: string;
  catalogRoot: string;
}

export async function runUse(options: UseOptions): Promise<UseResult> {
  if (!options.rootFolder || options.rootFolder.trim() === '') {
    throw new Error('--root is required. Please specify the workspace root directory.');
  }

  const rootFolder = expandPath(options.rootFolder);

  // Check if it's a valid Renku workspace
  if (!(await isValidWorkspace(rootFolder))) {
    throw new Error(
      `Not a valid Renku workspace at "${rootFolder}". Run "renku init --root=${options.rootFolder}" first.`,
    );
  }

  const catalogRoot = getCliCatalogRoot(rootFolder);

  // Read existing config to preserve other settings (like viewer preferences)
  const existingConfig = await readCliConfig(options.configPath);

  const cliConfig: CliConfig = {
    ...existingConfig,
    storage: {
      root: rootFolder,
      basePath: existingConfig?.storage.basePath ?? 'builds',
    },
    catalog: {
      root: catalogRoot,
    },
  };

  await writeCliConfig(cliConfig, options.configPath);

  return { rootFolder, catalogRoot };
}
