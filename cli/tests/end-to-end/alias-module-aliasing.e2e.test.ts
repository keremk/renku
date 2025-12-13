import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { runExecute, formatMovieId } from '../../src/commands/execute.js';
import {
  createLoggerRecorder,
  expectFileExists,
  findJob,
  readPlan,
  setupTempCliConfig,
} from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('end-to-end: module alias drives canonical producer ids', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('uses module alias instead of producer meta.id for canonical ids in dry-run', async () => {
    const blueprintPath = resolve(__dirname, 'fixtures', 'alias-audio-only.yaml');
    const inputsPath = resolve(__dirname, 'fixtures', 'alias-audio-only-inputs.yaml');
    const movieId = 'e2e-alias-audio';
    const storageMovieId = formatMovieId(movieId);
    const { logger, warnings, errors } = createLoggerRecorder();

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

    if (queryResult.dryRun?.status !== 'succeeded') {
      throw new Error(`dryRun failed: ${JSON.stringify(queryResult.dryRun, null, 2)}`);
    }
    expect(queryResult.dryRun?.jobCount).toBe(4); // 1 script + 3 audio
    expect(queryResult.dryRun?.statusCounts.failed).toBe(0);
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);

    await expectFileExists(queryResult.planPath);
    const plan = await readPlan(queryResult.planPath);

    const scriptJob = findJob(plan, 'DocScript');
    expect(scriptJob).toBeDefined();
    if (!scriptJob) {
      throw new Error('DocScript job missing from plan');
    }
    expect(scriptJob.jobId.startsWith('Producer:DocScript')).toBe(true);
    expect(scriptJob.inputs).toEqual(
      expect.arrayContaining(['Input:InquiryPrompt', 'Input:Duration', 'Input:NumOfSegments']),
    );

    const audioJobs = plan.layers.flat().filter((job: any) => job.producer === 'NarrationAudio');
    expect(audioJobs).toHaveLength(3);
    for (const job of audioJobs) {
      expect(job.jobId.startsWith('Producer:NarrationAudio')).toBe(true);
      expect(job.context?.inputBindings?.TextInput).toMatch(/^Artifact:DocScript\.NarrationScript\[\d+]/);
      expect(job.inputs).toEqual(
        expect.arrayContaining(['Input:VoiceId', 'Input:Emotion', 'Input:NarrationAudio.provider', 'Input:NarrationAudio.model']),
      );
    }
  });
});
