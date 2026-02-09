import { readFile, rm } from 'node:fs/promises';
import path, { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createEventLog,
  createManifestService,
  createStorageContext,
  executePlanWithConcurrency,
  initializeMovieStorage,
  injectAllSystemInputs,
  readBlobFromStorage,
  resolveBlobRefsToInputs,
  type ProduceFn,
  type ProduceRequest,
  type ProduceResult,
  type RunResult,
} from '@gorenku/core';
import {
  createProviderProduce,
  createProviderRegistry,
  loadModelCatalog,
  prepareProviderHandlers,
} from '@gorenku/providers';
import { getDefaultCliConfigPath, readCliConfig } from '../../src/lib/cli-config.js';
import { formatMovieId } from '../../src/commands/execute.js';
import { generatePlan } from '../../src/lib/planner.js';
import { createLoggerRecorder, findJob, setupTempCliConfig } from './helpers.js';
import {
  CATALOG_MODELS_ROOT,
  CLI_FIXTURES_BLUEPRINTS,
  CLI_FIXTURES_MEDIA,
} from '../test-catalog-paths.js';

interface ScenarioOptions {
  storageMovieId: string;
  breakAudioFileBeforeTranscription?: boolean;
}

interface ScenarioResult {
  run: RunResult;
  capturedAssetBlobPaths: Record<string, string> | undefined;
  audioFixture: Buffer;
  storageRoot: string;
  storageBasePath: string;
}

async function runTranscriptionPathScenario(
  options: ScenarioOptions,
): Promise<ScenarioResult> {
  const blueprintPath = resolve(
    CLI_FIXTURES_BLUEPRINTS,
    'transcription-path-resolution',
    'transcription-path-resolution.yaml',
  );
  const inputsPath = resolve(
    CLI_FIXTURES_BLUEPRINTS,
    'transcription-path-resolution',
    'input-template.yaml',
  );
  const { logger } = createLoggerRecorder();

  const configPath = getDefaultCliConfigPath();
  const cliConfig = await readCliConfig(configPath);
  if (!cliConfig) {
    throw new Error('CLI config not initialized');
  }

  const planResult = await generatePlan({
    cliConfig,
    movieId: options.storageMovieId,
    isNew: true,
    inputsPath,
    usingBlueprint: blueprintPath,
    logger,
    notifications: undefined,
  });

  const timelineJob = findJob(planResult.plan, 'TimelineComposer');
  expect(timelineJob).toBeDefined();
  const transcriptionFanIn = timelineJob?.context?.fanIn?.['Input:TimelineComposer.TranscriptionAudio'];
  expect(transcriptionFanIn).toBeDefined();
  expect(transcriptionFanIn?.members?.length).toBe(3);

  const transcriptionJob = findJob(planResult.plan, 'TranscriptionProducer');
  expect(transcriptionJob).toBeDefined();
  expect(transcriptionJob?.context?.inputBindings?.Timeline).toBe(
    'Artifact:TimelineComposer.Timeline',
  );

  const storage = createStorageContext({
    kind: 'local',
    rootDir: cliConfig.storage.root,
    basePath: cliConfig.storage.basePath,
  });
  await initializeMovieStorage(storage, options.storageMovieId);
  const eventLog = createEventLog(storage);
  const manifestService = createManifestService(storage);

  const catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);
  const registry = createProviderRegistry({
    mode: 'simulated',
    logger,
    catalog,
    catalogModelsDir: planResult.catalogModelsDir,
  });

  const preResolved = prepareProviderHandlers(registry, planResult.plan, planResult.providerOptions);
  await registry.warmStart?.(preResolved);

  const resolvedInputsWithBlobs = await resolveBlobRefsToInputs(
    storage,
    options.storageMovieId,
    planResult.resolvedInputs,
  );
  const resolvedInputsWithSystem = injectAllSystemInputs(
    resolvedInputsWithBlobs as Record<string, unknown>,
    options.storageMovieId,
    cliConfig.storage.root,
    cliConfig.storage.basePath,
  );

  const delegateProduce = createProviderProduce(
    registry,
    planResult.providerOptions,
    resolvedInputsWithSystem,
    preResolved,
    logger,
  );

  const audioFixture = await readFile(resolve(CLI_FIXTURES_MEDIA, 'audio-fixture.mp3'));
  let capturedAssetBlobPaths: Record<string, string> | undefined;

  const produce: ProduceFn = async (request: ProduceRequest): Promise<ProduceResult> => {
    if (request.job.producer === 'AudioProducer') {
      const artefacts = request.job.produces
        .filter((id) => id.startsWith('Artifact:'))
        .map((artefactId) => ({
          artefactId,
          blob: {
            data: audioFixture,
            mimeType: 'audio/mpeg',
          },
        }));

      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artefacts,
      };
    }

    if (request.job.producer === 'TranscriptionProducer') {
      capturedAssetBlobPaths = request.job.context?.extras?.assetBlobPaths as Record<string, string> | undefined;

      if (options.breakAudioFileBeforeTranscription && capturedAssetBlobPaths) {
        const [firstRelativePath] = Object.values(capturedAssetBlobPaths);
        if (typeof firstRelativePath === 'string') {
          const absolutePath = path.resolve(cliConfig.storage.root, firstRelativePath);
          await rm(absolutePath, { force: true });
        }
      }
    }

    return delegateProduce(request);
  };

  const run = await executePlanWithConcurrency(
    planResult.plan,
    {
      movieId: options.storageMovieId,
      manifest: planResult.manifest,
      storage,
      eventLog,
      manifestService,
      produce,
      logger,
    },
    {
      concurrency: 1,
    },
  );

  return {
    run,
    capturedAssetBlobPaths,
    audioFixture,
    storageRoot: cliConfig.storage.root,
    storageBasePath: cliConfig.storage.basePath,
  };
}

