/* eslint-env node */
import process from 'node:process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runProducersList } from './producers-list.js';
import { readCliConfig } from '../lib/cli-config.js';
import {
	CLI_FIXTURES_BLUEPRINTS,
	CLI_FIXTURES_CATALOG,
} from '../../tests/test-catalog-paths.js';

const tmpRoots: string[] = [];
const originalEnv = { ...process.env };
const originalConfigPath = process.env.RENKU_CLI_CONFIG;

beforeEach(() => {
	process.env.OPENAI_API_KEY = 'test-key';
});

afterEach(async () => {
	process.env.RENKU_CLI_CONFIG = originalConfigPath;
	for (const [key, value] of Object.entries(originalEnv)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	while (tmpRoots.length) {
		const dir = tmpRoots.pop();
		if (dir) {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

async function createTempRoot(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'renku-producers-list-'));
	tmpRoots.push(dir);
	return dir;
}

describe('runProducersList', () => {
	it('returns empty entries for selection-driven producer blueprints', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});
		const cliConfig = await readCliConfig(cliConfigPath);
		expect(cliConfig).not.toBeNull();

		// Use CLI fixture blueprint with local producer modules (no embedded model variants).
		const blueprintPath = resolve(
			CLI_FIXTURES_BLUEPRINTS,
			'input-binding-dimensions',
			'sibling-dimension-unification',
			'sibling-dimension-unification.yaml'
		);
		const result = await runProducersList({ blueprintPath });

		// Producer/model selection is defined in input templates, not producer declarations.
		expect(result.entries).toEqual([]);

		// missingTokens should still be a Map
		expect(result.missingTokens).toBeInstanceOf(Map);
	});
});
