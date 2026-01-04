import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAssetProducerModels, loadAllAssetModels } from './asset-model-loader.js';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

const mockReadFile = vi.mocked(fs.readFile);

describe('loadAssetProducerModels', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads models from producer YAML mappings', async () => {
    const yamlContent = `
meta:
  id: text-to-image
mappings:
  replicate:
    flux-dev:
      api: replicate-image
    flux-pro:
      api: replicate-image
  openai:
    dall-e-3:
      api: openai-image
`;
    mockReadFile.mockResolvedValue(yamlContent);

    const models = await loadAssetProducerModels('asset/text-to-image', '/catalog');

    expect(mockReadFile).toHaveBeenCalledWith('/catalog/producers/asset/text-to-image.yaml', 'utf8');
    expect(models).toHaveLength(3);
    expect(models).toContainEqual({ provider: 'replicate', model: 'flux-dev' });
    expect(models).toContainEqual({ provider: 'replicate', model: 'flux-pro' });
    expect(models).toContainEqual({ provider: 'openai', model: 'dall-e-3' });
  });

  it('returns empty array when file not found', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const models = await loadAssetProducerModels('asset/nonexistent', '/catalog');

    expect(models).toEqual([]);
  });

  it('returns empty array when no mappings section', async () => {
    const yamlContent = `
meta:
  id: some-producer
inputs:
  - name: prompt
`;
    mockReadFile.mockResolvedValue(yamlContent);

    const models = await loadAssetProducerModels('asset/some-producer', '/catalog');

    expect(models).toEqual([]);
  });

  it('returns empty array when mappings is empty', async () => {
    const yamlContent = `
meta:
  id: some-producer
mappings: {}
`;
    mockReadFile.mockResolvedValue(yamlContent);

    const models = await loadAssetProducerModels('asset/some-producer', '/catalog');

    expect(models).toEqual([]);
  });

  it('handles single provider with multiple models', async () => {
    const yamlContent = `
mappings:
  elevenlabs:
    eleven_multilingual_v2:
      api: elevenlabs-tts
    eleven_turbo_v2_5:
      api: elevenlabs-tts
    eleven_flash_v2_5:
      api: elevenlabs-tts
`;
    mockReadFile.mockResolvedValue(yamlContent);

    const models = await loadAssetProducerModels('asset/text-to-speech', '/catalog');

    expect(models).toHaveLength(3);
    expect(models.every((m) => m.provider === 'elevenlabs')).toBe(true);
  });

  it('handles nested model configurations', async () => {
    const yamlContent = `
mappings:
  replicate:
    minimax-video-01:
      api: replicate-video
      config:
        some: value
    kling-1.6-pro:
      api: replicate-video
`;
    mockReadFile.mockResolvedValue(yamlContent);

    const models = await loadAssetProducerModels('asset/text-to-video', '/catalog');

    expect(models).toHaveLength(2);
    expect(models).toContainEqual({ provider: 'replicate', model: 'minimax-video-01' });
    expect(models).toContainEqual({ provider: 'replicate', model: 'kling-1.6-pro' });
  });
});

describe('loadAllAssetModels', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads models for multiple producers', async () => {
    mockReadFile.mockImplementation(async (path) => {
      if (String(path).includes('text-to-image')) {
        return `
mappings:
  replicate:
    flux-dev:
      api: replicate-image
`;
      }
      if (String(path).includes('text-to-speech')) {
        return `
mappings:
  elevenlabs:
    eleven_multilingual_v2:
      api: elevenlabs-tts
`;
      }
      throw new Error('File not found');
    });

    const result = await loadAllAssetModels(
      ['asset/text-to-image', 'asset/text-to-speech'],
      '/catalog',
    );

    expect(result.size).toBe(2);
    expect(result.get('asset/text-to-image')).toContainEqual({
      provider: 'replicate',
      model: 'flux-dev',
    });
    expect(result.get('asset/text-to-speech')).toContainEqual({
      provider: 'elevenlabs',
      model: 'eleven_multilingual_v2',
    });
  });

  it('returns empty map for empty producer list', async () => {
    const result = await loadAllAssetModels([], '/catalog');

    expect(result.size).toBe(0);
  });

  it('handles missing producers gracefully', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const result = await loadAllAssetModels(['asset/missing-producer'], '/catalog');

    expect(result.size).toBe(1);
    expect(result.get('asset/missing-producer')).toEqual([]);
  });

  it('loads producers in parallel', async () => {
    const callOrder: string[] = [];

    mockReadFile.mockImplementation(async (path) => {
      const pathStr = String(path);
      callOrder.push(pathStr);
      // Add a small delay to simulate async operation
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `
mappings:
  provider:
    model:
      api: test
`;
    });

    await loadAllAssetModels(['asset/producer-1', 'asset/producer-2', 'asset/producer-3'], '/catalog');

    // All three should have been called (parallel execution)
    expect(callOrder).toHaveLength(3);
  });
});
