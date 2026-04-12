/* eslint-env node */
import process from 'node:process';
import './__testutils__/simulated-providers.js';
import {
	copyFile,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runGenerate } from './generate.js';
import { formatMovieId } from './execute.js';
import { readCliConfig } from '../lib/cli-config.js';
import { createInputsFile } from './__testutils__/inputs.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
	CLI_FIXTURES_BLUEPRINTS,
	CLI_FIXTURES_CATALOG,
} from '../../tests/test-catalog-paths.js';
import { RuntimeErrorCode } from '@gorenku/core';

// Use CLI fixtures for blueprints
const VIDEO_AUDIO_MUSIC_BLUEPRINT_PATH = resolve(
	CLI_FIXTURES_BLUEPRINTS,
	'pipeline-orchestration',
	'video-audio-music-timeline',
	'video-audio-music-timeline.yaml'
);
const AUDIO_ONLY_BLUEPRINT_PATH = resolve(
	CLI_FIXTURES_BLUEPRINTS,
	'pipeline-orchestration',
	'audio-narration-loop',
	'audio-narration-loop.yaml'
);
const IMAGE_AUDIO_BLUEPRINT_PATH = resolve(
	CLI_FIXTURES_BLUEPRINTS,
	'pipeline-orchestration',
	'image-narration-timeline',
	'image-narration-timeline.yaml'
);
const AUDIO_ONLY_MODELS = [
	{ producerId: 'ScriptProducer', provider: 'openai', model: 'gpt-5-mini' },
	{
		producerId: 'AudioProducer',
		provider: 'replicate',
		model: 'minimax/speech-2.6-hd',
	},
];
const AUDIO_ONLY_OVERRIDES = {
	Duration: 60,
	NumOfSegments: 3,
	VoiceId: 'default-voice',
	Audience: 'Adult',
	Emotion: 'neutral',
	Language: 'en',
};
const LOG_DEFAULTS = { mode: 'log' as const, logLevel: 'info' as const };

const tmpRoots: string[] = [];
const originalEnvConfig = process.env.RENKU_CLI_CONFIG;

