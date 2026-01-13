import { resolve } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { runExecute, formatMovieId } from '../../src/commands/execute.js';
import {
  createLoggerRecorder,
  expectFileExists,
  readPlan,
  setupTempCliConfig,
} from './helpers.js';
import { CLI_FIXTURES_BLUEPRINTS, CLI_FIXTURES_INPUTS } from '../test-catalog-paths.js';

function parseFirstIndex(jobId: string): number {
  const match = jobId.match(/\[(\d+)]/);
  if (!match) {
    throw new Error(`Expected indexed jobId, got "${jobId}"`);
  }
  return parseInt(match[1]!, 10);
}

describe('end-to-end: indexed collection binding', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('wires constant-indexed collection inputs (ReferenceImages[0], ReferenceImages[1]) to VideoProducer', async () => {
    // This test verifies the key feature: connecting different artifacts to specific
    // indices of a collection input. The blueprint connects:
    // - CharacterImageProducer.GeneratedImage -> VideoProducer[clip].ReferenceImages[0]
    // - ProductImageProducer.GeneratedImage -> VideoProducer[clip].ReferenceImages[1]
    //
    // Each VideoProducer job should have element-level bindings that allow the SDK
    // to reconstruct the ReferenceImages array from the two individual artifacts.

    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'indexed-collection-binding.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'indexed-collection-binding-inputs.yaml');

    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-indexed-collection';
    const storageMovieId = formatMovieId(movieId);

    const queryResult = await runExecute({
      storageMovieId,
      movieId,
      isNew: true,
      inputsPath,
      blueprintSpecifier: blueprintPath,
      dryRun: true,
      nonInteractive: true,
      logger,
    });

    if (queryResult.build?.status !== 'succeeded') {
      throw new Error(`dryRun failed: ${JSON.stringify(queryResult.build, null, 2)}`);
    }
    expect(queryResult.build?.counts.failed).toBe(0);
    if (warnings.length > 0 || errors.length > 0) {
      // eslint-disable-next-line no-console
      console.error('warnings', warnings, 'errors', errors);
    }
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
    await expectFileExists(queryResult.planPath);

    const plan = await readPlan(queryResult.planPath);

    // Verify image producers are created
    const characterImageJobs = plan.layers.flat().filter((job: any) => job.producer === 'CharacterImageProducer');
    expect(characterImageJobs).toHaveLength(1);

    const productImageJobs = plan.layers.flat().filter((job: any) => job.producer === 'ProductImageProducer');
    expect(productImageJobs).toHaveLength(1);

    // Verify video producer jobs are created (NumOfClips = 2)
    const videoJobs = plan.layers.flat().filter((job: any) => job.producer === 'VideoProducer');
    expect(videoJobs).toHaveLength(2);

    // Sort video jobs by index
    const sortedVideos = [...videoJobs].sort((a: any, b: any) => parseFirstIndex(a.jobId) - parseFirstIndex(b.jobId));

    // Verify each video job has the correct element-level input bindings
    for (const videoJob of sortedVideos) {
      const bindings = videoJob.context?.inputBindings;
      expect(bindings).toBeDefined();

      // Key assertion: element-level bindings should exist
      expect(bindings['ReferenceImages[0]']).toBe('Artifact:CharacterImageProducer.GeneratedImage');
      expect(bindings['ReferenceImages[1]']).toBe('Artifact:ProductImageProducer.GeneratedImage');
    }

    // Verify the first video job has the expected structure
    const [job0, job1] = sortedVideos;
    expect(job0).toBeDefined();
    expect(job1).toBeDefined();

    // Both jobs should reference the same artifacts (broadcast pattern)
    expect(job0.context?.inputBindings?.['ReferenceImages[0]']).toBe(
      job1.context?.inputBindings?.['ReferenceImages[0]']
    );
    expect(job0.context?.inputBindings?.['ReferenceImages[1]']).toBe(
      job1.context?.inputBindings?.['ReferenceImages[1]']
    );

    // Verify artifacts from element-level bindings are included in inputs list
    expect(job0.inputs).toContain('Artifact:CharacterImageProducer.GeneratedImage');
    expect(job0.inputs).toContain('Artifact:ProductImageProducer.GeneratedImage');
  });
});
