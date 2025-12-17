/**
 * Qwen Image Provider Integration Test (with cloud storage for blob uploads)
 *
 * Run with: RUN_QWEN_IMAGE_TEST=1 pnpm test:e2e
 * Requires env vars in providers/.env:
 *   - REPLICATE_API_TOKEN
 *   - S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT, S3_BUCKET
 *
 * To save output for visual inspection:
 * RUN_QWEN_IMAGE_TEST=1 SAVE_TEST_ARTIFACTS=1 pnpm test:e2e
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProviderRegistry } from '../../src/registry.js';
import type { ProviderJobContext } from '../../src/types.js';
import { loadCloudStorageEnv, createCloudStorageContext } from '@renku/core';
import { buildImageExtras, type ImageModel } from './schema-helpers.js';
import { saveTestArtifact } from './test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RUN_TEST = process.env.RUN_QWEN_IMAGE_TEST;
const API_TOKEN = process.env.REPLICATE_API_TOKEN;
const cloudStorageEnv = loadCloudStorageEnv();

// Debug: show cloud storage config (without secrets)
console.log('Cloud Storage Config:', {
  isConfigured: cloudStorageEnv.isConfigured,
  endpoint: cloudStorageEnv.config?.endpoint,
  bucket: cloudStorageEnv.config?.bucket,
  region: cloudStorageEnv.config?.region,
  hasAccessKey: !!cloudStorageEnv.config?.accessKeyId,
  hasSecretKey: !!cloudStorageEnv.config?.secretAccessKey,
});

const hasRequiredEnvVars = RUN_TEST && API_TOKEN && cloudStorageEnv.isConfigured;

const describeIf = hasRequiredEnvVars ? describe : describe.skip;

function loadFixture(filename: string): { data: Buffer; mimeType: string } {
  const fixturePath = join(__dirname, 'fixtures', filename);
  const data = readFileSync(fixturePath);
  const mimeType = filename.endsWith('.jpg') || filename.endsWith('.jpeg')
    ? 'image/jpeg'
    : filename.endsWith('.png')
      ? 'image/png'
      : 'application/octet-stream';
  return { data, mimeType };
}

describeIf('Qwen Image provider integration (with cloud storage)', () => {
  it('generates image with multiple image inputs via cloud storage upload', async () => {
    const provider = 'replicate';
    const model: ImageModel = 'qwen/qwen-image';

    // Load fixture images as blobs
    const cokeCan = loadFixture('coke-can.jpg');
    const pepsiCan = loadFixture('pepsi-can.jpg');

    // Create cloud storage context for blob uploads
    const cloudStorage = createCloudStorageContext(cloudStorageEnv.config!);

    // Create registry with cloud storage
    const registry = createProviderRegistry({
      mode: 'live',
      secretResolver: {
        async getSecret(key) {
          return process.env[key] ?? null;
        },
      },
      cloudStorage,
    });

    const handler = registry.resolve({ provider, model, environment: 'local' });

    // Build request with multiple image inputs as blobs
    const resolvedInputs: Record<string, unknown> = {
      'Input:Prompt': 'A pirate holding a coke and pepsi can in each hands',
      'Input:ImageInput': [cokeCan, pepsiCan],
    };

    const request: ProviderJobContext = {
      jobId: `integration-qwen-image-multi`,
      provider,
      model,
      revision: 'rev-test',
      layerIndex: 0,
      attempt: 1,
      inputs: Object.keys(resolvedInputs),
      produces: ['Artifact:Output[index=0]'],
      context: {
        providerConfig: {},
        extras: await buildImageExtras(model, resolvedInputs, {
          ImageInput: { field: 'image_input', required: false },
        }),
      },
    };

    await handler.warmStart?.({ logger: undefined });
    const result = await handler.invoke(request);

    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(1);
    expect(result.artefacts[0]?.blob?.mimeType).toMatch(/^image\/(png|jpeg|jpg|webp)$/);
    expect(result.artefacts[0]?.blob?.data).toBeInstanceOf(Uint8Array);

    // Verify diagnostics contain the uploaded URLs (not blobs)
    const diagnostics = result.diagnostics as Record<string, unknown>;
    const input = diagnostics?.input as Record<string, unknown>;
    if (input?.image_input) {
      const imageInput = input.image_input as string[];
      expect(Array.isArray(imageInput)).toBe(true);
      expect(imageInput).toHaveLength(2);
      // Each item should be a URL (string starting with http)
      for (const url of imageInput) {
        expect(typeof url).toBe('string');
        expect(url).toMatch(/^https?:\/\//);
      }
    }

    if (result.artefacts[0]?.blob?.data) {
      saveTestArtifact('qwen-image-pirate-output.png', result.artefacts[0].blob.data);
    }
  }, 300000); // 5 minute timeout for image generation with upload
});
