import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadYamlBlueprintTree } from '../parsing/blueprint-loader/yaml-parser.js';
import { prepareBlueprintResolutionContext } from './blueprint-resolution-context.js';
import type { BlueprintTreeNode } from '../types.js';
import { CATALOG_ROOT, TEST_FIXTURES_ROOT } from '../../tests/catalog-paths.js';
import {
  collectNodesAndEdges,
  convertTreeToGraph,
  normalizeProducerName,
  resolveEdgeEndpoints,
  resolveEndpoint,
} from './viewer-parse-projection.js';

function makeTreeNode(
  document: Record<string, unknown>,
  namespacePath: string[] = []
): BlueprintTreeNode {
  return {
    id: String((document.meta as { id: string }).id),
    namespacePath,
    document,
    children: new Map(),
    sourcePath: '/tmp/test-blueprint.yaml',
  } as unknown as BlueprintTreeNode;
}

describe('viewer-parse-projection helpers', () => {
  it('normalizes producer names with selector suffixes', () => {
    expect(normalizeProducerName('VideoProducer[segment]')).toBe('VideoProducer');
    expect(normalizeProducerName('VideoProducer[segment-1]')).toBe(
      'VideoProducer'
    );
    expect(normalizeProducerName('ImageProducer[scene][shot]')).toBe(
      'ImageProducer'
    );
    expect(normalizeProducerName('SimpleProducer')).toBe('SimpleProducer');
  });

  it('resolves endpoint and edge endpoint kinds', () => {
    const inputNames = new Set(['Title', 'Count']);
    const producerNames = new Set(['AudioGen', 'VideoGen']);
    const artifactNames = new Set(['FinalVideo']);

    expect(
      resolveEndpoint('Title', inputNames, producerNames, artifactNames)
    ).toEqual({ type: 'input' });
    expect(
      resolveEndpoint('AudioGen.Output', inputNames, producerNames, artifactNames)
    ).toEqual({ type: 'producer', producer: 'AudioGen' });
    expect(
      resolveEndpoint('FinalVideo', inputNames, producerNames, artifactNames)
    ).toEqual({ type: 'output' });

    expect(
      resolveEdgeEndpoints(
        'AudioGen.Output',
        'VideoGen.Input',
        inputNames,
        producerNames,
        artifactNames
      )
    ).toEqual({
      sourceType: 'producer',
      sourceProducer: 'AudioGen',
      targetType: 'producer',
      targetProducer: 'VideoGen',
    });
  });

  it('attaches structured input/output bindings while collecting graph edges', () => {
    const root = makeTreeNode({
      meta: { id: 'id', name: 'test' },
      inputs: [{ name: 'Prompt', type: 'text', required: true }],
      producers: [],
      imports: [
        { name: 'PromptProducer', producer: 'prompt/director' },
        { name: 'VideoProducer', producer: 'video/image-to-video', loop: 'scene' },
      ],
      outputs: [{ name: 'FinalVideo', type: 'video' }],
      edges: [
        { from: 'Prompt', to: 'PromptProducer.Prompt' },
        {
          from: 'PromptProducer.SceneVideoPrompt[scene]',
          to: 'VideoProducer[scene].Prompt',
        },
        {
          from: 'VideoProducer[scene].GeneratedVideo',
          to: 'FinalVideo',
        },
      ],
    });

    root.children.set(
      'PromptProducer',
      makeTreeNode({
        meta: { id: 'PromptProducer', name: 'Prompt Producer', kind: 'producer' },
        inputs: [{ name: 'Prompt', type: 'text', required: true }],
        producers: [{ name: 'PromptProducer' }],
        imports: [],
        outputs: [{ name: 'SceneVideoPrompt', type: 'text' }],
        edges: [],
      }, ['PromptProducer'])
    );
    root.children.set(
      'VideoProducer',
      makeTreeNode({
        meta: { id: 'VideoProducer', name: 'Video Producer', kind: 'producer' },
        inputs: [{ name: 'Prompt', type: 'text', required: true }],
        producers: [{ name: 'VideoProducer' }],
        imports: [],
        outputs: [{ name: 'GeneratedVideo', type: 'video' }],
        edges: [],
      }, ['VideoProducer'])
    );

    const nodes: ReturnType<typeof convertTreeToGraph>['nodes'] = [];
    const edges: ReturnType<typeof convertTreeToGraph>['edges'] = [];
    const conditions: ReturnType<typeof convertTreeToGraph>['conditions'] = [];

    collectNodesAndEdges(root, nodes, edges, conditions ?? []);

    const videoNode = nodes.find((node) => node.id === 'Producer:VideoProducer');
    expect(videoNode?.inputBindings).toHaveLength(1);

    const binding = videoNode?.inputBindings?.[0];
    expect(binding).toEqual(
      expect.objectContaining({
        from: 'PromptProducer.SceneVideoPrompt',
        to: 'VideoProducer.Prompt',
        sourceType: 'producer',
        targetType: 'producer',
      })
    );
    expect(binding?.sourceEndpoint).toEqual(
      expect.objectContaining({
        kind: 'producer',
        producerId: 'Producer:PromptProducer',
        outputName: 'SceneVideoPrompt',
        artifactNodeId: 'Artifact:PromptProducer.SceneVideoPrompt',
      })
    );
    expect(binding?.targetEndpoint).toEqual(
      expect.objectContaining({
        kind: 'producer',
        producerId: 'Producer:VideoProducer',
        inputName: 'Prompt',
        nodeId: 'InputSource:VideoProducer.Prompt',
      })
    );
    expect(binding?.targetEndpoint.selectorPath).toEqual([
      expect.objectContaining({ kind: 'loop', symbol: 'scene', offset: 0 }),
    ]);

    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Producer:PromptProducer',
          target: 'Producer:VideoProducer',
        }),
      ])
    );
  });

  it('ignores collapsed self-edges from loop-carried producer dependencies', () => {
    const root = makeTreeNode({
      meta: { id: 'id', name: 'loop-continuity-test' },
      inputs: [{ name: 'Prompt', type: 'text', required: true }],
      producers: [],
      imports: [
        { name: 'ScriptProducer', producer: 'prompt/director' },
        { name: 'VideoProducer', producer: 'video/image-to-video', loop: 'scene' },
        { name: 'TimelineComposer', producer: 'composition/timeline-composer' },
      ],
      loops: [
        { name: 'scene', countInput: 'NumOfSegments' },
      ],
      outputs: [{ name: 'Timeline', type: 'json' }],
      edges: [
        { from: 'Prompt', to: 'ScriptProducer.Prompt' },
        {
          from: 'ScriptProducer.SceneVideoPrompt[scene]',
          to: 'VideoProducer[scene].Prompt',
        },
        {
          from: 'VideoProducer[scene-1].LastFrame',
          to: 'VideoProducer[scene].StartImage',
        },
        {
          from: 'VideoProducer[scene].GeneratedVideo',
          to: 'TimelineComposer.VideoSegments',
        },
        {
          from: 'TimelineComposer.Timeline',
          to: 'Timeline',
        },
      ],
    });

    root.children.set(
      'ScriptProducer',
      makeTreeNode({
        meta: { id: 'ScriptProducer', name: 'Script Producer', kind: 'producer' },
        inputs: [{ name: 'Prompt', type: 'text', required: true }],
        producers: [{ name: 'ScriptProducer' }],
        imports: [],
        outputs: [{ name: 'SceneVideoPrompt', type: 'text' }],
        edges: [],
      }, ['ScriptProducer'])
    );
    root.children.set(
      'VideoProducer',
      makeTreeNode({
        meta: { id: 'VideoProducer', name: 'Video Producer', kind: 'producer' },
        inputs: [
          { name: 'Prompt', type: 'text', required: true },
          { name: 'StartImage', type: 'image', required: false },
        ],
        producers: [{ name: 'VideoProducer' }],
        imports: [],
        outputs: [
          { name: 'GeneratedVideo', type: 'video' },
          { name: 'LastFrame', type: 'image' },
        ],
        edges: [],
      }, ['VideoProducer'])
    );
    root.children.set(
      'TimelineComposer',
      makeTreeNode({
        meta: {
          id: 'TimelineComposer',
          name: 'Timeline Composer',
          kind: 'producer',
        },
        inputs: [{ name: 'VideoSegments', type: 'video', required: false }],
        producers: [{ name: 'TimelineComposer' }],
        imports: [],
        outputs: [{ name: 'Timeline', type: 'json' }],
        edges: [],
      }, ['TimelineComposer'])
    );

    const graph = convertTreeToGraph(root);

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Producer:ScriptProducer',
          target: 'Producer:VideoProducer',
        }),
        expect.objectContaining({
          source: 'Producer:VideoProducer',
          target: 'Producer:TimelineComposer',
        }),
      ])
    );
    expect(graph.edges).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Producer:VideoProducer',
          target: 'Producer:VideoProducer',
        }),
      ])
    );
    expect(graph.layerCount).toBe(3);
    expect(graph.layerAssignments).toMatchObject({
      'Producer:ScriptProducer': 0,
      'Producer:VideoProducer': 1,
      'Producer:TimelineComposer': 2,
    });
  });

  it('preserves named if conditions on bindings and rendered edges', () => {
    const root = makeTreeNode({
      meta: { id: 'id', name: 'conditional-test' },
      inputs: [{ name: 'Script', type: 'text', required: true }],
      producers: [],
      imports: [
        { name: 'AudioProducer', producer: 'audio/text-to-speech' },
        { name: 'TimelineComposer', producer: 'video/timeline-compose' },
      ],
      outputs: [{ name: 'Timeline', type: 'json' }],
      conditions: {
        NeedsNarration: {
          when: 'Artifact:AudioProducer.GeneratedAudio',
          is: true,
        },
      },
      edges: [
        { from: 'Script', to: 'AudioProducer.Text' },
        {
          from: 'AudioProducer.GeneratedAudio',
          to: 'TimelineComposer.AudioSegments',
          if: 'NeedsNarration',
        },
        {
          from: 'TimelineComposer.Timeline',
          to: 'Timeline',
        },
      ],
    });

    root.children.set(
      'AudioProducer',
      makeTreeNode(
        {
          meta: { id: 'AudioProducer', name: 'Audio Producer', kind: 'producer' },
          inputs: [{ name: 'Text', type: 'text', required: true }],
          producers: [{ name: 'AudioProducer' }],
          imports: [],
          outputs: [{ name: 'GeneratedAudio', type: 'audio' }],
          edges: [],
        },
        ['AudioProducer']
      )
    );
    root.children.set(
      'TimelineComposer',
      makeTreeNode(
        {
          meta: {
            id: 'TimelineComposer',
            name: 'Timeline Composer',
            kind: 'producer',
          },
          inputs: [{ name: 'AudioSegments', type: 'audio', required: false }],
          producers: [{ name: 'TimelineComposer' }],
          imports: [],
          outputs: [{ name: 'Timeline', type: 'json' }],
          edges: [],
        },
        ['TimelineComposer']
      )
    );

    const graph = convertTreeToGraph(root);
    const timelineNode = graph.nodes.find(
      (node) => node.id === 'Producer:TimelineComposer'
    );
    const conditionalBinding = timelineNode?.inputBindings?.find(
      (binding) => binding.from === 'AudioProducer.GeneratedAudio'
    );
    const conditionalEdge = graph.edges.find(
      (edge) =>
        edge.source === 'Producer:AudioProducer' &&
        edge.target === 'Producer:TimelineComposer'
    );

    expect(conditionalBinding).toEqual(
      expect.objectContaining({
        isConditional: true,
        conditionName: 'NeedsNarration',
      })
    );
    expect(conditionalEdge).toEqual(
      expect.objectContaining({
        isConditional: true,
        conditionName: 'NeedsNarration',
      })
    );
  });

  it('preserves named if conditions on root input and output edges', () => {
    const root = makeTreeNode({
      meta: { id: 'id', name: 'root-conditional-test' },
      inputs: [{ name: 'Prompt', type: 'text', required: true }],
      producers: [],
      imports: [{ name: 'ImageProducer', producer: 'image/text-to-image' }],
      outputs: [{ name: 'HeroImage', type: 'image' }],
      conditions: {
        ShouldGenerateImage: {
          when: 'Input:Prompt',
          is: true,
        },
        ShouldExportImage: {
          when: 'Artifact:ImageProducer.GeneratedImage',
          is: true,
        },
      },
      edges: [
        {
          from: 'Prompt',
          to: 'ImageProducer.Prompt',
          if: 'ShouldGenerateImage',
        },
        {
          from: 'ImageProducer.GeneratedImage',
          to: 'HeroImage',
          if: 'ShouldExportImage',
        },
      ],
    });

    root.children.set(
      'ImageProducer',
      makeTreeNode(
        {
          meta: { id: 'ImageProducer', name: 'Image Producer', kind: 'producer' },
          inputs: [{ name: 'Prompt', type: 'text', required: true }],
          producers: [{ name: 'ImageProducer' }],
          imports: [],
          outputs: [{ name: 'GeneratedImage', type: 'image' }],
          edges: [],
        },
        ['ImageProducer']
      )
    );

    const graph = convertTreeToGraph(root);
    const producerNode = graph.nodes.find(
      (node) => node.id === 'Producer:ImageProducer'
    );
    const conditionalInputBinding = producerNode?.inputBindings?.find(
      (binding) => binding.from === 'Input.Prompt'
    );
    const conditionalOutputBinding = producerNode?.outputBindings?.find(
      (binding) => binding.to === 'Output.HeroImage'
    );
    const conditionalInputEdge = graph.edges.find(
      (edge) =>
        edge.source === 'Inputs' && edge.target === 'Producer:ImageProducer'
    );
    const conditionalOutputEdge = graph.edges.find(
      (edge) =>
        edge.source === 'Producer:ImageProducer' && edge.target === 'Outputs'
    );

    expect(conditionalInputBinding).toEqual(
      expect.objectContaining({
        isConditional: true,
        conditionName: 'ShouldGenerateImage',
      })
    );
    expect(conditionalOutputBinding).toEqual(
      expect.objectContaining({
        isConditional: true,
        conditionName: 'ShouldExportImage',
      })
    );
    expect(conditionalInputEdge).toEqual(
      expect.objectContaining({
        isConditional: true,
        conditionName: 'ShouldGenerateImage',
      })
    );
    expect(conditionalOutputEdge).toEqual(
      expect.objectContaining({
        isConditional: true,
        conditionName: 'ShouldExportImage',
      })
    );
  });

  it('flattens composite producers into leaf producer nodes for real blueprints', async () => {
    const celebrityPath = resolve(
      CATALOG_ROOT,
      'blueprints/celebrity-then-now/celebrity-then-now.yaml'
    );
    const { root: celebrityTree } = await loadYamlBlueprintTree(celebrityPath, {
      catalogRoot: CATALOG_ROOT,
    });
    const celebrityContext = await prepareBlueprintResolutionContext({
      root: celebrityTree,
      schemaSource: { kind: 'producer-metadata' },
    });

    const celebrityGraph = convertTreeToGraph(celebrityContext.root);
    const producerNodeIds = celebrityGraph.nodes
      .filter((node) => node.type === 'producer')
      .map((node) => node.id);

    expect(producerNodeIds).toEqual(
      expect.arrayContaining([
        'Producer:DirectorProducer',
        'Producer:ThenImageProducer',
        'Producer:NowImageProducer',
        'Producer:CelebrityVideoProducer.TogetherImageProducer',
        'Producer:CelebrityVideoProducer.MeetingVideoProducer',
        'Producer:CelebrityVideoProducer.TransitionVideoProducer',
        'Producer:CelebrityVideoProducer.VideoStitcher',
        'Producer:MusicProducer',
        'Producer:TimelineComposer',
        'Producer:VideoExporter',
      ])
    );
    expect(producerNodeIds).not.toContain('Producer:CelebrityVideoProducer');
    expect(celebrityGraph.layerCount).toBe(7);
  });

  it('keeps looped historical-story topology acyclic at the alias layer', async () => {
    const historicalStoryPath = resolve(
      CATALOG_ROOT,
      'blueprints/short-video-documentary/historical-story.yaml'
    );
    const { root } = await loadYamlBlueprintTree(historicalStoryPath, {
      catalogRoot: CATALOG_ROOT,
    });
    const context = await prepareBlueprintResolutionContext({
      root,
      schemaSource: { kind: 'producer-metadata' },
    });

    const graph = convertTreeToGraph(context.root);

    expect(graph.edges).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Producer:VideoProducer',
          target: 'Producer:VideoProducer',
        }),
      ])
    );
    expect(graph.layerCount).toBe(6);
    expect(graph.layerAssignments).toMatchObject({
      'Producer:HistoryScriptwriter': 0,
      'Producer:InitialImageProducer': 1,
      'Producer:VideoProducer': 2,
      'Producer:TimelineComposer': 3,
      'Producer:TranscriptionProducer': 4,
      'Producer:VideoExporter': 5,
    });
  });
});

describe('viewer-parse-projection loop grouping', () => {
  it('derives loop groups for celebrity-then-now fixture', async () => {
    const celebrityPath = resolve(
      TEST_FIXTURES_ROOT,
      'viewer-parse-projection--celebrity-then-now',
      'celebrity-then-now.yaml'
    );
    const { root: rawRoot } = await loadYamlBlueprintTree(celebrityPath, {
      catalogRoot: CATALOG_ROOT,
    });
    const context = await prepareBlueprintResolutionContext({
      root: rawRoot,
      schemaSource: { kind: 'producer-metadata' },
    });

    const graph = convertTreeToGraph(context.root);
    const segmentGroup = graph.loopGroups?.find(
      (group) => group.primaryDimension === 'segment'
    );

    expect(segmentGroup).toBeDefined();
    expect(segmentGroup?.countInput).toBe('NumOfSegments');
    expect(segmentGroup?.members.map((member) => member.inputName)).toEqual(
      expect.arrayContaining(['CelebrityThenImages', 'CelebrityNowImages'])
    );
    expect(
      segmentGroup?.members.map((member) => member.inputName)
    ).not.toContain('SettingImage');
  });
});
