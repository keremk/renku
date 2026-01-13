/**
 * End-to-end test for derived video artifacts (FirstFrame, LastFrame, AudioTrack).
 *
 * This test verifies that:
 * 1. Video producers correctly declare derived artifacts (FirstFrame, LastFrame, AudioTrack)
 * 2. Derived artifacts are properly wired to downstream producers in the plan
 * 3. The produces array includes derived artifacts when they are connected
 * 4. Dry-run execution succeeds with derived artifact connections
 * 5. Real ffmpeg extraction works with actual video files
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { runExecute, formatMovieId } from '../../src/commands/execute.js';
import {
  extractDerivedArtefacts,
  checkFfmpegAvailability,
  resetFfmpegCache,
} from '@gorenku/providers';
import {
  createLoggerRecorder,
  expectFileExists,
  findJob,
  readPlan,
  setupTempCliConfig,
} from './helpers.js';
import { CLI_FIXTURES_BLUEPRINTS, CLI_FIXTURES_INPUTS, CLI_FIXTURES_MEDIA } from '../test-catalog-paths.js';

describe('end-to-end: derived video artifacts', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('plans derived artifacts (FirstFrame, LastFrame, AudioTrack) and wires LastFrame to downstream producer', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'derived-video-artifacts.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'derived-video-artifacts-inputs.yaml');

    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-derived-video-artifacts';
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

    // Verify execution succeeded
    if (result.build?.status !== 'succeeded') {
      throw new Error(`dryRun failed: ${JSON.stringify(result.build, null, 2)}`);
    }
    expect(result.build?.counts.failed).toBe(0);

    // Debug output if there are warnings/errors
    if (warnings.length > 0 || errors.length > 0) {
      // eslint-disable-next-line no-console
      console.error('warnings', warnings, 'errors', errors);
    }
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);

    // Verify plan file exists
    await expectFileExists(result.planPath);

    const plan = await readPlan(result.planPath);

    // Find FirstVideoProducer job
    const firstVideoJob = findJob(plan, 'FirstVideoProducer');
    expect(firstVideoJob).toBeDefined();

    // Verify FirstVideoProducer produces the derived artifacts
    expect(firstVideoJob.produces).toContain('Artifact:FirstVideoProducer.GeneratedVideo');
    expect(firstVideoJob.produces).toContain('Artifact:FirstVideoProducer.FirstFrame');
    expect(firstVideoJob.produces).toContain('Artifact:FirstVideoProducer.LastFrame');
    expect(firstVideoJob.produces).toContain('Artifact:FirstVideoProducer.AudioTrack');

    // Find SecondVideoProducer job
    const secondVideoJob = findJob(plan, 'SecondVideoProducer');
    expect(secondVideoJob).toBeDefined();

    // Verify SecondVideoProducer receives LastFrame as StartImage input
    expect(secondVideoJob.context?.inputBindings?.StartImage).toBe(
      'Artifact:FirstVideoProducer.LastFrame',
    );

    // Verify SecondVideoProducer depends on FirstVideoProducer's LastFrame
    expect(secondVideoJob.inputs).toContain('Artifact:FirstVideoProducer.LastFrame');

    // Verify job dependencies - SecondVideoProducer should be in a later layer than FirstVideoProducer
    const firstVideoJobLayer = plan.layers.findIndex((layer: any[]) =>
      layer.some((job: any) => job.producer === 'FirstVideoProducer'),
    );
    const secondVideoJobLayer = plan.layers.findIndex((layer: any[]) =>
      layer.some((job: any) => job.producer === 'SecondVideoProducer'),
    );
    expect(secondVideoJobLayer).toBeGreaterThan(firstVideoJobLayer);

    // Verify all jobs succeeded
    expect(result.build?.jobs?.every((job) => job.status === 'succeeded')).toBe(true);
  });

  it('correctly tracks all derived artifacts in the plan', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'derived-video-artifacts.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'derived-video-artifacts-inputs.yaml');

    const { logger } = createLoggerRecorder();
    const movieId = 'e2e-derived-artifacts-tracking';
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

    expect(result.build?.status).toBe('succeeded');

    const plan = await readPlan(result.planPath);

    // Collect all produced artifacts from the plan
    const allProducedArtifacts = plan.layers
      .flat()
      .flatMap((job: any) => job.produces || []);

    // Verify all expected derived artifacts are produced
    const expectedDerivedArtifacts = [
      'Artifact:FirstVideoProducer.FirstFrame',
      'Artifact:FirstVideoProducer.LastFrame',
      'Artifact:FirstVideoProducer.AudioTrack',
    ];

    for (const artifact of expectedDerivedArtifacts) {
      expect(allProducedArtifacts).toContain(artifact);
    }

    // Verify primary video artifacts are also produced
    expect(allProducedArtifacts).toContain('Artifact:FirstVideoProducer.GeneratedVideo');
    expect(allProducedArtifacts).toContain('Artifact:SecondVideoProducer.GeneratedVideo');
  });
});

describe('end-to-end: real ffmpeg extraction', () => {
  const VIDEO_FIXTURE_PATH = resolve(CLI_FIXTURES_MEDIA, 'video-fixture.mp4');

  beforeEach(() => {
    resetFfmpegCache();
  });

  it('extracts FirstFrame as valid PNG from real video', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const videoBuffer = await readFile(VIDEO_FIXTURE_PATH);
    const produces = [
      'Artifact:TestProducer.GeneratedVideo',
      'Artifact:TestProducer.FirstFrame',
    ];

    const result = await extractDerivedArtefacts({
      videoBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedVideo',
      produces,
      mode: 'live',
    });

    expect(result.firstFrame).toBeDefined();
    expect(result.firstFrame?.status).toBe('succeeded');
    expect(result.firstFrame?.artefactId).toBe('Artifact:TestProducer.FirstFrame');
    expect(result.firstFrame?.blob?.mimeType).toBe('image/png');

    // Verify it's a valid PNG (PNG magic bytes: 0x89 0x50 0x4E 0x47)
    const pngBuffer = result.firstFrame?.blob?.data;
    expect(pngBuffer).toBeDefined();
    expect(pngBuffer?.length).toBeGreaterThan(100); // Real PNG should be much larger than mock
    expect(pngBuffer?.[0]).toBe(0x89);
    expect(pngBuffer?.[1]).toBe(0x50); // 'P'
    expect(pngBuffer?.[2]).toBe(0x4e); // 'N'
    expect(pngBuffer?.[3]).toBe(0x47); // 'G'
  });

  it('extracts LastFrame as valid PNG from real video', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const videoBuffer = await readFile(VIDEO_FIXTURE_PATH);
    const produces = [
      'Artifact:TestProducer.GeneratedVideo',
      'Artifact:TestProducer.LastFrame',
    ];

    const result = await extractDerivedArtefacts({
      videoBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedVideo',
      produces,
      mode: 'live',
    });

    expect(result.lastFrame).toBeDefined();
    expect(result.lastFrame?.status).toBe('succeeded');
    expect(result.lastFrame?.artefactId).toBe('Artifact:TestProducer.LastFrame');
    expect(result.lastFrame?.blob?.mimeType).toBe('image/png');

    // Verify it's a valid PNG
    const pngBuffer = result.lastFrame?.blob?.data;
    expect(pngBuffer).toBeDefined();
    expect(pngBuffer?.length).toBeGreaterThan(100);
    expect(pngBuffer?.[0]).toBe(0x89);
    expect(pngBuffer?.[1]).toBe(0x50);
    expect(pngBuffer?.[2]).toBe(0x4e);
    expect(pngBuffer?.[3]).toBe(0x47);
  });

  it('extracts AudioTrack as valid WAV from real video', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const videoBuffer = await readFile(VIDEO_FIXTURE_PATH);
    const produces = [
      'Artifact:TestProducer.GeneratedVideo',
      'Artifact:TestProducer.AudioTrack',
    ];

    const result = await extractDerivedArtefacts({
      videoBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedVideo',
      produces,
      mode: 'live',
    });

    expect(result.audioTrack).toBeDefined();
    expect(result.audioTrack?.status).toBe('succeeded');
    expect(result.audioTrack?.artefactId).toBe('Artifact:TestProducer.AudioTrack');
    expect(result.audioTrack?.blob?.mimeType).toBe('audio/wav');

    // Verify it's a valid WAV (WAV magic bytes: "RIFF" at start, "WAVE" at offset 8)
    const wavData = result.audioTrack?.blob?.data;
    expect(wavData).toBeDefined();
    const wavBuffer = Buffer.from(wavData!);
    expect(wavBuffer.length).toBeGreaterThan(1000); // Real WAV should be substantial
    expect(wavBuffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wavBuffer.toString('ascii', 8, 12)).toBe('WAVE');
  });

  it('extracts all derived artifacts (FirstFrame, LastFrame, AudioTrack) from real video', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const videoBuffer = await readFile(VIDEO_FIXTURE_PATH);
    const produces = [
      'Artifact:TestProducer.GeneratedVideo',
      'Artifact:TestProducer.FirstFrame',
      'Artifact:TestProducer.LastFrame',
      'Artifact:TestProducer.AudioTrack',
    ];

    const result = await extractDerivedArtefacts({
      videoBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedVideo',
      produces,
      mode: 'live',
    });

    // All three derived artifacts should be extracted
    expect(result.firstFrame?.status).toBe('succeeded');
    expect(result.lastFrame?.status).toBe('succeeded');
    expect(result.audioTrack?.status).toBe('succeeded');

    // FirstFrame and LastFrame should be different (different content)
    const firstFrameSize = result.firstFrame?.blob?.data?.length ?? 0;
    const lastFrameSize = result.lastFrame?.blob?.data?.length ?? 0;

    // Both should be valid PNGs with reasonable size
    expect(firstFrameSize).toBeGreaterThan(100);
    expect(lastFrameSize).toBeGreaterThan(100);

    // Audio should be substantial (5 second video at 44.1kHz stereo 16-bit)
    const audioSize = result.audioTrack?.blob?.data?.length ?? 0;
    expect(audioSize).toBeGreaterThan(100000); // ~5 seconds of audio should be > 100KB

    // Verify diagnostics contain extraction info
    expect(result.firstFrame?.diagnostics?.extraction).toBe('first_frame');
    expect(result.lastFrame?.diagnostics?.extraction).toBe('last_frame');
    expect(result.audioTrack?.diagnostics?.extraction).toBe('audio_track');
  });

  it('returns empty result when no derived artifacts are requested', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const videoBuffer = await readFile(VIDEO_FIXTURE_PATH);
    const produces = ['Artifact:TestProducer.GeneratedVideo']; // Only primary artifact

    const result = await extractDerivedArtefacts({
      videoBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedVideo',
      produces,
      mode: 'live',
    });

    // No derived artifacts should be extracted
    expect(result.firstFrame).toBeUndefined();
    expect(result.lastFrame).toBeUndefined();
    expect(result.audioTrack).toBeUndefined();
  });
});
