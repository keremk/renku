import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generatePlan } from '../planner.js';
import { getBundledBlueprintsRoot, resolveBlueprintSpecifier } from '../config-assets.js';
import type { CliConfig } from '../cli-config.js';
import { createCliLogger } from '../logger.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '../../../..');
const CLI_ROOT = resolve(REPO_ROOT, 'cli');
const BLUEPRINTS_ROOT = getBundledBlueprintsRoot();

describe('planner provider inputs', () => {
	it('includes provider/model inputs for ImageProducer jobs', async () => {
		const tempRoot = await mkdtemp(resolve(tmpdir(), 'renku-plan-'));
		const cliConfig: CliConfig = {
			storage: { root: tempRoot, basePath: 'builds' },
		};
		const blueprintPath = await resolveBlueprintSpecifier('image-audio.yaml', {
			cliRoot: CLI_ROOT,
		});
		const inputsPath = resolve(BLUEPRINTS_ROOT, 'kenn-burns', 'input-template.yaml');

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
