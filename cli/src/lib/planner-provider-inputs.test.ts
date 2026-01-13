import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatePlan } from './planner.js';
import type { CliConfig } from './cli-config.js';
import { createCliLogger } from './logger.js';
import { CATALOG_ROOT, CLI_FIXTURES_BLUEPRINTS } from '../../tests/test-catalog-paths.js';

const catalogRoot = CATALOG_ROOT;

describe('planner provider inputs', () => {
	it('includes provider/model inputs for ImageProducer jobs', async () => {
		const tempRoot = await mkdtemp(resolve(tmpdir(), 'renku-plan-'));
		const cliConfig: CliConfig = {
			storage: { root: tempRoot, basePath: 'builds' },
			catalog: { root: catalogRoot },
		};
		// Use CLI fixtures (condition-example has ImageProducer)
		const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'condition-example', 'condition-example.yaml');
		const inputsPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'condition-example', 'input-template.yaml');

		try {
			const { plan } = await generatePlan({
				cliConfig,
				movieId: 'movie-test',
				isNew: true,
				inputsPath,
				usingBlueprint: blueprintPath,
				logger: createCliLogger({
					level: 'debug',
				}),
				notifications: undefined,
			});

			const imageJobs = plan.layers
				.flat()
				.filter((job) => job.producer === 'ImageProducer');
			expect(imageJobs.length).toBeGreaterThan(0);
			for (const job of imageJobs) {
				expect(job.inputs).toContain(
					'Input:ImageProducer.provider'
				);
				expect(job.inputs).toContain('Input:ImageProducer.model');
			}
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});
});
