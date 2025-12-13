/* eslint-env node */
import process from 'node:process';
import './__testutils__/mock-providers.js';
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runGenerate } from './generate.js';
import { formatMovieId } from './execute.js';
import { readCliConfig } from '../lib/cli-config.js';
import { createInputsFile } from './__testutils__/inputs.js';
import { getBundledBlueprintsRoot } from '../lib/config-assets.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const BUNDLED_BLUEPRINT_ROOT = getBundledBlueprintsRoot();
const VIDEO_AUDIO_MUSIC_BLUEPRINT_PATH = resolve(
  BUNDLED_BLUEPRINT_ROOT,
  'cut-scene-video',
  'video-audio-music.yaml',
);
const AUDIO_ONLY_BLUEPRINT_PATH = resolve(
  BUNDLED_BLUEPRINT_ROOT,
  'audio-only',
  'audio-only.yaml',
);
const IMAGE_AUDIO_BLUEPRINT_PATH = resolve(
  BUNDLED_BLUEPRINT_ROOT,
  'kenn-burns',
  'image-audio.yaml',
);
const AUDIO_ONLY_MODELS = [
  { producerId: 'ScriptProducer', provider: 'openai', model: 'gpt-5-mini' },
  { producerId: 'AudioProducer', provider: 'replicate', model: 'minimax/speech-2.6-hd' },
];
const AUDIO_ONLY_OVERRIDES = {
  Duration: 60,
  NumOfSegments: 3,
  VoiceId: 'default-voice',
  Audience: 'Adult',
  Emotion: 'neutral',
  Language: 'en',
};
const LOG_DEFAULTS = { mode: 'log' as const, logLevel: 'info' as const };

const tmpRoots: string[] = [];
const originalEnvConfig = process.env.RENKU_CLI_CONFIG;

afterEach(async () => {
  process.env.RENKU_CLI_CONFIG = originalEnvConfig;
  while (tmpRoots.length) {
    const dir = tmpRoots.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createTempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'renku-generate-'));
  tmpRoots.push(dir);
  return dir;
}

