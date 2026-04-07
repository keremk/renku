import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatMovieId, runExecute } from '../../../src/commands/execute.js';
import {
	createLoggerRecorder,
	expectFileExists,
	findJob,
	readPlan,
	setupTempCliConfig,
} from '../helpers.js';
import {
	CLI_FIXTURES_BLUEPRINTS,
	CLI_FIXTURES_INPUTS,
} from '../../test-catalog-paths.js';

function parseFirstIndex(jobId: string): number {
	const match = jobId.match(/\[(\d+)\]/);
	if (!match) {
		throw new Error(`Expected indexed jobId, got "${jobId}"`);
	}
	return parseInt(match[1]!, 10);
}

describe('end-to-end: harness prompt arrays wired to looped downstream producers', () => {
	let restoreEnv: () => void = () => {};

	beforeEach(async () => {
		const config = await setupTempCliConfig();
		restoreEnv = config.restoreEnv;
	});

	afterEach(() => {
		restoreEnv();
	});

	it('executes dry-run using system loop inputs and canonical indexed bindings without a prompt producer stage', async () => {
		const blueprintPath = resolve(
			CLI_FIXTURES_BLUEPRINTS,
			'pipeline-orchestration',
			'harness-prompt-arrays-looped-producers',
			'harness-prompt-arrays-looped-producers.yaml'
		);
		const inputsPath = resolve(
			CLI_FIXTURES_INPUTS,
			'harness-prompt-arrays-looped-producers--default.inputs.yaml'
		);

		const { logger, warnings, errors } = createLoggerRecorder();
		const movieId = 'e2e-harness-prompt-arrays-looped-producers';
		const storageMovieId = formatMovieId(movieId);

		const result = await runExecute({
			storageMovieId,
			movieId,
			isNew: true,
			inputsPath,
			blueprintSpecifier: blueprintPath,
			dryRun: true,
			nonInteractive: true,
			logger,
		});

		if (result.build?.status !== 'succeeded') {
			throw new Error(`dryRun failed: ${JSON.stringify(result.build, null, 2)}`);
		}

		expect(result.build?.jobCount).toBe(9);
		expect(result.build?.counts.failed).toBe(0);
		expect(warnings).toHaveLength(0);
		expect(errors).toHaveLength(0);
		await expectFileExists(result.planPath);

		const plan = await readPlan(result.planPath);
		const jobs = plan.layers.flat();

		const promptStageJobs = jobs.filter((job: any) =>
			/PromptProducer|Director/.test(job.producer)
		);
		expect(promptStageJobs).toHaveLength(0);

		const characterJobs = jobs
			.filter((job: any) => job.producer === 'CharacterImageProducer')
			.sort(
				(a: any, b: any) => parseFirstIndex(a.jobId) - parseFirstIndex(b.jobId)
			);
		expect(characterJobs).toHaveLength(2);
		for (const job of characterJobs) {
			const index = parseFirstIndex(job.jobId);
			expect(job.context?.inputBindings?.Prompt).toBe(
				`Input:CharacterImagePrompt[${index}]`
			);
			expect(job.context?.inputBindings?.Resolution).toBe('Input:Resolution');
			expect(job.inputs).toContain(`Input:CharacterImagePrompt[${index}]`);
		}

		const storyboardJobs = jobs
			.filter((job: any) => job.producer === 'StoryboardImageProducer')
			.sort(
				(a: any, b: any) => parseFirstIndex(a.jobId) - parseFirstIndex(b.jobId)
			);
		expect(storyboardJobs).toHaveLength(3);
		for (const job of storyboardJobs) {
			const index = parseFirstIndex(job.jobId);
			expect(job.context?.inputBindings?.Prompt).toBe(
				`Input:StoryboardImagePrompt[${index}]`
			);
			expect(job.context?.inputBindings?.['SourceImages[0]']).toBe(
				'Artifact:CharacterImageProducer.ComposedImage[0]'
			);
			expect(job.context?.inputBindings?.['SourceImages[1]']).toBe(
				'Artifact:CharacterImageProducer.ComposedImage[1]'
			);
			expect(job.inputs).toContain('Artifact:CharacterImageProducer.ComposedImage[0]');
			expect(job.inputs).toContain('Artifact:CharacterImageProducer.ComposedImage[1]');
		}

		const sceneVideoJobs = jobs
			.filter((job: any) => job.producer === 'SceneVideoProducer')
			.sort(
				(a: any, b: any) => parseFirstIndex(a.jobId) - parseFirstIndex(b.jobId)
			);
		expect(sceneVideoJobs).toHaveLength(3);
		for (const job of sceneVideoJobs) {
			const index = parseFirstIndex(job.jobId);
			expect(job.context?.inputBindings?.Prompt).toBe(
				`Input:SceneVideoPrompt[${index}]`
			);
			expect(job.context?.inputBindings?.StartImage).toBe(
				`Artifact:StoryboardImageProducer.ComposedImage[${index}]`
			);
			expect(job.context?.inputBindings?.Duration).toBe('Input:SegmentDuration');
			expect(job.inputs).toContain('Input:SegmentDuration');
		}

		const timelineJob = findJob(plan, 'TimelineComposer');
		expect(timelineJob).toBeDefined();
		if (!timelineJob) {
			throw new Error('TimelineComposer job missing from plan');
		}
		expect(timelineJob.context?.inputBindings?.Duration).toBe('Input:Duration');
		expect(timelineJob.inputs).toEqual(
			expect.arrayContaining([
				'Input:TimelineComposer.VideoSegments',
				'Input:Duration',
			])
		);
		expect(
			timelineJob.context?.fanIn?.['Input:TimelineComposer.VideoSegments']
				?.members?.length
		).toBe(3);
	});
});
