import { describe, expect, it } from 'vitest';
import type {
  BlueprintArtefactDefinition,
  BlueprintDocument,
  BlueprintEdgeDefinition,
  BlueprintInputDefinition,
  BlueprintLoopDefinition,
  BlueprintTreeNode,
  ProducerConfig,
} from '../types.js';
import { buildBlueprintGraph } from './canonical-graph.js';

describe('buildBlueprintGraph', () => {
  it('flattens nested blueprints and tracks namespace dimensions', () => {
    const bundle = createFixtureTree();
    const graph = buildBlueprintGraph(bundle);

    const producerNode = graph.nodes.find((node) =>
      node.id.endsWith('TextToImageProducer')
    );
    expect(producerNode?.dimensions).toHaveLength(2);
    expect(new Set(producerNode?.dimensions ?? []).size).toBe(2);

    const artefactNode = graph.nodes.find((node) =>
      node.id.endsWith('NarrationScript')
    );
    expect(artefactNode?.dimensions).toHaveLength(1);

    const promptNode = graph.nodes.find((node) =>
      node.id.endsWith('ImagePrompt')
    );
    expect(promptNode?.dimensions).toHaveLength(2);
    expect(new Set(promptNode?.dimensions ?? []).size).toBe(2);

    const finalEdge = graph.edges.find(
      (edge) => edge.to.nodeId === 'SegmentImage'
    );
    expect(finalEdge?.from.dimensions).toHaveLength(2);
    expect(finalEdge?.to.dimensions).toHaveLength(2);

    expect(
      readNamespaceSymbols(graph.namespaceDimensions.get('ImageGenerator'))
    ).toEqual(['i', 'j']);
    expect(
      readNamespaceSymbols(
        graph.namespaceDimensions.get('ImagePromptGenerator')
      )
    ).toEqual(['i']);
  });
});