describe('runGenerate (new runs)', () => {
  beforeEach(() => {
    process.env.RENKU_CLI_CONFIG = undefined;
  });

  it('generates a plan and writes prompt/config files', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });

    const inputsPath = await createInputsFile({
      root,
      prompt: 'Tell me a story about the sea',
      models: AUDIO_ONLY_MODELS,
      includeDefaults: false,
      overrides: AUDIO_ONLY_OVERRIDES,
    });
    const result = await runGenerate({
      ...LOG_DEFAULTS,
      inputsPath,
      nonInteractive: true,
      blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
    });

    expect(result.movieId).toHaveLength(8);
    expect(result.dryRun).toBeUndefined();

    const cliConfig = await readCliConfig(cliConfigPath);
    expect(cliConfig).not.toBeNull();

    const storageMovieId = formatMovieId(result.movieId);
    const movieDir = resolve(cliConfig!.storage.root, cliConfig!.storage.basePath, storageMovieId);

    const planStats = await stat(join(movieDir, 'runs', `${result.targetRevision}-plan.json`));
    expect(planStats.isFile()).toBe(true);
    const plan = JSON.parse(
      await readFile(join(movieDir, 'runs', `${result.targetRevision}-plan.json`), 'utf8'),
    );
    const firstJob = plan.layers.flat()[0];
    expect(firstJob.context.inputBindings.InquiryPrompt).toBe('Input:InquiryPrompt');
    expect(firstJob.context.inputs).toContain('Input:InquiryPrompt');
    expect(firstJob.context.produces.some((id: string) => id.startsWith('Artifact:ScriptProducer.NarrationScript'))).toBe(true);

    expect(result.build?.status).toBe('succeeded');
    expect(result.manifestPath).toBeDefined();
    const manifestStats = await stat(result.manifestPath!);
    expect(manifestStats.isFile()).toBe(true);

    const current = JSON.parse(
      await readFile(join(movieDir, 'current.json'), 'utf8'),
    ) as { revision?: string };
    expect(current.revision).toBe(result.targetRevision);
    const friendlyStats = await stat(result.friendlyRoot ?? '');
    expect(friendlyStats.isDirectory()).toBe(true);
  });

  it('can perform a dry run and report summary', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });

    const inputsPath = await createInputsFile({
      root,
      prompt: 'Explain gravity',
      models: AUDIO_ONLY_MODELS,
      includeDefaults: false,
      overrides: AUDIO_ONLY_OVERRIDES,
    });
    const result = await runGenerate({
      ...LOG_DEFAULTS,
      inputsPath,
      dryRun: true,
      nonInteractive: true,
      blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
    });

    expect(result.dryRun).toBeDefined();
    expect(result.dryRun?.status).toBe('succeeded');
    expect(result.dryRun?.jobCount).toBeGreaterThan(0);
    expect(result.dryRun?.statusCounts.succeeded).toBeGreaterThan(0);
    expect(result.build).toBeUndefined();
  });

  it('runs the video + audio + music blueprint with timeline stub', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });

    const inputsPath = await createInputsFile({
      root,
      prompt: 'History of comets',
      overrides: {
        VoiceId: 'timeline-voice',
        NumOfSegments: 2,
      },
    });
    const result = await runGenerate({
      ...LOG_DEFAULTS,
      inputsPath,
      dryRun: true,
      nonInteractive: true,
      blueprint: VIDEO_AUDIO_MUSIC_BLUEPRINT_PATH,
    });

    expect(result.dryRun).toBeDefined();
    expect(result.dryRun?.jobCount).toBeGreaterThan(0);
  });

  it('overrides InquiryPrompt when provided inline', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });

    const inputsPath = await createInputsFile({
      root,
      prompt: 'Original prompt',
      models: AUDIO_ONLY_MODELS,
      includeDefaults: false,
      overrides: AUDIO_ONLY_OVERRIDES,
    });
    const result = await runGenerate({
      ...LOG_DEFAULTS,
      inputsPath,
      nonInteractive: true,
      blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
    });

    expect(result.build?.status).toBe('succeeded');
  });

  it('persists concurrency overrides into the CLI config', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });

    const inputsPath = await createInputsFile({
      root,
      prompt: 'Concurrency check',
      models: AUDIO_ONLY_MODELS,
      includeDefaults: false,
      overrides: AUDIO_ONLY_OVERRIDES,
    });
    await runGenerate({
      ...LOG_DEFAULTS,
      inputsPath,
      nonInteractive: true,
      blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
      concurrency: 3,
    });

    const cliConfig = await readCliConfig(cliConfigPath);
    expect(cliConfig?.concurrency).toBe(3);
  });

  it('reruns only image layer when ImageProducer model changes on edit', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });

    const baselineInputsPath = join(root, 'inputs-image.yaml');
    await copyFile(
      resolve(BUNDLED_BLUEPRINT_ROOT, 'kenn-burns', 'input-template.yaml'),
      baselineInputsPath,
    );

    const initialDoc = parseYaml(await readFile(baselineInputsPath, 'utf8')) as { inputs?: Record<string, unknown>; models?: Array<Record<string, unknown>> };
    const initialImageModel = initialDoc.models?.find((entry) => entry.producerId === 'ImageProducer');
    expect(initialImageModel).toBeDefined();
    if (!initialImageModel) {
      throw new Error('ImageProducer model entry missing from inputs file.');
    }
    initialImageModel.model = 'bytedance/seedream-4';
    await writeFile(baselineInputsPath, stringifyYaml(initialDoc), 'utf8');

    const first = await runGenerate({
      ...LOG_DEFAULTS,
      inputsPath: baselineInputsPath,
      nonInteractive: true,
      blueprint: IMAGE_AUDIO_BLUEPRINT_PATH,
    });
    expect(first.build?.status).toBe('succeeded');

    const doc = parseYaml(await readFile(baselineInputsPath, 'utf8')) as { inputs?: Record<string, unknown>; models?: Array<Record<string, unknown>> };
    const imageModel = doc.models?.find((entry) => entry.producerId === 'ImageProducer');
    expect(imageModel).toBeDefined();
    if (!imageModel) {
      throw new Error('ImageProducer model entry missing from inputs file.');
    }
    imageModel.model = 'google/nano-banana';
    await writeFile(baselineInputsPath, stringifyYaml(doc), 'utf8');

    const second = await runGenerate({
      ...LOG_DEFAULTS,
      useLast: true,
      inputsPath: baselineInputsPath,
      nonInteractive: true,
      blueprint: IMAGE_AUDIO_BLUEPRINT_PATH,
      dryRun: true,
    });
    expect(second.dryRun?.status).toBe('succeeded');

    const plan = JSON.parse(await readFile(second.planPath, 'utf8')) as { layers: Array<unknown[]> };
    expect(plan.layers[0]?.length ?? 0).toBe(0);
    expect(plan.layers[1]?.length ?? 0).toBe(0);
    expect(plan.layers[2]?.length ?? 0).toBeGreaterThan(0);
    expect(plan.layers[3]?.length ?? 0).toBeGreaterThan(0);
  });

  it('schedules TimelineProducer after upstream image/audio jobs', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });

    const inputsPath = await createInputsFile({
      root,
      prompt: 'Formation of galaxies',
      overrides: {
        VoiceId: 'timeline-voice',
        NumOfSegments: 2,
      },
    });
    const result = await runGenerate({
      ...LOG_DEFAULTS,
      inputsPath,
      dryRun: true,
      nonInteractive: true,
      blueprint: VIDEO_AUDIO_MUSIC_BLUEPRINT_PATH,
    });

    expect(result.dryRun).toBeDefined();
    const jobs = result.dryRun?.jobs ?? [];
    const timelineJob = jobs.find((job) => job.producer === 'TimelineComposer');
    const exporterJob = jobs.find((job) => job.producer === 'VideoExporter');
    expect(timelineJob).toBeDefined();
    const upstreamMax = Math.max(
      ...jobs
        .filter((job) => job.producer !== 'TimelineComposer' && job.producer !== 'VideoExporter')
        .map((job) => job.layerIndex),
    );
    expect(timelineJob?.layerIndex).toBeGreaterThan(upstreamMax);
    if (exporterJob) {
      expect(timelineJob?.layerIndex).toBeLessThan(exporterJob.layerIndex);
    }
  });

  it('reuses the last movie when requested', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });

    const inputsPath = await createInputsFile({
      root,
      prompt: 'First run',
      models: AUDIO_ONLY_MODELS,
      includeDefaults: false,
      overrides: AUDIO_ONLY_OVERRIDES,
    });
    const first = await runGenerate({
      ...LOG_DEFAULTS,
      inputsPath,
      nonInteractive: true,
      blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
    });

    const cliConfig = await readCliConfig(cliConfigPath);
    expect(cliConfig?.lastMovieId).toBe(formatMovieId(first.movieId));

    const second = await runGenerate({
      ...LOG_DEFAULTS,
      inputsPath,
      useLast: true,
      dryRun: true,
    });

    expect(second.storageMovieId).toBe(formatMovieId(first.movieId));
    expect(second.dryRun?.jobCount ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('fails when --last is used without a prior generation', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });

    const inputsPath = await createInputsFile({
      root,
      prompt: 'Last without prior',
      models: AUDIO_ONLY_MODELS,
      includeDefaults: false,
      overrides: AUDIO_ONLY_OVERRIDES,
    });

    await expect(
      runGenerate({
        ...LOG_DEFAULTS,
        inputsPath,
        useLast: true,
      }),
    ).rejects.toThrow(/No previous movie found/i);
  });

  it('fails when both last and movieId are provided', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });

    const inputsPath = await createInputsFile({
      root,
      prompt: 'Conflicting flags',
      models: AUDIO_ONLY_MODELS,
      includeDefaults: false,
      overrides: AUDIO_ONLY_OVERRIDES,
    });
    const first = await runGenerate({
      ...LOG_DEFAULTS,
      inputsPath,
      nonInteractive: true,
      blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
    });

    await expect(
      runGenerate({
        ...LOG_DEFAULTS,
        movieId: first.storageMovieId,
        useLast: true,
        dryRun: true,
      }),
    ).rejects.toThrow(/either --last or --movie-id/i);
  });

  it('continues an existing movie when movie-id is provided explicitly', async () => {
    const root = await createTempRoot();
    const cliConfigPath = join(root, 'cli-config.json');
    process.env.RENKU_CLI_CONFIG = cliConfigPath;

    await runInit({ rootFolder: root, configPath: cliConfigPath });

    const inputsPath = await createInputsFile({
      root,
      prompt: 'First run explicit id',
      models: AUDIO_ONLY_MODELS,
      includeDefaults: false,
      overrides: AUDIO_ONLY_OVERRIDES,
    });
    const first = await runGenerate({
      ...LOG_DEFAULTS,
      inputsPath,
      nonInteractive: true,
      blueprint: AUDIO_ONLY_BLUEPRINT_PATH,
    });

    const next = await runGenerate({
      ...LOG_DEFAULTS,
      inputsPath,
      movieId: first.storageMovieId,
      dryRun: true,
    });

    expect(next.storageMovieId).toBe(first.storageMovieId);
    expect(next.dryRun?.jobCount ?? 0).toBeGreaterThanOrEqual(0);
  });
});