afterEach(async () => {
	process.env.RENKU_CLI_CONFIG = originalEnvConfig;
	while (tmpRoots.length) {
		const dir = tmpRoots.pop();
		if (dir) {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

async function createTempRoot(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'renku-generate-'));
	tmpRoots.push(dir);
	return dir;
}

describe('runGenerate (new runs)', () => {
	beforeEach(() => {
		process.env.RENKU_CLI_CONFIG = undefined;
	});

	it('generates a plan and writes prompt/config files', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Tell me a story about the sea',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});
		const result = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			nonInteractive: true,
			blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			storageOverride: { root, basePath: 'builds' },
		});

		expect(result.movieId).toHaveLength(8);
		expect(result.isDryRun).toBeFalsy();

		const cliConfig = await readCliConfig(cliConfigPath);
		expect(cliConfig).not.toBeNull();

		const storageMovieId = formatMovieId(result.movieId);
		const movieDir = resolve(root, 'builds', storageMovieId);

		const planStats = await stat(
			join(movieDir, 'runs', `${result.targetRevision}-plan.json`)
		);
		expect(planStats.isFile()).toBe(true);
		const plan = JSON.parse(
			await readFile(
				join(movieDir, 'runs', `${result.targetRevision}-plan.json`),
				'utf8'
			)
		);
		const firstJob = plan.layers.flat()[0];
		expect(firstJob.context.inputBindings.InquiryPrompt).toBe(
			'Input:InquiryPrompt'
		);
		expect(firstJob.context.inputs).toContain('Input:InquiryPrompt');
		expect(
			firstJob.context.produces.some((id: string) =>
				id.startsWith('Artifact:ScriptProducer.NarrationScript')
			)
		).toBe(true);

		expect(result.build?.status).toBe('succeeded');
		expect(result.manifestPath).toBeDefined();
		const manifestStats = await stat(result.manifestPath!);
		expect(manifestStats.isFile()).toBe(true);

		const current = JSON.parse(
			await readFile(join(movieDir, 'current.json'), 'utf8')
		) as { revision?: string };
		expect(current.revision).toBe(result.targetRevision);
		const artifactsStats = await stat(result.artifactsRoot ?? '');
		expect(artifactsStats.isDirectory()).toBe(true);
	});

	it('can perform a dry run and report summary', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Explain gravity',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});
		const result = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			dryRun: true,
			nonInteractive: true,
			blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			storageOverride: { root, basePath: 'builds' },
		});

		expect(result.isDryRun).toBe(true);
		expect(result.build?.status).toBe('succeeded');
		expect(result.build?.jobCount).toBeGreaterThan(0);
		expect(result.build?.counts.succeeded).toBeGreaterThan(0);
	});

	it('runs the video + audio + music blueprint with timeline stub', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'History of comets',
			overrides: {
				VoiceId: 'timeline-voice',
				NumOfSegments: 2,
			},
		});
		const result = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			dryRun: true,
			nonInteractive: true,
			blueprint: VIDEO_AUDIO_MUSIC_BLUEPRINT_PATH,
			storageOverride: { root, basePath: 'builds' },
		});

		expect(result.isDryRun).toBe(true);
		expect(result.build?.jobCount).toBeGreaterThan(0);
	});

	it('overrides InquiryPrompt when provided inline', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Original prompt',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});
		const result = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			nonInteractive: true,
			blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			storageOverride: { root, basePath: 'builds' },
		});

		expect(result.build?.status).toBe('succeeded');
	});

	it('persists concurrency overrides into the CLI config', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Concurrency check',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});
		const first = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			nonInteractive: true,
			blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			concurrency: 3,
			storageOverride: { root, basePath: 'builds' },
		});

		const cliConfig = await readCliConfig(cliConfigPath);
		expect(cliConfig?.concurrency).toBe(3);
	});

	it('reruns only image layer when ImageProducer model changes on edit', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const baselineInputsPath = join(root, 'inputs-image.yaml');
		await copyFile(
			resolve(
				CLI_FIXTURES_BLUEPRINTS,
				'pipeline-orchestration',
				'image-narration-timeline',
				'input-template.yaml'
			),
			baselineInputsPath
		);

		const initialDoc = parseYaml(
			await readFile(baselineInputsPath, 'utf8')
		) as {
			inputs?: Record<string, unknown>;
			models?: Array<Record<string, unknown>>;
		};
		initialDoc.inputs = {
			...(initialDoc.inputs ?? {}),
			Language: 'en',
		};

		// Convert promptFile paths to inline prompts since the relative paths won't work after copy
		for (const model of initialDoc.models ?? []) {
			if (model.promptFile) {
				delete model.promptFile;
				// Add inline prompts for LLM producers
				model.systemPrompt = 'You are a helpful assistant for testing.';
				model.userPrompt = 'Process this: {{InquiryPrompt}}';
			}
		}

		const initialImageModel = initialDoc.models?.find(
			(entry) => entry.producerId === 'ImageProducer'
		);
		expect(initialImageModel).toBeDefined();
		if (!initialImageModel) {
			throw new Error('ImageProducer model entry missing from inputs file.');
		}
		initialImageModel.model = 'bytedance/seedream-4';
		await writeFile(baselineInputsPath, stringifyYaml(initialDoc), 'utf8');

		const first = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath: baselineInputsPath,
			dryRun: true,
			nonInteractive: true,
			blueprint: IMAGE_AUDIO_BLUEPRINT_PATH,
			storageOverride: { root, basePath: 'builds' },
		});
		expect(first.build?.status).toBe('succeeded');

		const doc = parseYaml(await readFile(baselineInputsPath, 'utf8')) as {
			inputs?: Record<string, unknown>;
			models?: Array<Record<string, unknown>>;
		};
		const imageModel = doc.models?.find(
			(entry) => entry.producerId === 'ImageProducer'
		);
		expect(imageModel).toBeDefined();
		if (!imageModel) {
			throw new Error('ImageProducer model entry missing from inputs file.');
		}
		imageModel.model = 'google/nano-banana';
		await writeFile(baselineInputsPath, stringifyYaml(doc), 'utf8');

		const second = await runGenerate({
			...LOG_DEFAULTS,
			movieId: first.storageMovieId,
			inputsPath: baselineInputsPath,
			nonInteractive: true,
			blueprint: IMAGE_AUDIO_BLUEPRINT_PATH,
			dryRun: true,
			storageOverride: { root, basePath: 'builds' },
		});
		expect(second.build?.status).toBe('succeeded');

		const plan = JSON.parse(await readFile(second.planPath, 'utf8')) as {
			layers: Array<unknown[]>;
		};
		expect(plan.layers[0]?.length ?? 0).toBe(0);
		expect(plan.layers[1]?.length ?? 0).toBe(0);
		expect(plan.layers[2]?.length ?? 0).toBeGreaterThan(0);
		expect(plan.layers[3]?.length ?? 0).toBeGreaterThan(0);
	});

	it('schedules TimelineProducer after upstream image/audio jobs', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Formation of galaxies',
			overrides: {
				VoiceId: 'timeline-voice',
				NumOfSegments: 2,
			},
		});
		const result = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			dryRun: true,
			nonInteractive: true,
			blueprint: VIDEO_AUDIO_MUSIC_BLUEPRINT_PATH,
			storageOverride: { root, basePath: 'builds' },
		});

		expect(result.isDryRun).toBe(true);
		const jobs = result.build?.jobs ?? [];
		const timelineJob = jobs.find((job) => job.producer === 'TimelineComposer');
		const exporterJob = jobs.find((job) => job.producer === 'VideoExporter');
		expect(timelineJob).toBeDefined();
		const upstreamMax = Math.max(
			...jobs
				.filter(
					(job) =>
						job.producer !== 'TimelineComposer' &&
						job.producer !== 'VideoExporter' &&
						job.producer !== 'TranscriptionProducer'
				)
				.map((job) => job.layerIndex)
		);
		expect(timelineJob?.layerIndex).toBeGreaterThan(upstreamMax);
		if (exporterJob) {
			expect(timelineJob?.layerIndex).toBeLessThan(exporterJob.layerIndex);
		}
	});

	it('does not persist legacy last-movie fields in CLI config', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'First run',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});
		const first = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			nonInteractive: true,
			blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			storageOverride: { root, basePath: 'builds' },
		});

		const cliConfig = await readCliConfig(cliConfigPath);
		expect(cliConfig).not.toBeNull();
		expect(
			Object.prototype.hasOwnProperty.call(cliConfig ?? {}, 'lastMovieId')
		).toBe(false);
		expect(
			Object.prototype.hasOwnProperty.call(cliConfig ?? {}, 'lastGeneratedAt')
		).toBe(false);

		const second = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			movieId: first.storageMovieId,
			dryRun: true,
			storageOverride: { root, basePath: 'builds' },
		});

		expect(second.storageMovieId).toBe(formatMovieId(first.movieId));
		expect(second.build?.jobCount ?? 0).toBeGreaterThanOrEqual(0);
	});

	it('fails when --regen is used for a new movie without --movie-id', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Last without prior',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});

		await expect(
			runGenerate({
				...LOG_DEFAULTS,
				inputsPath,
				blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
				regenerateIds: ['Artifact:AudioProducer.GeneratedAudio[0]'],
				storageOverride: { root, basePath: 'builds' },
			})
		).rejects.toThrow(/requires --movie-id\/--id/i);
	});

	it('continues an existing movie when movie-id is provided explicitly', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'First run explicit id',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});
		const first = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			nonInteractive: true,
			blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			storageOverride: { root, basePath: 'builds' },
		});

		const next = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			movieId: first.storageMovieId,
			dryRun: true,
			storageOverride: { root, basePath: 'builds' },
		});

		expect(next.storageMovieId).toBe(first.storageMovieId);
		expect(next.build?.jobCount ?? 0).toBeGreaterThanOrEqual(0);
	});

	it('fails when pinning is requested for a new movie run', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Pinned new movie',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});

		await expect(
			runGenerate({
				...LOG_DEFAULTS,
				inputsPath,
				blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
				dryRun: true,
				pinIds: ['Artifact:ScriptProducer.NarrationScript[0]'],
				storageOverride: { root, basePath: 'builds' },
			})
		).rejects.toMatchObject({
			code: RuntimeErrorCode.PIN_REQUIRES_EXISTING_MOVIE,
		});
	});

	it('fails on non-canonical pin IDs from CLI', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Baseline',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});
		const first = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			nonInteractive: true,
			blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			storageOverride: { root, basePath: 'builds' },
		});

		await expect(
			runGenerate({
				...LOG_DEFAULTS,
				inputsPath,
				movieId: first.storageMovieId,
				dryRun: true,
				pinIds: ['ScriptProducer'],
				storageOverride: { root, basePath: 'builds' },
			})
		).rejects.toMatchObject({
			code: RuntimeErrorCode.INVALID_PIN_ID,
		});
	});

	it('fails on non-canonical artifact IDs from CLI', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Baseline',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});
		const first = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			nonInteractive: true,
			blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			storageOverride: { root, basePath: 'builds' },
		});

		await expect(
			runGenerate({
				...LOG_DEFAULTS,
				inputsPath,
				movieId: first.storageMovieId,
				dryRun: true,
				regenerateIds: ['ScriptProducer.NarrationScript[0]'],
				storageOverride: { root, basePath: 'builds' },
			})
		).rejects.toThrow(
			/Expected canonical Artifact:\.\.\. or Producer:\.\.\./
		);
	});

	it('accepts producer overrides without legacy --from coupling', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Producer override + from',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});

		const result = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			dryRun: true,
			producerIds: ['Producer:AudioProducer:1'],
			storageOverride: { root, basePath: 'builds' },
		});

		const plan = JSON.parse(await readFile(result.planPath, 'utf8')) as {
			layers: Array<Array<{ jobId: string }>>;
		};
		expect(plan.layers.flat().map((job) => job.jobId)).toEqual(
			expect.arrayContaining(['Producer:AudioProducer[0]'])
		);
	});

	it('supports disabling a producer family with --pid ...:0', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Producer override invalid count',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});

		const result = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			dryRun: true,
			producerIds: ['Producer:AudioProducer:0'],
			storageOverride: { root, basePath: 'builds' },
		});

		const plan = JSON.parse(await readFile(result.planPath, 'utf8')) as {
			layers: Array<Array<{ jobId: string }>>;
		};
		const jobIds = plan.layers.flat().map((job) => job.jobId);
		expect(jobIds.some((jobId) => jobId.startsWith('Producer:AudioProducer'))).toBe(
			false
		);
	});

	it('applies producer pin via shared core logic during targeted regeneration', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Pin producer',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});
		const first = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			nonInteractive: true,
			blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			storageOverride: { root, basePath: 'builds' },
		});

		const result = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			movieId: first.storageMovieId,
			dryRun: true,
			regenerateIds: ['Producer:AudioProducer'],
			pinIds: ['Producer:ScriptProducer'],
			storageOverride: { root, basePath: 'builds' },
		});

		const plan = JSON.parse(await readFile(result.planPath, 'utf8')) as {
			layers: Array<Array<{ jobId: string }>>;
		};
		const jobIds = plan.layers.flat().map((job) => job.jobId);
		expect(jobIds).not.toContain('Producer:ScriptProducer');
		expect(jobIds).toContain('Producer:AudioProducer[0]');
		expect(jobIds).toContain('Producer:AudioProducer[1]');
		expect(jobIds.length).toBeGreaterThanOrEqual(2);
	});

	it('honors --up even when producer directives are provided', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Producer override + up',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});
		const first = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			nonInteractive: true,
			blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			storageOverride: { root, basePath: 'builds' },
		});

		const updatedInputsPath = await createInputsFile({
			root,
			prompt: 'Producer override + up (changed)',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});

		const result = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath: updatedInputsPath,
			movieId: first.storageMovieId,
			dryRun: true,
			upToLayer: 0,
			producerIds: ['Producer:AudioProducer:1'],
			storageOverride: { root, basePath: 'builds' },
		});

		const plan = JSON.parse(await readFile(result.planPath, 'utf8')) as {
			layers: Array<Array<{ jobId: string }>>;
		};
		const jobIds = plan.layers.flat().map((job) => job.jobId);
		expect(jobIds).toContain('Producer:ScriptProducer');
		expect(jobIds).not.toContain('Producer:AudioProducer[0]');
	});

	it('fails when the same canonical target is both pinned and regenerated', async () => {
		const root = await createTempRoot();
		const cliConfigPath = join(root, 'cli-config.json');
		process.env.RENKU_CLI_CONFIG = cliConfigPath;

		await runInit({
			rootFolder: root,
			configPath: cliConfigPath,
			catalogSourceRoot: CLI_FIXTURES_CATALOG,
		});

		const inputsPath = await createInputsFile({
			root,
			prompt: 'Conflict test',
			models: AUDIO_ONLY_MODELS,
			includeDefaults: false,
			overrides: AUDIO_ONLY_OVERRIDES,
		});
		const first = await runGenerate({
			...LOG_DEFAULTS,
			inputsPath,
			nonInteractive: true,
			blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			storageOverride: { root, basePath: 'builds' },
		});

		await expect(
			runGenerate({
				...LOG_DEFAULTS,
				inputsPath,
				movieId: first.storageMovieId,
				dryRun: true,
				regenerateIds: ['Artifact:ScriptProducer.NarrationScript[0]'],
				pinIds: ['Artifact:ScriptProducer.NarrationScript[0]'],
				storageOverride: { root, basePath: 'builds' },
			})
		).rejects.toMatchObject({
			code: RuntimeErrorCode.PLANNING_CONFLICT_REGEN_PIN,
		});
	});
});
