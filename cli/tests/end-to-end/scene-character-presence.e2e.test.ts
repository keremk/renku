import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	createEventLog,
	createManifestService,
	createStorageContext,
	executePlanWithConcurrency,
	initializeMovieStorage,
	injectAllSystemInputs,
	readBlobFromStorage,
	resolveBlobRefsToInputs,
	type Manifest,
	type ProduceFn,
	type ProduceRequest,
	type ProduceResult,
	type StorageContext,
} from '@gorenku/core';
import {
	createProviderProduce,
	createProviderRegistry,
	prepareProviderHandlers,
} from '@gorenku/providers';
import {
	getDefaultCliConfigPath,
	readCliConfig,
} from '../../src/lib/cli-config.js';
import { runBlueprintsValidate } from '../../src/commands/blueprints-validate.js';
import { formatMovieId } from '../../src/commands/execute.js';
import { generatePlan } from '../../src/lib/planner.js';
import {
	createLoggerRecorder,
	readPlan,
	setupTempCliConfig,
} from './helpers.js';
import { CLI_FIXTURES_BLUEPRINTS } from '../test-catalog-paths.js';

function parseSceneIndex(jobId: string): number {
	const match = jobId.match(/\[(\d+)\]/);
	if (!match) {
		throw new Error(`Expected scene index in jobId: ${jobId}`);
	}
	return parseInt(match[1]!, 10);
}

function parseBooleanText(value: string, artifactId: string): boolean {
	if (value === 'true') {
		return true;
	}
	if (value === 'false') {
		return false;
	}
	throw new Error(
		`Expected boolean text for ${artifactId}, received: ${JSON.stringify(value)}`
	);
}

function getRequiredBlob(manifest: Manifest, artifactId: string) {
	const entry = manifest.artefacts[artifactId];
	if (!entry) {
		throw new Error(`Missing manifest artifact: ${artifactId}`);
	}
	if (!entry.blob) {
		throw new Error(`Expected blob for artifact: ${artifactId}`);
	}
	return entry.blob;
}

async function readTextArtifact(
	storage: StorageContext,
	movieId: string,
	manifest: Manifest,
	artifactId: string
): Promise<string> {
	const blob = getRequiredBlob(manifest, artifactId);
	const content = await readBlobFromStorage(storage, movieId, blob);
	return Buffer.from(content.data).toString('utf8');
}

function extractBoundCharacterIndices(
	bindings: Record<string, string>
): number[] {
	const indices: number[] = [];
	for (const [alias, artifactId] of Object.entries(bindings)) {
		const aliasMatch = /^ReferenceImages\[(\d+)\]$/.exec(alias);
		if (!aliasMatch) {
			continue;
		}
		const characterIndex = parseInt(aliasMatch[1]!, 10);
		const expectedArtifact = `Artifact:CharacterImageProducer.GeneratedImage[${characterIndex}]`;
		if (artifactId !== expectedArtifact) {
			throw new Error(
				`Expected ${alias} to bind ${expectedArtifact}, received ${artifactId}`
			);
		}
		indices.push(characterIndex);
	}
	return indices.sort((a, b) => a - b);
}

function createDryRunCloudStorage(
	rootDir: string,
	basePath: string,
	movieId: string
): StorageContext {
	const movieRootDir = resolve(rootDir, basePath, movieId);
	const movieScopedStorage = createStorageContext({
		kind: 'local',
		rootDir: movieRootDir,
		basePath: '',
	});

	return {
		...movieScopedStorage,
		temporaryUrl: async (path: string) => {
			if (!path.startsWith('blobs/')) {
				throw new Error(`Invalid blob path for dry-run: ${path}`);
			}
			return `https://dry-run.invalid/${path}`;
		},
	};
}

