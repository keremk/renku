import { readCliConfig } from '../lib/cli-config.js';
import {
	getCliCatalogRoot,
	updateBundledCatalogAssets,
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

	const catalogRoot =
		cliConfig.catalog?.root ?? getCliCatalogRoot(cliConfig.storage.root);
	await updateBundledCatalogAssets(catalogRoot, {
		sourceRoot: options.catalogSourceRoot,
	});

	return { catalogRoot };
}
