import { resolve } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { runExecute, formatMovieId } from '../../../src/commands/execute.js';
import {
  createLoggerRecorder,
  findJob,
  readPlan,
  setupTempCliConfig,
} from '../helpers.js';
import {
  CLI_FIXTURES_BLUEPRINTS,
  CLI_FIXTURES_INPUTS,
} from '../../test-catalog-paths.js';

describe('end-to-end: subtitles composite producer plan wiring', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('plans the three-stage subtitles pipeline between timeline and exporter', async () => {
    const blueprintPath = resolve(
      CLI_FIXTURES_BLUEPRINTS,
      'pipeline-orchestration',
      'video-audio-music-timeline-subtitles-v2',
      'video-audio-music-timeline-subtitles-v2.yaml',
    );
    const inputsPath = resolve(
      CLI_FIXTURES_INPUTS,
      'video-audio-music-timeline-subtitles-v2--pipeline.inputs.yaml',
    );
    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-subtitles-composite';
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
    const exporterJob = findJob(plan, 'VideoExporter');

    expect(sttJobs.length).toBe(2);
    expect(normalizerJobs.length).toBe(2);
    expect(composerJob).toBeDefined();
    expect(exporterJob).toBeDefined();

    expect(composerJob?.context?.inputBindings?.Timeline).toBe(
      'Artifact:TimelineComposer.Timeline',
    );
    expect(composerJob?.context?.inputBindings?.Duration).toBe('Input:Duration');
    expect(
      composerJob?.context?.fanIn?.['Input:SubtitlesProducer.SubtitlesComposer.Transcripts'],
    ).toBeDefined();

    expect(exporterJob?.context?.inputBindings?.Transcription).toBe(
      'Artifact:SubtitlesProducer.SubtitlesComposer.Transcription',
    );
  });
});
