import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadYamlBlueprintTree } from '../parsing/blueprint-loader/yaml-parser.js';
import { RuntimeErrorCode } from '../errors/index.js';
import { hydrateOutputSchemasFromProducerMetadata } from '../orchestration/output-schema-hydration.js';
import type { BlueprintTreeNode } from '../types.js';
import { TEST_FIXTURES_ROOT } from '../../tests/catalog-paths.js';
import { buildBlueprintGraph } from './canonical-graph.js';
import {
  buildProducerBindingSummary,
  collectRuntimeConnectedAliases,
  buildProducerRuntimeBindingSnapshot,
  collectProducerBindingEntries,
} from './producer-binding-summary.js';

const ARTIFACT_JSON_PATH_FIXTURE_BLUEPRINT = resolve(
  TEST_FIXTURES_ROOT,
  'producer-binding-summary--artifact-json-path-binding',
  'producer-binding-summary--artifact-json-path-binding.yaml'
);

const LOOPED_SOURCE_IMAGES_FIXTURE_BLUEPRINT = resolve(
  TEST_FIXTURES_ROOT,
  'producer-binding-summary--looped-source-images',
  'producer-binding-summary--looped-source-images.yaml'
);

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
      { name: 'ReferenceImages', type: 'array', required: false },
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

function collectMissingEdgeEndpointNodeIds(root: BlueprintTreeNode): {
  missingSourceNodeIds: string[];
  missingTargetNodeIds: string[];
} {
  const graph = buildBlueprintGraph(root);
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const missingSourceNodeIds = new Set<string>();
  const missingTargetNodeIds = new Set<string>();

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from.nodeId)) {
      missingSourceNodeIds.add(edge.from.nodeId);
    }
    if (!nodeIds.has(edge.to.nodeId)) {
      missingTargetNodeIds.add(edge.to.nodeId);
    }
  }

  return {
    missingSourceNodeIds: Array.from(missingSourceNodeIds).sort(),
    missingTargetNodeIds: Array.from(missingTargetNodeIds).sort(),
  };
}

