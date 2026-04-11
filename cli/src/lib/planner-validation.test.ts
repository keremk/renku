import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatePlan } from './planner.js';
import type { CliConfig } from './cli-config.js';
import { createCliLogger } from './logger.js';
import {
	CATALOG_ROOT,
	CLI_FIXTURES_BLUEPRINTS,
} from '../../tests/test-catalog-paths.js';

const catalogRoot = CATALOG_ROOT;

describe('planner blueprint validation', () => {
	it('throws validation error for invalid blueprint with missing artifact', async () => {
		const tempRoot = await mkdtemp(resolve(tmpdir(), 'renku-validation-'));
		const blueprintDir = resolve(tempRoot, 'blueprints');
		await mkdir(blueprintDir, { recursive: true });

		// Create an invalid blueprint that references a non-existent artifact
		const invalidBlueprint = `
meta:
  name: Invalid Blueprint
  id: InvalidBlueprint
  version: 0.1.0

inputs:
  - name: TestInput
    type: string

artifacts:
  - name: Output
    type: string

producers:
  - name: TestProducer
    producer: audio/text-to-speech

connections:
  - from: TestInput
    to: TestProducer.InquiryPrompt
  - from: TestProducer.MovieTitle
    to: NonExistentArtifact
`;

		const blueprintPath = resolve(blueprintDir, 'invalid.yaml');
		await writeFile(blueprintPath, invalidBlueprint);

		// Create minimal inputs file
		const inputsPath = resolve(blueprintDir, 'inputs.yaml');
		await writeFile(inputsPath, 'inputs:\n  TestInput: "test value"\n');

		const cliConfig: CliConfig = {
			storage: { root: tempRoot, basePath: 'builds' },
			catalog: { root: catalogRoot },
		};

		try {
			await expect(
				generatePlan({
					cliConfig,
					movieId: 'movie-test',
					isNew: true,
					inputsPath,
					usingBlueprint: blueprintPath,
					logger: createCliLogger({ level: 'info' }),
				})
			).rejects.toThrow(/Blueprint validation failed/);
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it('throws validation error for blueprint with invalid producer input', async () => {
		const tempRoot = await mkdtemp(resolve(tmpdir(), 'renku-validation-'));
		const blueprintDir = resolve(tempRoot, 'blueprints');
		await mkdir(blueprintDir, { recursive: true });

		// Create an invalid blueprint that connects to a non-existent producer input
		const invalidBlueprint = `
meta:
  name: Invalid Blueprint
  id: InvalidBlueprint
  version: 0.1.0

inputs:
  - name: TestInput
    type: string

artifacts:
  - name: Output
    type: string

producers:
  - name: TestProducer
    producer: audio/text-to-speech

connections:
  - from: TestInput
    to: TestProducer.NonExistentInput
  - from: TestProducer.MovieTitle
    to: Output
`;

		const blueprintPath = resolve(blueprintDir, 'invalid.yaml');
		await writeFile(blueprintPath, invalidBlueprint);

		// Create minimal inputs file
		const inputsPath = resolve(blueprintDir, 'inputs.yaml');
		await writeFile(inputsPath, 'inputs:\n  TestInput: "test value"\n');

		const cliConfig: CliConfig = {
			storage: { root: tempRoot, basePath: 'builds' },
			catalog: { root: catalogRoot },
		};

		try {
			await expect(
				generatePlan({
					cliConfig,
					movieId: 'movie-test',
					isNew: true,
					inputsPath,
					usingBlueprint: blueprintPath,
					logger: createCliLogger({ level: 'info' }),
				})
			).rejects.toThrow(/Blueprint validation failed/);
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it('includes error code in validation error message', async () => {
		const tempRoot = await mkdtemp(resolve(tmpdir(), 'renku-validation-'));
		const blueprintDir = resolve(tempRoot, 'blueprints');
		await mkdir(blueprintDir, { recursive: true });

		// Create an invalid blueprint
		const invalidBlueprint = `
meta:
  name: Invalid Blueprint
  id: InvalidBlueprint
  version: 0.1.0

inputs:
  - name: TestInput
    type: string

artifacts:
  - name: Output
    type: string

producers:
  - name: TestProducer
    producer: audio/text-to-speech

connections:
  - from: TestInput
    to: TestProducer.InquiryPrompt
  - from: TestProducer.MovieTitle
    to: MissingArtifact
`;

		const blueprintPath = resolve(blueprintDir, 'invalid.yaml');
		await writeFile(blueprintPath, invalidBlueprint);

		const inputsPath = resolve(blueprintDir, 'inputs.yaml');
		await writeFile(inputsPath, 'inputs:\n  TestInput: "test value"\n');

		const cliConfig: CliConfig = {
			storage: { root: tempRoot, basePath: 'builds' },
			catalog: { root: catalogRoot },
		};

		try {
			await expect(
				generatePlan({
					cliConfig,
					movieId: 'movie-test',
					isNew: true,
					inputsPath,
					usingBlueprint: blueprintPath,
					logger: createCliLogger({ level: 'info' }),
				})
			).rejects.toThrow(/V\d{3}:/); // Validation error codes like V001, V005, etc.
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it('rejects schema-invalid blueprints before planning when the output schema file is missing', async () => {
		const tempRoot = await mkdtemp(resolve(tmpdir(), 'renku-validation-'));
		const cliConfig: CliConfig = {
			storage: { root: tempRoot, basePath: 'builds' },
			catalog: { root: catalogRoot },
		};

		try {
			const { blueprintPath, inputsPath } = await createSchemaValidationFixture(
				tempRoot,
				{
					documentaryOutputSchemaPath: './missing-output.json',
				}
			);

			await expect(
				generatePlan({
					cliConfig,
					movieId: 'movie-test',
					isNew: true,
					inputsPath,
					usingBlueprint: blueprintPath,
					logger: createCliLogger({ level: 'info' }),
				})
			).rejects.toThrow(/Failed to load output schema/);
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});
});

async function createSchemaValidationFixture(
	tempRoot: string,
	args: {
		documentaryOutputSchemaPath?: string;
		rootBlueprintReplacements?: Array<[string, string]>;
	}
): Promise<{ blueprintPath: string; inputsPath: string }> {
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
	const blueprintDir = resolve(tempRoot, 'fixture-blueprint');
	const documentaryDir = resolve(blueprintDir, 'documentary');
	await mkdir(blueprintDir, { recursive: true });
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

	const blueprintPath = resolve(blueprintDir, 'conditional-narration-routing.yaml');
	const inputsPath = resolve(blueprintDir, 'input-template.yaml');
	await writeFile(blueprintPath, rootBlueprint, 'utf8');
	await writeFile(
		resolve(documentaryDir, 'documentary.yaml'),
		documentaryBlueprint,
		'utf8'
	);
	await cp(resolve(fixtureRoot, 'input-template.yaml'), inputsPath);

	return { blueprintPath, inputsPath };
}
