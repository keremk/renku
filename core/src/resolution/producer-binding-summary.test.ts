import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadYamlBlueprintTree } from '../parsing/blueprint-loader/yaml-parser.js';
import type { BlueprintTreeNode } from '../types.js';
import { CATALOG_ROOT } from '../../tests/catalog-paths.js';
import {
  buildProducerBindingSummary,
  collectProducerBindingEntries,
} from './producer-binding-summary.js';

function makeTreeNode(
  namespacePath: string[],
  document: Record<string, unknown>,
  children: Array<[string, BlueprintTreeNode]> = []
): BlueprintTreeNode {
  return {
    namespacePath,
    document,
    children: new Map(children),
  } as unknown as BlueprintTreeNode;
}

function createFixtureTree(): BlueprintTreeNode {
  const videoProducerDoc = {
    meta: { id: 'video-producer', name: 'Video Producer' },
    inputs: [
      { name: 'Prompt', type: 'string', required: true },
      { name: 'Resolution', type: 'resolution', required: false },
      { name: 'ReferenceImages', type: 'collection', required: false },
    ],
    producers: [{ name: 'VideoGenerator', provider: 'fal-ai', model: 'video' }],
    producerImports: [],
    artefacts: [{ name: 'GeneratedVideo', type: 'video' }],
    edges: [
      { from: 'Prompt', to: 'VideoGenerator.Prompt' },
      { from: 'Resolution', to: 'VideoGenerator.Resolution' },
      { from: 'ReferenceImages', to: 'VideoGenerator.ReferenceImages' },
      { from: 'VideoGenerator.GeneratedVideo', to: 'GeneratedVideo' },
    ],
  };

  const storyProducerDoc = {
    meta: { id: 'story-producer', name: 'Story Producer' },
    inputs: [{ name: 'Topic', type: 'string', required: false }],
    producers: [{ name: 'StoryGenerator', provider: 'openai', model: 'gpt-4' }],
    producerImports: [],
    artefacts: [{ name: 'Script', type: 'json' }],
    edges: [
      { from: 'Topic', to: 'StoryGenerator.Topic' },
      { from: 'StoryGenerator.Script', to: 'Script' },
    ],
  };

  const rootDoc = {
    meta: { id: 'root', name: 'Root' },
    inputs: [
      { name: 'Prompt', type: 'string', required: true },
      { name: 'Resolution', type: 'resolution', required: false },
    ],
    producers: [],
    producerImports: [
      { name: 'StoryProducer', producer: 'prompt/story' },
      { name: 'VideoProducer', producer: 'video/text-to-video' },
    ],
    artefacts: [{ name: 'FinalVideo', type: 'video' }],
    edges: [
      { from: 'Resolution', to: 'VideoProducer.Resolution' },
      { from: 'Prompt', to: 'VideoProducer.Prompt[0]' },
      { from: 'StoryProducer.Script', to: 'VideoProducer.Prompt' },
      { from: 'StoryProducer.Script', to: 'VideoProducer.ReferenceImages[0]' },
      { from: 'StoryProducer.Script', to: 'VideoProducer.ReferenceImages[1]' },
      { from: 'VideoProducer.GeneratedVideo', to: 'FinalVideo' },
    ],
  };

  return makeTreeNode([], rootDoc, [
    [
      'StoryProducer',
      makeTreeNode(
        ['StoryProducer'],
        storyProducerDoc as Record<string, unknown>
      ),
    ],
    [
      'VideoProducer',
      makeTreeNode(
        ['VideoProducer'],
        videoProducerDoc as Record<string, unknown>
      ),
    ],
  ]);
}

describe('producer-binding-summary', () => {
  it('extracts producer aliases from edge target references', () => {
    const root = createFixtureTree();
    const entries = collectProducerBindingEntries(root, 'VideoProducer');

    const aliases = entries.map((entry) => entry.aliasBase);
    expect(aliases).toContain('Prompt');
    expect(aliases).toContain('Resolution');
    expect(aliases).toContain('ReferenceImages');
    expect(aliases).not.toContain('Prompt[0]');
    expect(aliases).not.toContain('ReferenceImages[0]');
  });

  it('classifies source kinds from blueprint endpoints', () => {
    const root = createFixtureTree();
    const summary = buildProducerBindingSummary({
      root,
      producerId: 'VideoProducer',
      inputs: {
        Resolution: { width: 1280, height: 720 },
        Prompt: 'Plain input prompt',
      },
    });

    expect(summary.mappingInputBindings.Resolution).toBe('Input:Resolution');
    expect(summary.mappingInputBindings.Prompt).toBeDefined();
    expect(summary.mappingInputBindings['Prompt[1]']).toBeDefined();

    const promptSources = summary.aliasSources.get('Prompt');
    expect(promptSources).toBeDefined();
    expect(promptSources?.has('input')).toBe(true);
    expect(promptSources?.has('artifact')).toBe(false);

    const promptSecondSources = summary.aliasSources.get('Prompt[1]');
    expect(promptSecondSources).toBeDefined();
    expect(promptSecondSources?.has('artifact')).toBe(true);

    const resolutionSources = summary.aliasSources.get('Resolution');
    expect(resolutionSources).toBeDefined();
    expect(resolutionSources?.has('input')).toBe(true);
    expect(resolutionSources?.has('artifact')).toBe(false);

    expect(summary.resolvedInputs['Input:Resolution']).toEqual({
      width: 1280,
      height: 720,
    });
    expect(summary.resolvedInputs['Input:Prompt']).toBe('Plain input prompt');
  });

  it('creates deterministic indexed aliases for repeated bindings', () => {
    const root = createFixtureTree();
    const summary = buildProducerBindingSummary({
      root,
      producerId: 'VideoProducer',
      inputs: {},
    });

    expect(summary.mappingInputBindings.ReferenceImages).toBe(
      'Artifact:StoryProducer.Script'
    );
    expect(summary.mappingInputBindings['ReferenceImages[1]']).toBe(
      'Artifact:StoryProducer.Script'
    );
    expect(summary.connectedAliases.has('ReferenceImages')).toBe(true);
  });

  it('resolves real blueprint bindings for producer artifacts', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'ads',
      'ad-video.yaml'
    );
    const { root } = await loadYamlBlueprintTree(blueprintPath, {
      catalogRoot: CATALOG_ROOT,
    });

    const summary = buildProducerBindingSummary({
      root,
      producerId: 'CharacterImageProducer',
      inputs: {
        Resolution: { width: 1280, height: 720 },
      },
    });

    expect(summary.mappingInputBindings.Resolution).toBe('Input:Resolution');
    expect(summary.mappingInputBindings.Prompt).toBe(
      'Artifact:AdScriptProducer.AdScript.CharacterImagePrompt'
    );
  });
});
