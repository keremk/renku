/**
 * Tests for ElevenLabs schema loading and validation.
 * Ensures the schema property in YAML is correctly resolved to the shared schema files.
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import type { JSONSchema7 } from 'ai';
import {
  loadModelCatalog,
  loadModelSchemaFile,
  lookupModel,
  resolveSchemaPath,
} from '../../src/model-catalog.js';
import { CATALOG_MODELS_ROOT } from '../test-catalog-paths.js';

/**
 * Helper to get properties from a schema, asserting it exists.
 * Throws if properties is undefined.
 */
function getSchemaProperties(schema: JSONSchema7): Record<string, JSONSchema7> {
  expect(schema.properties).toBeDefined();
  return schema.properties as Record<string, JSONSchema7>;
}

describe('ElevenLabs schema loading', () => {
  describe('schema property resolution', () => {
    it('resolves eleven_v3 to tts_schema.json', async () => {
      const catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);
      const modelDef = lookupModel(catalog, 'elevenlabs', 'eleven_v3');

      expect(modelDef).not.toBeNull();
      expect(modelDef!.schema).toBe('tts_schema');

      const path = resolveSchemaPath(CATALOG_MODELS_ROOT, 'elevenlabs', 'eleven_v3', modelDef!);
      expect(path).toBe(resolve(CATALOG_MODELS_ROOT, 'elevenlabs/audio/tts_schema.json'));
    });

    it('resolves eleven_multilingual_v2 to tts_schema.json (shared schema)', async () => {
      const catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);
      const modelDef = lookupModel(catalog, 'elevenlabs', 'eleven_multilingual_v2');

      expect(modelDef).not.toBeNull();
      expect(modelDef!.schema).toBe('tts_schema');

      const path = resolveSchemaPath(CATALOG_MODELS_ROOT, 'elevenlabs', 'eleven_multilingual_v2', modelDef!);
      expect(path).toBe(resolve(CATALOG_MODELS_ROOT, 'elevenlabs/audio/tts_schema.json'));
    });

    it('resolves music_v1 to music_v1.json', async () => {
      const catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);
      const modelDef = lookupModel(catalog, 'elevenlabs', 'music_v1');

      expect(modelDef).not.toBeNull();
      expect(modelDef!.schema).toBe('music_v1');

      const path = resolveSchemaPath(CATALOG_MODELS_ROOT, 'elevenlabs', 'music_v1', modelDef!);
      expect(path).toBe(resolve(CATALOG_MODELS_ROOT, 'elevenlabs/audio/music_v1.json'));
    });
  });

  describe('loadModelSchemaFile', () => {
    it('loads TTS schema with correct input_schema structure', async () => {
      const catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);
      const schemaFile = await loadModelSchemaFile(CATALOG_MODELS_ROOT, catalog, 'elevenlabs', 'eleven_v3');

      expect(schemaFile).not.toBeNull();
      expect(schemaFile!.inputSchema).toBeDefined();

      const props = getSchemaProperties(schemaFile!.inputSchema);
      expect(props.text).toBeDefined();
      expect(props.voice).toBeDefined();
    });

    it('loads music schema with correct input_schema structure', async () => {
      const catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);
      const schemaFile = await loadModelSchemaFile(CATALOG_MODELS_ROOT, catalog, 'elevenlabs', 'music_v1');

      expect(schemaFile).not.toBeNull();
      expect(schemaFile!.inputSchema).toBeDefined();

      const props = getSchemaProperties(schemaFile!.inputSchema);
      expect(props.prompt).toBeDefined();
      expect(props.music_length_ms).toBeDefined();
    });

    it('all TTS models share the same schema file', async () => {
      const catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);

      const v3Schema = await loadModelSchemaFile(CATALOG_MODELS_ROOT, catalog, 'elevenlabs', 'eleven_v3');
      const multilingualSchema = await loadModelSchemaFile(CATALOG_MODELS_ROOT, catalog, 'elevenlabs', 'eleven_multilingual_v2');
      const turboSchema = await loadModelSchemaFile(CATALOG_MODELS_ROOT, catalog, 'elevenlabs', 'eleven_turbo_v2_5');

      // All schemas should be equivalent since they share the same file
      expect(v3Schema).not.toBeNull();
      expect(multilingualSchema).not.toBeNull();
      expect(turboSchema).not.toBeNull();

      expect(JSON.stringify(v3Schema!.inputSchema)).toBe(JSON.stringify(multilingualSchema!.inputSchema));
      expect(JSON.stringify(v3Schema!.inputSchema)).toBe(JSON.stringify(turboSchema!.inputSchema));
    });
  });

  describe('schema content validation', () => {
    it('TTS schema has required text field', async () => {
      const catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);
      const schemaFile = await loadModelSchemaFile(CATALOG_MODELS_ROOT, catalog, 'elevenlabs', 'eleven_v3');

      expect(schemaFile!.inputSchema.required).toContain('text');
    });

    it('music schema has required prompt field', async () => {
      const catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);
      const schemaFile = await loadModelSchemaFile(CATALOG_MODELS_ROOT, catalog, 'elevenlabs', 'music_v1');

      expect(schemaFile!.inputSchema.required).toContain('prompt');
    });

    it('TTS schema has voice_settings object', async () => {
      const catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);
      const schemaFile = await loadModelSchemaFile(CATALOG_MODELS_ROOT, catalog, 'elevenlabs', 'eleven_v3');

      const props = getSchemaProperties(schemaFile!.inputSchema);
      const voiceSettings = props.voice_settings;
      expect(voiceSettings).toBeDefined();
      expect(voiceSettings.type).toBe('object');
      expect(voiceSettings.properties).toBeDefined();
    });

    it('music schema has valid music_length_ms constraints', async () => {
      const catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);
      const schemaFile = await loadModelSchemaFile(CATALOG_MODELS_ROOT, catalog, 'elevenlabs', 'music_v1');

      const props = getSchemaProperties(schemaFile!.inputSchema);
      const lengthMs = props.music_length_ms;
      expect(lengthMs).toBeDefined();
      expect(lengthMs.type).toBe('integer');
      expect(lengthMs.minimum).toBe(3000);
      expect(lengthMs.maximum).toBe(600000);
    });
  });
});