describe('collectLoopDefinitions', () => {
  it('collects loops from root blueprint', () => {
    const doc = makeBlueprintDocument(
      'Test',
      [{ name: 'NumOfSegments', type: 'int', required: true }],
      [{ name: 'Script', type: 'array', countInput: 'NumOfSegments' }],
      [],
      [],
      [{ name: 'i', countInput: 'NumOfSegments' }]
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    // Root loops are keyed by empty string (empty namespace path)
    const rootLoops = graph.loops.get('');
    expect(rootLoops).toBeDefined();
    expect(rootLoops).toHaveLength(1);
    expect(rootLoops![0].name).toBe('i');
    expect(rootLoops![0].countInput).toBe('NumOfSegments');
  });

  it('collects loops from child blueprints', () => {
    const childDoc = makeBlueprintDocument(
      'ChildBlueprint',
      [{ name: 'Count', type: 'int', required: true }],
      [{ name: 'Item', type: 'array', countInput: 'Count' }],
      [],
      [],
      [{ name: 'j', countInput: 'Count' }]
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [{ name: 'RootInput', type: 'string', required: true }],
      [],
      [],
      []
    );

    const tree = makeTreeNode(
      rootDoc,
      [],
      new Map([['ChildBlueprint', makeTreeNode(childDoc, ['ChildBlueprint'])]])
    );

    const graph = buildBlueprintGraph(tree);

    // Child loops are keyed by namespace path
    const childLoops = graph.loops.get('ChildBlueprint');
    expect(childLoops).toBeDefined();
    expect(childLoops).toHaveLength(1);
    expect(childLoops![0].name).toBe('j');
    expect(childLoops![0].countInput).toBe('Count');
  });

  it('collects loops from nested blueprints at multiple levels', () => {
    const grandchildDoc = makeBlueprintDocument(
      'Grandchild',
      [{ name: 'ImageCount', type: 'int', required: true }],
      [],
      [],
      [],
      [{ name: 'k', countInput: 'ImageCount' }]
    );

    const childDoc = makeBlueprintDocument(
      'Child',
      [{ name: 'SegmentCount', type: 'int', required: true }],
      [],
      [],
      [],
      [{ name: 'j', countInput: 'SegmentCount' }]
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [{ name: 'ChapterCount', type: 'int', required: true }],
      [],
      [],
      [],
      [{ name: 'i', countInput: 'ChapterCount' }]
    );

    const grandchildNode = makeTreeNode(grandchildDoc, ['Child', 'Grandchild']);
    const childNode: BlueprintTreeNode = {
      ...makeTreeNode(childDoc, ['Child']),
      children: new Map([['Grandchild', grandchildNode]]),
    };
    const tree: BlueprintTreeNode = {
      ...makeTreeNode(rootDoc, []),
      children: new Map([['Child', childNode]]),
    };

    const graph = buildBlueprintGraph(tree);

    // Verify all three levels of loops are collected
    const rootLoops = graph.loops.get('');
    expect(rootLoops).toBeDefined();
    expect(rootLoops![0].name).toBe('i');

    const childLoops = graph.loops.get('Child');
    expect(childLoops).toBeDefined();
    expect(childLoops![0].name).toBe('j');

    const grandchildLoops = graph.loops.get('Child.Grandchild');
    expect(grandchildLoops).toBeDefined();
    expect(grandchildLoops![0].name).toBe('k');
  });

  it('handles blueprints without loops', () => {
    const doc = makeBlueprintDocument(
      'NoLoops',
      [{ name: 'Input', type: 'string', required: true }],
      [],
      [],
      []
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    // No loops should be collected
    expect(graph.loops.size).toBe(0);
  });

  it('handles multiple loops in the same blueprint', () => {
    const doc = makeBlueprintDocument(
      'MultiLoop',
      [
        { name: 'SegmentCount', type: 'int', required: true },
        { name: 'ImageCount', type: 'int', required: true },
      ],
      [],
      [],
      [],
      [
        { name: 'i', countInput: 'SegmentCount' },
        { name: 'j', countInput: 'ImageCount' },
      ]
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    const loops = graph.loops.get('');
    expect(loops).toBeDefined();
    expect(loops).toHaveLength(2);
    expect(loops!.map((l) => l.name)).toContain('i');
    expect(loops!.map((l) => l.name)).toContain('j');
  });

  it('preserves countInputOffset in collected loops', () => {
    const doc = makeBlueprintDocument(
      'WithOffset',
      [{ name: 'Count', type: 'int', required: true }],
      [],
      [],
      [],
      [{ name: 'i', countInput: 'Count', countInputOffset: 1 }]
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    const loops = graph.loops.get('');
    expect(loops).toBeDefined();
    expect(loops![0].countInputOffset).toBe(1);
  });
});

function readNamespaceSymbols(
  entries: Array<{ raw: string }> | undefined
): string[] | undefined {
  return entries?.map((entry) => entry.raw);
}

function createFixtureTree(): BlueprintTreeNode {
  const scriptBlueprint = makeBlueprintDocument(
    'ScriptGenerator',
    [
      { name: 'InquiryPrompt', type: 'string', required: true },
      { name: 'NumOfSegments', type: 'int', required: true },
    ],
    [
      { name: 'NarrationScript', type: 'array', countInput: 'NumOfSegments' },
      { name: 'MovieSummary', type: 'string' },
    ],
    [{ name: 'ScriptProducer', provider: 'openai', model: 'gpt' }],
    [
      { from: 'InquiryPrompt', to: 'ScriptProducer' },
      { from: 'NumOfSegments', to: 'ScriptProducer' },
      { from: 'ScriptProducer', to: 'NarrationScript[i]' },
      { from: 'ScriptProducer', to: 'MovieSummary' },
    ]
  );

  const imagePromptBlueprint = makeBlueprintDocument(
    'ImagePromptGenerator',
    [
      { name: 'NarrativeText', type: 'string', required: true },
      { name: 'OverallSummary', type: 'string', required: true },
      { name: 'NumOfImagesPerNarrative', type: 'int', required: true },
    ],
    [
      {
        name: 'ImagePrompt',
        type: 'array',
        countInput: 'NumOfImagesPerNarrative',
      },
    ],
    [{ name: 'ImagePromptProducer', provider: 'openai', model: 'gpt' }],
    [
      { from: 'NarrativeText', to: 'ImagePromptProducer' },
      { from: 'OverallSummary', to: 'ImagePromptProducer' },
      { from: 'NumOfImagesPerNarrative', to: 'ImagePromptProducer' },
      { from: 'ImagePromptProducer', to: 'ImagePrompt[j]' },
    ]
  );

  const imageGeneratorBlueprint = makeBlueprintDocument(
    'ImageGenerator',
    [
      { name: 'Prompt', type: 'string', required: true },
      { name: 'Size', type: 'string', required: false },
    ],
    [{ name: 'SegmentImage', type: 'image' }],
    [{ name: 'TextToImageProducer', provider: 'replicate', model: 'xyz' }],
    [
      { from: 'Prompt', to: 'TextToImageProducer' },
      { from: 'Size', to: 'TextToImageProducer' },
      { from: 'TextToImageProducer', to: 'SegmentImage' },
    ]
  );

  const rootDocument = makeBlueprintDocument(
    'ImageOnly',
    [
      { name: 'InquiryPrompt', type: 'string', required: true },
      { name: 'NumOfSegments', type: 'int', required: true },
      { name: 'NumOfImagesPerNarrative', type: 'int', required: true },
      { name: 'Size', type: 'string', required: false },
    ],
    [{ name: 'SegmentImage', type: 'array' }],
    [],
    [
      { from: 'InquiryPrompt', to: 'ScriptGenerator.InquiryPrompt' },
      { from: 'NumOfSegments', to: 'ScriptGenerator.NumOfSegments' },
      {
        from: 'ScriptGenerator.NarrationScript[i]',
        to: 'ImagePromptGenerator[i].NarrativeText',
      },
      {
        from: 'ScriptGenerator.MovieSummary',
        to: 'ImagePromptGenerator[i].OverallSummary',
      },
      {
        from: 'NumOfImagesPerNarrative',
        to: 'ImagePromptGenerator[i].NumOfImagesPerNarrative',
      },
      {
        from: 'ImagePromptGenerator[i].ImagePrompt[j]',
        to: 'ImageGenerator[i][j].Prompt',
      },
      { from: 'Size', to: 'ImageGenerator[i][j].Size' },
      { from: 'ImageGenerator[i][j].SegmentImage', to: 'SegmentImage[i][j]' },
    ]
  );

  return makeTreeNode(
    rootDocument,
    [],
    new Map<string, BlueprintTreeNode>([
      ['ScriptGenerator', makeTreeNode(scriptBlueprint, ['ScriptGenerator'])],
      [
        'ImagePromptGenerator',
        makeTreeNode(imagePromptBlueprint, ['ImagePromptGenerator']),
      ],
      [
        'ImageGenerator',
        makeTreeNode(imageGeneratorBlueprint, ['ImageGenerator']),
      ],
    ])
  );
}

function makeBlueprintDocument(
  id: string,
  inputs: BlueprintInputDefinition[],
  artefacts: BlueprintArtefactDefinition[],
  producers: ProducerConfig[],
  edges: BlueprintEdgeDefinition[],
  loops?: BlueprintLoopDefinition[]
): BlueprintDocument {
  return {
    meta: { id, name: id },
    inputs,
    artefacts,
    producers,
    producerImports: [],
    edges,
    loops,
  };
}

function makeTreeNode(
  document: BlueprintDocument,
  namespacePath: string[],
  children: Map<string, BlueprintTreeNode> = new Map()
): BlueprintTreeNode {
  return {
    id: document.meta.id,
    namespacePath,
    document,
    children,
    sourcePath: '/test/mock-blueprint.yaml',
  };
}

describe('edge cases', () => {
  it('handles empty blueprint with no nodes', () => {
    const doc = makeBlueprintDocument('Empty', [], [], [], []);

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it('handles blueprint with only artifacts (no producers)', () => {
    const doc = makeBlueprintDocument(
      'ArtefactsOnly',
      [],
      [{ name: 'Output', type: 'string' }],
      [],
      []
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    const artefactNodes = graph.nodes.filter((n) => n.type === 'Artifact');
    expect(artefactNodes).toHaveLength(1);
  });

  it('correctly tracks dimensions from multiple levels of nesting', () => {
    // Deep nesting: Root -> Level1 -> Level2 with dimensions at each level
    const level2Doc = makeBlueprintDocument(
      'Level2',
      [{ name: 'L2Count', type: 'int', required: true }],
      [{ name: 'L2Output', type: 'array', countInput: 'L2Count' }],
      [{ name: 'L2Producer', provider: 'openai', model: 'gpt' }],
      [
        { from: 'L2Count', to: 'L2Producer' },
        { from: 'L2Producer', to: 'L2Output[k]' },
      ],
      [{ name: 'k', countInput: 'L2Count' }]
    );

    const level1Doc = makeBlueprintDocument(
      'Level1',
      [{ name: 'L1Count', type: 'int', required: true }],
      [],
      [],
      [],
      [{ name: 'j', countInput: 'L1Count' }]
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [{ name: 'RootCount', type: 'int', required: true }],
      [],
      [],
      [],
      [{ name: 'i', countInput: 'RootCount' }]
    );

    const level2Node = makeTreeNode(level2Doc, ['Level1', 'Level2']);
    const level1Node: BlueprintTreeNode = {
      ...makeTreeNode(level1Doc, ['Level1']),
      children: new Map([['Level2', level2Node]]),
    };
    const tree: BlueprintTreeNode = {
      ...makeTreeNode(rootDoc, []),
      children: new Map([['Level1', level1Node]]),
    };

    const graph = buildBlueprintGraph(tree);

    // Verify all three levels of loops are tracked
    expect(graph.loops.get('')?.[0]?.name).toBe('i');
    expect(graph.loops.get('Level1')?.[0]?.name).toBe('j');
    expect(graph.loops.get('Level1.Level2')?.[0]?.name).toBe('k');
  });

  it('creates nodes for string-type artifacts', () => {
    const doc = makeBlueprintDocument(
      'StringArtifact',
      [{ name: 'Prompt', type: 'string', required: true }],
      [{ name: 'Summary', type: 'string' }],
      [{ name: 'Producer', provider: 'openai', model: 'gpt' }],
      [
        { from: 'Prompt', to: 'Producer' },
        { from: 'Producer', to: 'Summary' },
      ]
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    // Check that artifact nodes exist (using endsWith for flexible ID format)
    const summaryNode = graph.nodes.find(
      (n) => n.type === 'Artifact' && n.id.endsWith('Summary')
    );
    expect(summaryNode).toBeDefined();
    expect(summaryNode?.type).toBe('Artifact');
    expect(summaryNode?.dimensions).toHaveLength(0); // string artifacts have no dimensions
  });

  it('handles edges referencing nested namespace paths', () => {
    // Test edge references like "Namespace.Artifact" in parent blueprint
    const childDoc = makeBlueprintDocument(
      'Child',
      [{ name: 'ChildInput', type: 'string', required: true }],
      [{ name: 'ChildOutput', type: 'string' }],
      [{ name: 'ChildProducer', provider: 'openai', model: 'gpt' }],
      [
        { from: 'ChildInput', to: 'ChildProducer' },
        { from: 'ChildProducer', to: 'ChildOutput' },
      ]
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [{ name: 'RootInput', type: 'string', required: true }],
      [{ name: 'FinalOutput', type: 'string' }],
      [],
      [
        { from: 'RootInput', to: 'Child.ChildInput' },
        { from: 'Child.ChildOutput', to: 'FinalOutput' },
      ]
    );

    const tree: BlueprintTreeNode = {
      ...makeTreeNode(rootDoc, []),
      children: new Map([['Child', makeTreeNode(childDoc, ['Child'])]]),
    };

    const graph = buildBlueprintGraph(tree);

    // Verify edges connecting root to child namespace
    const edgeToChild = graph.edges.find(
      (e) => e.from.nodeId === 'RootInput' && e.to.nodeId === 'Child.ChildInput'
    );
    expect(edgeToChild).toBeDefined();

    const edgeFromChild = graph.edges.find(
      (e) =>
        e.from.nodeId === 'Child.ChildOutput' && e.to.nodeId === 'FinalOutput'
    );
    expect(edgeFromChild).toBeDefined();
  });

  it('parses dimension selectors with offsets', () => {
    // Test edges with dimension offsets like [i+1], [i-1]
    const doc = makeBlueprintDocument(
      'WithOffset',
      [{ name: 'Count', type: 'int', required: true }],
      [
        { name: 'Current', type: 'array', countInput: 'Count' },
        { name: 'Next', type: 'array', countInput: 'Count' },
      ],
      [{ name: 'Producer', provider: 'openai', model: 'gpt' }],
      [
        { from: 'Count', to: 'Producer' },
        { from: 'Producer', to: 'Current[i]' },
        { from: 'Current[i]', to: 'Next[i+1]' },
      ],
      [{ name: 'i', countInput: 'Count' }]
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    // Find the edge with offset (Current -> Next)
    const offsetEdge = graph.edges.find(
      (e) => e.from.nodeId === 'Current' && e.to.nodeId === 'Next'
    );
    expect(offsetEdge).toBeDefined();
    expect(offsetEdge?.to.dimensions).toHaveLength(1);

    // Verify there are nodes for both artifacts
    const currentNode = graph.nodes.find((n) => n.id.endsWith('Current'));
    const nextNode = graph.nodes.find((n) => n.id.endsWith('Next'));
    expect(currentNode).toBeDefined();
    expect(nextNode).toBeDefined();
  });

  it('handles producer with multiple output artifacts', () => {
    const doc = makeBlueprintDocument(
      'MultiOutput',
      [{ name: 'Input', type: 'string', required: true }],
      [
        { name: 'Output1', type: 'string' },
        { name: 'Output2', type: 'string' },
        { name: 'Output3', type: 'string' },
      ],
      [{ name: 'Producer', provider: 'openai', model: 'gpt' }],
      [
        { from: 'Input', to: 'Producer' },
        { from: 'Producer', to: 'Output1' },
        { from: 'Producer', to: 'Output2' },
        { from: 'Producer', to: 'Output3' },
      ]
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    // All three outputs should exist
    expect(graph.nodes.filter((n) => n.type === 'Artifact')).toHaveLength(3);

    // All three edges from producer to outputs should exist
    const producerEdges = graph.edges.filter(
      (e) => e.from.nodeId === 'Producer'
    );
    expect(producerEdges).toHaveLength(3);
  });

  it('handles array artifacts with multiple dimensions', () => {
    const doc = makeBlueprintDocument(
      'MultiDim',
      [
        { name: 'Rows', type: 'int', required: true },
        { name: 'Cols', type: 'int', required: true },
      ],
      [{ name: 'Grid', type: 'array', countInput: 'Cols' }],
      [{ name: 'Producer', provider: 'openai', model: 'gpt' }],
      [
        { from: 'Rows', to: 'Producer' },
        { from: 'Cols', to: 'Producer' },
        { from: 'Producer', to: 'Grid[i][j]' },
      ],
      [
        { name: 'i', countInput: 'Rows' },
        { name: 'j', countInput: 'Cols' },
      ]
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    // Grid artifact should have 2 dimensions
    const gridNode = graph.nodes.find(
      (n) => n.type === 'Artifact' && n.id.endsWith('Grid')
    );
    expect(gridNode).toBeDefined();
    expect(gridNode?.dimensions).toHaveLength(2);
  });

  it('handles circular edges gracefully (artifact depends on itself via producer)', () => {
    // A producer that takes its own output as input (for iterative processing)
    const doc = makeBlueprintDocument(
      'Circular',
      [{ name: 'Initial', type: 'string', required: true }],
      [{ name: 'Result', type: 'string' }],
      [{ name: 'IterativeProducer', provider: 'openai', model: 'gpt' }],
      [
        { from: 'Initial', to: 'IterativeProducer' },
        { from: 'IterativeProducer', to: 'Result' },
        // This edge creates a potential cycle
        { from: 'Result', to: 'IterativeProducer' },
      ]
    );

    const tree = makeTreeNode(doc, []);

    // This should not throw - graph building should handle cycles
    const graph = buildBlueprintGraph(tree);

    // Both edges should exist
    const resultToProducer = graph.edges.find(
      (e) => e.from.nodeId === 'Result' && e.to.nodeId === 'IterativeProducer'
    );
    expect(resultToProducer).toBeDefined();
  });

  it('creates separate Input nodes for constant-indexed collection elements', () => {
    // Test scenario: Video producer with collection input, different artifacts
    // connected to different elements via constant indices
    const videoProducerDoc = makeBlueprintDocument(
      'VideoProducer',
      [
        { name: 'ReferenceImages', type: 'collection', required: false },
        { name: 'Prompt', type: 'string', required: true },
      ],
      [{ name: 'GeneratedVideo', type: 'video' }],
      [{ name: 'VideoGenerator', provider: 'fal-ai', model: 'video' }],
      [
        { from: 'Prompt', to: 'VideoGenerator' },
        { from: 'ReferenceImages', to: 'VideoGenerator' },
        { from: 'VideoGenerator', to: 'GeneratedVideo' },
      ]
    );

    const imageProducerDoc = makeBlueprintDocument(
      'ImageProducer',
      [{ name: 'Prompt', type: 'string', required: true }],
      [{ name: 'GeneratedImage', type: 'image' }],
      [{ name: 'ImageGenerator', provider: 'fal-ai', model: 'image' }],
      [
        { from: 'Prompt', to: 'ImageGenerator' },
        { from: 'ImageGenerator', to: 'GeneratedImage' },
      ]
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [
        { name: 'CharacterPrompt', type: 'string', required: true },
        { name: 'ProductPrompt', type: 'string', required: true },
        { name: 'VideoPrompt', type: 'string', required: true },
        { name: 'NumClips', type: 'int', required: true },
      ],
      [{ name: 'FinalVideo', type: 'video' }],
      [],
      [
        // Image producers get prompts
        { from: 'CharacterPrompt', to: 'CharacterImage.Prompt' },
        { from: 'ProductPrompt', to: 'ProductImage.Prompt' },
        // Video producer gets its prompts (for each clip)
        { from: 'VideoPrompt', to: 'VideoProducer[clip].Prompt' },
        // Constant-indexed connections: different artifacts to different collection elements
        {
          from: 'CharacterImage.GeneratedImage',
          to: 'VideoProducer[clip].ReferenceImages[0]',
        },
        {
          from: 'ProductImage.GeneratedImage',
          to: 'VideoProducer[clip].ReferenceImages[1]',
        },
        // Output
        { from: 'VideoProducer[clip].GeneratedVideo', to: 'FinalVideo[clip]' },
      ],
      [{ name: 'clip', countInput: 'NumClips' }]
    );

    const tree: BlueprintTreeNode = {
      ...makeTreeNode(rootDoc, []),
      children: new Map([
        ['CharacterImage', makeTreeNode(imageProducerDoc, ['CharacterImage'])],
        ['ProductImage', makeTreeNode(imageProducerDoc, ['ProductImage'])],
        ['VideoProducer', makeTreeNode(videoProducerDoc, ['VideoProducer'])],
      ]),
    };

    const graph = buildBlueprintGraph(tree);

    // Verify that constant-indexed Input nodes are created
    const refImagesNodes = graph.nodes.filter(
      (n) => n.type === 'InputSource' && n.id.includes('ReferenceImages')
    );

    // Should have separate nodes for ReferenceImages[0] and ReferenceImages[1]
    const node0 = refImagesNodes.find((n) =>
      n.id.includes('ReferenceImages[0]')
    );
    const node1 = refImagesNodes.find((n) =>
      n.id.includes('ReferenceImages[1]')
    );
    expect(node0).toBeDefined();
    expect(node1).toBeDefined();

    // Verify edges target the correct constant-indexed nodes
    const edgeToRef0 = graph.edges.find(
      (e) =>
        e.from.nodeId.includes('CharacterImage.GeneratedImage') &&
        e.to.nodeId.includes('ReferenceImages[0]')
    );
    const edgeToRef1 = graph.edges.find(
      (e) =>
        e.from.nodeId.includes('ProductImage.GeneratedImage') &&
        e.to.nodeId.includes('ReferenceImages[1]')
    );
    expect(edgeToRef0).toBeDefined();
    expect(edgeToRef1).toBeDefined();

    // The constant indices should NOT be in the selectors (they're part of the node name)
    // So the selectors should only contain the [clip] dimension selector
    expect(
      edgeToRef0?.to.selectors?.filter((s) => s?.kind === 'const')
    ).toHaveLength(0);
    expect(
      edgeToRef1?.to.selectors?.filter((s) => s?.kind === 'const')
    ).toHaveLength(0);
  });

  it('captures symbolic collection selectors for cross-dimension indexed inputs', () => {
    const videoProducerDoc = makeBlueprintDocument(
      'VideoProducer',
      [
        { name: 'ReferenceImages', type: 'collection', required: false },
        { name: 'Prompt', type: 'string', required: true },
      ],
      [{ name: 'GeneratedVideo', type: 'video' }],
      [{ name: 'VideoGenerator', provider: 'fal-ai', model: 'video' }],
      [
        { from: 'Prompt', to: 'VideoGenerator' },
        { from: 'ReferenceImages', to: 'VideoGenerator' },
        { from: 'VideoGenerator', to: 'GeneratedVideo' },
      ]
    );

    const imageProducerDoc = makeBlueprintDocument(
      'ImageProducer',
      [{ name: 'Prompt', type: 'string', required: true }],
      [{ name: 'GeneratedImage', type: 'image' }],
      [{ name: 'ImageGenerator', provider: 'fal-ai', model: 'image' }],
      [
        { from: 'Prompt', to: 'ImageGenerator' },
        { from: 'ImageGenerator', to: 'GeneratedImage' },
      ]
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [
        { name: 'CharacterPrompt', type: 'string', required: true },
        { name: 'VideoPrompt', type: 'string', required: true },
        { name: 'NumClips', type: 'int', required: true },
        { name: 'NumCharacters', type: 'int', required: true },
      ],
      [{ name: 'FinalVideo', type: 'video' }],
      [],
      [
        { from: 'CharacterPrompt', to: 'CharacterImage.Prompt' },
        { from: 'VideoPrompt', to: 'VideoProducer[clip].Prompt' },
        {
          from: 'CharacterImage[character].GeneratedImage',
          to: 'VideoProducer[clip].ReferenceImages[character]',
        },
        { from: 'VideoProducer[clip].GeneratedVideo', to: 'FinalVideo[clip]' },
      ],
      [
        { name: 'clip', countInput: 'NumClips' },
        { name: 'character', countInput: 'NumCharacters' },
      ]
    );

    const tree: BlueprintTreeNode = {
      ...makeTreeNode(rootDoc, []),
      children: new Map([
        ['CharacterImage', makeTreeNode(imageProducerDoc, ['CharacterImage'])],
        ['VideoProducer', makeTreeNode(videoProducerDoc, ['VideoProducer'])],
      ]),
    };

    const graph = buildBlueprintGraph(tree);
    const crossDimensionEdge = graph.edges.find(
      (edge) =>
        edge.from.nodeId.includes('CharacterImage.GeneratedImage') &&
        edge.to.nodeId.includes('VideoProducer.ReferenceImages')
    );

    expect(crossDimensionEdge).toBeDefined();
    expect(crossDimensionEdge?.to.selectors?.[0]).toEqual({
      kind: 'loop',
      symbol: 'clip',
      offset: 0,
    });
    expect(crossDimensionEdge?.to.collectionSelectors).toEqual([
      { kind: 'loop', symbol: 'character', offset: 0 },
    ]);
  });

  it('injects synthetic input declarations for system inputs referenced in edges', () => {
    // Test scenario: Blueprint references SegmentDuration without declaring it
    // The graph builder should inject a synthetic input declaration
    const producerDoc = makeBlueprintDocument(
      'VideoProducer',
      [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'Duration', type: 'int', required: true },
      ],
      [{ name: 'GeneratedVideo', type: 'video' }],
      [{ name: 'VideoGenerator', provider: 'fal-ai', model: 'video' }],
      [
        { from: 'Prompt', to: 'VideoGenerator' },
        { from: 'Duration', to: 'VideoGenerator' },
        { from: 'VideoGenerator', to: 'GeneratedVideo' },
      ]
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [
        // Note: SegmentDuration is NOT declared as an input
        { name: 'Prompt', type: 'string', required: true },
        { name: 'Duration', type: 'int', required: true },
        { name: 'NumOfSegments', type: 'int', required: true },
      ],
      [{ name: 'FinalVideo', type: 'video' }],
      [],
      [
        // Reference SegmentDuration without declaring it - this is a system input
        { from: 'SegmentDuration', to: 'VideoProducer.Duration' },
        { from: 'Prompt', to: 'VideoProducer.Prompt' },
        { from: 'VideoProducer.GeneratedVideo', to: 'FinalVideo' },
      ]
    );

    const tree: BlueprintTreeNode = {
      ...makeTreeNode(rootDoc, []),
      children: new Map([
        ['VideoProducer', makeTreeNode(producerDoc, ['VideoProducer'])],
      ]),
    };

    const graph = buildBlueprintGraph(tree);

    // Verify that SegmentDuration was injected as a synthetic input
    const segmentDurationNode = graph.nodes.find(
      (n) => n.type === 'InputSource' && n.name === 'SegmentDuration'
    );
    expect(segmentDurationNode).toBeDefined();
    expect(segmentDurationNode?.input?.required).toBe(false); // System inputs are optional

    // Verify that the edge from SegmentDuration exists
    const edgeFromSegmentDuration = graph.edges.find(
      (e) => e.from.nodeId === 'SegmentDuration'
    );
    expect(edgeFromSegmentDuration).toBeDefined();
  });

  it('injects all system inputs when referenced in edges without declaration', () => {
    // Test scenario: Blueprint references all system inputs without declaring them
    // System inputs: Duration, NumOfSegments, SegmentDuration, MovieId, StorageRoot, StorageBasePath
    const exporterDoc = makeBlueprintDocument(
      'Exporter',
      [
        { name: 'Timeline', type: 'json', required: true },
        { name: 'MovieId', type: 'string', required: true },
        { name: 'StorageRoot', type: 'string', required: true },
        { name: 'StorageBasePath', type: 'string', required: true },
      ],
      [{ name: 'FinalVideo', type: 'video' }],
      [{ name: 'VideoExporter', provider: 'renku', model: 'export' }],
      [
        { from: 'Timeline', to: 'VideoExporter' },
        { from: 'MovieId', to: 'VideoExporter' },
        { from: 'StorageRoot', to: 'VideoExporter' },
        { from: 'StorageBasePath', to: 'VideoExporter' },
        { from: 'VideoExporter', to: 'FinalVideo' },
      ]
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [
        // Only Timeline is declared - all system inputs should be auto-injected
        { name: 'Timeline', type: 'json', required: true },
      ],
      [{ name: 'Output', type: 'video' }],
      [],
      [
        { from: 'Timeline', to: 'Exporter.Timeline' },
        // Reference system inputs without declaring them
        { from: 'MovieId', to: 'Exporter.MovieId' },
        { from: 'StorageRoot', to: 'Exporter.StorageRoot' },
        { from: 'StorageBasePath', to: 'Exporter.StorageBasePath' },
        { from: 'Exporter.FinalVideo', to: 'Output' },
      ]
    );

    const tree: BlueprintTreeNode = {
      ...makeTreeNode(rootDoc, []),
      children: new Map([
        ['Exporter', makeTreeNode(exporterDoc, ['Exporter'])],
      ]),
    };

    const graph = buildBlueprintGraph(tree);

    // Verify all system inputs were injected
    const movieIdNode = graph.nodes.find(
      (n) => n.type === 'InputSource' && n.name === 'MovieId'
    );
    const storageRootNode = graph.nodes.find(
      (n) => n.type === 'InputSource' && n.name === 'StorageRoot'
    );
    const storageBasePathNode = graph.nodes.find(
      (n) => n.type === 'InputSource' && n.name === 'StorageBasePath'
    );

    expect(movieIdNode).toBeDefined();
    expect(storageRootNode).toBeDefined();
    expect(storageBasePathNode).toBeDefined();

    // All should be marked as optional (system inputs)
    expect(movieIdNode?.input?.required).toBe(false);
    expect(storageRootNode?.input?.required).toBe(false);
    expect(storageBasePathNode?.input?.required).toBe(false);

    // Verify edges exist from each system input
    const edgeFromMovieId = graph.edges.find(
      (e) => e.from.nodeId === 'MovieId'
    );
    const edgeFromStorageRoot = graph.edges.find(
      (e) => e.from.nodeId === 'StorageRoot'
    );
    const edgeFromStorageBasePath = graph.edges.find(
      (e) => e.from.nodeId === 'StorageBasePath'
    );

    expect(edgeFromMovieId).toBeDefined();
    expect(edgeFromStorageRoot).toBeDefined();
    expect(edgeFromStorageBasePath).toBeDefined();
  });

  it('does not inject system inputs when they are already declared', () => {
    // Test scenario: Blueprint explicitly declares a system input
    // The graph builder should NOT inject a duplicate
    const rootDoc = makeBlueprintDocument(
      'Root',
      [
        // Duration is explicitly declared with custom settings
        {
          name: 'Duration',
          type: 'int',
          required: true,
          description: 'User-defined duration',
        },
      ],
      [{ name: 'Output', type: 'string' }],
      [{ name: 'Producer', provider: 'openai', model: 'gpt' }],
      [
        { from: 'Duration', to: 'Producer' },
        { from: 'Producer', to: 'Output' },
      ]
    );

    const tree = makeTreeNode(rootDoc, []);
    const graph = buildBlueprintGraph(tree);

    // Find all Duration InputSource nodes
    const durationNodes = graph.nodes.filter(
      (n) => n.type === 'InputSource' && n.name === 'Duration'
    );

    // Should only have ONE Duration node (the explicitly declared one)
    expect(durationNodes).toHaveLength(1);

    // The declared one should maintain its original required=true setting
    expect(durationNodes[0]?.input?.required).toBe(true);
    expect(durationNodes[0]?.input?.description).toBe('User-defined duration');
  });

  it('injects system inputs with correct types', () => {
    // Test scenario: Verify that injected system inputs have the correct type
    const rootDoc = makeBlueprintDocument(
      'Root',
      [],
      [{ name: 'Output', type: 'string' }],
      [{ name: 'Producer', provider: 'openai', model: 'gpt' }],
      [
        // Reference various system inputs to trigger injection
        { from: 'Duration', to: 'Producer' },
        { from: 'NumOfSegments', to: 'Producer' },
        { from: 'SegmentDuration', to: 'Producer' },
        { from: 'MovieId', to: 'Producer' },
        { from: 'StorageRoot', to: 'Producer' },
        { from: 'StorageBasePath', to: 'Producer' },
        { from: 'Producer', to: 'Output' },
      ]
    );

    const tree = makeTreeNode(rootDoc, []);
    const graph = buildBlueprintGraph(tree);

    // Verify types for numeric system inputs
    const durationNode = graph.nodes.find(
      (n) => n.type === 'InputSource' && n.name === 'Duration'
    );
    const numOfSegmentsNode = graph.nodes.find(
      (n) => n.type === 'InputSource' && n.name === 'NumOfSegments'
    );
    const segmentDurationNode = graph.nodes.find(
      (n) => n.type === 'InputSource' && n.name === 'SegmentDuration'
    );

    expect(durationNode?.input?.type).toBe('number');
    expect(numOfSegmentsNode?.input?.type).toBe('number');
    expect(segmentDurationNode?.input?.type).toBe('number');

    // Verify types for string system inputs
    const movieIdNode = graph.nodes.find(
      (n) => n.type === 'InputSource' && n.name === 'MovieId'
    );
    const storageRootNode = graph.nodes.find(
      (n) => n.type === 'InputSource' && n.name === 'StorageRoot'
    );
    const storageBasePathNode = graph.nodes.find(
      (n) => n.type === 'InputSource' && n.name === 'StorageBasePath'
    );

    expect(movieIdNode?.input?.type).toBe('string');
    expect(storageRootNode?.input?.type).toBe('string');
    expect(storageBasePathNode?.input?.type).toBe('string');
  });

  it('does not auto-inject system inputs into producer children - producers must declare their inputs', () => {
    // Test scenario: A producer YAML declares "Duration" as an input (part of its interface).
    // The blueprint routes "SegmentDuration" (a system input) to "Producer.Duration".
    // The producer's "Duration" is NOT a system input - it's a regular input that must be declared.
    // System input injection only happens at the ROOT blueprint level.

    const producerDoc = makeBlueprintDocument(
      'ScriptProducer',
      [
        // Producer MUST declare Duration as an input - it's part of its interface
        { name: 'Duration', type: 'int', required: true },
        { name: 'Prompt', type: 'string', required: true },
      ],
      [{ name: 'Script', type: 'string' }],
      [{ name: 'LLM', provider: 'openai', model: 'gpt' }],
      [
        { from: 'Prompt', to: 'LLM' },
        { from: 'Duration', to: 'LLM' },
        { from: 'LLM', to: 'Script' },
      ]
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [
        // Only Prompt is declared - SegmentDuration is a system input (auto-injected)
        { name: 'Prompt', type: 'string', required: true },
      ],
      [{ name: 'Output', type: 'string' }],
      [],
      [
        { from: 'Prompt', to: 'ScriptProducer.Prompt' },
        // Route SegmentDuration (system input) to producer's Duration input
        { from: 'SegmentDuration', to: 'ScriptProducer.Duration' },
        { from: 'ScriptProducer.Script', to: 'Output' },
      ]
    );

    const tree: BlueprintTreeNode = {
      ...makeTreeNode(rootDoc, []),
      children: new Map([
        ['ScriptProducer', makeTreeNode(producerDoc, ['ScriptProducer'])],
      ]),
    };

    const graph = buildBlueprintGraph(tree);

    // Verify: SegmentDuration is auto-injected at ROOT level (system input)
    const segmentDurationNode = graph.nodes.find(
      (n) =>
        n.type === 'InputSource' &&
        n.name === 'SegmentDuration' &&
        n.namespacePath.length === 0
    );
    expect(segmentDurationNode).toBeDefined();
    expect(segmentDurationNode?.input?.required).toBe(false); // System inputs are optional

    // Verify: Producer's Duration is a regular input (declared in producer YAML)
    const producerDurationNode = graph.nodes.find(
      (n) =>
        n.type === 'InputSource' &&
        n.name === 'Duration' &&
        n.namespacePath.includes('ScriptProducer')
    );
    expect(producerDurationNode).toBeDefined();
    expect(producerDurationNode?.input?.required).toBe(true); // As declared in producer YAML

    // Verify: Edge connects root-level SegmentDuration to producer's Duration
    const edgeFromSegmentDuration = graph.edges.find(
      (e) =>
        e.from.nodeId === 'SegmentDuration' &&
        e.to.nodeId === 'ScriptProducer.Duration'
    );
    expect(edgeFromSegmentDuration).toBeDefined();

    // Verify: There is NO root-level Duration node (it was not referenced in root edges)
    const rootDurationNode = graph.nodes.find(
      (n) =>
        n.type === 'InputSource' &&
        n.name === 'Duration' &&
        n.namespacePath.length === 0
    );
    expect(rootDurationNode).toBeUndefined();
  });

  it('allows routing different system inputs to producer Duration input', () => {
    // Test scenario: Blueprint can route EITHER Duration OR SegmentDuration to producer
    // This demonstrates that producer's Duration input is just a regular input,
    // not magically connected to any system input.

    const producerDoc = makeBlueprintDocument(
      'VideoProducer',
      [
        { name: 'Duration', type: 'int', required: true }, // Producer declares Duration input
        { name: 'Prompt', type: 'string', required: true },
      ],
      [{ name: 'Video', type: 'video' }],
      [{ name: 'Generator', provider: 'fal-ai', model: 'video' }],
      [
        { from: 'Prompt', to: 'Generator' },
        { from: 'Duration', to: 'Generator' },
        { from: 'Generator', to: 'Video' },
      ]
    );

    // First: Blueprint routes Duration (full duration) to producer
    const rootDocWithDuration = makeBlueprintDocument(
      'Root',
      [{ name: 'Prompt', type: 'string', required: true }],
      [{ name: 'Output', type: 'video' }],
      [],
      [
        { from: 'Prompt', to: 'VideoProducer.Prompt' },
        { from: 'Duration', to: 'VideoProducer.Duration' }, // Route Duration system input
        { from: 'VideoProducer.Video', to: 'Output' },
      ]
    );

    const treeWithDuration: BlueprintTreeNode = {
      ...makeTreeNode(rootDocWithDuration, []),
      children: new Map([
        ['VideoProducer', makeTreeNode(producerDoc, ['VideoProducer'])],
      ]),
    };

    const graphWithDuration = buildBlueprintGraph(treeWithDuration);

    // Verify: Duration system input is injected and routed to producer
    const durationNode = graphWithDuration.nodes.find(
      (n) =>
        n.type === 'InputSource' &&
        n.name === 'Duration' &&
        n.namespacePath.length === 0
    );
    expect(durationNode).toBeDefined();

    const edgeFromDuration = graphWithDuration.edges.find(
      (e) =>
        e.from.nodeId === 'Duration' && e.to.nodeId === 'VideoProducer.Duration'
    );
    expect(edgeFromDuration).toBeDefined();

    // Second: Blueprint routes SegmentDuration to the same producer input
    const rootDocWithSegmentDuration = makeBlueprintDocument(
      'Root',
      [{ name: 'Prompt', type: 'string', required: true }],
      [{ name: 'Output', type: 'video' }],
      [],
      [
        { from: 'Prompt', to: 'VideoProducer.Prompt' },
        { from: 'SegmentDuration', to: 'VideoProducer.Duration' }, // Route SegmentDuration instead
        { from: 'VideoProducer.Video', to: 'Output' },
      ]
    );

    const treeWithSegmentDuration: BlueprintTreeNode = {
      ...makeTreeNode(rootDocWithSegmentDuration, []),
      children: new Map([
        ['VideoProducer', makeTreeNode(producerDoc, ['VideoProducer'])],
      ]),
    };

    const graphWithSegmentDuration = buildBlueprintGraph(
      treeWithSegmentDuration
    );

    // Verify: SegmentDuration system input is injected and routed to producer
    const segmentDurationNode = graphWithSegmentDuration.nodes.find(
      (n) =>
        n.type === 'InputSource' &&
        n.name === 'SegmentDuration' &&
        n.namespacePath.length === 0
    );
    expect(segmentDurationNode).toBeDefined();

    const edgeFromSegmentDuration = graphWithSegmentDuration.edges.find(
      (e) =>
        e.from.nodeId === 'SegmentDuration' &&
        e.to.nodeId === 'VideoProducer.Duration'
    );
    expect(edgeFromSegmentDuration).toBeDefined();
  });

  it('connects whole collection artifact to collection input (non-indexed binding)', () => {
    // Test scenario: A collection artifact is connected directly to a collection input
    // without using element indices. This is the "whole-collection binding" pattern.
    const imageGeneratorDoc = makeBlueprintDocument(
      'ImageGenerator',
      [
        { name: 'Prompts', type: 'collection', required: true },
        { name: 'NumImages', type: 'int', required: true },
      ],
      [{ name: 'GeneratedImages', type: 'array', countInput: 'NumImages' }],
      [{ name: 'ImageProducer', provider: 'fal-ai', model: 'image' }],
      [
        { from: 'Prompts', to: 'ImageProducer' },
        { from: 'NumImages', to: 'ImageProducer' },
        { from: 'ImageProducer', to: 'GeneratedImages[i]' },
      ],
      [{ name: 'i', countInput: 'NumImages' }]
    );

    const videoProducerDoc = makeBlueprintDocument(
      'VideoProducer',
      [
        { name: 'ReferenceImages', type: 'collection', required: false },
        { name: 'Prompt', type: 'string', required: true },
      ],
      [{ name: 'GeneratedVideo', type: 'video' }],
      [{ name: 'VideoGenerator', provider: 'fal-ai', model: 'video' }],
      [
        { from: 'Prompt', to: 'VideoGenerator' },
        { from: 'ReferenceImages', to: 'VideoGenerator' },
        { from: 'VideoGenerator', to: 'GeneratedVideo' },
      ]
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [
        { name: 'ImagePrompts', type: 'collection', required: true },
        { name: 'NumImages', type: 'int', required: true },
        { name: 'VideoPrompt', type: 'string', required: true },
      ],
      [{ name: 'FinalVideo', type: 'video' }],
      [],
      [
        // Image generator inputs
        { from: 'ImagePrompts', to: 'ImageGenerator.Prompts' },
        { from: 'NumImages', to: 'ImageGenerator.NumImages' },
        // Whole-collection binding: entire array artifact to collection input
        {
          from: 'ImageGenerator.GeneratedImages',
          to: 'VideoProducer.ReferenceImages',
        },
        // Video producer prompt
        { from: 'VideoPrompt', to: 'VideoProducer.Prompt' },
        // Output
        { from: 'VideoProducer.GeneratedVideo', to: 'FinalVideo' },
      ]
    );

    const tree: BlueprintTreeNode = {
      ...makeTreeNode(rootDoc, []),
      children: new Map([
        ['ImageGenerator', makeTreeNode(imageGeneratorDoc, ['ImageGenerator'])],
        ['VideoProducer', makeTreeNode(videoProducerDoc, ['VideoProducer'])],
      ]),
    };

    const graph = buildBlueprintGraph(tree);

    // Verify that the collection Input node exists (non-indexed)
    const refImagesNode = graph.nodes.find(
      (n) =>
        n.type === 'InputSource' &&
        n.id.includes('ReferenceImages') &&
        !n.id.includes('[')
    );
    expect(refImagesNode).toBeDefined();

    // Verify that an edge exists from the array artifact to the collection input
    const edgeToRefImages = graph.edges.find(
      (e) =>
        e.from.nodeId.includes('ImageGenerator.GeneratedImages') &&
        e.to.nodeId.includes('ReferenceImages')
    );
    expect(edgeToRefImages).toBeDefined();

    // The target should NOT have constant indices - it's a whole-collection binding
    expect(edgeToRefImages?.to.nodeId).not.toContain('[');
  });
});
