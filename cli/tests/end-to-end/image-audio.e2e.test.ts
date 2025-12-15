import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { runExecute, formatMovieId } from '../../src/commands/execute.js';
import { getBundledBlueprintsRoot } from '../../src/lib/config-assets.js';
import {
  createLoggerRecorder,
  expectFileExists,
  findJob,
  readPlan,
  setupTempCliConfig,
} from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('end-to-end: image-audio dry runs', () => {
  let tempRoot = '';
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    tempRoot = config.tempRoot;
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('runs image/audio dry-run with three images per narration', async () => {
    const blueprintRoot = getBundledBlueprintsRoot();
    const blueprintPath = resolve(blueprintRoot, 'kenn-burns', 'image-audio.yaml');
    const inputsPath = resolve(__dirname, 'fixtures', 'image-audio-inputs.yaml');

    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-image';
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

    if (queryResult.dryRun?.status !== 'succeeded') {
      throw new Error(`dryRun failed: ${JSON.stringify(queryResult.dryRun, null, 2)}`);
    }
    expect(queryResult.dryRun?.jobCount).toBe(12);
    expect(queryResult.dryRun?.statusCounts.failed).toBe(0);
    expect(queryResult.dryRun?.jobs.every((job) => job.status === 'succeeded')).toBe(true);
    if (warnings.length > 0 || errors.length > 0) {
      // eslint-disable-next-line no-console
      console.error('warnings', warnings, 'errors', errors);
    }
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
    await expectFileExists(queryResult.planPath);
    await expectFileExists(queryResult.storagePath);
    await expectFileExists(resolve(queryResult.storagePath, 'runs', `${queryResult.targetRevision}-plan.json`));
    await expectFileExists(resolve(queryResult.storagePath, 'events', 'inputs.log'));

    const plan = await readPlan(queryResult.planPath);

    const scriptJob = findJob(plan, 'ScriptProducer');
    expect(scriptJob?.context?.inputBindings?.NumOfSegments).toBe('Input:NumOfSegments');
    expect(scriptJob?.context?.inputBindings?.InquiryPrompt).toBe('Input:InquiryPrompt');
    expect(scriptJob?.context?.inputBindings?.Language).toBe('Input:ScriptProducer.Language');
    expect(scriptJob?.produces?.length).toBeGreaterThanOrEqual(3);

    const imagePromptJobs = plan.layers.flat().filter((job: any) => job.producer === 'ImagePromptProducer');
    expect(imagePromptJobs).toHaveLength(2);
    for (const job of imagePromptJobs) {
      expect(job.context?.inputBindings?.NumOfImagesPerNarrative).toBe('Input:NumOfImagesPerNarrative');
      expect(job.context?.inputBindings?.NarrativeText).toMatch(/^Artifact:ScriptProducer\.NarrationScript\[\d+]/);
      expect(job.inputs.some((input: string) => input.startsWith('Artifact:ScriptProducer.NarrationScript'))).toBe(
        true,
      );
    }

    const imageJobs = plan.layers.flat().filter((job: any) => job.producer === 'ImageProducer');
    expect(imageJobs).toHaveLength(6);
    const firstImageJob = imageJobs.at(0);
    expect(firstImageJob).toBeDefined();
    if (!firstImageJob) {
      throw new Error('ImageProducer job missing from plan');
    }
    expect(firstImageJob.context?.inputBindings?.Prompt).toMatch(
      /^Artifact:ImagePromptProducer\.ImagePrompt\[\d+]\[\d+]/,
    );
    expect(firstImageJob.context?.inputBindings?.Size).toBe('Input:Size');
    expect(firstImageJob.context?.inputBindings?.AspectRatio).toBe('Input:AspectRatio');
    expect(
      firstImageJob.inputs.some((input: string) => input.startsWith('Artifact:ImagePromptProducer.ImagePrompt')),
    ).toBe(true);
    expect(
      firstImageJob.inputs.some((input: string) => input === 'Input:Size' || input === 'Input:AspectRatio'),
    ).toBe(true);

    const audioJobs = plan.layers.flat().filter((job: any) => job.producer === 'AudioProducer');
    expect(audioJobs).toHaveLength(2);
    const firstAudioJob = audioJobs.at(0);
    expect(firstAudioJob).toBeDefined();
    if (!firstAudioJob) {
      throw new Error('AudioProducer job missing from plan');
    }
    expect(firstAudioJob.context?.inputBindings?.TextInput).toMatch(
      /^Artifact:ScriptProducer\.NarrationScript\[\d+]/,
    );
    expect(firstAudioJob.inputs).toEqual(expect.arrayContaining(['Input:VoiceId', 'Input:Emotion']));

    const timelineJob = findJob(plan, 'TimelineComposer');
    expect(timelineJob).toBeDefined();
    if (!timelineJob) {
      throw new Error('TimelineComposer job missing from plan');
    }
    expect(timelineJob.inputs).toEqual(
      expect.arrayContaining([
        'Input:TimelineComposer.ImageSegments',
        'Input:TimelineComposer.AudioSegments',
        'Input:Duration',
      ]),
    );
    expect(timelineJob.context?.fanIn?.['Input:TimelineComposer.ImageSegments']?.members?.length).toBe(6);
    expect(timelineJob.context?.fanIn?.['Input:TimelineComposer.AudioSegments']?.members?.length).toBe(2);
    const imageMembers = timelineJob.context?.fanIn?.['Input:TimelineComposer.ImageSegments']?.members ?? [];
    expect(imageMembers.filter((member: any) => member.group === 0).map((m: any) => m.order)).toEqual([0, 1, 2]);
    expect(imageMembers.filter((member: any) => member.group === 1).map((m: any) => m.order)).toEqual([0, 1, 2]);
    const audioMembers = timelineJob.context?.fanIn?.['Input:TimelineComposer.AudioSegments']?.members ?? [];
    expect(audioMembers.map((member: any) => member.group)).toEqual([0, 1]);
    expect(timelineJob.context?.fanIn?.['Input:TimelineComposer.Music']).toBeUndefined();
  });
});
