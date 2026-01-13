import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatePlan } from './planner.js';
import type { CliConfig } from './cli-config.js';
import { createCliLogger } from './logger.js';
import { CATALOG_ROOT } from '../../tests/test-catalog-paths.js';

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
    producer: asset/text-to-speech

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
        }),
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
    producer: asset/text-to-speech

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
        }),
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
    producer: asset/text-to-speech

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
        }),
      ).rejects.toThrow(/V\d{3}:/); // Validation error codes like V001, V005, etc.
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
