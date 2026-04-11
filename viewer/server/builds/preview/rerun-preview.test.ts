import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProducerCatalog, ProviderOptionEntry } from '@gorenku/core';
import {
  loadYamlBlueprintTree,
  prepareBlueprintResolutionContext,
} from '@gorenku/core';
import { resolveRerunInputOverrideTargets } from './rerun-preview.js';

const FIXTURES_ROOT = path.resolve(
  process.cwd(),
  '../cli/tests/fixtures/blueprints'
);
const BLUEPRINT_PATH = path.join(
  FIXTURES_ROOT,
  'conditional-logic',
  'scene-character-reference-routing',
  'scene-character-reference-routing.yaml'
);
const STORYBOARD_SCHEMA_PATH = path.join(
  FIXTURES_ROOT,
  'conditional-logic',
  'scene-character-reference-routing',
  'storyboard-director',
  'storyboard-director-output.json'
);
const CATALOG_ROOT = path.resolve(process.cwd(), '../catalog');

describe('resolveRerunInputOverrideTargets', () => {
  it('resolves schema-derived JSON field targets from the rerun preview resolution context', async () => {
    const { root } = await loadYamlBlueprintTree(BLUEPRINT_PATH, {
      catalogRoot: CATALOG_ROOT,
    });
    const storyboardSchema = await readFile(STORYBOARD_SCHEMA_PATH, 'utf8');

    const providerMetadata = new Map<string, ProviderOptionEntry>([
      [
        'StoryProducer',
        {
          outputSchema: storyboardSchema,
        },
      ],
      [
        'CharacterImageProducer',
        {
          sdkMapping: {
            Prompt: { field: 'prompt' },
            Resolution: { field: 'resolution' },
          },
        },
      ],
      [
        'SceneVideoProducer',
        {
          sdkMapping: {
            Prompt: { field: 'prompt' },
            ReferenceImages: { field: 'reference_images' },
            Resolution: { field: 'resolution' },
          },
        },
      ],
    ]);

    const providerCatalog: ProducerCatalog = {
      StoryProducer: {
        provider: 'openai',
        providerModel: 'gpt-4o',
        rateKey: 'openai/gpt-4o',
      },
      CharacterImageProducer: {
        provider: 'replicate',
        providerModel: 'flux-dev',
        rateKey: 'replicate/flux-dev',
      },
      SceneVideoProducer: {
        provider: 'fal-ai',
        providerModel: 'veo3-fast',
        rateKey: 'fal-ai/veo3-fast',
      },
    };

    const context = await prepareBlueprintResolutionContext({
      root,
      schemaSource: {
        kind: 'provider-options',
        providerOptions: providerMetadata,
      },
    });

    const resolved = resolveRerunInputOverrideTargets({
      sourceJobId: 'Producer:SceneVideoProducer[1]',
      context,
      providerCatalog,
      providerMetadata,
      inputValues: {
        'Input:StoryPrompt': 'A rescue mission in orbit',
        'Input:CharacterVisualStyle': 'retro sci-fi',
        'Input:NumOfCharacters': 2,
        'Input:NumOfScenes': 2,
        'Input:Resolution': { width: 1280, height: 720 },
      },
      inputOverrides: {
        Prompt: 'A dramatic close-up from the cockpit',
      },
    });

    expect(resolved).toEqual([
      {
        inputName: 'Prompt',
        canonicalId: 'Artifact:StoryProducer.Storyboard.Scenes[1].VideoPrompt',
        value: 'A dramatic close-up from the cockpit',
      },
    ]);
  });
});
