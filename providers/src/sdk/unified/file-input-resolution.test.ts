import { describe, it, expect, vi } from 'vitest';
import { resolveProviderFileInputs } from './file-input-resolution.js';
import type { ProviderAdapter } from './provider-adapter.js';
import { SdkErrorCode } from '../errors.js';
import {
  buildSimulatedUploadUrl,
  createSimulatedProviderClient,
} from './simulated-client.js';

describe('resolveProviderFileInputs', () => {
  const schema = JSON.stringify({
    type: 'object',
    properties: {
      image_url: { type: 'string', format: 'uri' },
      image_urls: {
        type: 'array',
        items: { type: 'string', format: 'uri' },
      },
      prompt: { type: 'string' },
    },
  });

  it('resolves blobs through the adapter upload hook in simulated mode', async () => {
    const uploadInputFile = vi
      .fn()
      .mockImplementation(async (_client, file) =>
        buildSimulatedUploadUrl(file, 'fal-ai')
      );
    const adapter: ProviderAdapter = {
      name: 'fal-ai',
      secretKey: 'FAL_KEY',
      async createClient() {
        return {};
      },
      formatModelIdentifier(model) {
        return model;
      },
      async invoke() {
        return { result: {} };
      },
      uploadInputFile,
      normalizeOutput() {
        return [];
      },
    };

    const payload = {
      image_url: {
        data: Buffer.from('sample-image'),
        mimeType: 'image/png',
      },
      prompt: 'hello',
    };

    const first = await resolveProviderFileInputs({
      payload,
      inputSchema: schema,
      adapter,
      client: createSimulatedProviderClient('fal-ai'),
    });
    const second = await resolveProviderFileInputs({
      payload,
      inputSchema: schema,
      adapter,
      client: createSimulatedProviderClient('fal-ai'),
    });

    expect(first.image_url).toMatch(
      /^https:\/\/simulated\.fal-ai\.files\.invalid\/blobs\//
    );
    expect(first.image_url).toBe(second.image_url);
    expect(uploadInputFile).toHaveBeenCalledTimes(2);
  });

  it('live mode uses provider native upload when available', async () => {
    const uploadInputFile = vi
      .fn()
      .mockResolvedValue('https://provider.example.com/file-1');
    const adapter: ProviderAdapter = {
      name: 'replicate',
      secretKey: 'REPLICATE_API_TOKEN',
      async createClient() {
        return {};
      },
      formatModelIdentifier(model) {
        return model;
      },
      async invoke() {
        return { result: {} };
      },
      uploadInputFile,
      normalizeOutput() {
        return [];
      },
    };

    const payload = {
      image_url: {
        data: Buffer.from('input-bytes'),
        mimeType: 'image/jpeg',
      },
      prompt: 'hello',
    };

    const resolved = await resolveProviderFileInputs({
      payload,
      inputSchema: schema,
      adapter,
      client: { configured: true },
    });

    expect(uploadInputFile).toHaveBeenCalledTimes(1);
    expect(uploadInputFile).toHaveBeenCalledWith(
      { configured: true },
      expect.objectContaining({ mimeType: 'image/jpeg' })
    );
    expect(resolved.image_url).toBe('https://provider.example.com/file-1');
  });

  it('resolves array URI fields and keeps existing URL strings', async () => {
    const uploadInputFile = vi
      .fn()
      .mockResolvedValueOnce('https://provider.example.com/a')
      .mockResolvedValueOnce('https://provider.example.com/b');

    const adapter: ProviderAdapter = {
      name: 'replicate',
      secretKey: 'REPLICATE_API_TOKEN',
      async createClient() {
        return {};
      },
      formatModelIdentifier(model) {
        return model;
      },
      async invoke() {
        return { result: {} };
      },
      uploadInputFile,
      normalizeOutput() {
        return [];
      },
    };

    const payload = {
      image_urls: [
        {
          data: Buffer.from('first'),
          mimeType: 'image/png',
        },
        'https://existing.example.com/image.png',
        {
          data: Buffer.from('second'),
          mimeType: 'image/png',
        },
      ],
      prompt: 'hello',
    };

    const resolved = await resolveProviderFileInputs({
      payload,
      inputSchema: schema,
      adapter,
      client: { configured: true },
    });

    expect(resolved.image_urls).toEqual([
      'https://provider.example.com/a',
      'https://existing.example.com/image.png',
      'https://provider.example.com/b',
    ]);
  });

  it('resolves nested URI fields using provider native upload', async () => {
    const nestedSchema = JSON.stringify({
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            image_url: { type: 'string', format: 'uri' },
          },
        },
      },
    });

    const uploadInputFile = vi
      .fn()
      .mockResolvedValue('https://provider.example.com/nested-file');

    const adapter: ProviderAdapter = {
      name: 'wavespeed-ai',
      secretKey: 'WAVESPEED_API_KEY',
      async createClient() {
        return {};
      },
      formatModelIdentifier(model) {
        return model;
      },
      async invoke() {
        return { result: {} };
      },
      uploadInputFile,
      normalizeOutput() {
        return [];
      },
    };

    const payload = {
      config: {
        image_url: {
          data: Buffer.from('nested-image'),
          mimeType: 'image/png',
        },
      },
    };

    const resolved = await resolveProviderFileInputs({
      payload,
      inputSchema: nestedSchema,
      adapter,
      client: { configured: true },
    });

    expect(uploadInputFile).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual({
      config: {
        image_url: 'https://provider.example.com/nested-file',
      },
    });
  });

  it('throws BLOB_INPUT_NO_STORAGE when provider has no native upload support', async () => {
    const adapter: ProviderAdapter = {
      name: 'wavespeed-ai',
      secretKey: 'WAVESPEED_API_KEY',
      async createClient() {
        return {};
      },
      formatModelIdentifier(model) {
        return model;
      },
      async invoke() {
        return { result: {} };
      },
      normalizeOutput() {
        return [];
      },
    };

    const payload = {
      image_url: {
        data: Buffer.from('no-storage'),
        mimeType: 'image/png',
      },
    };

    await expect(
      resolveProviderFileInputs({
        payload,
        inputSchema: schema,
        adapter,
        client: { configured: true },
      })
    ).rejects.toMatchObject({
      code: SdkErrorCode.BLOB_INPUT_NO_STORAGE,
    });
  });

  it('does not hide native upload errors', async () => {
    const adapter: ProviderAdapter = {
      name: 'replicate',
      secretKey: 'REPLICATE_API_TOKEN',
      async createClient() {
        return {};
      },
      formatModelIdentifier(model) {
        return model;
      },
      async invoke() {
        return { result: {} };
      },
      uploadInputFile: vi
        .fn()
        .mockRejectedValue(new Error('native upload failed')),
      normalizeOutput() {
        return [];
      },
    };

    const payload = {
      image_url: {
        data: Buffer.from('native-failure'),
        mimeType: 'image/png',
      },
    };

    await expect(
      resolveProviderFileInputs({
        payload,
        inputSchema: schema,
        adapter,
        client: { configured: true },
      })
    ).rejects.toThrow(/native upload failed/);
  });

  it('throws when blob payload cannot be mapped to URI fields', async () => {
    const uploadInputFile = vi.fn();
    const adapter: ProviderAdapter = {
      name: 'fal-ai',
      secretKey: 'FAL_KEY',
      async createClient() {
        return {};
      },
      formatModelIdentifier(model) {
        return model;
      },
      async invoke() {
        return { result: {} };
      },
      uploadInputFile,
      normalizeOutput() {
        return [];
      },
    };

    const nonUriSchema = JSON.stringify({
      type: 'object',
      properties: {
        prompt: { type: 'string' },
      },
    });

    await expect(
      resolveProviderFileInputs({
        payload: {
          prompt: {
            data: Buffer.from('blob-in-wrong-field'),
            mimeType: 'image/png',
          },
        },
        inputSchema: nonUriSchema,
        adapter,
        client: { configured: true },
      })
    ).rejects.toMatchObject({
      code: SdkErrorCode.BLOB_INPUT_NO_STORAGE,
    });

    expect(uploadInputFile).not.toHaveBeenCalled();
  });
});
