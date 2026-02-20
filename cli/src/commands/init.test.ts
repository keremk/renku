import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { readCliConfig } from '../lib/cli-config.js';
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
	const dir = await mkdtemp(join(tmpdir(), 'renku-init-'));
	tmpRoots.push(dir);
	return dir;
}

describe('runInit', () => {
	it('creates catalog, gitignore, config files, and CLI config', async () => {
		const root = await createTempRoot();
		const configPath = resolve(root, 'cli-config.json');
		const result = await runInit({
			rootFolder: root,
			configPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		// Check that .gitignore was created
		const gitignoreStats = await stat(join(result.rootFolder, '.gitignore'));
		expect(gitignoreStats.isFile()).toBe(true);
		expect(result.gitignoreCreated).toBe(true);

		const blueprintStats = await stat(
			join(
				getCliBlueprintsRoot(result.rootFolder),
				'interface-only',
				'interface-only.yaml'
			)
		);
		expect(blueprintStats.isFile()).toBe(true);
		const modelStats = await stat(
			join(
				getCliCatalogRoot(result.rootFolder),
				'models',
				'openai',
				'openai.yaml'
			)
		);
		expect(modelStats.isFile()).toBe(true);
		const producerStats = await stat(
			join(
				getCliCatalogRoot(result.rootFolder),
				'producers',
				'asset',
				'text-to-speech.yaml'
			)
		);
		expect(producerStats.isFile()).toBe(true);
		await expect(async () => {
			await stat(join(result.rootFolder, 'blueprints'));
		}).rejects.toThrow();

		const cliConfig = await readCliConfig(result.cliConfigPath);
		expect(cliConfig?.storage.root).toBe(result.rootFolder);
		expect(cliConfig?.storage.basePath).toBe('builds');
		expect(cliConfig?.concurrency).toBe(1);
	});

	it('creates env.sh template file with API key placeholders', async () => {
		const root = await createTempRoot();
		const configPath = resolve(root, 'cli-config.json');
		const envPath = resolve(root, 'env.sh');
		const result = await runInit({
			rootFolder: root,
			configPath,
			envPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		expect(result.envFilePath).toBe(envPath);
		expect(result.envFileCreated).toBe(true);

		const envContent = await readFile(envPath, 'utf8');
		expect(envContent).toContain('export REPLICATE_API_TOKEN=');
		expect(envContent).toContain('export FAL_KEY=');
		expect(envContent).toContain('export WAVESPEED_API_KEY=');
		expect(envContent).toContain('export OPENAI_API_KEY=');
	});

	it('does not overwrite existing env.sh file', async () => {
		const root = await createTempRoot();
		const configPath = resolve(root, 'cli-config.json');
		const envPath = resolve(root, 'env.sh');

		const existingContent = 'export OPENAI_API_KEY="my-real-key"';
		await writeFile(envPath, existingContent, 'utf8');

		const result = await runInit({
			rootFolder: root,
			configPath,
			envPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		expect(result.envFilePath).toBe(envPath);
		expect(result.envFileCreated).toBe(false);

		const envContent = await readFile(envPath, 'utf8');
		expect(envContent).toBe(existingContent);
	});

	it('throws error when trying to init an already-initialized workspace', async () => {
		const root = await createTempRoot();
		const configPath = resolve(root, 'cli-config.json');
		const envPath = resolve(root, 'env.sh');

		// First init should succeed
		await runInit({
			rootFolder: root,
			configPath,
			envPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		// Second init on the same folder should fail
		await expect(
			runInit({
				rootFolder: root,
				configPath,
				envPath,
				catalogSourceRoot: CLI_FIXTURES_CATALOG,
			})
		).rejects.toThrow(/Workspace already initialized/);
	});
});
