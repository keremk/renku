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

    const producerNode = graph.nodes.find((node) => node.id.endsWith('TextToImageProducer'));
    expect(producerNode?.dimensions).toHaveLength(2);
    expect(new Set(producerNode?.dimensions ?? []).size).toBe(2);

    const artefactNode = graph.nodes.find((node) => node.id.endsWith('NarrationScript'));
    expect(artefactNode?.dimensions).toHaveLength(1);

    const promptNode = graph.nodes.find((node) => node.id.endsWith('ImagePrompt'));
    expect(promptNode?.dimensions).toHaveLength(2);
    expect(new Set(promptNode?.dimensions ?? []).size).toBe(2);

    const finalEdge = graph.edges.find((edge) => edge.to.nodeId === 'SegmentImage');
    expect(finalEdge?.from.dimensions).toHaveLength(2);
    expect(finalEdge?.to.dimensions).toHaveLength(2);

    expect(readNamespaceSymbols(graph.namespaceDimensions.get('ImageGenerator'))).toEqual(['i', 'j']);
    expect(readNamespaceSymbols(graph.namespaceDimensions.get('ImagePromptGenerator'))).toEqual(['i']);
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
      [{ name: 'i', countInput: 'NumOfSegments' }],
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
      [{ name: 'j', countInput: 'Count' }],
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [{ name: 'RootInput', type: 'string', required: true }],
      [],
      [],
      [],
    );

    const tree = makeTreeNode(rootDoc, [], new Map([
      ['ChildBlueprint', makeTreeNode(childDoc, ['ChildBlueprint'])],
    ]));

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
      [{ name: 'k', countInput: 'ImageCount' }],
    );

    const childDoc = makeBlueprintDocument(
      'Child',
      [{ name: 'SegmentCount', type: 'int', required: true }],
      [],
      [],
      [],
      [{ name: 'j', countInput: 'SegmentCount' }],
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [{ name: 'ChapterCount', type: 'int', required: true }],
      [],
      [],
      [],
      [{ name: 'i', countInput: 'ChapterCount' }],
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
      [],
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
      ],
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
      [{ name: 'i', countInput: 'Count', countInputOffset: 1 }],
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    const loops = graph.loops.get('');
    expect(loops).toBeDefined();
    expect(loops![0].countInputOffset).toBe(1);
  });
});

function readNamespaceSymbols(entries: Array<{ raw: string }> | undefined): string[] | undefined {
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
    [
      { name: 'ScriptProducer', provider: 'openai', model: 'gpt' },
    ],
    [
      { from: 'InquiryPrompt', to: 'ScriptProducer' },
      { from: 'NumOfSegments', to: 'ScriptProducer' },
      { from: 'ScriptProducer', to: 'NarrationScript[i]' },
      { from: 'ScriptProducer', to: 'MovieSummary' },
    ],
  );

  const imagePromptBlueprint = makeBlueprintDocument(
    'ImagePromptGenerator',
    [
      { name: 'NarrativeText', type: 'string', required: true },
      { name: 'OverallSummary', type: 'string', required: true },
      { name: 'NumOfImagesPerNarrative', type: 'int', required: true },
    ],
    [
      { name: 'ImagePrompt', type: 'array', countInput: 'NumOfImagesPerNarrative' },
    ],
    [
      { name: 'ImagePromptProducer', provider: 'openai', model: 'gpt' },
    ],
    [
      { from: 'NarrativeText', to: 'ImagePromptProducer' },
      { from: 'OverallSummary', to: 'ImagePromptProducer' },
      { from: 'NumOfImagesPerNarrative', to: 'ImagePromptProducer' },
      { from: 'ImagePromptProducer', to: 'ImagePrompt[j]' },
    ],
  );

  const imageGeneratorBlueprint = makeBlueprintDocument(
    'ImageGenerator',
    [
      { name: 'Prompt', type: 'string', required: true },
      { name: 'Size', type: 'string', required: false },
    ],
    [
      { name: 'SegmentImage', type: 'image' },
    ],
    [
      { name: 'TextToImageProducer', provider: 'replicate', model: 'xyz' },
    ],
    [
      { from: 'Prompt', to: 'TextToImageProducer' },
      { from: 'Size', to: 'TextToImageProducer' },
      { from: 'TextToImageProducer', to: 'SegmentImage' },
    ],
  );

  const rootDocument = makeBlueprintDocument(
    'ImageOnly',
    [
      { name: 'InquiryPrompt', type: 'string', required: true },
      { name: 'NumOfSegments', type: 'int', required: true },
      { name: 'NumOfImagesPerNarrative', type: 'int', required: true },
      { name: 'Size', type: 'string', required: false },
    ],
    [
      { name: 'SegmentImage', type: 'array' },
    ],
    [],
    [
      { from: 'InquiryPrompt', to: 'ScriptGenerator.InquiryPrompt' },
      { from: 'NumOfSegments', to: 'ScriptGenerator.NumOfSegments' },
      { from: 'ScriptGenerator.NarrationScript[i]', to: 'ImagePromptGenerator[i].NarrativeText' },
      { from: 'ScriptGenerator.MovieSummary', to: 'ImagePromptGenerator[i].OverallSummary' },
      { from: 'NumOfImagesPerNarrative', to: 'ImagePromptGenerator[i].NumOfImagesPerNarrative' },
      { from: 'ImagePromptGenerator[i].ImagePrompt[j]', to: 'ImageGenerator[i][j].Prompt' },
      { from: 'Size', to: 'ImageGenerator[i][j].Size' },
      { from: 'ImageGenerator[i][j].SegmentImage', to: 'SegmentImage[i][j]' },
    ],
  );

  return makeTreeNode(rootDocument, [], new Map<string, BlueprintTreeNode>([
    ['ScriptGenerator', makeTreeNode(scriptBlueprint, ['ScriptGenerator'])],
    ['ImagePromptGenerator', makeTreeNode(imagePromptBlueprint, ['ImagePromptGenerator'])],
    ['ImageGenerator', makeTreeNode(imageGeneratorBlueprint, ['ImageGenerator'])],
  ]));
}

