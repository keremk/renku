import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatMovieId, runExecute } from '../../../src/commands/execute.js';
import {
  createLoggerRecorder,
  expectFileExists,
  findJob,
  readPlan,
  setupTempCliConfig,
} from '../helpers.js';
import {
  CLI_FIXTURES_BLUEPRINTS,
  CLI_FIXTURES_INPUTS,
} from '../../test-catalog-paths.js';

describe('end-to-end: video stitcher fan-in dry run', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('plans and executes the stitcher with canonical fan-in data', async () => {
    const blueprintPath = resolve(
      CLI_FIXTURES_BLUEPRINTS,
      'pipeline-orchestration',
      'video-stitcher-fanin',
      'video-stitcher-fanin.yaml'
    );
    const inputsPath = resolve(
      CLI_FIXTURES_INPUTS,
      'video-stitcher-fanin--default.inputs.yaml'
    );

    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-video-stitcher-fanin';
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

    expect(result.build.counts.failed).toBe(0);
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
    await expectFileExists(result.planPath);

    const plan = await readPlan(result.planPath);
    const stitcherJob = findJob(plan, 'VideoStitcher');
    expect(stitcherJob).toBeDefined();
    expect(stitcherJob.produces).toContain(
      'Artifact:VideoStitcher.StitchedVideo'
    );

    const videoFanIn =
      stitcherJob.context?.fanIn?.['Input:VideoStitcher.VideoSegments'];
    expect(videoFanIn).toBeDefined();
    expect(videoFanIn?.members).toHaveLength(2);
    expect(videoFanIn?.members[0]?.id).toBe(
      'Artifact:VideoProducer.GeneratedVideo[0]'
    );
    expect(videoFanIn?.members[1]?.id).toBe(
      'Artifact:VideoProducer.GeneratedVideo[1]'
    );

    expect(result.build.jobs).toBeDefined();
    expect(result.build.jobs?.every((job) => job.status === 'succeeded')).toBe(
      true
    );
  });
});
