import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runExecute, formatMovieId } from '../../../src/commands/execute.js';
import {
  createLoggerRecorder,
  findJob,
  readPlan,
  setupTempCliConfig,
} from '../helpers.js';
import { CLI_FIXTURES_BLUEPRINTS } from '../../test-catalog-paths.js';

describe('end-to-end: subtitles composite producer sparse inputs', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('skips STT and normalization jobs for missing transcription-audio segments', async () => {
    const blueprintPath = resolve(
      CLI_FIXTURES_BLUEPRINTS,
      'pipeline-orchestration',
      'subtitles-input-driven-sparse',
      'subtitles-input-driven-sparse.yaml',
    );
    const inputsPath = resolve(
      CLI_FIXTURES_BLUEPRINTS,
      'pipeline-orchestration',
      'subtitles-input-driven-sparse',
      'input-template.yaml',
    );
    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-subtitles-composite-sparse';
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

    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);

    const plan = await readPlan(result.planPath);
    const jobs = plan.layers.flat();
    const sttJobs = jobs.filter((job: any) =>
      typeof job.producer === 'string' &&
      job.producer.startsWith('SubtitlesProducer.STTTimestamps')
    );
    const normalizerJobs = jobs.filter((job: any) =>
      typeof job.producer === 'string' &&
      job.producer.startsWith('SubtitlesProducer.STTNormalizer')
    );
    const composerJob = findJob(plan, 'SubtitlesProducer.SubtitlesComposer');

    expect(sttJobs).toHaveLength(2);
    expect(normalizerJobs).toHaveLength(2);
    expect(composerJob).toBeDefined();
  });
});
