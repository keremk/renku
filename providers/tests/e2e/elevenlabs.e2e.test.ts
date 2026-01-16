/**
 * ElevenLabs Provider Integration Test
 *
 * Run with: RUN_ELEVENLABS_TEST=1 pnpm test:e2e
 * Requires: ELEVENLABS_API_KEY env var
 *
 * To save output for visual inspection:
 * RUN_ELEVENLABS_TEST=1 SAVE_TEST_ARTIFACTS=1 pnpm test:e2e
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createProviderRegistry, type CreateProviderRegistryOptions } from '../../src/registry.js';
import { loadModelCatalog, type LoadedModelCatalog } from '../../src/model-catalog.js';
import type { ProviderJobContext } from '../../src/types.js';
import { buildElevenlabsTTSExtras, buildElevenlabsMusicExtras } from './schema-helpers.js';
import { saveTestArtifact } from './test-utils.js';
import { CATALOG_MODELS_ROOT } from '../test-catalog-paths.js';

const RUN_TEST = process.env.RUN_ELEVENLABS_TEST;
const API_KEY = process.env.ELEVENLABS_API_KEY;

const describeIf = RUN_TEST && API_KEY ? describe : describe.skip;

// Shared catalog loaded once for all tests
let catalog: LoadedModelCatalog;

describeIf('ElevenLabs provider integration', () => {
  beforeAll(async () => {
    catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);
  });

  it('generates TTS audio via eleven_v3 (end-to-end)', async () => {
    const provider = 'elevenlabs';
    const model = 'eleven_v3';

    // Full end-to-end: use registry like CLI does
    const registryOptions: CreateProviderRegistryOptions = {
      mode: 'live',
      catalog,
      catalogModelsDir: CATALOG_MODELS_ROOT,
      secretResolver: {
        async getSecret(key) {
          return process.env[key] ?? null;
        },
      },
    };
    const registry = createProviderRegistry(registryOptions);

    const handler = registry.resolve({ provider, model, environment: 'local' });

    // Build request with schema and extras (like planner would)
    const resolvedInputs: Record<string, unknown> = {
      'Input:TextInput': 'Hello! This is a test of the ElevenLabs text to speech system. How does it sound?',
      'Input:VoiceId': 'Rachel',
    };

    const request: ProviderJobContext = {
      jobId: `integration-${provider}-${model}`,
      provider,
      model,
      revision: 'rev-test',
      layerIndex: 0,
      attempt: 1,
      inputs: Object.keys(resolvedInputs),
      produces: ['Artifact:Output[index=0]'],
      context: {
        providerConfig: {},
        extras: await buildElevenlabsTTSExtras(model, resolvedInputs),
      },
    };

    await handler.warmStart?.({ logger: undefined });
    const result = await handler.invoke(request);

    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(1);
    expect(result.artefacts[0]?.blob?.mimeType).toBe('audio/mp3');
    expect(result.artefacts[0]?.blob?.data).toBeInstanceOf(Uint8Array);

    if (result.artefacts[0]?.blob?.data) {
      saveTestArtifact('elevenlabs-tts-output.mp3', result.artefacts[0].blob.data);
    }
  }, 60000);

  it('generates TTS audio via eleven_multilingual_v2 (end-to-end)', async () => {
    const provider = 'elevenlabs';
    const model = 'eleven_multilingual_v2';

    const registryOptions: CreateProviderRegistryOptions = {
      mode: 'live',
      catalog,
      catalogModelsDir: CATALOG_MODELS_ROOT,
      secretResolver: {
        async getSecret(key) {
          return process.env[key] ?? null;
        },
      },
    };
    const registry = createProviderRegistry(registryOptions);

    const handler = registry.resolve({ provider, model, environment: 'local' });

    const resolvedInputs: Record<string, unknown> = {
      'Input:TextInput': 'Bonjour! Ceci est un test du systeme de synthese vocale multilingue.',
      'Input:VoiceId': 'Aria',
    };

    const request: ProviderJobContext = {
      jobId: `integration-${provider}-${model}`,
      provider,
      model,
      revision: 'rev-test',
      layerIndex: 0,
      attempt: 1,
      inputs: Object.keys(resolvedInputs),
      produces: ['Artifact:Output[index=0]'],
      context: {
        providerConfig: {},
        extras: await buildElevenlabsTTSExtras(model, resolvedInputs),
      },
    };

    await handler.warmStart?.({ logger: undefined });
    const result = await handler.invoke(request);

    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(1);
    expect(result.artefacts[0]?.blob?.mimeType).toBe('audio/mp3');
    expect(result.artefacts[0]?.blob?.data).toBeInstanceOf(Uint8Array);

    if (result.artefacts[0]?.blob?.data) {
      saveTestArtifact('elevenlabs-multilingual-output.mp3', result.artefacts[0].blob.data);
    }
  }, 60000);

  it('generates music via music_v1 (end-to-end)', async () => {
    const provider = 'elevenlabs';
    const model = 'music_v1';

    const registryOptions: CreateProviderRegistryOptions = {
      mode: 'live',
      catalog,
      catalogModelsDir: CATALOG_MODELS_ROOT,
      secretResolver: {
        async getSecret(key) {
          return process.env[key] ?? null;
        },
      },
    };
    const registry = createProviderRegistry(registryOptions);

    const handler = registry.resolve({ provider, model, environment: 'local' });

    const resolvedInputs: Record<string, unknown> = {
      'Input:Prompt': 'A relaxing acoustic guitar melody with soft piano accompaniment',
      'Input:Duration': 10000, // 10 seconds
    };

    const request: ProviderJobContext = {
      jobId: `integration-${provider}-${model}`,
      provider,
      model,
      revision: 'rev-test',
      layerIndex: 0,
      attempt: 1,
      inputs: Object.keys(resolvedInputs),
      produces: ['Artifact:Output[index=0]'],
      context: {
        providerConfig: {},
        extras: await buildElevenlabsMusicExtras(model, resolvedInputs),
      },
    };

    await handler.warmStart?.({ logger: undefined });
    const result = await handler.invoke(request);

    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(1);
    expect(result.artefacts[0]?.blob?.mimeType).toBe('audio/mp3');
    expect(result.artefacts[0]?.blob?.data).toBeInstanceOf(Uint8Array);

    if (result.artefacts[0]?.blob?.data) {
      saveTestArtifact('elevenlabs-music-output.mp3', result.artefacts[0].blob.data);
    }
  }, 180000); // Music generation can take longer
});
