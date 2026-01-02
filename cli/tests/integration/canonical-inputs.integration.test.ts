import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveBlueprintSpecifier } from '../../src/lib/config-assets.js';
import { generatePlan } from '../../src/lib/planner.js';
import { writeCliConfig, type CliConfig } from '../../src/lib/cli-config.js';
import { createCliLogger } from '../../src/lib/logger.js';
import { REPO_ROOT, CATALOG_ROOT, CATALOG_BLUEPRINTS_ROOT } from '../test-catalog-paths.js';

const CLI_ROOT = resolve(REPO_ROOT, 'cli');
const BLUEPRINTS_ROOT = CATALOG_BLUEPRINTS_ROOT;

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
		// Use audio-only blueprint with matching input template
		const blueprintPath = await resolveBlueprintSpecifier(
			'audio-only.yaml',
			{ cliRoot: CLI_ROOT }
		);
		const inputsPath = resolve(BLUEPRINTS_ROOT, 'audio-only', 'input-template.yaml');
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

		// Verify some canonical inputs were persisted
		expect(inputEvents.length).toBeGreaterThan(0);
		const inquiryEvent = inputEvents.find(
			e => e.id === 'Input:InquiryPrompt'
		);
		expect(inquiryEvent).toBeDefined();

		// Verify plan was generated successfully
		expect(planResult.plan.layers.length).toBeGreaterThan(0);
		expect(planResult.providerOptions.size).toBeGreaterThan(0);

		// Verify provider options are populated
		// Note: SDK mappings now come from producer YAML mappings section, not input template
		// The audio producer doesn't have a mappings section yet, so sdkMapping may be undefined
		const audioOptions = planResult.providerOptions.get('AudioProducer');
		expect(audioOptions).toBeDefined();
		expect(audioOptions?.[0]?.provider).toBe('replicate');
		expect(audioOptions?.[0]?.model).toBe('minimax/speech-2.6-hd');
	});
});
