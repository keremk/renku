import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBlueprintSpecifier } from '../../src/lib/config-assets.js';
import { loadBlueprintBundle } from '../../src/lib/blueprint-loader/index.js';
import { generatePlan } from '../../src/lib/planner.js';
import { writeCliConfig } from '../../src/lib/cli-config.js';
import { executeDryRun } from '../../src/lib/dry-run.js';
import { loadInputsFromYaml } from '../../src/lib/input-loader.js';
import { createCliLogger } from '../../src/lib/logger.js';

const CLI_ROOT = resolve(__dirname, '../../');

describe('integration: canonical inputs persist across query/edit', () => {
	it('saves canonical inputs and reuses them during edit without unknown-id errors', async () => {
		const storageRoot = await mkdtemp(join(tmpdir(), 'renku-builds-'));
		const movieId = 'movie-testcanon';
		const configPath = join(storageRoot, 'cli-config.json');
		const cliConfig = {
			storage: {
				root: storageRoot,
				basePath: 'builds',
			},
			concurrency: 1,
		};
		process.env.RENKU_CLI_CONFIG = configPath;
		await writeCliConfig(cliConfig, configPath);
		const blueprintPath = await resolveBlueprintSpecifier(
			'video-audio-music.yaml',
			{ cliRoot: CLI_ROOT }
		);
		const inputsPath = resolve(CLI_ROOT, 'config/inputs.yaml');
		const { root: blueprint } = await loadBlueprintBundle(blueprintPath);
		const logger = createCliLogger({
			mode: 'log',
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

		expect(
			planResult.resolvedInputs[
				'Input:MusicProducer.MusicProducer.force_instrumental'
			]
		).toBe(true);

		// Edit flow: reload saved inputs and run dry-run using the stored plan artefacts
		const savedInputsPath = resolve(
			storageRoot,
			'builds',
			movieId,
			'inputs.yaml'
		);
		const reloaded = await loadInputsFromYaml(savedInputsPath, blueprint);
		expect(
			reloaded.values['Input:MusicProducer.MusicProducer.force_instrumental']
		).toBe(true);

		const trimmedPlan = {
			...planResult.plan,
			layers: planResult.plan.layers.slice(0, 1),
		};

		const dryRun = await executeDryRun({
			movieId,
			plan: trimmedPlan,
			manifest: planResult.manifest,
			manifestHash: planResult.manifestHash,
			providerOptions: planResult.providerOptions,
			resolvedInputs: planResult.resolvedInputs,
			storage: { rootDir: storageRoot, basePath: 'builds' },
			concurrency: 1,
			logger,
		});

		expect(dryRun.jobCount).toBeGreaterThan(0);
		expect(dryRun.statusCounts.failed).toBe(0);
	});
});
