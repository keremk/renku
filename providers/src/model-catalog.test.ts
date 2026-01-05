import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { loadModelCatalog, lookupModel } from './model-catalog.js';

const CATALOG_ROOT = resolve(import.meta.dirname, '../../catalog');
const MODELS_DIR = resolve(CATALOG_ROOT, 'models');
const PRODUCERS_ASSET_DIR = resolve(CATALOG_ROOT, 'producers/asset');

describe('model-catalog', () => {
  describe('loadModelCatalog', () => {
    it('should load all provider catalogs', async () => {
      const catalog = await loadModelCatalog(MODELS_DIR);

      // Verify known providers are loaded
      expect(catalog.providers.has('fal-ai')).toBe(true);
      expect(catalog.providers.has('replicate')).toBe(true);
      expect(catalog.providers.has('wavespeed-ai')).toBe(true);

      // Verify each provider has models
      const falAi = catalog.providers.get('fal-ai');
      expect(falAi).toBeDefined();
      expect(falAi!.size).toBeGreaterThan(0);

      const replicate = catalog.providers.get('replicate');
      expect(replicate).toBeDefined();
      expect(replicate!.size).toBeGreaterThan(0);
    });
  });

  describe('lookupModel', () => {
    it('should find models with dots in version numbers', async () => {
      const catalog = await loadModelCatalog(MODELS_DIR);

      // fal-ai models with dots
      expect(lookupModel(catalog, 'fal-ai', 'veo3.1')).not.toBeNull();
      expect(lookupModel(catalog, 'fal-ai', 'gpt-image-1.5')).not.toBeNull();
      expect(lookupModel(catalog, 'fal-ai', 'minimax/speech-2.6-hd')).not.toBeNull();
      expect(lookupModel(catalog, 'fal-ai', 'veed/fabric-1.0/fast')).not.toBeNull();

      // replicate models with dots
      expect(lookupModel(catalog, 'replicate', 'minimax/hailuo-2.3')).not.toBeNull();
      expect(lookupModel(catalog, 'replicate', 'minimax/music-1.5')).not.toBeNull();
      expect(lookupModel(catalog, 'replicate', 'bytedance/seedream-4.5')).not.toBeNull();
      expect(lookupModel(catalog, 'replicate', 'google/veo-3.1-fast')).not.toBeNull();
    });

    it('should find models with slashes in path', async () => {
      const catalog = await loadModelCatalog(MODELS_DIR);

      // Models with multi-segment paths
      expect(lookupModel(catalog, 'fal-ai', 'bytedance/seedance/v1.5/pro/text-to-video')).not.toBeNull();
      expect(lookupModel(catalog, 'fal-ai', 'wan/v2.6/text-to-video')).not.toBeNull();
      expect(lookupModel(catalog, 'fal-ai', 'kling-video/o1/image-to-video')).not.toBeNull();
      expect(lookupModel(catalog, 'fal-ai', 'elevenlabs/tts/eleven-v3')).not.toBeNull();
    });

    it('should return null for non-existent models', async () => {
      const catalog = await loadModelCatalog(MODELS_DIR);

      // Non-existent models should return null
      expect(lookupModel(catalog, 'fal-ai', 'non-existent-model')).toBeNull();
      expect(lookupModel(catalog, 'replicate', 'non-existent-model')).toBeNull();

      // Wrong provider for existing model
      expect(lookupModel(catalog, 'replicate', 'veo3.1')).toBeNull();
    });

    it('should require exact model name matching (no fuzzy matching)', async () => {
      const catalog = await loadModelCatalog(MODELS_DIR);

      // Using hyphen instead of dot should fail
      expect(lookupModel(catalog, 'fal-ai', 'veo3-1')).toBeNull();
      expect(lookupModel(catalog, 'fal-ai', 'gpt-image-1-5')).toBeNull();

      // Using wrong path structure should fail
      expect(lookupModel(catalog, 'fal-ai', 'wan-v2-6/text-to-video')).toBeNull();
    });
  });

  describe('producer-catalog validation', () => {
    it('should validate ALL producer model names exist in catalog', async () => {
      const catalog = await loadModelCatalog(MODELS_DIR);

      // Get all producer files
      const producerFiles = await readdir(PRODUCERS_ASSET_DIR);
      const yamlFiles = producerFiles.filter((f) => f.endsWith('.yaml'));

      const mismatches: Array<{
        file: string;
        provider: string;
        model: string;
      }> = [];

      for (const file of yamlFiles) {
        const filePath = resolve(PRODUCERS_ASSET_DIR, file);
        const content = await readFile(filePath, 'utf8');
        const producer = parseYaml(content) as {
          mappings?: Record<string, Record<string, unknown>>;
        };

        if (!producer.mappings) {
          continue;
        }

        // Extract all provider/model pairs from mappings
        for (const [provider, models] of Object.entries(producer.mappings)) {
          // Skip non-asset providers (like 'openai' for LLM, 'vercel')
          if (!catalog.providers.has(provider)) {
            continue;
          }

          for (const modelName of Object.keys(models)) {
            const found = lookupModel(catalog, provider, modelName);
            if (!found) {
              mismatches.push({
                file,
                provider,
                model: modelName,
              });
            }
          }
        }
      }

      // Report all mismatches at once for easy debugging
      if (mismatches.length > 0) {
        const report = mismatches
          .map((m) => `  ${m.file}: ${m.provider}/${m.model}`)
          .join('\n');
        expect.fail(
          `Found ${mismatches.length} model name mismatches:\n${report}`
        );
      }
    });
  });
});
