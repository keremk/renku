import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadYamlBlueprintTree,
  parseYamlBlueprintFile,
} from '../parsing/blueprint-loader/yaml-parser.js';
import { isRenkuError, RuntimeErrorCode } from '../errors/index.js';
import type { BlueprintTreeNode } from '../types.js';
import { CATALOG_ROOT, TEST_FIXTURES_ROOT } from '../../tests/catalog-paths.js';
import {
  collectNodesAndEdges,
  convertTreeToGraph,
  normalizeProducerName,
  resolveEdgeEndpoints,
  resolveEndpoint,
} from './viewer-parse-projection.js';

function makeTreeNode(document: Record<string, unknown>): BlueprintTreeNode {
  return {
    id: String((document.meta as { id: string }).id),
    namespacePath: [],
    document,
    children: new Map(),
    sourcePath: '/tmp/test-blueprint.yaml',
  } as unknown as BlueprintTreeNode;
}

async function loadFixtureRoot(
  fixtureFolder: string,
  filename: string
): Promise<BlueprintTreeNode> {
  const fixturePath = resolve(TEST_FIXTURES_ROOT, fixtureFolder, filename);
  const document = await parseYamlBlueprintFile(fixturePath);
  return {
    id: document.meta.id,
    namespacePath: [],
    document,
    children: new Map(),
    sourcePath: fixturePath,
  };
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
      producerImports: [
        { name: 'PromptProducer', producer: 'prompt/director' },
        { name: 'VideoProducer', producer: 'video/image-to-video', loop: 'scene' },
      ],
      artefacts: [{ name: 'FinalVideo', type: 'video' }],
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

    const nodes: ReturnType<typeof convertTreeToGraph>['nodes'] = [];
    const edges: ReturnType<typeof convertTreeToGraph>['edges'] = [];
    const conditions: ReturnType<typeof convertTreeToGraph>['conditions'] = [];

    collectNodesAndEdges(root, nodes, edges, conditions ?? []);

    const videoNode = nodes.find((node) => node.id === 'Producer:VideoProducer');
    expect(videoNode?.inputBindings).toHaveLength(1);

    const binding = videoNode?.inputBindings?.[0];
    expect(binding).toEqual(
      expect.objectContaining({
        from: 'PromptProducer.SceneVideoPrompt[scene]',
        to: 'VideoProducer[scene].Prompt',
        sourceType: 'producer',
        targetType: 'producer',
      })
    );
    expect(binding?.sourceEndpoint).toEqual(
      expect.objectContaining({
        kind: 'producer',
        producerName: 'PromptProducer',
        outputName: 'SceneVideoPrompt',
      })
    );
    expect(binding?.targetEndpoint).toEqual(
      expect.objectContaining({
        kind: 'producer',
        producerName: 'VideoProducer',
        inputName: 'Prompt',
      })
    );
    expect(binding?.targetEndpoint.loopSelectors).toEqual([
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

  it('marks composite producer-import nodes as non-runnable containers', () => {
    const root = makeTreeNode({
      meta: { id: 'ViewerParseComposite', name: 'Viewer Parse Composite' },
      inputs: [],
      producers: [],
      producerImports: [
        {
          name: 'CelebrityVideoProducer',
          path: './celebrity-video-producer.yaml',
        },
        {
          name: 'TimelineComposer',
          producer: 'video/timeline-compose',
        },
      ],
      artefacts: [],
      edges: [],
    });

    root.children.set(
      'CelebrityVideoProducer',
      makeTreeNode({
        meta: {
          id: 'CelebrityVideoProducer',
          name: 'Celebrity Video Producer',
          kind: 'blueprint',
        },
        inputs: [],
        producers: [],
        producerImports: [],
        artefacts: [],
        edges: [],
      })
    );
    root.children.set(
      'TimelineComposer',
      makeTreeNode({
        meta: {
          id: 'TimelineComposer',
          name: 'Timeline Composer',
          kind: 'producer',
        },
        inputs: [],
        producers: [],
        producerImports: [],
        artefacts: [],
        edges: [],
      })
    );

    const graph = convertTreeToGraph(root);
    const compositeNode = graph.nodes.find(
      (node) => node.id === 'Producer:CelebrityVideoProducer'
    );
    const leafNode = graph.nodes.find(
      (node) => node.id === 'Producer:TimelineComposer'
    );

    expect(compositeNode).toBeDefined();
    expect(compositeNode?.runnable).toBe(false);
    expect(leafNode).toBeDefined();
    expect(leafNode?.runnable).toBe(true);
  });

  it('marks real path-backed producer blueprints as runnable when catalog metadata uses kind: producer', async () => {
    const celebrityPath = resolve(
      CATALOG_ROOT,
      'blueprints/celebrity-then-now/celebrity-then-now.yaml'
    );
    const eduPath = resolve(
      CATALOG_ROOT,
      'blueprints/animated-edu-characters/animated-edu-characters.yaml'
    );

    const [{ root: celebrityRoot }, { root: eduRoot }] = await Promise.all([
      loadYamlBlueprintTree(celebrityPath, { catalogRoot: CATALOG_ROOT }),
      loadYamlBlueprintTree(eduPath, { catalogRoot: CATALOG_ROOT }),
    ]);

    const celebrityGraph = convertTreeToGraph(celebrityRoot);
    const eduGraph = convertTreeToGraph(eduRoot);

    const directorNode = celebrityGraph.nodes.find(
      (node) => node.id === 'Producer:DirectorProducer'
    );
    const compositeNode = celebrityGraph.nodes.find(
      (node) => node.id === 'Producer:CelebrityVideoProducer'
    );
    const eduScriptNode = eduGraph.nodes.find(
      (node) => node.id === 'Producer:EduScriptProducer'
    );

    expect(directorNode?.runnable).toBe(true);
    expect(eduScriptNode?.runnable).toBe(true);
    expect(compositeNode?.runnable).toBe(false);
  });
});

describe('viewer-parse-projection loop grouping', () => {
  it('derives loop groups for style-cartoon-alt fixture with outer-dimension grouping and countInputOffset', async () => {
    const root = await loadFixtureRoot(
      'viewer-parse-projection--style-cartoon-alt',
      'style-cartoon-alt.yaml'
    );

    const graph = convertTreeToGraph(root);

    const sceneGroup = graph.loopGroups?.find(
      (group) => group.primaryDimension === 'scene'
    );
    expect(sceneGroup).toBeDefined();
    expect(sceneGroup?.countInput).toBe('NumOfSegments');
    expect(sceneGroup?.countInputOffset).toBe(1);
    expect(sceneGroup?.members.map((member) => member.inputName)).toEqual(
      expect.arrayContaining(['SceneVideoPrompt', 'StoryboardImagePrompt'])
    );

    const characterGroup = graph.loopGroups?.find(
      (group) => group.primaryDimension === 'character'
    );
    expect(characterGroup).toBeDefined();
    expect(characterGroup?.members.map((member) => member.inputName)).toEqual(
      expect.arrayContaining(['CharacterDescriptions', 'CharacterImagePrompt'])
    );

    expect(graph.managedCountInputs).toEqual(
      expect.arrayContaining(['NumOfCharacters', 'NumOfSegments'])
    );

    const groupedInputNames = new Set(
      graph.loopGroups?.flatMap((group) =>
        group.members.map((member) => member.inputName)
      ) ?? []
    );
    expect(groupedInputNames.has('StyleReferenceImages')).toBe(false);
  });

  it('derives loop groups for celebrity-then-now fixture', async () => {
    const root = await loadFixtureRoot(
      'viewer-parse-projection--celebrity-then-now',
      'celebrity-then-now.yaml'
    );

    const graph = convertTreeToGraph(root);
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

  it('throws explicit error code when one input maps to multiple loop groups', async () => {
    const root = await loadFixtureRoot(
      'viewer-parse-projection--ambiguous-loop-group',
      'ambiguous-loop-group.yaml'
    );

    let caught: unknown;
    try {
      convertTreeToGraph(root);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(isRenkuError(caught)).toBe(true);
    if (!isRenkuError(caught)) {
      return;
    }

    expect(caught.code).toBe(RuntimeErrorCode.LOOP_GROUP_AMBIGUOUS_INPUT);
    expect(caught.message).toContain('DualPrompt');
  });
});
