import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBlueprintsValidate } from '../../src/commands/blueprints-validate.js';
import { runBlueprintsDryRunProfile } from '../../src/commands/blueprints-dry-run-profile.js';
import { runGenerate } from '../../src/commands/generate.js';
import { setupTempCliConfig } from '../end-to-end/helpers.js';
import { CLI_FIXTURES_BLUEPRINTS } from '../test-catalog-paths.js';

interface TestManifest {
	artefacts: Record<
		string,
		{
			blob?: {
				hash: string;
				mimeType: string;
			};
		}
	>;
}

async function readManifest(manifestPath: string): Promise<TestManifest> {
	const raw = await readFile(manifestPath, 'utf8');
	return JSON.parse(raw) as TestManifest;
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

describe('integration: blueprint validation and dry-run profiles', () => {
	let restoreEnv: () => void = () => {};
	let originalOpenAiApiKey: string | undefined;

	beforeEach(async () => {
		originalOpenAiApiKey = process.env.OPENAI_API_KEY;
		process.env.OPENAI_API_KEY = 'test-openai-api-key-for-validation';

		const config = await setupTempCliConfig();
		restoreEnv = config.restoreEnv;
	});

	afterEach(() => {
		if (originalOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiApiKey;
		}

		restoreEnv();
	});

	it('keeps blueprints:validate as static wiring validation', async () => {
		const fixtureRoot = resolve(
			CLI_FIXTURES_BLUEPRINTS,
			'scene-character-presence'
		);
		const blueprintPath = resolve(fixtureRoot, 'scene-character-presence.yaml');

		const result = await runBlueprintsValidate({ blueprintPath });

		expect(result.valid).toBe(true);
		expect(result.error).toBeUndefined();
		expect(result.nodeCount).toBeGreaterThan(0);
		expect(result.edgeCount).toBeGreaterThan(0);
	});

	it('generates dry-run profile files with boolean/enum/number hints and uses them with generate --dry-run', async () => {
		const fixtureRoot = resolve(
			CLI_FIXTURES_BLUEPRINTS,
			'scene-character-presence-typed'
		);
		const blueprintPath = resolve(
			fixtureRoot,
			'scene-character-presence-typed.yaml'
		);
		const inputsPath = resolve(fixtureRoot, 'input-template.yaml');

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

			const manifestPath = result.build?.manifestPath;
			expect(manifestPath).toBeDefined();
			const manifest = await readManifest(manifestPath!);

			const shotTypeIds = Object.keys(manifest.artefacts)
				.filter(
					(id) =>
						id.includes('StoryProducer.Storyboard.Scenes[') &&
						id.includes('ShotType')
				)
				.sort();
			expect(shotTypeIds.length).toBeGreaterThanOrEqual(3);

			const sceneNumberIds = Object.keys(manifest.artefacts)
				.filter(
					(id) =>
						id.includes('StoryProducer.Storyboard.Scenes[') &&
						id.includes('SceneNumber')
				)
				.sort();
			expect(sceneNumberIds.length).toBeGreaterThanOrEqual(3);

			const characterPresenceIds = Object.keys(manifest.artefacts)
				.filter(
					(id) =>
						id.includes('StoryProducer.Storyboard.Scenes[') &&
						id.includes('CharacterPresent[0]')
				)
				.sort();
			expect(characterPresenceIds.length).toBeGreaterThanOrEqual(3);

			const observedShotTypes: string[] = [];
			for (const artifactId of shotTypeIds.slice(0, 3)) {
				const blob = manifest.artefacts[artifactId]?.blob;
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
				const blob = manifest.artefacts[artifactId]?.blob;
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
				const blob = manifest.artefacts[artifactId]?.blob;
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
		const fixtureRoot = resolve(
			CLI_FIXTURES_BLUEPRINTS,
			'scene-character-presence'
		);
		const blueprintPath = resolve(fixtureRoot, 'scene-character-presence.yaml');
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
		const fixtureRoot = resolve(
			CLI_FIXTURES_BLUEPRINTS,
			'scene-character-presence'
		);
		const blueprintPath = resolve(fixtureRoot, 'scene-character-presence.yaml');
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
		const fixtureRoot = resolve(CLI_FIXTURES_BLUEPRINTS, 'condition-example');
		const blueprintPath = resolve(fixtureRoot, 'condition-example.yaml');
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

			const manifestPath = result.build?.manifestPath;
			expect(manifestPath).toBeDefined();
			const manifest = await readManifest(manifestPath!);

			const narrationTypeIds = Object.keys(manifest.artefacts)
				.filter(
					(id) =>
						id.includes('DocProducer.VideoScript.Segments[') &&
						id.includes('NarrationType')
				)
				.sort();
			expect(narrationTypeIds.length).toBeGreaterThanOrEqual(3);

			const useNarrationAudioIds = Object.keys(manifest.artefacts)
				.filter(
					(id) =>
						id.includes('DocProducer.VideoScript.Segments[') &&
						id.includes('UseNarrationAudio')
				)
				.sort();
			expect(useNarrationAudioIds.length).toBeGreaterThanOrEqual(3);

			const observedNarrationTypes: string[] = [];
			for (const artifactId of narrationTypeIds.slice(0, 3)) {
				const blob = manifest.artefacts[artifactId]?.blob;
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
				const blob = manifest.artefacts[artifactId]?.blob;
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
