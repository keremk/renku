import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBundledBlueprintsRoot, getBundledCatalogRoot, resolveBlueprintSpecifier } from '../../src/lib/config-assets.js';
import { generatePlan } from '../../src/lib/planner.js';
import { writeCliConfig, type CliConfig } from '../../src/lib/cli-config.js';
import { executeBuild } from '../../src/lib/build.js';
import { createCliLogger } from '../../src/lib/logger.js';

const CLI_ROOT = resolve(__dirname, '../../');
const BLUEPRINTS_ROOT = getBundledBlueprintsRoot();
const CATALOG_ROOT = getBundledCatalogRoot();

describe('integration: canonical inputs persist across query/edit', () => {
	let originalApiKey: string | undefined;

	beforeEach(() => {
		// Store original API key and set a test key
		// Dry-run mode requires API key validation (same as live mode)
		originalApiKey = process.env.OPENAI_API_KEY;
		process.env.OPENAI_API_KEY = 'test-api-key-for-dry-run';
	});

	afterEach(() => {
		// Restore original API key
		if (originalApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalApiKey;
		}
	});

	it('saves canonical inputs and reuses them during edit without unknown-id errors', async () => {
		const storageRoot = await mkdtemp(join(tmpdir(), 'renku-builds-'));
		const movieId = 'movie-testcanon';
		const configPath = join(storageRoot, 'cli-config.json');
		const cliConfig: CliConfig = {
			storage: {
				root: storageRoot,
				basePath: 'builds',
			},
			catalog: {
				root: CATALOG_ROOT,
			},
			concurrency: 1,
		};
		process.env.RENKU_CLI_CONFIG = configPath;
		await writeCliConfig(cliConfig, configPath);
		const blueprintPath = await resolveBlueprintSpecifier(
			'video-audio-music.yaml',
			{ cliRoot: CLI_ROOT }
		);
		const inputsPath = resolve(BLUEPRINTS_ROOT, 'cut-scene-video', 'input-template.yaml');
		const logger = createCliLogger({
			level: 'debug',
		});

		// Query flow: generate plan and persist canonical inputs
		const planResult = await generatePlan({
			cliConfig,
			movieId,
			isNew: true,
			inputsPath,
			usingBlueprint: blueprintPath,
			logger,
		});

		// Persist the plan to disk (now required after in-memory planning)
		await planResult.persist();

		expect(
			planResult.resolvedInputs[
				'Input:MusicProducer.force_instrumental'
			]
		).toBe(true);

		// Verify inputs were persisted to events/inputs.log
		const inputsLogPath = resolve(
			storageRoot,
			'builds',
			movieId,
			'events',
			'inputs.log'
		);
		const inputsLogContent = await readFile(inputsLogPath, 'utf8');
		const inputEvents = inputsLogContent
			.split('\n')
			.filter(Boolean)
			.map(line => JSON.parse(line) as { id: string; payload: unknown });

		// Find the force_instrumental input event
		const forceInstrumentalEvent = inputEvents.find(
			e => e.id === 'Input:MusicProducer.force_instrumental'
		);
		expect(forceInstrumentalEvent).toBeDefined();
		expect(forceInstrumentalEvent?.payload).toBe(true);

		const trimmedPlan = {
			...planResult.plan,
			layers: planResult.plan.layers.slice(0, 1),
		};

		const result = await executeBuild({
			cliConfig,
			movieId,
			plan: trimmedPlan,
			manifest: planResult.manifest,
			manifestHash: planResult.manifestHash,
			providerOptions: planResult.providerOptions,
			resolvedInputs: planResult.resolvedInputs,
			catalog: planResult.modelCatalog,
			concurrency: 1,
			dryRun: true,
			logger,
		});

		expect(result.summary.jobCount).toBeGreaterThan(0);
		expect(result.summary.counts.failed).toBe(0);
	});
});
