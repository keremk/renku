import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBlueprintGraph, createBuildStateService, createStorageContext } from '@gorenku/core';
import { runBlueprintsValidate } from '../../src/commands/blueprints-validate.js';
import { runBlueprintsDryRunProfile } from '../../src/commands/blueprints-dry-run-profile.js';
import { runGenerate } from '../../src/commands/generate.js';
import { loadBlueprintBundle } from '../../src/lib/blueprint-loader/index.js';
import {
	getDefaultCliConfigPath,
	readCliConfig,
} from '../../src/lib/cli-config.js';
import { setupTempCliConfig } from '../end-to-end/helpers.js';
import { CLI_FIXTURES_BLUEPRINTS } from '../test-catalog-paths.js';

interface TestManifest {
	artifacts: Record<
		string,
		{
			blob?: {
				hash: string;
				mimeType: string;
			};
		}
	>;
}

async function readBuildState(storagePath: string): Promise<TestManifest> {
	const movieId = basename(storagePath);
	const storage = createStorageContext({
		kind: 'local',
		rootDir: dirname(dirname(storagePath)),
		basePath: basename(dirname(storagePath)),
	});
	const buildStateService = createBuildStateService(storage);
	const { buildState } = await buildStateService.loadCurrent(movieId);
	return buildState as TestManifest;
}

async function readTextBlob(args: {
	storagePath: string;
	hash: string;
}): Promise<string> {
	const blobPath = resolve(
		args.storagePath,
		'blobs',
		args.hash.slice(0, 2),
		`${args.hash}.txt`
	);
	return readFile(blobPath, 'utf8');
}

async function createValidationFixtureBundle(
	tempDirs: string[],
	args: {
		documentaryOutputSchemaPath?: string;
		rootBlueprintReplacements?: Array<[string, string]>;
	}
): Promise<string> {
	const tempDir = await mkdtemp(join(tmpdir(), 'renku-blueprints-validate-'));
	tempDirs.push(tempDir);

	const fixtureRoot = resolve(
		CLI_FIXTURES_BLUEPRINTS,
		'conditional-logic',
		'conditional-narration-routing'
	);
	const documentaryFixtureDir = resolve(
		CLI_FIXTURES_BLUEPRINTS,
		'_shared',
		'documentary'
	);
	const documentaryDir = resolve(tempDir, 'documentary');
	await cp(documentaryFixtureDir, documentaryDir, { recursive: true });

	let rootBlueprint = await readFile(
		resolve(fixtureRoot, 'conditional-narration-routing.yaml'),
		'utf8'
	);
	rootBlueprint = rootBlueprint.replace(
		'../../_shared/documentary/documentary.yaml',
		'./documentary/documentary.yaml'
	);
	for (const [from, to] of args.rootBlueprintReplacements ?? []) {
		rootBlueprint = rootBlueprint.replace(from, to);
	}

	let documentaryBlueprint = await readFile(
		resolve(documentaryFixtureDir, 'documentary.yaml'),
		'utf8'
	);
	if (args.documentaryOutputSchemaPath) {
		documentaryBlueprint = documentaryBlueprint.replace(
			'./documentary-output.json',
			args.documentaryOutputSchemaPath
		);
	}

	await writeFile(
		resolve(tempDir, 'conditional-narration-routing.yaml'),
		rootBlueprint,
		'utf8'
	);
	await writeFile(
		resolve(documentaryDir, 'documentary.yaml'),
		documentaryBlueprint,
		'utf8'
	);

	return resolve(tempDir, 'conditional-narration-routing.yaml');
}

