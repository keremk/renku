import { resolve } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { formatMovieId } from '../../src/commands/execute.js';
import { generatePlan } from '../../src/lib/planner.js';
import {
	getDefaultCliConfigPath,
	readCliConfig,
} from '../../src/lib/cli-config.js';
import {
	createLoggerRecorder,
	expectFileExists,
	readPlan,
	setupTempCliConfig,
} from './helpers.js';
import { CLI_FIXTURES_BLUEPRINTS } from '../test-catalog-paths.js';

describe('end-to-end: conditional fan-in inference', () => {
	let restoreEnv: () => void = () => {};

	beforeEach(async () => {
		const config = await setupTempCliConfig();
		restoreEnv = config.restoreEnv;
	});

	afterEach(() => {
		restoreEnv();
	});

	it('infers fan-in for conditional multi-source video and singleton music', async () => {
		const fixtureRoot = resolve(
			CLI_FIXTURES_BLUEPRINTS,
			'celebrity-then-now-lite'
		);
		const blueprintPath = resolve(fixtureRoot, 'celebrity-then-now-lite.yaml');
		const inputsPath = resolve(fixtureRoot, 'input-template.yaml');

		const { logger, warnings, errors } = createLoggerRecorder();
		const movieId = 'e2e-conditional-fanin';
		const storageMovieId = formatMovieId(movieId);

		const configPath = getDefaultCliConfigPath();
		const cliConfig = await readCliConfig(configPath);
		if (!cliConfig) {
			throw new Error('CLI config not initialized');
		}

		const planResult = await generatePlan({
			cliConfig,
			movieId: storageMovieId,
			isNew: true,
			inputsPath,
			usingBlueprint: blueprintPath,
			logger,
			notifications: undefined,
		});

		await planResult.persist();
		expect(warnings).toHaveLength(0);
		expect(errors).toHaveLength(0);
		await expectFileExists(planResult.planPath);

		const plan = await readPlan(planResult.planPath);
		const timelineJob = plan.layers
			.flat()
			.find((job: any) => job.producer === 'TimelineComposer');

		expect(timelineJob).toBeDefined();
		if (!timelineJob) {
			throw new Error('TimelineComposer job missing from plan');
		}

		const videoFanIn =
			timelineJob.context?.fanIn?.['Input:TimelineComposer.VideoSegments'];
		expect(videoFanIn).toBeDefined();
		expect(videoFanIn?.groupBy).toBe('character');
		expect(videoFanIn?.orderBy).toBeUndefined();
		expect(videoFanIn?.members).toHaveLength(6);
		expect(videoFanIn?.members.map((member: any) => member.group)).toEqual([
			0, 1, 2, 0, 1, 2,
		]);
		expect(videoFanIn?.members[0]?.id).toContain(
			'Artifact:MeetingVideoProducer.GeneratedVideo[0]'
		);
		expect(videoFanIn?.members[3]?.id).toContain(
			'Artifact:TransitionVideoProducer.GeneratedVideo[0]'
		);

		const musicFanIn =
			timelineJob.context?.fanIn?.['Input:TimelineComposer.Music'];
		expect(musicFanIn).toBeDefined();
		expect(musicFanIn?.groupBy).toBe('singleton');
		expect(musicFanIn?.members).toHaveLength(1);
		expect(musicFanIn?.members[0]?.id).toBe(
			'Artifact:MusicProducer.GeneratedMusic'
		);

		const conditionalIds = Object.keys(
			timelineJob.context?.inputConditions ?? {}
		);
		expect(
			conditionalIds.some((id) =>
				id.startsWith('Artifact:TransitionVideoProducer.GeneratedVideo')
			)
		).toBe(true);
	});
});