describe('end-to-end: scene character presence', () => {
	let restoreEnv: () => void = () => {};

	beforeEach(async () => {
		const config = await setupTempCliConfig();
		restoreEnv = config.restoreEnv;
	});

	afterEach(() => {
		restoreEnv();
	});

	it('uses dry-run simulation to validate scene-to-character reference bindings thoroughly', async () => {
		const fixtureRoot = resolve(
			CLI_FIXTURES_BLUEPRINTS,
			'scene-character-presence'
		);
		const blueprintPath = resolve(fixtureRoot, 'scene-character-presence.yaml');
		const inputsPath = resolve(fixtureRoot, 'input-template.yaml');

		const { logger, warnings, errors } = createLoggerRecorder();
		const movieId = 'e2e-scene-character-presence';
		const storageMovieId = formatMovieId(movieId);

		const configPath = getDefaultCliConfigPath();
		const cliConfig = await readCliConfig(configPath);
		if (!cliConfig) {
			throw new Error('CLI config not initialized');
		}

		const validation = await runBlueprintsValidate({
			blueprintPath,
			errorsOnly: false,
		});
		expect(validation.valid).toBe(true);
		expect(validation.errors ?? []).toHaveLength(0);
		expect(validation.nodeCount).toBeGreaterThan(0);
		expect(validation.edgeCount).toBeGreaterThan(0);

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

		const plan = await readPlan(planResult.planPath);
		const allPlanJobs = plan.layers.flat();

		const storyJobs = allPlanJobs.filter(
			(job: any) => job.producer === 'StoryProducer'
		);
		const characterJobs = allPlanJobs.filter(
			(job: any) => job.producer === 'CharacterImageProducer'
		);
		const sceneJobs = allPlanJobs.filter(
			(job: any) => job.producer === 'SceneVideoProducer'
		);

		expect(storyJobs).toHaveLength(1);
		expect(characterJobs.length).toBeGreaterThan(1);
		expect(sceneJobs.length).toBeGreaterThan(1);

		const characterCount = characterJobs.length;
		const sceneCount = sceneJobs.length;

		for (const sceneJob of sceneJobs) {
			const inputConditions = sceneJob.context?.inputConditions ?? {};
			expect(Object.keys(inputConditions).length).toBeGreaterThan(0);
		}

		const storage = createStorageContext({
			kind: 'local',
			rootDir: cliConfig.storage.root,
			basePath: cliConfig.storage.basePath,
		});
		await initializeMovieStorage(storage, storageMovieId);
		const eventLog = createEventLog(storage);
		const manifestService = createManifestService(storage);

		const cloudStorage = createDryRunCloudStorage(
			cliConfig.storage.root,
			cliConfig.storage.basePath,
			storageMovieId
		);

		const registry = createProviderRegistry({
			mode: 'simulated',
			logger,
			cloudStorage,
			catalog: planResult.modelCatalog,
			catalogModelsDir: planResult.catalogModelsDir,
		});
		const preResolved = prepareProviderHandlers(
			registry,
			planResult.plan,
			planResult.providerOptions
		);
		await registry.warmStart?.(preResolved);

		const resolvedInputsWithBlobs = await resolveBlobRefsToInputs(
			storage,
			storageMovieId,
			planResult.resolvedInputs
		);
		const resolvedInputsWithSystem = injectAllSystemInputs(
			resolvedInputsWithBlobs as Record<string, unknown>,
			storageMovieId,
			cliConfig.storage.root,
			cliConfig.storage.basePath
		);

		const delegateProduce = createProviderProduce(
			registry,
			planResult.providerOptions,
			resolvedInputsWithSystem,
			preResolved,
			logger,
			undefined,
			planResult.conditionHints
		);

		const observedBindingsByScene = new Map<number, Record<string, string>>();
		const produce: ProduceFn = async (
			request: ProduceRequest
		): Promise<ProduceResult> => {
			if (request.job.producer === 'SceneVideoProducer') {
				observedBindingsByScene.set(parseSceneIndex(request.job.jobId), {
					...(request.job.context?.inputBindings ?? {}),
				});
			}
			return delegateProduce(request);
		};

		const run = await executePlanWithConcurrency(
			planResult.plan,
			{
				movieId: storageMovieId,
				manifest: planResult.manifest,
				storage,
				eventLog,
				manifestService,
				produce,
				logger,
			},
			{
				concurrency: 1,
			}
		);

		expect(run.status).toBe('succeeded');
		expect(run.jobs.filter((job) => job.status === 'failed')).toHaveLength(0);

		const sceneRunJobs = run.jobs.filter(
			(job) => job.producer === 'SceneVideoProducer'
		);
		expect(sceneRunJobs).toHaveLength(sceneCount);
		for (const sceneJob of sceneRunJobs) {
			expect(sceneJob.status).toBe('succeeded');
		}

		const manifest = await run.buildManifest();

		const characterPrompts: string[] = [];
		for (
			let characterIndex = 0;
			characterIndex < characterCount;
			characterIndex += 1
		) {
			const artifactId = `Artifact:StoryProducer.Storyboard.CharacterImagePrompts[${characterIndex}]`;
			const prompt = await readTextArtifact(
				storage,
				storageMovieId,
				manifest,
				artifactId
			);
			expect(prompt.trim().length).toBeGreaterThan(0);
			characterPrompts.push(prompt);
		}
		expect(new Set(characterPrompts).size).toBeGreaterThan(1);

		const scenePrompts: string[] = [];
		const characterPresenceMatrix: boolean[][] = [];

		for (let sceneIndex = 0; sceneIndex < sceneCount; sceneIndex += 1) {
			const promptArtifactId = `Artifact:StoryProducer.Storyboard.Scenes[${sceneIndex}].VideoPrompt`;
			const scenePrompt = await readTextArtifact(
				storage,
				storageMovieId,
				manifest,
				promptArtifactId
			);
			expect(scenePrompt.trim().length).toBeGreaterThan(0);
			scenePrompts.push(scenePrompt);

			const row: boolean[] = [];
			for (
				let characterIndex = 0;
				characterIndex < characterCount;
				characterIndex += 1
			) {
				const presenceArtifactId = `Artifact:StoryProducer.Storyboard.Scenes[${sceneIndex}].CharacterPresent[${characterIndex}]`;
				const rawValue = await readTextArtifact(
					storage,
					storageMovieId,
					manifest,
					presenceArtifactId
				);
				row.push(parseBooleanText(rawValue, presenceArtifactId));
			}
			characterPresenceMatrix.push(row);
		}

		const flattenedPresence = characterPresenceMatrix.flat();
		expect(flattenedPresence.some((value) => value)).toBe(true);
		expect(flattenedPresence.some((value) => !value)).toBe(true);

		const uniqueRows = new Set(
			characterPresenceMatrix.map((row) =>
				row.map((value) => (value ? '1' : '0')).join('')
			)
		);
		expect(uniqueRows.size).toBeGreaterThan(1);

		for (
			let characterIndex = 0;
			characterIndex < characterCount;
			characterIndex += 1
		) {
			const columnValues = characterPresenceMatrix.map(
				(row) => row[characterIndex]!
			);
			expect(columnValues.some((value) => value)).toBe(true);
			expect(columnValues.some((value) => !value)).toBe(true);
		}

		expect(observedBindingsByScene.size).toBe(sceneCount);

		for (let sceneIndex = 0; sceneIndex < sceneCount; sceneIndex += 1) {
			const expectedCharacters = characterPresenceMatrix[sceneIndex]!.map(
				(isPresent, characterIndex) => (isPresent ? characterIndex : null)
			).filter(
				(characterIndex): characterIndex is number => characterIndex !== null
			);

			const observedBindings = observedBindingsByScene.get(sceneIndex);
			expect(observedBindings).toBeDefined();
			const observedCharacters = extractBoundCharacterIndices(
				observedBindings!
			);

			expect(observedCharacters).toEqual(expectedCharacters);
		}

		expect(warnings).toHaveLength(0);
		expect(errors).toHaveLength(0);
	});
});
