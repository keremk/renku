import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGenerate } from '../../../src/commands/generate.js';
import {
	createLoggerRecorder,
	expectFileExists,
	readPlan,
	setupTempCliConfig,
} from '../helpers.js';
import {
	CLI_FIXTURES_BLUEPRINTS,
	CLI_FIXTURES_INPUTS,
} from '../../test-catalog-paths.js';

function jobIdsByProducer(plan: any, producer: string): string[] {
	return plan.layers
		.flat()
		.filter((job: any) => job.producer === producer)
		.map((job: any) => job.jobId)
		.sort();
}

function jobsByProducer(plan: any, producer: string): any[] {
	return plan.layers
		.flat()
		.filter((job: any) => job.producer === producer);
}

function dimensionIndex(job: any, label: string): number | undefined {
	for (const [symbol, value] of Object.entries(job.context?.indices ?? {})) {
		if (symbol.split(':').at(-1) === label) {
			return value as number;
		}
	}
	return undefined;
}

describe('end-to-end: clip-scoped generation with complex upstream dependencies', () => {
	let tempConfig: Awaited<ReturnType<typeof setupTempCliConfig>>;

	beforeEach(async () => {
		tempConfig = await setupTempCliConfig();
	});

	afterEach(() => {
		tempConfig.restoreEnv();
	});

	it('plans one clip while keeping upstream character-loop and selected multidimensional jobs', async () => {
		const { logger, warnings, errors } = createLoggerRecorder();
		const result = await runGenerate({
			blueprint: resolve(
				CLI_FIXTURES_BLUEPRINTS,
				'pipeline-orchestration',
				'clip-scoped-character-video',
				'clip-scoped-character-video.yaml'
			),
			inputsPath: resolve(
				CLI_FIXTURES_INPUTS,
				'clip-scoped-character-video--default.inputs.yaml'
			),
			dryRun: true,
			nonInteractive: true,
			clip: '2',
			logLevel: 'info',
			storageOverride: {
				root: tempConfig.tempRoot,
				basePath: 'builds',
			},
		});

		expect(result.build?.status).toBe('succeeded');
		expect(result.build?.jobCount).toBe(6);
		expect(warnings).toHaveLength(0);
		expect(errors).toHaveLength(0);
		await expectFileExists(result.planPath);

		const plan = await readPlan(result.planPath);
		expect(jobIdsByProducer(plan, 'CharacterImageProducer')).toHaveLength(2);
		expect(jobIdsByProducer(plan, 'ClipCharacterImageProducer')).toHaveLength(2);
		expect(jobIdsByProducer(plan, 'StoryboardImageProducer')).toHaveLength(1);
		expect(jobIdsByProducer(plan, 'ClipVideoProducer')).toHaveLength(1);
		expect(jobIdsByProducer(plan, 'VideoStitcher')).toHaveLength(0);

		for (const job of jobsByProducer(plan, 'CharacterImageProducer')) {
			expect(dimensionIndex(job, 'clip')).toBeUndefined();
		}

		for (const job of jobsByProducer(plan, 'ClipCharacterImageProducer')) {
			expect(dimensionIndex(job, 'clip')).toBe(1);
			expect([0, 1]).toContain(dimensionIndex(job, 'character'));
		}

		for (const job of [
			...jobsByProducer(plan, 'StoryboardImageProducer'),
			...jobsByProducer(plan, 'ClipVideoProducer'),
		]) {
			expect(dimensionIndex(job, 'clip')).toBe(1);
		}
	});

	it('plans through a clip while excluding later clip work and final assembly', async () => {
		const { logger, warnings, errors } = createLoggerRecorder();
		const result = await runGenerate({
			blueprint: resolve(
				CLI_FIXTURES_BLUEPRINTS,
				'pipeline-orchestration',
				'clip-scoped-character-video',
				'clip-scoped-character-video.yaml'
			),
			inputsPath: resolve(
				CLI_FIXTURES_INPUTS,
				'clip-scoped-character-video--default.inputs.yaml'
			),
			dryRun: true,
			nonInteractive: true,
			throughClip: '2',
			logLevel: 'info',
			storageOverride: {
				root: tempConfig.tempRoot,
				basePath: 'builds',
			},
		});

		expect(result.build?.status).toBe('succeeded');
		expect(result.build?.jobCount).toBe(10);
		expect(warnings).toHaveLength(0);
		expect(errors).toHaveLength(0);
		await expectFileExists(result.planPath);

		const plan = await readPlan(result.planPath);
		expect(jobIdsByProducer(plan, 'CharacterImageProducer')).toHaveLength(2);
		expect(jobIdsByProducer(plan, 'ClipCharacterImageProducer')).toHaveLength(4);
		expect(jobIdsByProducer(plan, 'StoryboardImageProducer')).toHaveLength(2);
		expect(jobIdsByProducer(plan, 'ClipVideoProducer')).toHaveLength(2);
		expect(jobIdsByProducer(plan, 'VideoStitcher')).toHaveLength(0);

		for (const job of plan.layers.flat()) {
			const clipIndex = dimensionIndex(job, 'clip');
			if (clipIndex !== undefined) {
				expect(clipIndex).toBeLessThanOrEqual(1);
			}
		}
	});
});
