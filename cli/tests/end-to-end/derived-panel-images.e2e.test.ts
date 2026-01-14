/**
 * End-to-end test for derived panel images from storyboard grids.
 *
 * This test verifies that:
 * 1. Image producers correctly declare panel artifacts (PanelImages[N])
 * 2. Panel artifacts are properly extracted using ffmpeg crop filter
 * 3. The produces array includes panel artifacts when they are connected
 * 4. Dry-run execution succeeds with panel artifact connections
 * 5. Real ffmpeg extraction works with actual grid images
 * 6. Extracted panels have correct dimensions based on GridStyle
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { runExecute, formatMovieId } from '../../src/commands/execute.js';
import {
  extractPanelImages,
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

describe('end-to-end: derived panel images', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('plans panel artifacts (PanelImages[0-8]) and includes them in produces', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'derived-panel-images.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'derived-panel-images-inputs.yaml');

    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-derived-panel-images';
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

    // Find ImageGenerator job
    const imageJob = findJob(plan, 'ImageGenerator');
    expect(imageJob).toBeDefined();

    // Verify ImageGenerator produces the primary image and all 9 panel artifacts
    expect(imageJob.produces).toContain('Artifact:ImageGenerator.GeneratedImage');
    for (let i = 0; i < 9; i++) {
      expect(imageJob.produces).toContain(`Artifact:ImageGenerator.PanelImages[${i}]`);
    }

    // Verify all jobs succeeded
    expect(result.build?.jobs?.every((job) => job.status === 'succeeded')).toBe(true);
  });

  it('correctly tracks all panel artifacts in the plan', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'derived-panel-images.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'derived-panel-images-inputs.yaml');

    const { logger } = createLoggerRecorder();
    const movieId = 'e2e-panel-artifacts-tracking';
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

    // Verify all expected panel artifacts are produced
    for (let i = 0; i < 9; i++) {
      expect(allProducedArtifacts).toContain(`Artifact:ImageGenerator.PanelImages[${i}]`);
    }

    // Verify primary image artifact is also produced
    expect(allProducedArtifacts).toContain('Artifact:ImageGenerator.GeneratedImage');
  });
});

describe('end-to-end: real ffmpeg panel extraction', () => {
  const GRID_IMAGE_FIXTURE_PATH = resolve(CLI_FIXTURES_MEDIA, 'grid-image-fixture.jpeg');

  beforeEach(() => {
    resetFfmpegCache();
  });

  it('extracts all 9 panels from real 3x3 grid image', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const imageBuffer = await readFile(GRID_IMAGE_FIXTURE_PATH);
    const produces = [
      'Artifact:TestProducer.GeneratedImage',
      ...Array.from({ length: 9 }, (_, i) => `Artifact:TestProducer.PanelImages[${i}]`),
    ];

    const result = await extractPanelImages({
      imageBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedImage',
      produces,
      gridStyle: '3x3',
      mode: 'live',
    });

    expect(result.panels.length).toBe(9);

    // Verify each panel is a valid PNG with expected properties
    for (let i = 0; i < 9; i++) {
      const panel = result.panels[i];
      expect(panel.status).toBe('succeeded');
      expect(panel.artefactId).toBe(`Artifact:TestProducer.PanelImages[${i}]`);
      expect(panel.blob?.mimeType).toBe('image/png');

      // Verify PNG magic bytes
      const pngBuffer = panel.blob?.data as Buffer;
      expect(pngBuffer).toBeDefined();
      expect(pngBuffer.length).toBeGreaterThan(1000); // Real PNG should be substantial
      expect(pngBuffer[0]).toBe(0x89);
      expect(pngBuffer.toString('ascii', 1, 4)).toBe('PNG');

      // Verify diagnostics contain correct panel info
      expect(panel.diagnostics?.panelIndex).toBe(i);
      expect(panel.diagnostics?.extraction).toBe('panel');
    }
  });

  it('extracts panels with correct grid positions for 3x3', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const imageBuffer = await readFile(GRID_IMAGE_FIXTURE_PATH);
    const produces = [
      'Artifact:TestProducer.GeneratedImage',
      ...Array.from({ length: 9 }, (_, i) => `Artifact:TestProducer.PanelImages[${i}]`),
    ];

    const result = await extractPanelImages({
      imageBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedImage',
      produces,
      gridStyle: '3x3',
      mode: 'live',
    });

    // Verify grid positions follow left-to-right, top-to-bottom order
    // Panel layout for 3x3:
    // [0] (0,0)   [1] (1,0)   [2] (2,0)
    // [3] (0,1)   [4] (1,1)   [5] (2,1)
    // [6] (0,2)   [7] (1,2)   [8] (2,2)
    const expectedPositions = [
      { row: 0, col: 0 }, // Panel 0: top-left
      { row: 0, col: 1 }, // Panel 1: top-center
      { row: 0, col: 2 }, // Panel 2: top-right
      { row: 1, col: 0 }, // Panel 3: middle-left
      { row: 1, col: 1 }, // Panel 4: center
      { row: 1, col: 2 }, // Panel 5: middle-right
      { row: 2, col: 0 }, // Panel 6: bottom-left
      { row: 2, col: 1 }, // Panel 7: bottom-center
      { row: 2, col: 2 }, // Panel 8: bottom-right
    ];

    for (let i = 0; i < 9; i++) {
      expect(result.panels[i].diagnostics?.gridPosition).toEqual(expectedPositions[i]);
    }
  });

  it('extracts panels with correct crop dimensions (640x360 for 1920x1080 3x3)', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const imageBuffer = await readFile(GRID_IMAGE_FIXTURE_PATH);
    // The fixture is 1920x1080, so each panel in a 3x3 grid should be 640x360
    const produces = [
      'Artifact:TestProducer.GeneratedImage',
      'Artifact:TestProducer.PanelImages[0]',
      'Artifact:TestProducer.PanelImages[4]', // Center panel
      'Artifact:TestProducer.PanelImages[8]', // Bottom-right panel
    ];

    const result = await extractPanelImages({
      imageBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedImage',
      produces,
      gridStyle: '3x3',
      mode: 'live',
    });

    expect(result.panels.length).toBe(3);

    // Panel 0: top-left corner, crop at (0, 0)
    const panel0 = result.panels.find((p) => p.diagnostics?.panelIndex === 0);
    expect(panel0?.diagnostics?.crop).toEqual({ x: 0, y: 0, width: 640, height: 360 });

    // Panel 4: center, crop at (640, 360)
    const panel4 = result.panels.find((p) => p.diagnostics?.panelIndex === 4);
    expect(panel4?.diagnostics?.crop).toEqual({ x: 640, y: 360, width: 640, height: 360 });

    // Panel 8: bottom-right, crop at (1280, 720)
    const panel8 = result.panels.find((p) => p.diagnostics?.panelIndex === 8);
    expect(panel8?.diagnostics?.crop).toEqual({ x: 1280, y: 720, width: 640, height: 360 });
  });

  it('produces different content for different panels', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const imageBuffer = await readFile(GRID_IMAGE_FIXTURE_PATH);
    const produces = [
      'Artifact:TestProducer.GeneratedImage',
      'Artifact:TestProducer.PanelImages[0]', // Top-left
      'Artifact:TestProducer.PanelImages[4]', // Center
      'Artifact:TestProducer.PanelImages[8]', // Bottom-right
    ];

    const result = await extractPanelImages({
      imageBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedImage',
      produces,
      gridStyle: '3x3',
      mode: 'live',
    });

    expect(result.panels.length).toBe(3);

    // Get panel data buffers
    const panel0Data = result.panels.find((p) => p.diagnostics?.panelIndex === 0)?.blob?.data;
    const panel4Data = result.panels.find((p) => p.diagnostics?.panelIndex === 4)?.blob?.data;
    const panel8Data = result.panels.find((p) => p.diagnostics?.panelIndex === 8)?.blob?.data;

    expect(panel0Data).toBeDefined();
    expect(panel4Data).toBeDefined();
    expect(panel8Data).toBeDefined();

    // Panels should have different content (different PNG data)
    // Compare buffer contents - they should NOT be identical
    expect(Buffer.compare(panel0Data as Buffer, panel4Data as Buffer)).not.toBe(0);
    expect(Buffer.compare(panel0Data as Buffer, panel8Data as Buffer)).not.toBe(0);
    expect(Buffer.compare(panel4Data as Buffer, panel8Data as Buffer)).not.toBe(0);
  });

  it('handles partial panel requests (only some panels)', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const imageBuffer = await readFile(GRID_IMAGE_FIXTURE_PATH);
    // Request only panels 0, 2, 6 (corners except bottom-right)
    const produces = [
      'Artifact:TestProducer.GeneratedImage',
      'Artifact:TestProducer.PanelImages[0]',
      'Artifact:TestProducer.PanelImages[2]',
      'Artifact:TestProducer.PanelImages[6]',
    ];

    const result = await extractPanelImages({
      imageBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedImage',
      produces,
      gridStyle: '3x3',
      mode: 'live',
    });

    expect(result.panels.length).toBe(3);

    // Verify only requested panels are extracted
    const extractedIndices = result.panels.map((p) => p.diagnostics?.panelIndex).sort();
    expect(extractedIndices).toEqual([0, 2, 6]);

    // Verify each is successful
    for (const panel of result.panels) {
      expect(panel.status).toBe('succeeded');
      expect(panel.blob?.mimeType).toBe('image/png');
    }
  });

  it('handles panel index out of range gracefully', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const imageBuffer = await readFile(GRID_IMAGE_FIXTURE_PATH);
    const produces = [
      'Artifact:TestProducer.GeneratedImage',
      'Artifact:TestProducer.PanelImages[0]', // Valid
      'Artifact:TestProducer.PanelImages[99]', // Out of range for 3x3
    ];

    const result = await extractPanelImages({
      imageBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedImage',
      produces,
      gridStyle: '3x3',
      mode: 'live',
    });

    expect(result.panels.length).toBe(2);

    // Panel 0 should succeed
    const panel0 = result.panels.find((p) => p.diagnostics?.panelIndex === 0);
    expect(panel0?.status).toBe('succeeded');

    // Panel 99 should fail with out of range error
    const panel99 = result.panels.find((p) => p.diagnostics?.panelIndex === 99);
    expect(panel99?.status).toBe('failed');
    expect(panel99?.diagnostics?.reason).toBe('panel_index_out_of_range');
  });

  it('returns empty result when no panel artifacts are requested', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const imageBuffer = await readFile(GRID_IMAGE_FIXTURE_PATH);
    const produces = ['Artifact:TestProducer.GeneratedImage']; // Only primary artifact

    const result = await extractPanelImages({
      imageBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedImage',
      produces,
      gridStyle: '3x3',
      mode: 'live',
    });

    // No panel artifacts should be extracted
    expect(result.panels.length).toBe(0);
  });

  it('handles 2x2 grid extraction correctly', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const imageBuffer = await readFile(GRID_IMAGE_FIXTURE_PATH);
    // For 1920x1080 image with 2x2 grid, each panel should be 960x540
    const produces = [
      'Artifact:TestProducer.GeneratedImage',
      'Artifact:TestProducer.PanelImages[0]',
      'Artifact:TestProducer.PanelImages[1]',
      'Artifact:TestProducer.PanelImages[2]',
      'Artifact:TestProducer.PanelImages[3]',
    ];

    const result = await extractPanelImages({
      imageBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedImage',
      produces,
      gridStyle: '2x2',
      mode: 'live',
    });

    expect(result.panels.length).toBe(4);

    // Verify panel dimensions for 2x2 (960x540 each)
    const panel0 = result.panels.find((p) => p.diagnostics?.panelIndex === 0);
    expect(panel0?.diagnostics?.crop).toEqual({ x: 0, y: 0, width: 960, height: 540 });

    const panel3 = result.panels.find((p) => p.diagnostics?.panelIndex === 3);
    expect(panel3?.diagnostics?.crop).toEqual({ x: 960, y: 540, width: 960, height: 540 });

    // Verify grid positions for 2x2
    expect(panel0?.diagnostics?.gridPosition).toEqual({ row: 0, col: 0 });
    expect(result.panels.find((p) => p.diagnostics?.panelIndex === 1)?.diagnostics?.gridPosition).toEqual({ row: 0, col: 1 });
    expect(result.panels.find((p) => p.diagnostics?.panelIndex === 2)?.diagnostics?.gridPosition).toEqual({ row: 1, col: 0 });
    expect(panel3?.diagnostics?.gridPosition).toEqual({ row: 1, col: 1 });
  });

  it('handles non-square grid (2x3) extraction correctly', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const imageBuffer = await readFile(GRID_IMAGE_FIXTURE_PATH);
    // For 1920x1080 image with 2x3 grid (2 cols, 3 rows), each panel should be 960x360
    const produces = [
      'Artifact:TestProducer.GeneratedImage',
      ...Array.from({ length: 6 }, (_, i) => `Artifact:TestProducer.PanelImages[${i}]`),
    ];

    const result = await extractPanelImages({
      imageBuffer,
      primaryArtifactId: 'Artifact:TestProducer.GeneratedImage',
      produces,
      gridStyle: '2x3',
      mode: 'live',
    });

    expect(result.panels.length).toBe(6);

    // Verify panel dimensions for 2x3 (960x360 each)
    const panel0 = result.panels.find((p) => p.diagnostics?.panelIndex === 0);
    const crop0 = panel0?.diagnostics?.crop as { x: number; y: number; width: number; height: number } | undefined;
    expect(crop0?.width).toBe(960);
    expect(crop0?.height).toBe(360);

    // Verify grid positions follow left-to-right, top-to-bottom order
    // Layout:
    // [0] [1]
    // [2] [3]
    // [4] [5]
    expect(result.panels.find((p) => p.diagnostics?.panelIndex === 0)?.diagnostics?.gridPosition).toEqual({ row: 0, col: 0 });
    expect(result.panels.find((p) => p.diagnostics?.panelIndex === 1)?.diagnostics?.gridPosition).toEqual({ row: 0, col: 1 });
    expect(result.panels.find((p) => p.diagnostics?.panelIndex === 2)?.diagnostics?.gridPosition).toEqual({ row: 1, col: 0 });
    expect(result.panels.find((p) => p.diagnostics?.panelIndex === 3)?.diagnostics?.gridPosition).toEqual({ row: 1, col: 1 });
    expect(result.panels.find((p) => p.diagnostics?.panelIndex === 4)?.diagnostics?.gridPosition).toEqual({ row: 2, col: 0 });
    expect(result.panels.find((p) => p.diagnostics?.panelIndex === 5)?.diagnostics?.gridPosition).toEqual({ row: 2, col: 1 });
  });
});
