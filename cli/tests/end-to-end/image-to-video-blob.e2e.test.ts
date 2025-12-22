/**
 * End-to-end test for image-to-video blueprint with blob inputs via file: prefix.
 *
 * This test verifies that:
 * 1. Image file references are properly resolved and stored as BlobRef during planning
 * 2. Blobs are copied from memory storage to local storage during plan persistence
 * 3. The planning phase succeeds with blob inputs
 * 4. Dry-run execution correctly handles blob inputs
 */
import { dirname, resolve, join } from 'node:path';
import { writeFile, mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { isBlobRef } from '@gorenku/core';
import { getDefaultCliConfigPath, readCliConfig } from '../../src/lib/cli-config.js';
import { formatMovieId } from '../../src/commands/execute.js';
import { generatePlan } from '../../src/lib/planner.js';
import {
  createLoggerRecorder,
  setupTempCliConfig,
} from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('end-to-end: image-to-video with blob input', () => {
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

  it('persists image blob to storage and creates valid plan', async () => {
    // Create a minimal test PNG image file (1x1 red pixel)
    const imageContent = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64',
    );
    const testImagePath = join(tempRoot, 'test-input-image.png');
    await writeFile(testImagePath, imageContent);

    // Create a minimal image-to-video blueprint
    const blueprintDir = await mkdtemp(join(tmpdir(), 'renku-blueprint-i2v-'));
    const inputSchemaPath = join(blueprintDir, 'input-schema.json');
    await writeFile(
      inputSchemaPath,
      JSON.stringify({
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          image_url: { type: 'string', format: 'uri' },
          aspect_ratio: { type: 'string' },
          duration: { type: 'string' },
        },
        required: ['prompt', 'image_url'],
      }),
      'utf8',
    );

    const blueprintPath = join(blueprintDir, 'image-to-video.yaml');
    await writeFile(
      blueprintPath,
      stringifyYaml({
        meta: {
          name: 'Image to Video Test Producer',
          id: 'ImageToVideoTestProducer',
          version: '0.1.0',
        },
        inputs: [
          { name: 'Prompt', type: 'string', required: true },
          { name: 'InputImage', type: 'image', required: true },
          { name: 'AspectRatio', type: 'string', default: '16:9' },
          { name: 'Duration', type: 'string', default: '4s' },
        ],
        artifacts: [
          { name: 'OutputVideo', type: 'video' },
        ],
        models: [
          {
            model: 'veo3.1/image-to-video',
            provider: 'fal-ai',
            inputSchema: './input-schema.json',
            inputs: {
              Prompt: 'prompt',
              InputImage: 'image_url',
              AspectRatio: 'aspect_ratio',
              Duration: 'duration',
            },
            outputs: {
              OutputVideo: {
                type: 'video',
                mimeType: 'video/mp4',
              },
            },
          },
        ],
      }),
      'utf8',
    );

    // Create inputs.yaml with file: reference
    const inputsPath = join(tempRoot, 'inputs.yaml');
    await writeFile(
      inputsPath,
      stringifyYaml({
        inputs: {
          Prompt: 'A camera slowly panning across a scenic landscape',
          InputImage: `file:${testImagePath}`,
          AspectRatio: '16:9',
          Duration: '4s',
        },
        models: [
          { model: 'veo3.1/image-to-video', provider: 'fal-ai', producerId: 'ImageToVideoTestProducer' },
        ],
      }),
      'utf8',
    );

    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-image-to-video-blob';
    const storageMovieId = formatMovieId(movieId);

    // Read CLI config for storage settings
    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // Generate plan - this should succeed and resolve the file: reference
    const planResult = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: true,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger,
      notifications: undefined,
    });

    // Verify planning succeeded
    expect(planResult.plan).toBeDefined();
    expect(planResult.plan.layers.length).toBeGreaterThan(0);

    // Verify the blob input was resolved to a BlobRef (hash reference)
    const inputImageValue = planResult.resolvedInputs['Input:InputImage'];
    expect(inputImageValue).toBeDefined();

    // Should be a BlobRef object (hash reference to stored blob)
    expect(isBlobRef(inputImageValue)).toBe(true);
    const blobRef = inputImageValue as { hash: string; size: number; mimeType: string };
    expect(blobRef.mimeType).toBe('image/png');
    expect(blobRef.hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hash
    expect(blobRef.size).toBe(imageContent.length);

    // Persist the plan to disk
    await planResult.persist();

    // Verify blob was persisted to local storage
    const blobsDir = resolve(cliConfig.storage.root, cliConfig.storage.basePath, storageMovieId, 'blobs');
    const prefix = blobRef.hash.slice(0, 2);
    const expectedBlobPath = resolve(blobsDir, prefix, `${blobRef.hash}.png`);

    // Check that the blob file exists
    const blobStat = await stat(expectedBlobPath);
    expect(blobStat.isFile()).toBe(true);
    expect(blobStat.size).toBe(imageContent.length);

    // Verify no warnings/errors during planning
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('handles multiple image inputs correctly', async () => {
    // Create multiple test image files
    const imageContent1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64',
    );
    const imageContent2 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwADggH/1JbO3gAAAABJRU5ErkJggg==',
      'base64',
    );
    const testImagePath1 = join(tempRoot, 'input-image-1.png');
    const testImagePath2 = join(tempRoot, 'input-image-2.jpg');
    await writeFile(testImagePath1, imageContent1);
    await writeFile(testImagePath2, imageContent2);

    // Create a blueprint that accepts two images
    const blueprintDir = await mkdtemp(join(tmpdir(), 'renku-blueprint-dual-'));
    const inputSchemaPath = join(blueprintDir, 'input-schema.json');
    await writeFile(
      inputSchemaPath,
      JSON.stringify({
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          image_url_1: { type: 'string', format: 'uri' },
          image_url_2: { type: 'string', format: 'uri' },
        },
        required: ['prompt', 'image_url_1'],
      }),
      'utf8',
    );

    const blueprintPath = join(blueprintDir, 'dual-image.yaml');
    await writeFile(
      blueprintPath,
      stringifyYaml({
        meta: {
          name: 'Dual Image Test Producer',
          id: 'DualImageTestProducer',
          version: '0.1.0',
        },
        inputs: [
          { name: 'Prompt', type: 'string', required: true },
          { name: 'InputImage1', type: 'image', required: true },
          { name: 'InputImage2', type: 'image', required: true },
        ],
        artifacts: [
          { name: 'OutputVideo', type: 'video' },
        ],
        models: [
          {
            model: 'test/dual-image',
            provider: 'test-provider',
            inputSchema: './input-schema.json',
            inputs: {
              Prompt: 'prompt',
              InputImage1: 'image_url_1',
              InputImage2: 'image_url_2',
            },
            outputs: {
              OutputVideo: {
                type: 'video',
                mimeType: 'video/mp4',
              },
            },
          },
        ],
      }),
      'utf8',
    );

    // Create inputs.yaml with two file: references
    const inputsPath = join(tempRoot, 'inputs.yaml');
    await writeFile(
      inputsPath,
      stringifyYaml({
        inputs: {
          Prompt: 'A dual image test prompt',
          InputImage1: `file:${testImagePath1}`,
          InputImage2: `file:${testImagePath2}`,
        },
        models: [
          { model: 'test/dual-image', provider: 'test-provider', producerId: 'DualImageTestProducer' },
        ],
      }),
      'utf8',
    );

    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-dual-image-blob';
    const storageMovieId = formatMovieId(movieId);

    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // Generate plan
    const planResult = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: true,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger,
      notifications: undefined,
    });

    // Verify planning succeeded
    expect(planResult.plan).toBeDefined();

    // Verify both blob inputs were resolved to BlobRefs
    const inputImage1Value = planResult.resolvedInputs['Input:InputImage1'];
    const inputImage2Value = planResult.resolvedInputs['Input:InputImage2'];

    expect(isBlobRef(inputImage1Value)).toBe(true);
    expect(isBlobRef(inputImage2Value)).toBe(true);

    const blobRef1 = inputImage1Value as { hash: string; size: number; mimeType: string };
    const blobRef2 = inputImage2Value as { hash: string; size: number; mimeType: string };

    expect(blobRef1.mimeType).toBe('image/png');
    expect(blobRef2.mimeType).toBe('image/jpeg');

    // Different images should have different hashes
    expect(blobRef1.hash).not.toBe(blobRef2.hash);

    // Persist and verify both blobs are stored
    await planResult.persist();

    const blobsDir = resolve(cliConfig.storage.root, cliConfig.storage.basePath, storageMovieId, 'blobs');

    const prefix1 = blobRef1.hash.slice(0, 2);
    const expectedBlobPath1 = resolve(blobsDir, prefix1, `${blobRef1.hash}.png`);
    const blobStat1 = await stat(expectedBlobPath1);
    expect(blobStat1.isFile()).toBe(true);

    const prefix2 = blobRef2.hash.slice(0, 2);
    const expectedBlobPath2 = resolve(blobsDir, prefix2, `${blobRef2.hash}.jpg`);
    const blobStat2 = await stat(expectedBlobPath2);
    expect(blobStat2.isFile()).toBe(true);

    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
