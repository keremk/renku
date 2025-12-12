import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { runQuery, formatMovieId } from '../../src/commands/query.js';
import { getBundledBlueprintsRoot } from '../../src/lib/config-assets.js';
import {
  createLoggerRecorder,
  expectFileExists,
  readPlan,
  setupTempCliConfig,
} from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    const blueprintRoot = getBundledBlueprintsRoot();
    const blueprintPath = resolve(blueprintRoot, 'image-to-video', 'image-to-video.yaml');
    const inputsPath = resolve(__dirname, 'fixtures', 'image-to-video-inputs.yaml');

    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-image-to-video';
    const storageMovieId = formatMovieId(movieId);

    const queryResult = await runQuery({
      inputsPath,
      usingBlueprint: blueprintPath,
      dryRun: true,
      nonInteractive: true,
      mode: 'log',
      movieId,
      storageMovieId,
      logger,
      notifications: undefined,
    });

    if (queryResult.dryRun?.status !== 'succeeded') {
      throw new Error(`dryRun failed: ${JSON.stringify(queryResult.dryRun, null, 2)}`);
    }
    expect(queryResult.dryRun?.statusCounts.failed).toBe(0);
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

    expect(job0.context?.inputBindings?.InputImage1).toBe('Artifact:ImageProducer.SegmentImage[0]');
    expect(job0.context?.inputBindings?.InputImage2).toBe('Artifact:ImageProducer.SegmentImage[1]');

    expect(job1.context?.inputBindings?.InputImage1).toBe('Artifact:ImageProducer.SegmentImage[1]');
    expect(job1.context?.inputBindings?.InputImage2).toBe('Artifact:ImageProducer.SegmentImage[2]');
  });
});

