/**
 * End-to-end test for blob inputs via file: prefix in inputs.yaml.
 *
 * This test verifies that:
 * 1. file: prefixed inputs are properly resolved to BlobInput objects during planning
 * 2. BlobInput objects are present in resolvedInputs when cloud storage is not available
 * 3. The planning phase succeeds with blob inputs
 */
import { dirname, resolve, join } from 'node:path';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { isBlobInput } from '@renku/core';
import { getDefaultCliConfigPath, readCliConfig } from '../../src/lib/cli-config.js';
import { formatMovieId } from '../../src/commands/execute.js';
import { generatePlan } from '../../src/lib/planner.js';
import {
  createLoggerRecorder,
  setupTempCliConfig,
} from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('end-to-end: blob inputs via file: prefix', () => {
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

  it('resolves file: prefixed inputs to BlobInput during planning', async () => {
    // Create a minimal test image file
    const imageContent = Buffer.from(
      // Minimal 1x1 PNG (red pixel)
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64',
    );
    const testImagePath = join(tempRoot, 'test-image.png');
    await writeFile(testImagePath, imageContent);

    // Create a minimal blueprint for testing
    const blueprintDir = await mkdtemp(join(tmpdir(), 'renku-blueprint-'));
    const inputSchemaPath = join(blueprintDir, 'input-schema.json');
    await writeFile(
      inputSchemaPath,
      JSON.stringify({
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          image_url: { type: 'string', format: 'uri' },
        },
        required: ['prompt', 'image_url'],
      }),
      'utf8',
    );

    const blueprintPath = join(blueprintDir, 'test-producer.yaml');
    await writeFile(
      blueprintPath,
      stringifyYaml({
        meta: {
          name: 'Test Image to Video Producer',
          id: 'TestImageToVideoProducer',
          version: '0.1.0',
        },
        inputs: [
          { name: 'Prompt', type: 'string', required: true },
          { name: 'InputImage', type: 'image', required: true },
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
          Prompt: 'A test video generation prompt',
          InputImage: `file:${testImagePath}`,
        },
        models: [
          { model: 'veo3.1/image-to-video', provider: 'fal-ai', producerId: 'TestImageToVideoProducer' },
        ],
      }),
      'utf8',
    );

    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-blob-input';
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

    // Verify the blob input was resolved
    const inputImageValue = planResult.resolvedInputs['Input:InputImage'];
    expect(inputImageValue).toBeDefined();

    // Should be a BlobInput object
    expect(isBlobInput(inputImageValue)).toBe(true);
    const blobInput = inputImageValue as { data: Buffer; mimeType: string };
    expect(blobInput.mimeType).toBe('image/png');
    expect(blobInput.data).toBeInstanceOf(Buffer);
    expect(blobInput.data.length).toBe(imageContent.length);

    // Verify no warnings/errors during planning
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('resolves multiple file: references in an array input', async () => {
    // Create multiple test image files
    const imageContent = Buffer.from(
      // Minimal 1x1 PNG
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64',
    );
    const testImagePath1 = join(tempRoot, 'test-image-1.png');
    const testImagePath2 = join(tempRoot, 'test-image-2.jpg');
    await writeFile(testImagePath1, imageContent);
    await writeFile(testImagePath2, imageContent);

    // Create a minimal blueprint for testing
    const blueprintDir = await mkdtemp(join(tmpdir(), 'renku-blueprint-'));
    const inputSchemaPath = join(blueprintDir, 'input-schema.json');
    await writeFile(
      inputSchemaPath,
      JSON.stringify({
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          image_urls: { type: 'array', items: { type: 'string', format: 'uri' } },
        },
        required: ['prompt', 'image_urls'],
      }),
      'utf8',
    );

    const blueprintPath = join(blueprintDir, 'test-producer.yaml');
    await writeFile(
      blueprintPath,
      stringifyYaml({
        meta: {
          name: 'Test Multi-Image Producer',
          id: 'TestMultiImageProducer',
          version: '0.1.0',
        },
        inputs: [
          { name: 'Prompt', type: 'string', required: true },
          { name: 'InputImages', type: 'array', itemType: 'image', required: true },
        ],
        artifacts: [
          { name: 'OutputImage', type: 'image' },
        ],
        models: [
          {
            model: 'test/multi-image',
            provider: 'test-provider',
            inputSchema: './input-schema.json',
            inputs: {
              Prompt: 'prompt',
              InputImages: 'image_urls',
            },
            outputs: {
              OutputImage: {
                type: 'image',
                mimeType: 'image/png',
              },
            },
          },
        ],
      }),
      'utf8',
    );

    // Create inputs.yaml with array of file: references
    const inputsPath = join(tempRoot, 'inputs.yaml');
    await writeFile(
      inputsPath,
      stringifyYaml({
        inputs: {
          Prompt: 'A test multi-image prompt',
          InputImages: [
            `file:${testImagePath1}`,
            `file:${testImagePath2}`,
          ],
        },
        models: [
          { model: 'test/multi-image', provider: 'test-provider', producerId: 'TestMultiImageProducer' },
        ],
      }),
      'utf8',
    );

    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-blob-input-array';
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

    // Verify the blob inputs were resolved
    const inputImagesValue = planResult.resolvedInputs['Input:InputImages'];
    expect(inputImagesValue).toBeDefined();
    expect(Array.isArray(inputImagesValue)).toBe(true);

    const blobInputs = inputImagesValue as Array<{ data: Buffer; mimeType: string }>;
    expect(blobInputs).toHaveLength(2);

    // First image (PNG)
    expect(isBlobInput(blobInputs[0])).toBe(true);
    expect(blobInputs[0]?.mimeType).toBe('image/png');

    // Second image (JPEG - mime type inferred from extension)
    expect(isBlobInput(blobInputs[1])).toBe(true);
    expect(blobInputs[1]?.mimeType).toBe('image/jpeg');

    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
