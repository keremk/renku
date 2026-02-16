/* eslint-env node */
import process from 'node:process';
import '../commands/__testutils__/mock-providers.js';
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../commands/init.js';
import { runGenerate } from '../commands/generate.js';
import { createInputsFile } from '../commands/__testutils__/inputs.js';
import { generatePlan } from './planner.js';
import type { CliConfig } from './cli-config.js';
import {
	createStorageContext,
	createEventLog,
	type ArtefactEvent,
} from '@gorenku/core';
import { CLI_FIXTURES_BLUEPRINTS } from '../../tests/test-catalog-paths.js';

const AUDIO_ONLY_BLUEPRINT_PATH = resolve(
	CLI_FIXTURES_BLUEPRINTS,
	'audio-only',
	'audio-only.yaml'
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
	manifestPath: string;
}

interface ManifestArtefactEntry {
	inputsHash?: string;
	producedBy?: string;
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
		const artefactId = 'Artifact:AudioProducer.GeneratedAudio[0]';

		await appendFailedArtefactEvent(seed, artefactId, {
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
				checkFalStatus: vi.fn(async () => ({
					status: 'completed',
					urls: ['https://cdn.example.com/recovered-audio.mp3'],
				})),
				downloadBinary: vi.fn(async () => ({
					data: Buffer.from('recovered-audio-data'),
					mimeType: 'audio/mpeg',
				})),
			},
		});

		expect(planResult.recoverySummary?.checkedArtifactIds).toEqual([
			artefactId,
		]);
		expect(planResult.recoverySummary?.recoveredArtifactIds).toEqual([
			artefactId,
		]);
		expect(planResult.recoverySummary?.pendingArtifactIds).toEqual([]);
		expect(planResult.recoverySummary?.failedRecoveries).toEqual([]);

		const jobIds = planResult.plan.layers.flat().map((job) => job.jobId);
		expect(jobIds).toEqual([]);
	});

	it('pending recovery keeps failed artifacts in plan', async () => {
		const seed = await createSeedMovie('Recovery pending baseline');
		const artefactId = 'Artifact:AudioProducer.GeneratedAudio[0]';

		await appendFailedArtefactEvent(seed, artefactId, {
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
				checkFalStatus: vi.fn(async () => ({ status: 'in_progress' })),
			},
		});

		expect(planResult.recoverySummary?.checkedArtifactIds).toEqual([
			artefactId,
		]);
		expect(planResult.recoverySummary?.recoveredArtifactIds).toEqual([]);
		expect(planResult.recoverySummary?.pendingArtifactIds).toEqual([
			artefactId,
		]);
		expect(planResult.recoverySummary?.failedRecoveries).toEqual([]);

		const jobIds = planResult.plan.layers.flat().map((job) => job.jobId);
		expect(jobIds).toContain('Producer:AudioProducer[0]');
	});

	it('malformed diagnostics does not silently recover', async () => {
		const seed = await createSeedMovie('Recovery malformed baseline');
		const artefactId = 'Artifact:AudioProducer.GeneratedAudio[0]';

		await appendFailedArtefactEvent(seed, artefactId, {
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
		expect(planResult.recoverySummary?.failedRecoveries[0]?.artefactId).toBe(
			artefactId
		);
		expect(planResult.recoverySummary?.failedRecoveries[0]?.reason).toContain(
			'providerRequestId'
		);

		const jobIds = planResult.plan.layers.flat().map((job) => job.jobId);
		expect(jobIds).toContain('Producer:AudioProducer[0]');
	});

	it('keeps dirty + aid + pin precedence intact', async () => {
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
			targetArtifactIds: ['Artifact:AudioProducer.GeneratedAudio[0]'],
			pinnedIds: ['Artifact:AudioProducer.GeneratedAudio[1]'],
			collectExplanation: true,
		});

		const jobIds = planResult.plan.layers.flat().map((job) => job.jobId);
		expect(jobIds).toContain('Producer:ScriptProducer');
		expect(jobIds).toContain('Producer:AudioProducer[0]');
		expect(jobIds).toContain('Producer:AudioProducer[2]');
		expect(jobIds).not.toContain('Producer:AudioProducer[1]');
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

	await runInit({ rootFolder: root, configPath: cliConfigPath });

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

	if (!result.manifestPath) {
		throw new Error('Seed movie did not produce a manifest path.');
	}

	return {
		root,
		cliConfigPath,
		cliConfig: {
			storage: { root, basePath: 'builds' },
			catalog: { root: resolve(root, 'catalog') },
		},
		storageMovieId: result.storageMovieId,
		inputsPath,
		manifestPath: result.manifestPath,
	};
}

async function appendFailedArtefactEvent(
	seed: SeedMovie,
	artefactId: string,
	diagnostics: Record<string, unknown>
): Promise<void> {
	const manifestRaw = await readFile(seed.manifestPath, 'utf8');
	const manifest = JSON.parse(manifestRaw) as {
		revision: string;
		artefacts: Record<string, ManifestArtefactEntry>;
	};

	const artefact = manifest.artefacts[artefactId];
	if (!artefact) {
		throw new Error(`Artefact ${artefactId} not found in manifest.`);
	}
	if (!artefact.inputsHash) {
		throw new Error(`Artefact ${artefactId} is missing inputsHash.`);
	}
	if (!artefact.producedBy) {
		throw new Error(`Artefact ${artefactId} is missing producedBy.`);
	}

	const storage = createStorageContext({
		kind: 'local',
		rootDir: seed.root,
		basePath: 'builds',
	});
	const eventLog = createEventLog(storage);

	const failedEvent: ArtefactEvent = {
		artefactId,
		revision: manifest.revision,
		inputsHash: artefact.inputsHash,
		output: {},
		status: 'failed',
		producedBy: artefact.producedBy,
		diagnostics,
		createdAt: new Date().toISOString(),
	};

	await eventLog.appendArtefact(seed.storageMovieId, failedEvent);
}
