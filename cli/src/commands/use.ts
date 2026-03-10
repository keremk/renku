import { createWorkspaceService, type CliConfig } from '@gorenku/core';
import { readCliConfig, writeCliConfig } from '../lib/cli-config.js';
import { expandPath } from '../lib/path.js';
import {
	getBundledCatalogRoot,
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
		throw new Error(
			'--root is required. Please specify the workspace root directory.'
		);
	}

	const rootFolder = expandPath(options.rootFolder);

	if (!(await isValidWorkspace(rootFolder))) {
		throw new Error(
			`Not a valid Renku workspace at "${rootFolder}". Run "renku init --root=${options.rootFolder}" first.`
		);
	}

	const existingConfig = await readCliConfig(options.configPath);
	if (!existingConfig) {
		const catalogRoot = getCliCatalogRoot(rootFolder);
		const cliConfig: CliConfig = {
			storage: {
				root: rootFolder,
				basePath: 'builds',
			},
			catalog: {
				root: catalogRoot,
			},
		};

		await writeCliConfig(cliConfig, options.configPath);
		return { rootFolder, catalogRoot };
	}

	const workspaceService = createWorkspaceService();
	const result = await workspaceService.switchWorkspaceRoot({
		targetRootFolder: rootFolder,
		catalogSourceRoot: getBundledCatalogRoot(),
		configPath: options.configPath,
		migrateContent: false,
		requireExistingWorkspace: true,
		syncCatalog: false,
	});

	return { rootFolder: result.rootFolder, catalogRoot: result.catalogRoot };
}