describe('integration: blueprint validation and dry-run profiles', () => {
	let restoreEnv: () => void = () => {};
	const originalProviderSecrets: Record<string, string | undefined> = {};
	const tempDirs: string[] = [];
	const testProviderSecrets: Record<string, string> = {
		OPENAI_API_KEY: 'test-openai-api-key-for-validation',
		AI_GATEWAY_API_KEY: 'test-ai-gateway-api-key-for-validation',
		REPLICATE_API_TOKEN: 'test-replicate-api-token-for-validation',
		FAL_KEY: 'test-fal-key-for-validation',
		WAVESPEED_API_KEY: 'test-wavespeed-api-key-for-validation',
		ELEVENLABS_API_KEY: 'test-elevenlabs-api-key-for-validation',
	};

	beforeEach(async () => {
		for (const [key, value] of Object.entries(testProviderSecrets)) {
			originalProviderSecrets[key] = process.env[key];
			process.env[key] = value;
		}

		const config = await setupTempCliConfig();
		restoreEnv = config.restoreEnv;
	});

	afterEach(() => {
		for (const [key, originalValue] of Object.entries(originalProviderSecrets)) {
			if (originalValue === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = originalValue;
			}
		}

		restoreEnv();
	});

	afterEach(async () => {
		await Promise.all(
			tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))
		);
		tempDirs.length = 0;
	});

	it('validates the prepared graph contract and reports schema-derived graph counts', async () => {
		const fixtureRoot = resolve(
			CLI_FIXTURES_BLUEPRINTS,
			'conditional-logic',
			'conditional-narration-routing'
		);
		const blueprintPath = resolve(fixtureRoot, 'conditional-narration-routing.yaml');
		const cliConfig = await readCliConfig(getDefaultCliConfigPath());
		const catalogRoot = cliConfig?.catalog?.root ?? undefined;
		const { root } = await loadBlueprintBundle(blueprintPath, { catalogRoot });
		const rawGraph = buildBlueprintGraph(root);

		const result = await runBlueprintsValidate({ blueprintPath });

		expect(result.valid).toBe(true);
		expect(result.error).toBeUndefined();
		expect(result.nodeCount).toBeGreaterThan(rawGraph.nodes.length);
		expect(result.edgeCount).toBeGreaterThan(rawGraph.edges.length);
	});

	it('fails blueprints:validate when an output schema file is missing', async () => {
		const blueprintPath = await createValidationFixtureBundle(tempDirs, {
			documentaryOutputSchemaPath: './missing-output.json',
		});

		const result = await runBlueprintsValidate({ blueprintPath });

		expect(result.valid).toBe(false);
		expect(result.error).toContain('Failed to load output schema');
		expect(result.errors?.some((error) => error.code === 'V070')).toBe(true);
	});

	it('fails blueprints:validate when a schema-derived edge path is invalid', async () => {
		const blueprintPath = await createValidationFixtureBundle(tempDirs, {
			rootBlueprintReplacements: [
				['ImagePrompts[image]', 'ImagPrompts[image]'],
			],
		});

		const result = await runBlueprintsValidate({ blueprintPath });

		expect(result.valid).toBe(false);
		expect(result.error).toContain('ImagPrompts');
		expect(result.errors?.some((error) => error.code === 'V006')).toBe(true);
	});

	it('returns a warning for unused count-style inputs', async () => {
		const tempDir = await mkdtemp(join(tmpdir(), 'renku-unused-count-input-'));
		const blueprintPath = join(tempDir, 'unused-count-input.yaml');

		try {
			await writeFile(
				blueprintPath,
				[
					'meta:',
					'  name: Unused Count Input',
					'  id: UnusedCountInput',
					'  kind: producer',
					'  version: 0.1.0',
					'inputs:',
					'  - name: Topic',
					'    type: string',
					'    required: true',
					'  - name: NumOfStyleImages',
					'    type: int',
					'    required: false',
					'outputs:',
					'  - name: Script',
					'    type: string',
					'    required: true',
					'',
				].join('\n'),
				'utf8'
			);

			const result = await runBlueprintsValidate({ blueprintPath });

			expect(result.valid).toBe(true);
			expect(result.warnings?.length).toBeGreaterThan(0);
			expect(
				result.warnings?.some(
					(warning) =>
						warning.code === 'W001' &&
						warning.message.includes('NumOfStyleImages') &&
						warning.message.includes('should be removed')
				)
			).toBe(true);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it('generates dry-run profile files with boolean/enum/number hints and uses them with generate --dry-run', async () => {
		const fixtureRoot = resolve(CLI_FIXTURES_BLUEPRINTS, 'conditional-logic', 'scene-character-reference-routing');
		const blueprintPath = resolve(
			fixtureRoot,
			'scene-character-reference-routing.yaml'
		);
		const inputsPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'conditional-logic', 'scene-character-reference-routing',
			'input-template.yaml'
		);

		const tempDir = await mkdtemp(join(tmpdir(), 'renku-dry-run-profile-'));
		const profilePath = join(tempDir, 'scene-profile.yaml');

		try {
			const profileResult = await runBlueprintsDryRunProfile({
				blueprintPath,
				outputPath: profilePath,
			});

			expect(profileResult.caseCount).toBeGreaterThan(0);
			expect(profileResult.conditionFieldCount).toBeGreaterThan(0);

			const profileContents = await readFile(profilePath, 'utf8');
			expect(profileContents).toContain('version: 1');
			expect(profileContents).toContain('cases:');
			expect(profileContents).toContain('conditionHints:');
			expect(profileContents).toContain('artifactId: Artifact:');
			expect(profileContents).toContain(
				'Artifact:StoryProducer.Storyboard.Scenes[scene].CharacterPresent[character]'
			);
			expect(profileContents).toContain(
				'Artifact:StoryProducer.Storyboard.Scenes[scene].ShotType'
			);
			expect(profileContents).toContain(
				'Artifact:StoryProducer.Storyboard.Scenes[scene].SceneNumber'
			);

			const result = await runGenerate({
				blueprint: blueprintPath,
				inputsPath,
				dryRun: true,
				dryRunProfilePath: profilePath,
				nonInteractive: true,
				logLevel: 'info',
				storageOverride: {
					root: tempDir,
					basePath: 'builds',
				},
			});

			expect(result.isDryRun).toBe(true);
			expect(result.dryRunValidation).toBeDefined();
			expect(result.dryRunValidation?.failedCases).toBe(0);
			expect(result.dryRunValidation?.failures).toHaveLength(0);
			expect(result.dryRunValidation?.totalCases).toBeGreaterThan(0);

			const manifest = await readBuildState(result.storagePath);

			const shotTypeIds = Object.keys(manifest.artifacts)
				.filter(
					(id) =>
						id.includes('StoryProducer.Storyboard.Scenes[') &&
						id.includes('ShotType')
				)
				.sort();
			expect(shotTypeIds.length).toBeGreaterThanOrEqual(3);

			const sceneNumberIds = Object.keys(manifest.artifacts)
				.filter(
					(id) =>
						id.includes('StoryProducer.Storyboard.Scenes[') &&
						id.includes('SceneNumber')
				)
				.sort();
			expect(sceneNumberIds.length).toBeGreaterThanOrEqual(3);

			const characterPresenceIds = Object.keys(manifest.artifacts)
				.filter(
					(id) =>
						id.includes('StoryProducer.Storyboard.Scenes[') &&
						id.includes('CharacterPresent[0]')
				)
				.sort();
			expect(characterPresenceIds.length).toBeGreaterThanOrEqual(3);

			const observedShotTypes: string[] = [];
			for (const artifactId of shotTypeIds.slice(0, 3)) {
				const blob = manifest.artifacts[artifactId]?.blob;
				expect(blob).toBeDefined();
				expect(blob?.mimeType).toBe('text/plain');
				observedShotTypes.push(
					await readTextBlob({
						storagePath: result.storagePath,
						hash: blob!.hash,
					})
				);
			}

			const observedSceneNumbers: number[] = [];
			for (const artifactId of sceneNumberIds.slice(0, 3)) {
				const blob = manifest.artifacts[artifactId]?.blob;
				expect(blob).toBeDefined();
				expect(blob?.mimeType).toBe('text/plain');
				const value = await readTextBlob({
					storagePath: result.storagePath,
					hash: blob!.hash,
				});
				observedSceneNumbers.push(Number.parseInt(value, 10));
			}

			const observedCharacterPresence: string[] = [];
			for (const artifactId of characterPresenceIds.slice(0, 3)) {
				const blob = manifest.artifacts[artifactId]?.blob;
				expect(blob).toBeDefined();
				expect(blob?.mimeType).toBe('text/plain');
				observedCharacterPresence.push(
					await readTextBlob({
						storagePath: result.storagePath,
						hash: blob!.hash,
					})
				);
			}

			expect(
				observedShotTypes.every(
					(value) => value === 'Wide' || value === 'Close'
				)
			).toBe(true);
			expect(new Set(observedShotTypes).size).toBeGreaterThan(1);

			expect(
				observedSceneNumbers.every((value) => Number.isInteger(value))
			).toBe(true);
			expect(observedSceneNumbers).toContain(1);
			expect(observedSceneNumbers).toContain(2);

			expect(
				observedCharacterPresence.every(
					(value) => value === 'true' || value === 'false'
				)
			).toBe(true);
			expect(new Set(observedCharacterPresence).size).toBeGreaterThan(1);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it('auto-generates dry-run validation cases when no profile is provided', async () => {
		const fixtureRoot = resolve(CLI_FIXTURES_BLUEPRINTS, 'conditional-logic', 'scene-character-reference-routing');
		const blueprintPath = resolve(fixtureRoot, 'scene-character-reference-routing.yaml');
		const inputsPath = resolve(fixtureRoot, 'input-template.yaml');

		const tempDir = await mkdtemp(join(tmpdir(), 'renku-dry-run-auto-'));

		try {
			const result = await runGenerate({
				blueprint: blueprintPath,
				inputsPath,
				dryRun: true,
				nonInteractive: true,
				logLevel: 'info',
				storageOverride: {
					root: tempDir,
					basePath: 'builds',
				},
			});

			expect(result.isDryRun).toBe(true);
			expect(result.dryRunValidation).toBeDefined();
			expect(result.dryRunValidation?.totalCases).toBeGreaterThan(0);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it('rejects dry-run profile usage without --dry-run', async () => {
		const fixtureRoot = resolve(CLI_FIXTURES_BLUEPRINTS, 'conditional-logic', 'scene-character-reference-routing');
		const blueprintPath = resolve(fixtureRoot, 'scene-character-reference-routing.yaml');
		const inputsPath = resolve(fixtureRoot, 'input-template.yaml');

		await expect(
			runGenerate({
				blueprint: blueprintPath,
				inputsPath,
				dryRunProfilePath: './profile.yaml',
				nonInteractive: true,
				logLevel: 'info',
			})
		).rejects.toThrow('--dry-run-profile/--profile requires --dry-run');
	});

	it('applies explicit profile definitions when fed to generate --dry-run', async () => {
		const fixtureRoot = resolve(CLI_FIXTURES_BLUEPRINTS, 'conditional-logic', 'conditional-narration-routing');
		const blueprintPath = resolve(fixtureRoot, 'conditional-narration-routing.yaml');
		const inputsPath = resolve(fixtureRoot, 'input-template.yaml');

		const tempDir = await mkdtemp(
			join(tmpdir(), 'renku-dry-run-profile-explicit-')
		);
		const profilePath = join(tempDir, 'explicit-profile.yaml');

		const profileYaml = `version: 1
blueprint: ${blueprintPath}
inputs: ${inputsPath}
cases:
  - id: case-1
    conditionHints:
      mode: alternating
      varyingFields:
        - artifactId: Artifact:DocProducer.VideoScript.Segments[segment].NarrationType
          values: [TalkingHead, ImageNarration]
          dimension: segment
        - artifactId: Artifact:DocProducer.VideoScript.Segments[segment].UseNarrationAudio
          values: [false, true]
          dimension: segment
`;

		try {
			await writeFile(profilePath, profileYaml, 'utf8');

			const result = await runGenerate({
				blueprint: blueprintPath,
				inputsPath,
				dryRun: true,
				dryRunProfilePath: profilePath,
				nonInteractive: true,
				logLevel: 'info',
				storageOverride: {
					root: tempDir,
					basePath: 'builds',
				},
			});

			expect(result.isDryRun).toBe(true);
			expect(result.dryRunValidation).toBeDefined();
			expect(result.dryRunValidation?.sourceTestFilePath).toBe(profilePath);

			const manifest = await readBuildState(result.storagePath);

			const narrationTypeIds = Object.keys(manifest.artifacts)
				.filter(
					(id) =>
						id.includes('DocProducer.VideoScript.Segments[') &&
						id.includes('NarrationType')
				)
				.sort();
			expect(narrationTypeIds.length).toBeGreaterThanOrEqual(3);

			const useNarrationAudioIds = Object.keys(manifest.artifacts)
				.filter(
					(id) =>
						id.includes('DocProducer.VideoScript.Segments[') &&
						id.includes('UseNarrationAudio')
				)
				.sort();
			expect(useNarrationAudioIds.length).toBeGreaterThanOrEqual(3);

			const observedNarrationTypes: string[] = [];
			for (const artifactId of narrationTypeIds.slice(0, 3)) {
				const blob = manifest.artifacts[artifactId]?.blob;
				expect(blob).toBeDefined();
				expect(blob?.mimeType).toBe('text/plain');
				observedNarrationTypes.push(
					await readTextBlob({
						storagePath: result.storagePath,
						hash: blob!.hash,
					})
				);
			}

			const observedUseNarrationAudio: string[] = [];
			for (const artifactId of useNarrationAudioIds.slice(0, 3)) {
				const blob = manifest.artifacts[artifactId]?.blob;
				expect(blob).toBeDefined();
				expect(blob?.mimeType).toBe('text/plain');
				observedUseNarrationAudio.push(
					await readTextBlob({
						storagePath: result.storagePath,
						hash: blob!.hash,
					})
				);
			}

			// Case-1 profile values should drive baseline artifacts: index 0 -> first value,
			// index 1 -> second value, index 2 -> first value.
			expect(observedNarrationTypes).toEqual([
				'TalkingHead',
				'ImageNarration',
				'TalkingHead',
			]);
			expect(observedUseNarrationAudio).toEqual(['false', 'true', 'false']);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
