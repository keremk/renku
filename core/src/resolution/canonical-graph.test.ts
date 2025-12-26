import { describe, expect, it } from 'vitest';
import type {
  BlueprintArtefactDefinition,
  BlueprintDocument,
  BlueprintEdgeDefinition,
  BlueprintInputDefinition,
  BlueprintLoopDefinition,
  BlueprintTreeNode,
  ProducerConfig,
  SubBlueprintDefinition,
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
      [],
      [{ name: 'j', countInput: 'Count' }],
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [{ name: 'RootInput', type: 'string', required: true }],
      [],
      [],
      [],
      [{ name: 'ChildBlueprint' }],
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
      [],
      [{ name: 'k', countInput: 'ImageCount' }],
    );

    const childDoc = makeBlueprintDocument(
      'Child',
      [{ name: 'SegmentCount', type: 'int', required: true }],
      [],
      [],
      [],
      [{ name: 'Grandchild' }],
      [{ name: 'j', countInput: 'SegmentCount' }],
    );

    const rootDoc = makeBlueprintDocument(
      'Root',
      [{ name: 'ChapterCount', type: 'int', required: true }],
      [],
      [],
      [],
      [{ name: 'Child' }],
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
    [
      { name: 'ScriptGenerator' },
      { name: 'ImagePromptGenerator' },
      { name: 'ImageGenerator' },
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
  subBlueprints: SubBlueprintDefinition[] = [],
  loops?: BlueprintLoopDefinition[],
): BlueprintDocument {
  return {
    meta: { id, name: id },
    inputs,
    artefacts,
    producers,
    edges,
    subBlueprints,
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