describe('end-to-end: transcription audio path resolution', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('loads transcription audio from storage-relative blob paths resolved against storage root', async () => {
    const movieId = formatMovieId('e2e-transcription-path-resolution');
    const result = await runTranscriptionPathScenario({ storageMovieId: movieId });

    if (result.run.status !== 'succeeded') {
      const failures = result.run.jobs
        .filter((job) => job.status === 'failed')
        .map((job) => ({
          producer: job.producer,
          jobId: job.jobId,
          error: job.error?.message,
        }));
      throw new Error(`Scenario failed unexpectedly: ${JSON.stringify(failures, null, 2)}`);
    }

    expect(result.run.status).toBe('succeeded');
    expect(result.run.jobs.every((job) => job.status === 'succeeded')).toBe(true);
    expect(result.capturedAssetBlobPaths).toBeDefined();

    const assetBlobPaths = result.capturedAssetBlobPaths!;
    const assetEntries = Object.entries(assetBlobPaths).filter(([assetId]) =>
      assetId.startsWith('Artifact:AudioProducer.GeneratedAudio['),
    );
    expect(assetEntries).toHaveLength(3);

    for (const [assetId, relativeBlobPath] of assetEntries) {
      expect(path.isAbsolute(relativeBlobPath)).toBe(false);
      expect(relativeBlobPath.startsWith(`${result.storageBasePath}/${movieId}/blobs/`)).toBe(true);

      const absoluteBlobPath = path.resolve(result.storageRoot, relativeBlobPath);
      const storedAudio = await readFile(absoluteBlobPath);
      expect(storedAudio.equals(result.audioFixture)).toBe(true);

      expect(assetId).toMatch(/^Artifact:AudioProducer\.GeneratedAudio\[\d+\]$/);
    }

    const manifest = await result.run.buildManifest();
    const audioArtefactIds = Object.keys(manifest.artefacts).filter((artefactId) =>
      artefactId.startsWith('Artifact:AudioProducer.GeneratedAudio['),
    );
    expect(audioArtefactIds).toHaveLength(3);
    for (const artefactId of audioArtefactIds) {
      expect(manifest.artefacts[artefactId]?.blob?.mimeType).toBe('audio/mpeg');
    }

    const timelineArtefact = manifest.artefacts['Artifact:TimelineComposer.Timeline'];
    expect(timelineArtefact?.blob?.mimeType).toBe('application/json');
    if (!timelineArtefact?.blob) {
      throw new Error('Timeline artifact blob missing');
    }

    const timelineBlob = await readBlobFromStorage(
      createStorageContext({
        kind: 'local',
        rootDir: result.storageRoot,
        basePath: result.storageBasePath,
      }),
      movieId,
      timelineArtefact.blob,
    );
    const timeline = JSON.parse(
      typeof timelineBlob.data === 'string'
        ? timelineBlob.data
        : Buffer.from(timelineBlob.data).toString('utf8'),
    ) as {
      tracks: Array<{
        kind: string;
        clips: Array<{
          startTime: number;
          duration: number;
          properties: { assetId?: string };
        }>;
      }>;
    };

    const audioTrack = timeline.tracks.find((track) => track.kind === 'Audio');
    const transcriptionTrack = timeline.tracks.find((track) => track.kind === 'Transcription');
    expect(audioTrack).toBeDefined();
    expect(transcriptionTrack).toBeDefined();
    expect(audioTrack?.clips).toHaveLength(3);
    expect(transcriptionTrack?.clips).toHaveLength(3);

    for (let index = 0; index < 3; index += 1) {
      const audioClip = audioTrack?.clips[index];
      const transcriptionClip = transcriptionTrack?.clips[index];
      expect(audioClip).toBeDefined();
      expect(transcriptionClip).toBeDefined();
      expect(transcriptionClip?.properties.assetId).toBe(audioClip?.properties.assetId);
      expect(transcriptionClip?.startTime).toBe(audioClip?.startTime);
      expect(transcriptionClip?.duration).toBe(audioClip?.duration);
      expect(transcriptionClip?.duration).toBeGreaterThan(0);
    }

    const transcriptionArtefact = manifest.artefacts['Artifact:TranscriptionProducer.Transcription'];
    expect(transcriptionArtefact?.blob?.mimeType).toBe('application/json');
    if (!transcriptionArtefact?.blob) {
      throw new Error('Transcription artifact blob missing');
    }

    const transcriptionBlob = await readBlobFromStorage(
      createStorageContext({
        kind: 'local',
        rootDir: result.storageRoot,
        basePath: result.storageBasePath,
      }),
      movieId,
      transcriptionArtefact.blob,
    );
    const transcription = JSON.parse(
      typeof transcriptionBlob.data === 'string'
        ? transcriptionBlob.data
        : Buffer.from(transcriptionBlob.data).toString('utf8'),
    ) as {
      text: string;
      words: Array<{ text: string; clipId: string }>;
      segments: Array<{ clipId: string; assetId: string }>;
      language: string;
      totalDuration: number;
    };

    expect(typeof transcription.text).toBe('string');
    expect(Array.isArray(transcription.words)).toBe(true);
    expect(transcription.segments).toHaveLength(3);
    expect(transcription.language.length).toBeGreaterThan(0);
    expect(transcription.totalDuration).toBeGreaterThan(0);
    for (const segment of transcription.segments) {
      expect(segment.clipId).toMatch(/^clip-\d+-\d+$/);
      expect(segment.assetId).toMatch(/^Artifact:AudioProducer\.GeneratedAudio\[\d+\]$/);
    }
  });

  it('fails fast when a referenced audio blob file is missing before transcription', async () => {
    const movieId = formatMovieId('e2e-transcription-path-resolution-missing-file');
    const result = await runTranscriptionPathScenario({
      storageMovieId: movieId,
      breakAudioFileBeforeTranscription: true,
    });

    expect(result.run.status).toBe('failed');
    const transcriptionJob = result.run.jobs.find((job) => job.producer === 'TranscriptionProducer');
    expect(transcriptionJob?.status).toBe('failed');
    expect(transcriptionJob?.error?.message).toMatch(/could not read audio file/i);
  });
});
