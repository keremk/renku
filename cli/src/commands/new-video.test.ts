import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNewVideo } from './new-video.js';
import { detectBlueprintInDirectory } from '../lib/blueprint-detection.js';

vi.mock('../lib/blueprint-detection.js', () => ({
	detectBlueprintInDirectory: vi.fn(),
}));

const tmpRoots: string[] = [];
const detectBlueprintInDirectoryMock = vi.mocked(detectBlueprintInDirectory);

afterEach(async () => {
	detectBlueprintInDirectoryMock.mockReset();
	while (tmpRoots.length > 0) {
		const dir = tmpRoots.pop();
		if (dir) {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

async function createTempRoot(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'renku-new-video-'));
	tmpRoots.push(dir);
	return dir;
}

async function createBlueprintFixture(root: string): Promise<string> {
	const blueprintPath = resolve(root, 'test-blueprint.yaml');
	const templatePath = resolve(root, 'input-template.yaml');
	await writeFile(
		blueprintPath,
		`meta:
  name: Test Blueprint
producers:
  - uses: ScriptProducer
`,
		'utf8'
	);
	await writeFile(
		templatePath,
		`inputs:
  InquiryPrompt: "Describe a sunrise"
`,
		'utf8'
	);
	return blueprintPath;
}

describe('runNewVideo', () => {
	it('creates a new build from an explicit blueprint path', async () => {
		const root = await createTempRoot();
		const blueprintPath = await createBlueprintFixture(root);

		const result = await runNewVideo({
			blueprint: blueprintPath,
			displayName: '  Draft Cut A  ',
		});

		expect(result.movieId).toMatch(/^movie-[a-z0-9]{6}$/);
		expect(result.blueprintPath).toBe(blueprintPath);
		expect(result.blueprintFolder).toBe(root);
		expect(result.buildDir).toBe(resolve(root, 'builds', result.movieId));
		expect(result.inputsPath).toBe(
			resolve(root, 'builds', result.movieId, 'inputs.yaml')
		);

		const templateContents = await readFile(
			resolve(root, 'input-template.yaml'),
			'utf8'
		);
		const inputsContents = await readFile(result.inputsPath, 'utf8');
		expect(inputsContents).toBe(templateContents);

		const metadata = JSON.parse(
			await readFile(resolve(root, 'builds', result.movieId, 'metadata.json'), 'utf8')
		) as { displayName?: string; blueprintPath?: string };
		expect(metadata.displayName).toBe('Draft Cut A');
		expect(metadata.blueprintPath).toBe(blueprintPath);
	});

	it('auto-detects blueprint in current directory when none is provided', async () => {
		const root = await createTempRoot();
		const blueprintPath = await createBlueprintFixture(root);
		detectBlueprintInDirectoryMock.mockResolvedValue({
			blueprintPath,
			blueprintFolder: root,
		});

		const result = await runNewVideo();

		expect(result.blueprintPath).toBe(blueprintPath);
		expect(result.buildDir).toBe(resolve(root, 'builds', result.movieId));
		expect(result.inputsPath).toBe(
			resolve(root, 'builds', result.movieId, 'inputs.yaml')
		);
	});

	it('fails when no blueprint is found in current directory', async () => {
		detectBlueprintInDirectoryMock.mockResolvedValue(null);

		await expect(runNewVideo()).rejects.toThrow(
			/No blueprint found in the current directory/i
		);
	});
});
