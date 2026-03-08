import { updateWorkspaceCatalog } from '@gorenku/core';
import { readCliConfig } from '../lib/cli-config.js';
import {
	getBundledCatalogRoot,
	getCliCatalogRoot,
} from '../lib/config-assets.js';

export interface UpdateOptions {
	/** Optional config path override (used in tests) */
	configPath?: string;
	/** Optional catalog source override (used in tests) */
	catalogSourceRoot?: string;
}

export interface UpdateResult {
	catalogRoot: string;
}

export async function runUpdate(
	options: UpdateOptions = {}
): Promise<UpdateResult> {
	const cliConfig = await readCliConfig(options.configPath);
	if (!cliConfig) {
		throw new Error('Renku CLI is not initialized. Run "renku init" first.');
	}

	const catalogRoot = getCliCatalogRoot(cliConfig.storage.root);
	const catalogSourceRoot =
		options.catalogSourceRoot ?? getBundledCatalogRoot();

	await updateWorkspaceCatalog({
		rootFolder: cliConfig.storage.root,
		catalogSourceRoot,
		configuredCatalogRoot: cliConfig.catalog?.root,
	});

	return { catalogRoot };
}
