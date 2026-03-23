import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runUpdate } from './update.js';
import { runInit } from './init.js';
import {
	getCliBlueprintsRoot,
	getCliCatalogRoot,
} from '../lib/config-assets.js';
import { CLI_FIXTURES_CATALOG } from '../../tests/test-catalog-paths.js';

const tmpRoots: string[] = [];

afterEach(async () => {
	while (tmpRoots.length) {
		const dir = tmpRoots.pop();
		if (dir) {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

async function createTempRoot(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'renku-update-'));
	tmpRoots.push(dir);
	return dir;
}

describe('runUpdate', () => {
	it('updates catalog when workspace is initialized', async () => {
		const root = await createTempRoot();
		const configPath = resolve(root, 'cli-config.json');
		const envPath = resolve(root, 'env.sh');

		// Initialize workspace first
		await runInit({
			rootFolder: root,
			configPath,
			envPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		// Modify a catalog file to verify it gets overwritten
		const catalogModelPath = join(
			getCliCatalogRoot(root),
			'models',
			'openai',
			'openai.yaml'
		);
		const originalContent = await readFile(catalogModelPath, 'utf8');
		await writeFile(catalogModelPath, '# Modified content', 'utf8');

		// Add stale entries that should be removed
		const staleFilePath = join(getCliBlueprintsRoot(root), 'stale.yaml');
		const staleDirFilePath = join(
			getCliBlueprintsRoot(root),
			'stale-dir',
			'old.yaml'
		);
		await writeFile(staleFilePath, 'stale', 'utf8');
		await mkdir(join(getCliBlueprintsRoot(root), 'stale-dir'), {
			recursive: true,
		});
		await writeFile(staleDirFilePath, 'stale dir', 'utf8');

		// Run update
		const result = await runUpdate({
			configPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		expect(result.catalogRoot).toBe(join(root, 'catalog'));

		// Verify the file was overwritten
		const updatedContent = await readFile(catalogModelPath, 'utf8');
		expect(updatedContent).toBe(originalContent);

		// Verify stale entries are removed
		await expect(readFile(staleFilePath, 'utf8')).rejects.toThrow();
		await expect(readFile(staleDirFilePath, 'utf8')).rejects.toThrow();
	});

	it('fails when configured catalog root is non-canonical', async () => {
		const root = await createTempRoot();
		const configPath = resolve(root, 'cli-config.json');
		const envPath = resolve(root, 'env.sh');

		await runInit({
			rootFolder: root,
			configPath,
			envPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const configJson = JSON.parse(await readFile(configPath, 'utf8')) as {
			storage: { root: string; basePath: string };
			catalog: { root: string };
		};
		configJson.catalog.root = join(root, 'custom-catalog');
		await writeFile(configPath, JSON.stringify(configJson, null, 2), 'utf8');

		await expect(
			runUpdate({ configPath, catalogSourceRoot: CLI_FIXTURES_CATALOG })
		).rejects.toThrow(/does not match canonical workspace catalog root/);
	});

	it('throws error when workspace is not initialized', async () => {
		const root = await createTempRoot();
		const configPath = resolve(root, 'cli-config.json');

		await expect(runUpdate({ configPath })).rejects.toThrow(
			/Renku CLI is not initialized/
		);
	});
});
