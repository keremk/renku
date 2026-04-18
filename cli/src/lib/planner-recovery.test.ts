/* eslint-env node */
import { createHash } from 'node:crypto';
import process from 'node:process';
import '../commands/__testutils__/simulated-providers.js';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../commands/init.js';
import { runGenerate } from '../commands/generate.js';
import {
	appendConditionArtifactEvent,
	createExistingConditionBuild,
} from '../commands/__testutils__/condition-builds.js';
import { createInputsFile } from '../commands/__testutils__/inputs.js';
import { generatePlan } from './planner.js';
import type { CliConfig } from './cli-config.js';
import {
	createBuildStateService,
	createStorageContext,
	createEventLog,
	RuntimeErrorCode,
	type ArtifactEvent,
	type FalRecoveryStatusResult,
} from '@gorenku/core';
import {
	CLI_FIXTURES_BLUEPRINTS,
	CLI_FIXTURES_CATALOG,
} from '../../tests/test-catalog-paths.js';

const AUDIO_ONLY_BLUEPRINT_PATH = resolve(CLI_FIXTURES_BLUEPRINTS, 'pipeline-orchestration', 'audio-narration-loop',
	'audio-narration-loop.yaml'
);
const CONDITIONAL_FANIN_BLUEPRINT_PATH = resolve(
	CLI_FIXTURES_BLUEPRINTS,
	'conditional-logic',
	'conditional-multi-source-fanin',
	'conditional-multi-source-fanin.yaml'
);
const CONDITIONAL_FANIN_INPUTS_PATH = resolve(
	CLI_FIXTURES_BLUEPRINTS,
	'conditional-logic',
	'conditional-multi-source-fanin',
	'input-template.yaml'
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

interface SeedMovie {
	root: string;
	cliConfigPath: string;
	cliConfig: CliConfig;
	storageMovieId: string;
	inputsPath: string;
}

const tmpRoots: string[] = [];
const originalEnvConfig = process.env.RENKU_CLI_CONFIG;

beforeEach(() => {
	process.env.RENKU_CLI_CONFIG = undefined;
});

afterEach(async () => {
	process.env.RENKU_CLI_CONFIG = originalEnvConfig;
	while (tmpRoots.length > 0) {
		const dir = tmpRoots.pop();
		if (dir) {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

describe('generatePlan recovery prepass', () => {
	it('completed recovery removes unnecessary rerun jobs', async () => {
		const seed = await createSeedMovie('Recovery baseline');
		const artifactId = 'Artifact:AudioProducer.GeneratedAudio[0]';

		await appendFailedArtifactEvent(seed, artifactId, {
			provider: 'fal-ai',
			model: 'fal-ai/kling-video',
			providerRequestId: 'req-recover-1',
			recoverable: true,
		});

		const planResult = await generatePlan({
			cliConfig: seed.cliConfig,
			movieId: seed.storageMovieId,
			isNew: false,
			inputsPath: seed.inputsPath,
			usingBlueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			recoveryDependencies: {
				checkFalStatus: vi.fn(
					async (): Promise<FalRecoveryStatusResult> => ({
						status: 'completed',
						urls: ['https://cdn.example.com/recovered-audio.mp3'],
					})
				),
				downloadBinary: vi.fn(async () => ({
					data: Buffer.from('recovered-audio-data'),
					mimeType: 'audio/mpeg',
				})),
			},
		});

		expect(planResult.recoverySummary?.checkedArtifactIds).toEqual([
			artifactId,
		]);
		expect(planResult.recoverySummary?.recoveredArtifactIds).toEqual([
			artifactId,
		]);
		expect(planResult.recoverySummary?.pendingArtifactIds).toEqual([]);
		expect(planResult.recoverySummary?.failedRecoveries).toEqual([]);

		const jobIds = planResult.plan.layers.flat().map((job) => job.jobId);
		expect(jobIds).toEqual([]);
	});

	it('pending recovery keeps failed artifacts in plan', async () => {
		const seed = await createSeedMovie('Recovery pending baseline');
		const artifactId = 'Artifact:AudioProducer.GeneratedAudio[0]';

		await appendFailedArtifactEvent(seed, artifactId, {
			provider: 'fal-ai',
			model: 'fal-ai/kling-video',
			providerRequestId: 'req-pending-1',
			recoverable: true,
		});

		const planResult = await generatePlan({
			cliConfig: seed.cliConfig,
			movieId: seed.storageMovieId,
			isNew: false,
			inputsPath: seed.inputsPath,
			usingBlueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			recoveryDependencies: {
				checkFalStatus: vi.fn(
					async (): Promise<FalRecoveryStatusResult> => ({
						status: 'in_progress',
					})
				),
			},
		});

		expect(planResult.recoverySummary?.checkedArtifactIds).toEqual([
			artifactId,
		]);
		expect(planResult.recoverySummary?.recoveredArtifactIds).toEqual([]);
		expect(planResult.recoverySummary?.pendingArtifactIds).toEqual([
			artifactId,
		]);
		expect(planResult.recoverySummary?.failedRecoveries).toEqual([]);

		const jobIds = planResult.plan.layers.flat().map((job) => job.jobId);
		expect(jobIds).toContain('Producer:AudioProducer[0]');
	});

	it('malformed diagnostics does not silently recover', async () => {
		const seed = await createSeedMovie('Recovery malformed baseline');
		const artifactId = 'Artifact:AudioProducer.GeneratedAudio[0]';

		await appendFailedArtifactEvent(seed, artifactId, {
			provider: 'fal-ai',
			model: 'fal-ai/kling-video',
			recoverable: true,
			// providerRequestId intentionally missing
		});

		const checkFalStatus = vi.fn(async () => ({
			status: 'completed' as const,
		}));
		const planResult = await generatePlan({
			cliConfig: seed.cliConfig,
			movieId: seed.storageMovieId,
			isNew: false,
			inputsPath: seed.inputsPath,
			usingBlueprint: AUDIO_ONLY_BLUEPRINT_PATH,
			recoveryDependencies: {
				checkFalStatus,
			},
		});

		expect(checkFalStatus).not.toHaveBeenCalled();
		expect(planResult.recoverySummary?.recoveredArtifactIds).toEqual([]);
		expect(planResult.recoverySummary?.failedRecoveries).toHaveLength(1);
		expect(planResult.recoverySummary?.failedRecoveries[0]?.artifactId).toBe(
			artifactId
		);
		expect(planResult.recoverySummary?.failedRecoveries[0]?.reason).toContain(
			'providerRequestId'
		);

		const jobIds = planResult.plan.layers.flat().map((job) => job.jobId);
		expect(jobIds).toContain('Producer:AudioProducer[0]');
	});

	it('keeps dirty + regenerate + pin precedence intact', async () => {
		const seed = await createSeedMovie('Precedence baseline');
		const updatedInputsPath = await createInputsFile({
			root: seed.root,
			fileName: 'inputs-updated.yaml',
			prompt: 'Precedence prompt changed',
			includeDefaults: false,
			models: AUDIO_ONLY_MODELS,
			overrides: AUDIO_ONLY_OVERRIDES,
		});

			const planResult = await generatePlan({
				cliConfig: seed.cliConfig,
				movieId: seed.storageMovieId,
				isNew: false,
				inputsPath: updatedInputsPath,
				usingBlueprint: AUDIO_ONLY_BLUEPRINT_PATH,
				planningControls: {
					surgical: {
						regenerateIds: ['Artifact:AudioProducer.GeneratedAudio[0]'],
						pinIds: ['Artifact:AudioProducer.GeneratedAudio[1]'],
					},
				},
				collectExplanation: true,
			});

		const jobIds = planResult.plan.layers.flat().map((job) => job.jobId);
		expect(jobIds).toContain('Producer:ScriptProducer');
		expect(jobIds).toContain('Producer:AudioProducer[0]');
		expect(jobIds).toContain('Producer:AudioProducer[2]');
		expect(jobIds).not.toContain('Producer:AudioProducer[1]');
	});
});

describe('generatePlan condition artifact fallback reuse', () => {
	it('reads legacy condition blobs from fallback storage for existing-build replans', async () => {
		const fixture = await createExistingConditionBuild({
			root: await createTempRoot(),
			catalogRoot: CLI_FIXTURES_CATALOG,
			blueprintPath: CONDITIONAL_FANIN_BLUEPRINT_PATH,
			inputsPath: CONDITIONAL_FANIN_INPUTS_PATH,
			blobHash: 'ab0123456789legacy-condition',
			blobContents: 'false',
			legacyFileName: true,
		});

		const planResult = await generatePlan({
			cliConfig: fixture.cliConfig,
			movieId: fixture.movieId,
			isNew: false,
			inputsPath: fixture.inputsPath,
			usingBlueprint: fixture.blueprintPath,
		});

		const jobIds = planResult.plan.layers.flat().map((job) => job.jobId);
		expect(jobIds).not.toContain('Producer:TransitionVideoProducer[0]');
		expect(jobIds).toContain('Producer:TransitionVideoProducer[1]');
	});

	it('does not reuse stale successful condition values after a later failed retry', async () => {
		const fixture = await createExistingConditionBuild({
			root: await createTempRoot(),
			catalogRoot: CLI_FIXTURES_CATALOG,
			blueprintPath: CONDITIONAL_FANIN_BLUEPRINT_PATH,
			inputsPath: CONDITIONAL_FANIN_INPUTS_PATH,
			blobHash: 'cd0123456789retry-condition',
			blobContents: 'false',
		});
		await appendConditionArtifactEvent(fixture, {
			revision: 'rev-0002',
			status: 'failed',
		});

		const planResult = await generatePlan({
			cliConfig: fixture.cliConfig,
			movieId: fixture.movieId,
			isNew: false,
			inputsPath: fixture.inputsPath,
			usingBlueprint: fixture.blueprintPath,
		});

		const jobIds = planResult.plan.layers.flat().map((job) => job.jobId);
		expect(jobIds).toContain('Producer:TransitionVideoProducer[0]');
	});

	it('fails fast when a reusable non-literal condition blob is missing', async () => {
		const fixture = await createExistingConditionBuild({
			root: await createTempRoot(),
			catalogRoot: CLI_FIXTURES_CATALOG,
			blueprintPath: CONDITIONAL_FANIN_BLUEPRINT_PATH,
			inputsPath: CONDITIONAL_FANIN_INPUTS_PATH,
			blobHash: 'ef0123456789missing-condition',
			writeBlob: false,
		});

		await expect(
			generatePlan({
				cliConfig: fixture.cliConfig,
				movieId: fixture.movieId,
				isNew: false,
				inputsPath: fixture.inputsPath,
				usingBlueprint: fixture.blueprintPath,
			})
		).rejects.toMatchObject({
			code: RuntimeErrorCode.CONDITION_EVALUATION_ERROR,
		});
	});

	it('keeps literal-hash inference when condition payload blobs are absent', async () => {
		const falseHash = createHash('sha256').update('false').digest('hex');
		const fixture = await createExistingConditionBuild({
			root: await createTempRoot(),
			catalogRoot: CLI_FIXTURES_CATALOG,
			blueprintPath: CONDITIONAL_FANIN_BLUEPRINT_PATH,
			inputsPath: CONDITIONAL_FANIN_INPUTS_PATH,
			blobHash: falseHash,
			writeBlob: false,
		});

		const planResult = await generatePlan({
			cliConfig: fixture.cliConfig,
			movieId: fixture.movieId,
			isNew: false,
			inputsPath: fixture.inputsPath,
			usingBlueprint: fixture.blueprintPath,
		});

		const jobIds = planResult.plan.layers.flat().map((job) => job.jobId);
		expect(jobIds).not.toContain('Producer:TransitionVideoProducer[0]');
	});
});

async function createTempRoot(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'renku-planner-recovery-'));
	tmpRoots.push(dir);
	return dir;
}

async function createSeedMovie(prompt: string): Promise<SeedMovie> {
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
		prompt,
		includeDefaults: false,
		models: AUDIO_ONLY_MODELS,
		overrides: AUDIO_ONLY_OVERRIDES,
	});

	const result = await runGenerate({
		logLevel: 'info',
		inputsPath,
		blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
		nonInteractive: true,
		storageOverride: { root, basePath: 'builds' },
	});

	return {
		root,
		cliConfigPath,
		cliConfig: {
			storage: { root, basePath: 'builds' },
			catalog: { root: resolve(root, 'catalog') },
		},
		storageMovieId: result.storageMovieId,
		inputsPath,
	};
}

async function appendFailedArtifactEvent(
	seed: SeedMovie,
	artifactId: string,
	diagnostics: Record<string, unknown>
): Promise<void> {
	const storage = createStorageContext({
		kind: 'local',
		rootDir: seed.root,
		basePath: 'builds',
	});
	const buildStateService = createBuildStateService(storage);
	const { buildState } = await buildStateService.loadCurrent(seed.storageMovieId);
	const artifact = buildState.artifacts[artifactId];
	if (!artifact) {
		throw new Error(`Artifact ${artifactId} not found in build state.`);
	}
	if (!artifact.inputsHash) {
		throw new Error(`Artifact ${artifactId} is missing inputsHash.`);
	}
	if (!artifact.producerJobId) {
		throw new Error(`Artifact ${artifactId} is missing producerJobId.`);
	}
	if (!artifact.producerId) {
		throw new Error(`Artifact ${artifactId} is missing producerId.`);
	}

	const eventLog = createEventLog(storage);

	const failedEvent: ArtifactEvent = {
		artifactId,
		revision: buildState.revision,
		inputsHash: artifact.inputsHash,
		output: {},
		status: 'failed',
		producerJobId: artifact.producerJobId,
		producerId: artifact.producerId,
		diagnostics,
		createdAt: new Date().toISOString(),
		lastRevisionBy: 'producer',
	};

	await eventLog.appendArtifact(seed.storageMovieId, failedEvent);
}
