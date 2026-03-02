import { initWorkspace } from '@gorenku/core';
import { getDefaultCliConfigPath, writeEnvTemplate } from '../lib/cli-config.js';
import { expandPath } from '../lib/path.js';
import { catalogExists, getBundledCatalogRoot, getCliCatalogRoot } from '../lib/config-assets.js';

export interface InitOptions {
	rootFolder: string;
	/** Optional config path override (used in tests) */
	configPath?: string;
	/** Optional env file path override (used in tests) */
	envPath?: string;
	/** Optional catalog source override (used in tests) */
	catalogSourceRoot?: string;
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
		throw new Error(
			'--root is required. Please specify the root directory for Renku storage.'
		);
	}

	const rootFolder = expandPath(options.rootFolder);
	const catalogRoot = getCliCatalogRoot(rootFolder);

	// Check if this folder is already initialized
	if (await catalogExists(catalogRoot)) {
		throw new Error(
			`Workspace already initialized at "${rootFolder}". Use "renku update" to update the catalog.`
		);
	}

	const configPath = options.configPath ?? getDefaultCliConfigPath();
	const catalogSourceRoot = options.catalogSourceRoot ?? getBundledCatalogRoot();

	const result = await initWorkspace({
		rootFolder,
		catalogSourceRoot,
		configPath,
	});

	const envResult = await writeEnvTemplate(options.envPath);

	return {
		rootFolder: result.rootFolder,
		cliConfigPath: result.cliConfigPath,
		envFilePath: envResult.path,
		envFileCreated: envResult.created,
		gitignoreCreated: result.gitignoreCreated,
	};
}
