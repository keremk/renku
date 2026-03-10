import { access, copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { parse, resolve, sep } from 'node:path';
import {
  initWorkspace,
  readCliConfig,
  updateWorkspaceCatalog,
  writeCliConfig,
  type CliConfig,
} from './workspace.js';

const REQUIRED_CATALOG_DIRECTORIES = [
  'blueprints',
  'models',
  'producers',
] as const;

export interface SwitchWorkspaceRootOptions {
  targetRootFolder: string;
  catalogSourceRoot: string;
  configPath?: string;
  migrateContent: boolean;
  requireExistingWorkspace: boolean;
  syncCatalog: boolean;
}

export type SwitchWorkspaceRootMode =
  | 'switched-existing'
  | 'initialized'
  | 'migrated';

export interface SwitchWorkspaceRootResult {
  rootFolder: string;
  catalogRoot: string;
  mode: SwitchWorkspaceRootMode;
}

export interface WorkspaceService {
  // eslint-disable-next-line no-unused-vars
  switchWorkspaceRoot(
    options: SwitchWorkspaceRootOptions
  ): Promise<SwitchWorkspaceRootResult>;
}

export function createWorkspaceService(): WorkspaceService {
  return {
    async switchWorkspaceRoot(options) {
      const targetRootFolder = options.targetRootFolder.trim();
      if (targetRootFolder === '') {
        throw new Error(
          '--root is required. Please specify the workspace root directory.'
        );
      }

      const catalogSourceRootInput = options.catalogSourceRoot.trim();
      if (catalogSourceRootInput === '') {
        throw new Error('catalogSourceRoot is required to switch workspace.');
      }

      const existingConfig = await readCliConfig(options.configPath);
      if (!existingConfig) {
        throw new Error(
          'Renku CLI is not initialized. Run "renku init" first.'
        );
      }

      const currentRootFolder = resolve(existingConfig.storage.root);
      const targetRoot = resolve(targetRootFolder);
      const targetCatalogRoot = resolve(targetRoot, 'catalog');
      const catalogSourceRoot = resolve(catalogSourceRootInput);

      assertSafeWorkspaceRoot(targetRoot);

      if (targetRoot === currentRootFolder) {
        throw new Error('Selected workspace root is already active.');
      }

      const targetHasWorkspace = await isExistingWorkspaceRoot(targetRoot);

      if (options.requireExistingWorkspace && !targetHasWorkspace) {
        throw new Error(
          `Not a valid Renku workspace at "${targetRoot}". Run "renku init --root=${targetRoot}" first.`
        );
      }

      if (targetHasWorkspace) {
        if (options.syncCatalog) {
          await updateWorkspaceCatalog({
            rootFolder: targetRoot,
            catalogSourceRoot,
            configuredCatalogRoot: targetCatalogRoot,
          });
        }

        await writeCliConfig(
          buildUpdatedCliConfig(existingConfig, targetRoot),
          options.configPath
        );

        return {
          rootFolder: targetRoot,
          catalogRoot: targetCatalogRoot,
          mode: 'switched-existing',
        };
      }

      if (options.migrateContent) {
        assertRootsDoNotOverlap(currentRootFolder, targetRoot);
        await ensureMissingOrEmptyDirectory(targetRoot);

        await copyDirectory(currentRootFolder, targetRoot, {
          overwrite: false,
        });

        if (options.syncCatalog) {
          await updateWorkspaceCatalog({
            rootFolder: targetRoot,
            catalogSourceRoot,
            configuredCatalogRoot: targetCatalogRoot,
          });
        }

        await writeCliConfig(
          buildUpdatedCliConfig(existingConfig, targetRoot),
          options.configPath
        );

        return {
          rootFolder: targetRoot,
          catalogRoot: targetCatalogRoot,
          mode: 'migrated',
        };
      }

      await ensureMissingOrEmptyDirectory(targetRoot);

      await initWorkspace({
        rootFolder: targetRoot,
        catalogSourceRoot,
        configPath: options.configPath,
      });

      await writeCliConfig(
        buildUpdatedCliConfig(existingConfig, targetRoot),
        options.configPath
      );

      return {
        rootFolder: targetRoot,
        catalogRoot: targetCatalogRoot,
        mode: 'initialized',
      };
    },
  };
}

function buildUpdatedCliConfig(
  config: CliConfig,
  rootFolder: string
): CliConfig {
  const basePath = config.storage.basePath;
  if (typeof basePath !== 'string' || basePath.trim() === '') {
    throw new Error('CLI config is invalid: storage.basePath must be set.');
  }

  return {
    ...config,
    storage: {
      root: rootFolder,
      basePath,
    },
    catalog: {
      root: resolve(rootFolder, 'catalog'),
    },
  };
}

interface CopyDirectoryOptions {
  overwrite: boolean;
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
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!options.overwrite && (await pathExists(targetPath))) {
      continue;
    }

    await copyFile(sourcePath, targetPath);
  }
}

async function isExistingWorkspaceRoot(rootFolder: string): Promise<boolean> {
  const catalogRoot = resolve(rootFolder, 'catalog');
  if (!(await directoryExists(catalogRoot))) {
    return false;
  }

  for (const directory of REQUIRED_CATALOG_DIRECTORIES) {
    const candidate = resolve(catalogRoot, directory);
    if (!(await directoryExists(candidate))) {
      return false;
    }
  }

  return true;
}

async function ensureMissingOrEmptyDirectory(path: string): Promise<void> {
  if (!(await pathExists(path))) {
    return;
  }

  const entry = await stat(path);
  if (!entry.isDirectory()) {
    throw new Error(`Target path "${path}" exists and is not a directory.`);
  }

  const entries = await readdir(path);
  if (entries.length > 0) {
    throw new Error(
      `Target folder "${path}" is not empty and is not a valid Renku workspace. Choose an empty folder, or select an existing Renku workspace.`
    );
  }
}

function assertRootsDoNotOverlap(sourceRoot: string, targetRoot: string): void {
  if (
    isSameOrNestedPath(sourceRoot, targetRoot) ||
    isSameOrNestedPath(targetRoot, sourceRoot)
  ) {
    throw new Error(
      `Cannot migrate workspace content between overlapping paths: "${sourceRoot}" and "${targetRoot}".`
    );
  }
}

function isSameOrNestedPath(rootPath: string, candidatePath: string): boolean {
  if (rootPath === candidatePath) {
    return true;
  }

  const withSeparator = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;
  return candidatePath.startsWith(withSeparator);
}

function assertSafeWorkspaceRoot(rootFolder: string): void {
  const filesystemRoot = parse(rootFolder).root;
  if (rootFolder === filesystemRoot) {
    throw new Error(
      `Refusing to switch workspace to "${rootFolder}" because it is a filesystem root.`
    );
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