describe('producer-binding-summary', () => {
  it('extracts producer aliases from edge target references', () => {
    const root = createFixtureTree();
    const entries = collectProducerBindingEntries(root, 'Producer:VideoProducer');

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
      producerId: 'Producer:VideoProducer',
      inputs: {
        'Input:Resolution': { width: 1280, height: 720 },
        'Input:Prompt': 'Plain input prompt',
      },
      mode: 'static',
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
      producerId: 'Producer:VideoProducer',
      inputs: {},
      mode: 'static',
    });

    expect(summary.mappingInputBindings.ReferenceImages).toBe(
      'Input:VideoProducer.ReferenceImages[0]'
    );
    expect(summary.mappingInputBindings['ReferenceImages[0]']).toBe(
      'Artifact:StoryProducer.Script'
    );
    expect(summary.mappingInputBindings['ReferenceImages[1]']).toBe(
      'Artifact:StoryProducer.Script'
    );
    expect(summary.connectedAliases.has('ReferenceImages')).toBe(true);
  });

  it('fails fast when JSON-path source graph nodes are unresolved', async () => {
    const { root } = await loadYamlBlueprintTree(
      ARTIFACT_JSON_PATH_FIXTURE_BLUEPRINT
    );

    expect(() =>
      buildProducerBindingSummary({
        root,
        producerId: 'Producer:CharacterImageProducer',
        mode: 'static',
      })
    ).toThrowError(
      /Missing source graph node "AdScriptProducer.AdScript.CharacterImagePrompt"/
    );
  });

  it('resolves fixture producer bindings after output-schema hydration', async () => {
    const { root } = await loadYamlBlueprintTree(
      ARTIFACT_JSON_PATH_FIXTURE_BLUEPRINT
    );
    await hydrateOutputSchemasFromProducerMetadata(root);

    const summary = buildProducerBindingSummary({
      root,
      producerId: 'Producer:CharacterImageProducer',
      mode: 'static',
    });

    const endpointCheck = collectMissingEdgeEndpointNodeIds(root);
    expect(endpointCheck.missingSourceNodeIds).toEqual([]);
    expect(summary.mappingInputBindings.Resolution).toBe('Input:Resolution');
    expect(summary.mappingInputBindings.Prompt).toBe(
      'Artifact:AdScriptProducer.AdScript.CharacterImagePrompt'
    );
  });

  it('resolves composite output sources to upstream artifacts in static binding summaries', () => {
    const childProducerDoc = {
      meta: { id: 'child-producer', name: 'Child Producer', kind: 'producer' },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      producers: [{ name: 'ImageGenerator', provider: 'fal-ai', model: 'image' }],
      producerImports: [],
      artefacts: [{ name: 'GeneratedImage', type: 'image' }],
      edges: [
        { from: 'Prompt', to: 'ImageGenerator.Prompt' },
        { from: 'ImageGenerator.GeneratedImage', to: 'GeneratedImage' },
      ],
    };

    const timelineDoc = {
      meta: { id: 'timeline-producer', name: 'Timeline Producer', kind: 'producer' },
      inputs: [{ name: 'VideoSegments', type: 'array', required: false, fanIn: true }],
      producers: [{ name: 'TimelineBuilder', provider: 'renku', model: 'timeline/ordered' }],
      producerImports: [],
      artefacts: [{ name: 'Timeline', type: 'json' }],
      edges: [
        { from: 'VideoSegments', to: 'TimelineBuilder.VideoSegments' },
        { from: 'TimelineBuilder.Timeline', to: 'Timeline' },
      ],
    };

    const rootDoc = {
      meta: { id: 'root', name: 'Root' },
      inputs: [{ name: 'ImagePrompt', type: 'string', required: true }],
      producers: [],
      producerImports: [],
      artefacts: [{ name: 'SegmentVideo', type: 'image' }],
      edges: [
        { from: 'ImagePrompt', to: 'ChildProducer.Prompt' },
        { from: 'ChildProducer.GeneratedImage', to: 'SegmentVideo' },
        { from: 'SegmentVideo', to: 'TimelineComposer.VideoSegments' },
      ],
    };

    const root = makeTreeNode([], rootDoc, [
      ['ChildProducer', makeTreeNode(['ChildProducer'], childProducerDoc)],
      ['TimelineComposer', makeTreeNode(['TimelineComposer'], timelineDoc)],
    ]);

    const summary = buildProducerBindingSummary({
      root,
      producerId: 'Producer:TimelineComposer',
      mode: 'static',
    });

    expect(summary.mappingInputBindings.VideoSegments).toBe(
      'Artifact:ChildProducer.GeneratedImage'
    );
    expect(summary.aliasSources.get('VideoSegments')?.has('artifact')).toBe(true);
    expect(summary.connectedAliases.has('VideoSegments')).toBe(true);
  });

  it('uses canonical runtime bindings for looped array aliases', async () => {
    const { root } = await loadYamlBlueprintTree(
      LOOPED_SOURCE_IMAGES_FIXTURE_BLUEPRINT
    );

    const summary = buildProducerBindingSummary({
      root,
      producerId: 'Producer:ThenImageProducer',
      inputs: {
        'Input:NumOfCharacters': 1,
        'Input:Prompt': 'compose then image',
        'Input:CelebrityThenImages': ['file:./input-files/then-0.jpg'],
        'Input:SettingImage': 'file:./input-files/setting.jpg',
      },
      mode: 'runtime',
    });

    expect(summary.mappingInputBindings.SourceImages).toBe(
      'Input:ThenImageProducer.SourceImages[0]'
    );
    expect(summary.mappingInputBindings['SourceImages[0]']).toBe(
      'Input:CelebrityThenImages[0]'
    );
    expect(summary.mappingInputBindings['SourceImages[1]']).toBe(
      'Input:SettingImage'
    );

    expect(summary.resolvedInputs['Input:CelebrityThenImages[0]']).toBe(
      'file:./input-files/then-0.jpg'
    );
    expect(summary.resolvedInputs['Input:SettingImage']).toBe(
      'file:./input-files/setting.jpg'
    );
  });

  it('captures per-instance runtime bindings for looped producers', async () => {
    const { root } = await loadYamlBlueprintTree(
      LOOPED_SOURCE_IMAGES_FIXTURE_BLUEPRINT
    );

    const runtimeSnapshot = buildProducerRuntimeBindingSnapshot({
      root,
      producerId: 'Producer:ThenImageProducer',
      inputs: {
        'Input:NumOfCharacters': 2,
        'Input:Prompt': 'compose then image',
        'Input:CelebrityThenImages': [
          'file:./input-files/then-0.jpg',
          'file:./input-files/then-1.jpg',
        ],
        'Input:SettingImage': 'file:./input-files/setting.jpg',
      },
    });

    expect(runtimeSnapshot.instances).toHaveLength(2);
    expect(
      runtimeSnapshot.instances[0]?.inputBindings['SourceImages[0]']
    ).toBe('Input:CelebrityThenImages[0]');
    expect(
      runtimeSnapshot.instances[1]?.inputBindings['SourceImages[0]']
    ).toBe('Input:CelebrityThenImages[1]');
    expect(runtimeSnapshot.resolvedInputs['Input:CelebrityThenImages[0]']).toBe(
      'file:./input-files/then-0.jpg'
    );
    expect(runtimeSnapshot.resolvedInputs['Input:CelebrityThenImages[1]']).toBe(
      'file:./input-files/then-1.jpg'
    );
  });

  it('fails fast when runtime inputs use non-canonical keys', () => {
    const root = createFixtureTree();

    expect(() =>
      buildProducerRuntimeBindingSnapshot({
        root,
        producerId: 'Producer:VideoProducer',
        inputs: {
          Prompt: 'non-canonical key',
        },
      })
    ).toThrow(/must use canonical IDs only/);
  });

  it('filters producer-local fallback aliases from runtime connected metadata', () => {
    const connectedAliases = collectRuntimeConnectedAliases({
      producerId: 'Producer:VideoProducer',
      staticConnectedAliases: new Set(['Prompt', 'Resolution']),
      runtimeInstances: [
        {
          instanceId: 'Producer:VideoProducer[0]',
          indices: { clip: 0 },
          inputBindings: {
            Prompt: 'Input:Prompt',
            Resolution: 'Input:Resolution',
            GenerateAudio: 'Input:VideoProducer.GenerateAudio',
            ReferenceImages: 'Artifact:CharacterImageProducer.GeneratedImage',
          },
        },
      ],
    });

    expect(Array.from(connectedAliases).sort()).toEqual([
      'Prompt',
      'ReferenceImages',
      'Resolution',
    ]);
    expect(connectedAliases.has('GenerateAudio')).toBe(false);
  });

  it('throws explicit errors when metadata output schema path is missing', async () => {
    const { root } = await loadYamlBlueprintTree(
      ARTIFACT_JSON_PATH_FIXTURE_BLUEPRINT
    );
    const producerNode = root.children.get('AdScriptProducer');
    if (!producerNode) {
      throw new Error('Fixture should include AdScriptProducer child node.');
    }

    producerNode.document.meta.outputSchema = './missing-schema.json';

    await expect(
      hydrateOutputSchemasFromProducerMetadata(root)
    ).rejects.toMatchObject({
      code: RuntimeErrorCode.MISSING_OUTPUT_SCHEMA,
    });
  });
});
