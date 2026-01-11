import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { runExecute, formatMovieId } from '../../src/commands/execute.js';
import {
  createLoggerRecorder,
  expectFileExists,
  findJob,
  readPlan,
  setupTempCliConfig,
} from './helpers.js';
import { CATALOG_BLUEPRINTS_ROOT } from '../test-catalog-paths.js';

const CATALOG_PRODUCERS_ROOT = resolve(CATALOG_BLUEPRINTS_ROOT, '..', 'producers');

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('end-to-end: video-audio-music dry runs', () => {
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

  it('runs query and edit dry-runs with canonical bindings and artefacts', async () => {
    const blueprintRoot = CATALOG_BLUEPRINTS_ROOT;
    const blueprintPath = resolve(blueprintRoot, 'cut-scene-video', 'video-audio-music.yaml');
    const inputsPath = resolve(__dirname, 'fixtures', 'video-audio-music-inputs.yaml');
    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-video';
    const storageMovieId = formatMovieId(movieId);

    // Run query dry-run
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
    expect(queryResult.build?.jobCount).toBe(12);
    expect(queryResult.build?.counts.failed).toBe(0);
    expect(queryResult.build?.jobs?.every((job) => job.status === 'succeeded')).toBe(true);
    // Debug helpers if warnings/errors appear
    if (warnings.length > 0 || errors.length > 0) {
      // eslint-disable-next-line no-console
      console.error('warnings', warnings, 'errors', errors);
    }
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect(queryResult.planPath).toBeDefined();
    await expectFileExists(queryResult.planPath);
    await expectFileExists(queryResult.storagePath);

    const plan = await readPlan(queryResult.planPath);
    const scriptJob = findJob(plan, 'ScriptProducer');
    expect(scriptJob?.context?.inputBindings?.InquiryPrompt).toBe('Input:InquiryPrompt');
    expect(scriptJob?.context?.inputBindings?.Duration).toBe('Input:Duration');
    expect(scriptJob?.context?.inputBindings?.NumOfSegments).toBe('Input:NumOfSegments');
    expect(scriptJob?.context?.inputBindings?.Language).toBe('Input:Language');
    expect(scriptJob?.context?.inputBindings?.Audience).toBe('Input:Audience');

    const audioJobs = plan.layers.flat().filter((job: any) => job.producer === 'AudioProducer');
    expect(audioJobs).toHaveLength(2);
    const audioJob0 = audioJobs[0];
    expect(audioJob0?.context?.inputBindings?.Text).toMatch(/^Artifact:ScriptProducer\.NarrationScript\[0]/);
    expect(audioJob0?.inputs.some((id: string) => id.startsWith('Artifact:ScriptProducer.NarrationScript'))).toBe(
      true,
    );

    const videoPromptJobs = plan.layers.flat().filter((job: any) => job.producer === 'VideoPromptProducer');
    expect(videoPromptJobs).toHaveLength(2);
    const videoPromptJob0 = videoPromptJobs[0];
    expect(videoPromptJob0?.inputs.some((id: string) => id.startsWith('Artifact:ScriptProducer.NarrationScript'))).toBe(
      true,
    );
    expect(videoPromptJob0?.context?.inputBindings?.NarrativeText).toMatch(
      /^Artifact:ScriptProducer\.NarrationScript\[0]/,
    );

    const videoJobs = plan.layers.flat().filter((job: any) => job.producer === 'VideoProducer');
    expect(videoJobs).toHaveLength(2);
    for (const job of videoJobs) {
      expect(job.context?.inputBindings?.Prompt).toMatch(
        /^Artifact:VideoPromptProducer\.VideoPrompt\[\d+]/,
      );
      expect(job.inputs.some((id: string) => id.startsWith('Artifact:VideoPromptProducer.VideoPrompt'))).toBe(true);
    }

    const musicPromptJob = findJob(plan, 'MusicPromptProducer');
    expect(musicPromptJob?.context?.fanIn?.['Input:MusicPromptProducer.NarrationScript']?.members?.length).toBeGreaterThan(
      0,
    );
    expect(musicPromptJob?.context?.inputBindings?.NarrationScript).toBe('Input:MusicPromptProducer.NarrationScript');

    const musicJob = findJob(plan, 'MusicProducer');
    expect(musicJob?.context?.inputBindings?.Prompt).toBe('Artifact:MusicPromptProducer.MusicPrompt');
    expect(musicJob?.context?.inputBindings?.Duration).toBe('Input:Duration');

    const timelineJob = findJob(plan, 'TimelineComposer');
    expect(timelineJob).toBeDefined();
    if (!timelineJob) {
      throw new Error('TimelineComposer job missing from plan');
    }
    expect(timelineJob.inputs).toEqual(
      expect.arrayContaining([
        'Input:TimelineComposer.VideoSegments',
        'Input:TimelineComposer.AudioSegments',
        'Input:TimelineComposer.Music',
        'Input:Duration',
      ]),
    );
    expect(timelineJob.context?.fanIn?.['Input:TimelineComposer.ImageSegments']).toBeUndefined();
    expect(timelineJob.context?.fanIn?.['Input:TimelineComposer.VideoSegments']?.members?.length).toBe(2);
    expect(timelineJob.context?.fanIn?.['Input:TimelineComposer.AudioSegments']?.members?.length).toBe(2);
    expect(timelineJob.context?.fanIn?.['Input:TimelineComposer.Music']?.members?.length).toBe(1);

    // Ensure plan artifacts stored under storage root
    await expectFileExists(resolve(queryResult.storagePath, 'runs', `${queryResult.targetRevision}-plan.json`));
    await expectFileExists(resolve(queryResult.storagePath, 'events', 'inputs.log'));

    // Prepare edited inputs to force re-run
    // When copying to temp directory, convert relative promptFile paths to absolute paths
    const editedInputsPath = join(tempRoot, 'edited-inputs.yaml');
    const originalContent = await readFile(inputsPath, 'utf8');
    const doc = parseYaml(originalContent) as { inputs?: Record<string, unknown>; models?: Array<Record<string, unknown>> };
    doc.inputs = doc.inputs ?? {};
    doc.inputs.InquiryPrompt = 'Chronicle deep-sea exploration technology';
    // Convert relative promptFile/outputSchema paths to absolute paths
    for (const model of doc.models ?? []) {
      if (typeof model.promptFile === 'string') {
        model.promptFile = resolve(CATALOG_PRODUCERS_ROOT, model.promptFile.replace(/^(\.\.\/)*catalog\/producers\//, ''));
      }
      if (typeof model.outputSchema === 'string') {
        model.outputSchema = resolve(CATALOG_PRODUCERS_ROOT, model.outputSchema.replace(/^(\.\.\/)*catalog\/producers\//, ''));
      }
    }
    await writeFile(editedInputsPath, stringifyYaml(doc), 'utf8');

    const editResult = await runExecute({
      storageMovieId: queryResult.storageMovieId,
      isNew: false,
      inputsPath: editedInputsPath,
      dryRun: true,
      nonInteractive: true,
      logger,
    });

    expect(editResult.build?.status).toBe('succeeded');
    expect(editResult.build?.jobCount).toBe(12);
    expect(editResult.build?.counts.failed).toBe(0);
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
    await expectFileExists(editResult.planPath);
    const editPlan = await readPlan(editResult.planPath);
    const editAudioJob0 = findJob(editPlan, 'AudioProducer');
    expect(editAudioJob0?.context?.inputBindings?.Text).toMatch(
      /^Artifact:ScriptProducer\.NarrationScript\[0]/,
    );
    const editTimelineJob = findJob(editPlan, 'TimelineComposer');
    expect(editTimelineJob?.context?.fanIn?.['Input:TimelineComposer.VideoSegments']?.members?.length).toBe(2);
    expect(editTimelineJob?.context?.fanIn?.['Input:TimelineComposer.AudioSegments']?.members?.length).toBe(2);
  });
});
