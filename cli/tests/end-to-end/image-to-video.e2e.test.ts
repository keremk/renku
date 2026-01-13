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

describe('end-to-end: image-to-video dry runs', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('wires sliding start/end images into ImageToVideoProducer', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'continuous-video', 'continuous-video.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'continuous-video-inputs.yaml');

    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-image-to-video';
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

    const imageJobs = plan.layers.flat().filter((job: any) => job.producer === 'ImageProducer');
    expect(imageJobs).toHaveLength(3); // NumOfSegments + 1 via countInputOffset

    const videoJobs = plan.layers.flat().filter((job: any) => job.producer === 'ImageToVideoProducer');
    expect(videoJobs).toHaveLength(2);

    const sortedVideos = [...videoJobs].sort((a: any, b: any) => parseFirstIndex(a.jobId) - parseFirstIndex(b.jobId));
    const [job0, job1] = sortedVideos;
    expect(job0).toBeDefined();
    expect(job1).toBeDefined();

    expect(job0.context?.inputBindings?.StartImage).toBe('Artifact:ImageProducer.GeneratedImage[0]');
    expect(job0.context?.inputBindings?.EndImage).toBe('Artifact:ImageProducer.GeneratedImage[1]');

    expect(job1.context?.inputBindings?.StartImage).toBe('Artifact:ImageProducer.GeneratedImage[1]');
    expect(job1.context?.inputBindings?.EndImage).toBe('Artifact:ImageProducer.GeneratedImage[2]');
  });
});