function makeBlueprintDocument(
  id: string,
  inputs: BlueprintInputDefinition[],
  artefacts: BlueprintArtefactDefinition[],
  producers: ProducerConfig[],
  edges: BlueprintEdgeDefinition[],
  loops?: BlueprintLoopDefinition[],
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
  children: Map<string, BlueprintTreeNode> = new Map(),
): BlueprintTreeNode {
  return {
    id: document.meta.id,
    namespacePath,
    document,
    children,
  };
}

describe('edge cases', () => {
  it('handles empty blueprint with no nodes', () => {
    const doc = makeBlueprintDocument(
      'Empty',
      [],
      [],
      [],
      [],
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it('handles blueprint with only artifacts (no producers)', () => {
    const doc = makeBlueprintDocument(
      'ArtefactsOnly',
      [],
      [
        { name: 'Output', type: 'string' },
      ],
      [],
      [],
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
      [{ name: 'k', countInput: 'L2Count' }],
    );

    const level1Doc = makeBlueprintDocument(
      'Level1',
      [{ name: 'L1Count', type: 'int', required: true }],
      [],
      [],
      [],
      [{ name: 'j', countInput: 'L1Count' }],
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [{ name: 'RootCount', type: 'int', required: true }],
      [],
      [],
      [],
      [{ name: 'i', countInput: 'RootCount' }],
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
      ],
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    // Check that artifact nodes exist (using endsWith for flexible ID format)
    const summaryNode = graph.nodes.find((n) => n.type === 'Artifact' && n.id.endsWith('Summary'));
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
      ],
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [{ name: 'RootInput', type: 'string', required: true }],
      [{ name: 'FinalOutput', type: 'string' }],
      [],
      [
        { from: 'RootInput', to: 'Child.ChildInput' },
        { from: 'Child.ChildOutput', to: 'FinalOutput' },
      ],
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
      (e) => e.from.nodeId === 'Child.ChildOutput' && e.to.nodeId === 'FinalOutput'
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
      [{ name: 'i', countInput: 'Count' }],
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
      ],
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    // All three outputs should exist
    expect(graph.nodes.filter((n) => n.type === 'Artifact')).toHaveLength(3);

    // All three edges from producer to outputs should exist
    const producerEdges = graph.edges.filter((e) => e.from.nodeId === 'Producer');
    expect(producerEdges).toHaveLength(3);
  });

  it('handles array artifacts with multiple dimensions', () => {
    const doc = makeBlueprintDocument(
      'MultiDim',
      [
        { name: 'Rows', type: 'int', required: true },
        { name: 'Cols', type: 'int', required: true },
      ],
      [
        { name: 'Grid', type: 'array', countInput: 'Cols' },
      ],
      [{ name: 'Producer', provider: 'openai', model: 'gpt' }],
      [
        { from: 'Rows', to: 'Producer' },
        { from: 'Cols', to: 'Producer' },
        { from: 'Producer', to: 'Grid[i][j]' },
      ],
      [
        { name: 'i', countInput: 'Rows' },
        { name: 'j', countInput: 'Cols' },
      ],
    );

    const tree = makeTreeNode(doc, []);
    const graph = buildBlueprintGraph(tree);

    // Grid artifact should have 2 dimensions
    const gridNode = graph.nodes.find((n) => n.type === 'Artifact' && n.id.endsWith('Grid'));
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
      ],
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
});
