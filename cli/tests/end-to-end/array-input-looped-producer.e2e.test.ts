import { resolve } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { runExecute, formatMovieId } from '../../src/commands/execute.js';
import {
  createLoggerRecorder,
  expectFileExists,
  readPlan,
  setupTempCliConfig,
} from './helpers.js';
import { CLI_FIXTURES_BLUEPRINTS, CLI_FIXTURES_INPUTS } from '../test-catalog-paths.js';

function parseFirstIndex(jobId: string): number {
  const match = jobId.match(/\[(\d+)\]/);
  if (!match) {
    throw new Error(`Expected indexed jobId, got "${jobId}"`);
  }
  return parseInt(match[1]!, 10);
}

describe('end-to-end: array input wiring to looped producer collection element', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('resolves array input elements per loop iteration and executes dry-run successfully', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'array-input-looped-producer.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'array-input-looped-producer-inputs.yaml');
    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-array-input-looped-producer';
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

    expect(result.build?.counts.failed).toBe(0);
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
    await expectFileExists(result.planPath);

    const plan = await readPlan(result.planPath);
    const jobs = plan.layers
      .flat()
      .filter((job: any) => job.producer === 'ThenImageProducer')
      .sort((a: any, b: any) => parseFirstIndex(a.jobId) - parseFirstIndex(b.jobId));

    expect(jobs).toHaveLength(3);

    const mappedSourceIds = new Set<string>();
    for (const job of jobs) {
      const index = parseFirstIndex(job.jobId);
      const bindings = job.context?.inputBindings;
      expect(bindings).toBeDefined();
      expect(bindings?.Prompt).toBe('Input:Prompt');
      expect(bindings?.SourceImages).toBe(`Input:ThenImageProducer.SourceImages[${index}]`);
      expect(bindings?.['SourceImages[0]']).toBe(`Input:CelebrityThenImages[${index}]`);
      mappedSourceIds.add(bindings?.['SourceImages[0]']);
    }

    expect(mappedSourceIds).toEqual(
      new Set([
        'Input:CelebrityThenImages[0]',
        'Input:CelebrityThenImages[1]',
        'Input:CelebrityThenImages[2]',
      ]),
    );
  });
});
