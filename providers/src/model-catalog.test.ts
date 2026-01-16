import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { loadModelCatalog, lookupModel, resolveSchemaPath, type ModelDefinition } from './model-catalog.js';

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

  describe('resolveSchemaPath', () => {
    it('resolves schema property to {type}/{schema}.json', () => {
      const modelDef: ModelDefinition = {
        name: 'eleven_v3',
        type: 'audio',
        schema: 'tts_schema',
      };
      const path = resolveSchemaPath('/catalog/models', 'elevenlabs', 'eleven_v3', modelDef);
      expect(path).toBe('/catalog/models/elevenlabs/audio/tts_schema.json');
    });

    it('prioritizes inputSchema over schema', () => {
      const modelDef: ModelDefinition = {
        name: 'test',
        type: 'audio',
        schema: 'shared_schema',
        inputSchema: 'custom/path.json',
      };
      const path = resolveSchemaPath('/catalog/models', 'test-provider', 'test', modelDef);
      expect(path).toBe('/catalog/models/test-provider/custom/path.json');
    });

    it('falls back to model name when no schema specified', () => {
      const modelDef: ModelDefinition = {
        name: 'my-model',
        type: 'video',
      };
      const path = resolveSchemaPath('/catalog/models', 'provider', 'my-model', modelDef);
      expect(path).toBe('/catalog/models/provider/video/my-model.json');
    });

    it('converts model name with slashes to filename', () => {
      const modelDef: ModelDefinition = {
        name: 'bytedance/seedream-4',
        type: 'image',
      };
      const path = resolveSchemaPath('/catalog/models', 'replicate', 'bytedance/seedream-4', modelDef);
      expect(path).toBe('/catalog/models/replicate/image/bytedance-seedream-4.json');
    });

    it('converts model name with dots to filename', () => {
      const modelDef: ModelDefinition = {
        name: 'minimax/speech-2.6-hd',
        type: 'audio',
      };
      const path = resolveSchemaPath('/catalog/models', 'fal-ai', 'minimax/speech-2.6-hd', modelDef);
      expect(path).toBe('/catalog/models/fal-ai/audio/minimax-speech-2-6-hd.json');
    });
  });

  describe('loadModelCatalog with schema property', () => {
    it('loads schema property from elevenlabs YAML', async () => {
      const catalog = await loadModelCatalog(MODELS_DIR);

      const eleven_v3 = lookupModel(catalog, 'elevenlabs', 'eleven_v3');
      expect(eleven_v3).not.toBeNull();
      expect(eleven_v3!.schema).toBe('tts_schema');

      const eleven_multilingual = lookupModel(catalog, 'elevenlabs', 'eleven_multilingual_v2');
      expect(eleven_multilingual).not.toBeNull();
      expect(eleven_multilingual!.schema).toBe('tts_schema');

      const music_v1 = lookupModel(catalog, 'elevenlabs', 'music_v1');
      expect(music_v1).not.toBeNull();
      expect(music_v1!.schema).toBe('music_v1');
    });

    it('models without schema property have undefined schema', async () => {
      const catalog = await loadModelCatalog(MODELS_DIR);

      const falModel = lookupModel(catalog, 'fal-ai', 'veo3.1');
      expect(falModel).not.toBeNull();
      expect(falModel!.schema).toBeUndefined();
    });
  });
});
