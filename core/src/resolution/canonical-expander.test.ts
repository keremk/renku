import { describe, expect, it } from 'vitest';
import { buildBlueprintGraph } from './canonical-graph.js';
import { expandBlueprintGraph } from './canonical-expander.js';
import {
  buildInputSourceMapFromCanonical,
  normalizeInputValues,
} from './input-sources.js';
import type { BlueprintTreeNode, BlueprintDocument } from '../types.js';

describe('expandBlueprintGraph', () => {
  it('expands nodes with indices and collapses input aliases', () => {
    const scriptDoc: BlueprintDocument = {
      meta: { id: 'ScriptGenerator', name: 'ScriptGenerator' },
      inputs: [
        { name: 'InquiryPrompt', type: 'string', required: true },
        { name: 'NumOfSegments', type: 'int', required: true },
      ],
      artefacts: [
        { name: 'NarrationScript', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [{ name: 'ScriptProducer', provider: 'openai', model: 'gpt' }],
      producerImports: [],
      edges: [
        { from: 'InquiryPrompt', to: 'ScriptProducer' },
        { from: 'NumOfSegments', to: 'ScriptProducer' },
        { from: 'ScriptProducer', to: 'NarrationScript[i]' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [
        { name: 'InquiryPrompt', type: 'string', required: true },
        { name: 'NumOfSegments', type: 'int', required: true },
      ],
      artefacts: [],
      producers: [],
      producerImports: [],
      edges: [
        { from: 'InquiryPrompt', to: 'ScriptGenerator.InquiryPrompt' },
        { from: 'NumOfSegments', to: 'ScriptGenerator.NumOfSegments' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'ScriptGenerator',
          {
            id: 'ScriptGenerator',
            namespacePath: ['ScriptGenerator'],
            document: scriptDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
      ]),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:InquiryPrompt': 'Hello',
        'Input:NumOfSegments': 2,
      },
      inputSources
    );
    const canonical = expandBlueprintGraph(
      graph,
      canonicalInputs,
      inputSources
    );

    const producerNodes = canonical.nodes.filter(
      (node) => node.type === 'Producer'
    );
    expect(producerNodes).toHaveLength(1);
    expect(producerNodes[0]?.id).toBe('Producer:ScriptGenerator');
    const producerId = producerNodes[0]?.id ?? '';
    expect(canonical.inputBindings[producerId]?.InquiryPrompt).toBe(
      'Input:InquiryPrompt'
    );
    expect(canonical.inputBindings[producerId]?.NumOfSegments).toBe(
      'Input:NumOfSegments'
    );

    const artefactNodes = canonical.nodes.filter(
      (node) => node.type === 'Artifact'
    );
    expect(artefactNodes).toHaveLength(2);
    const edges = canonical.edges.filter((edge) =>
      edge.to.includes('Producer:ScriptGenerator')
    );
    expect(edges).toHaveLength(2);
    expect(edges.every((edge) => edge.from.startsWith('Input:'))).toBe(true);
  });

  it('expands array artifacts using countInput', () => {
    // Test the countInput-based dimension expansion (traditional approach)
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [{ name: 'NumOfSegments', type: 'int', required: true }],
      artefacts: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      producerImports: [],
      edges: [
        { from: 'NumOfSegments', to: 'Producer' },
        { from: 'Producer', to: 'Script[i]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumOfSegments': 3,
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // Should have 3 artifacts (one per segment)
    const scriptArtifacts = expanded.nodes.filter(
      (n) => n.type === 'Artifact' && n.id.includes('Script')
    );
    expect(scriptArtifacts).toHaveLength(3);
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[0]');
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[1]');
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[2]');
  });

  it('handles countInputOffset for array artifacts', () => {
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [{ name: 'NumOfSegments', type: 'int', required: true }],
      artefacts: [
        {
          name: 'Script',
          type: 'array',
          countInput: 'NumOfSegments',
          countInputOffset: 1,
        },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      producerImports: [],
      edges: [
        { from: 'NumOfSegments', to: 'Producer' },
        { from: 'Producer', to: 'Script[i]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumOfSegments': 2,
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // With offset of 1, NumOfSegments=2 means 3 artifacts (2+1)
    const scriptArtifacts = expanded.nodes.filter(
      (n) => n.type === 'Artifact' && n.id.includes('Script')
    );
    expect(scriptArtifacts).toHaveLength(3);
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[0]');
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[1]');
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[2]');
  });

  it('expands nested dimensions using loops', () => {
    // Test nested dimensions (2 segments × 3 images = 6 image artifacts)
    // Uses loops to define dimension sizing for both dimensions
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [
        { name: 'NumOfSegments', type: 'int', required: true },
        { name: 'NumOfImages', type: 'int', required: true },
      ],
      artefacts: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
        { name: 'Image', type: 'array', countInput: 'NumOfImages' },
      ],
      producers: [
        { name: 'ScriptProducer', provider: 'openai', model: 'gpt-4' },
        { name: 'ImageProducer', provider: 'replicate', model: 'flux' },
      ],
      producerImports: [],
      loops: [
        { name: 'i', countInput: 'NumOfSegments' },
        { name: 'j', countInput: 'NumOfImages' },
      ],
      edges: [
        { from: 'NumOfSegments', to: 'ScriptProducer' },
        { from: 'ScriptProducer', to: 'Script[i]' },
        { from: 'NumOfImages', to: 'ImageProducer' },
        { from: 'Script[i]', to: 'ImageProducer' },
        { from: 'ImageProducer', to: 'Image[i][j]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumOfSegments': 2,
        'Input:NumOfImages': 3,
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // Should have 2 script artifacts (one per segment)
    const scriptArtifacts = expanded.nodes.filter(
      (n) => n.type === 'Artifact' && n.id.includes('Script')
    );
    expect(scriptArtifacts).toHaveLength(2);
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[0]');
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[1]');

    // Should have 6 image artifacts (2 segments × 3 images)
    const imageArtifacts = expanded.nodes.filter(
      (n) => n.type === 'Artifact' && n.id.includes('Image')
    );
    expect(imageArtifacts).toHaveLength(6);
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[0][0]');
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[0][1]');
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[0][2]');
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[1][0]');
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[1][1]');
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[1][2]');
  });

  it('throws error for zero count input', () => {
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [{ name: 'NumOfSegments', type: 'int', required: true }],
      artefacts: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      producerImports: [],
      edges: [
        { from: 'NumOfSegments', to: 'Producer' },
        { from: 'Producer', to: 'Script[i]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumOfSegments': 0,
      },
      inputSources
    );

    // Zero count is not allowed - throws validation error
    expect(() =>
      expandBlueprintGraph(graph, canonicalInputs, inputSources)
    ).toThrow('Input "NumOfSegments" must be greater than zero.');
  });

  it('expands producer nodes with multiple dimensions', () => {
    // Test producer that produces artifacts across 2 dimensions
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [
        { name: 'NumRows', type: 'int', required: true },
        { name: 'NumCols', type: 'int', required: true },
      ],
      artefacts: [{ name: 'Cell', type: 'array', countInput: 'NumCols' }],
      producers: [{ name: 'CellProducer', provider: 'openai', model: 'gpt-4' }],
      producerImports: [],
      loops: [
        { name: 'row', countInput: 'NumRows' },
        { name: 'col', countInput: 'NumCols' },
      ],
      edges: [
        { from: 'NumRows', to: 'CellProducer' },
        { from: 'NumCols', to: 'CellProducer' },
        { from: 'CellProducer', to: 'Cell[row][col]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumRows': 2,
        'Input:NumCols': 3,
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // Should have 6 cell artifacts (2 rows × 3 cols)
    const cellArtifacts = expanded.nodes.filter(
      (n) => n.type === 'Artifact' && n.id.includes('Cell')
    );
    expect(cellArtifacts).toHaveLength(6);

    // Verify all combinations exist
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        expect(cellArtifacts.map((a) => a.id)).toContain(
          `Artifact:Cell[${row}][${col}]`
        );
      }
    }
  });

  it('creates correct edges between producer and artifact instances', () => {
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [{ name: 'NumOfSegments', type: 'int', required: true }],
      artefacts: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      producerImports: [],
      edges: [
        { from: 'NumOfSegments', to: 'Producer' },
        { from: 'Producer', to: 'Script[i]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumOfSegments': 2,
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // Check edges from producer to each artifact instance
    const producerToArtifactEdges = expanded.edges.filter(
      (e) =>
        e.from.startsWith('Producer:') && e.to.startsWith('Artifact:Script')
    );
    expect(producerToArtifactEdges).toHaveLength(2);
    expect(producerToArtifactEdges.map((e) => e.to)).toContain(
      'Artifact:Script[0]'
    );
    expect(producerToArtifactEdges.map((e) => e.to)).toContain(
      'Artifact:Script[1]'
    );
  });

  it('handles artifact dependencies between producer instances', () => {
    // First producer makes Scripts, second producer uses Scripts to make Images
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [{ name: 'NumOfSegments', type: 'int', required: true }],
      artefacts: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
        { name: 'Image', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [
        { name: 'ScriptProducer', provider: 'openai', model: 'gpt-4' },
        { name: 'ImageProducer', provider: 'replicate', model: 'flux' },
      ],
      producerImports: [],
      loops: [{ name: 'i', countInput: 'NumOfSegments' }],
      edges: [
        { from: 'NumOfSegments', to: 'ScriptProducer' },
        { from: 'ScriptProducer', to: 'Script[i]' },
        { from: 'Script[i]', to: 'ImageProducer' },
        { from: 'ImageProducer', to: 'Image[i]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumOfSegments': 2,
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // Should have edges from Script artifacts to ImageProducer
    const scriptToImageProducerEdges = expanded.edges.filter(
      (e) =>
        e.from.startsWith('Artifact:Script') && e.to.includes('ImageProducer')
    );
    expect(scriptToImageProducerEdges).toHaveLength(2);
  });

  it('preserves edge conditions through expansion', () => {
    // Test that conditional edges are preserved during expansion
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [
        { name: 'NumOfSegments', type: 'int', required: true },
        { name: 'UseSpecialEffect', type: 'boolean', required: true },
      ],
      artefacts: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      producerImports: [],
      edges: [
        { from: 'NumOfSegments', to: 'Producer' },
        {
          from: 'UseSpecialEffect',
          to: 'Producer',
          conditions: { when: 'Input:UseSpecialEffect', is: true },
        },
        { from: 'Producer', to: 'Script[i]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumOfSegments': 2,
        'Input:UseSpecialEffect': true,
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // Check that conditional edge exists
    const conditionalEdge = expanded.edges.find(
      (e) => e.from === 'Input:UseSpecialEffect'
    );
    expect(conditionalEdge).toBeDefined();
    expect(conditionalEdge?.conditions).toBeDefined();
    const condition = conditionalEdge?.conditions as {
      when: string;
      is: boolean;
    };
    expect(condition.when).toBe('Input:UseSpecialEffect');
    expect(condition.is).toBe(true);
  });

  it('handles input aliases correctly', () => {
    // Test input aliasing - when a parent blueprint routes its input to a child input
    const childDoc: BlueprintDocument = {
      meta: { id: 'Child', name: 'Child' },
      inputs: [{ name: 'ChildInput', type: 'string', required: true }],
      artefacts: [{ name: 'ChildOutput', type: 'string' }],
      producers: [
        { name: 'ChildProducer', provider: 'openai', model: 'gpt-4' },
      ],
      producerImports: [],
      edges: [
        { from: 'ChildInput', to: 'ChildProducer' },
        { from: 'ChildProducer', to: 'ChildOutput' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [{ name: 'ParentInput', type: 'string', required: true }],
      artefacts: [],
      producers: [],
      producerImports: [],
      edges: [{ from: 'ParentInput', to: 'Child.ChildInput' }],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'Child',
          {
            id: 'Child',
            namespacePath: ['Child'],
            document: childDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
      ]),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:ParentInput': 'test value',
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // The child producer should exist
    const producerNodes = expanded.nodes.filter((n) => n.type === 'Producer');
    expect(producerNodes).toHaveLength(1);
    const producerNode = producerNodes[0];
    expect(producerNode).toBeDefined();

    // Verify the producer has input bindings that trace back to the parent input
    const producerBindings = expanded.inputBindings[producerNode.id];
    expect(producerBindings).toBeDefined();
    expect(producerBindings?.ChildInput).toBe('Input:ParentInput');
  });

  it('throws error for negative countInputOffset', () => {
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [{ name: 'NumOfSegments', type: 'int', required: true }],
      artefacts: [
        {
          name: 'Script',
          type: 'array',
          countInput: 'NumOfSegments',
          countInputOffset: -1,
        },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      producerImports: [],
      edges: [
        { from: 'NumOfSegments', to: 'Producer' },
        { from: 'Producer', to: 'Script[i]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumOfSegments': 3,
      },
      inputSources
    );

    // Negative offsets are not allowed - throws validation error
    expect(() =>
      expandBlueprintGraph(graph, canonicalInputs, inputSources)
    ).toThrow('Artefact "Script" declares an invalid countInputOffset (-1).');
  });

  it('creates input nodes for each producer instance', () => {
    // When a producer has dimension, each instance should have access to the same inputs
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [
        { name: 'NumOfSegments', type: 'int', required: true },
        { name: 'Prompt', type: 'string', required: true },
      ],
      artefacts: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      producerImports: [],
      edges: [
        { from: 'NumOfSegments', to: 'Producer' },
        { from: 'Prompt', to: 'Producer' },
        { from: 'Producer', to: 'Script[i]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumOfSegments': 2,
        'Input:Prompt': 'Generate a script',
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // Input nodes should exist for each input
    const inputNodes = expanded.nodes.filter((n) => n.type === 'Input');
    expect(inputNodes.some((n) => n.id === 'Input:NumOfSegments')).toBe(true);
    expect(inputNodes.some((n) => n.id === 'Input:Prompt')).toBe(true);

    // Edges should connect inputs to the producer
    const inputEdges = expanded.edges.filter(
      (e) => e.from.startsWith('Input:') && e.to.includes('Producer')
    );
    expect(inputEdges.length).toBeGreaterThanOrEqual(2);
  });

  it('handles multi-dimension artifacts with nested loops', () => {
    // Test nested dimensions - images across segments and variations
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [
        { name: 'NumOfSegments', type: 'int', required: true },
        { name: 'NumOfImages', type: 'int', required: true },
      ],
      artefacts: [{ name: 'Image', type: 'array', countInput: 'NumOfImages' }],
      producers: [
        { name: 'ImageProducer', provider: 'replicate', model: 'flux' },
      ],
      producerImports: [],
      loops: [
        { name: 'i', countInput: 'NumOfSegments' },
        { name: 'j', countInput: 'NumOfImages' },
      ],
      edges: [
        { from: 'NumOfImages', to: 'ImageProducer' },
        { from: 'NumOfSegments', to: 'ImageProducer' },
        { from: 'ImageProducer', to: 'Image[i][j]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumOfSegments': 2,
        'Input:NumOfImages': 3,
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // Should have 6 images (2×3)
    const imageArtifacts = expanded.nodes.filter(
      (n) => n.type === 'Artifact' && n.id.includes('Image')
    );
    expect(imageArtifacts).toHaveLength(6);

    // Verify specific artifact IDs exist
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[0][0]');
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[1][2]');
  });

  it('aliases constant-indexed collection inputs to upstream artifacts', () => {
    // Test scenario: VideoProducer with collection input ReferenceImages
    // Two different artifacts connect to ReferenceImages[0] and ReferenceImages[1]
    // The producer should receive bindings that resolve to the upstream artifacts

    const videoProducerDoc: BlueprintDocument = {
      meta: { id: 'VideoProducer', name: 'VideoProducer' },
      inputs: [
        { name: 'ReferenceImages', type: 'collection', required: false },
        { name: 'Prompt', type: 'string', required: true },
      ],
      artefacts: [{ name: 'GeneratedVideo', type: 'video' }],
      producers: [
        { name: 'VideoGenerator', provider: 'fal-ai', model: 'video' },
      ],
      producerImports: [],
      edges: [
        { from: 'Prompt', to: 'VideoGenerator' },
        { from: 'ReferenceImages', to: 'VideoGenerator' },
        { from: 'VideoGenerator', to: 'GeneratedVideo' },
      ],
    };

    const imageProducerDoc: BlueprintDocument = {
      meta: { id: 'ImageProducer', name: 'ImageProducer' },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      artefacts: [{ name: 'GeneratedImage', type: 'image' }],
      producers: [
        { name: 'ImageGenerator', provider: 'fal-ai', model: 'image' },
      ],
      producerImports: [],
      edges: [
        { from: 'Prompt', to: 'ImageGenerator' },
        { from: 'ImageGenerator', to: 'GeneratedImage' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [
        { name: 'CharacterPrompt', type: 'string', required: true },
        { name: 'ProductPrompt', type: 'string', required: true },
        { name: 'VideoPrompt', type: 'string', required: true },
        { name: 'NumClips', type: 'int', required: true },
      ],
      artefacts: [{ name: 'FinalVideo', type: 'video' }],
      producers: [],
      producerImports: [],
      edges: [
        { from: 'CharacterPrompt', to: 'CharacterImage.Prompt' },
        { from: 'ProductPrompt', to: 'ProductImage.Prompt' },
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
        { from: 'VideoProducer[clip].GeneratedVideo', to: 'FinalVideo[clip]' },
      ],
      loops: [{ name: 'clip', countInput: 'NumClips' }],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'CharacterImage',
          {
            id: 'CharacterImage',
            namespacePath: ['CharacterImage'],
            document: imageProducerDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
        [
          'ProductImage',
          {
            id: 'ProductImage',
            namespacePath: ['ProductImage'],
            document: imageProducerDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
        [
          'VideoProducer',
          {
            id: 'VideoProducer',
            namespacePath: ['VideoProducer'],
            document: videoProducerDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
      ]),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:CharacterPrompt': 'character prompt',
        'Input:ProductPrompt': 'product prompt',
        'Input:VideoPrompt': 'video prompt',
        'Input:NumClips': 2,
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // Find the VideoProducer producer nodes (should be 2, one per clip)
    const allProducers = expanded.nodes.filter((n) => n.type === 'Producer');
    const videoProducerNodes = allProducers.filter((n) =>
      n.id.includes('VideoProducer')
    );
    expect(videoProducerNodes).toHaveLength(2);

    // Check bindings for the first VideoProducer (clip 0)
    const firstVideoProducer = videoProducerNodes.find((n) =>
      n.id.includes('[0]')
    );
    expect(firstVideoProducer).toBeDefined();

    const bindings = expanded.inputBindings[firstVideoProducer!.id];
    expect(bindings).toBeDefined();

    // The ReferenceImages[0] binding should resolve to CharacterImage artifact
    // and ReferenceImages[1] should resolve to ProductImage artifact
    expect(bindings!['ReferenceImages[0]']).toBe(
      'Artifact:CharacterImage.GeneratedImage'
    );
    expect(bindings!['ReferenceImages[1]']).toBe(
      'Artifact:ProductImage.GeneratedImage'
    );
  });

  it('keeps array-input element bindings aligned with loop instance', () => {
    const producerDoc: BlueprintDocument = {
      meta: { id: 'ThenImageProducer', name: 'ThenImageProducer' },
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'SourceImages', type: 'collection', required: false },
      ],
      artefacts: [{ name: 'TransformedImage', type: 'image' }],
      producers: [
        {
          name: 'ImageTransformer',
          provider: 'fal-ai',
          model: 'flux-pro/kontext',
        },
      ],
      producerImports: [],
      edges: [
        { from: 'Prompt', to: 'ImageTransformer' },
        { from: 'SourceImages', to: 'ImageTransformer' },
        { from: 'ImageTransformer', to: 'TransformedImage' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ArrayLoop', name: 'ArrayLoop' },
      inputs: [
        { name: 'NumCharacters', type: 'int', required: true },
        { name: 'Prompt', type: 'string', required: true },
        {
          name: 'CelebrityThenImages',
          type: 'array',
          itemType: 'image',
          required: true,
        },
      ],
      artefacts: [
        {
          name: 'OutputImages',
          type: 'array',
          itemType: 'image',
          countInput: 'NumCharacters',
        },
      ],
      producers: [],
      producerImports: [],
      loops: [{ name: 'character', countInput: 'NumCharacters' }],
      edges: [
        { from: 'Prompt', to: 'ThenImageProducer[character].Prompt' },
        {
          from: 'CelebrityThenImages[character]',
          to: 'ThenImageProducer[character].SourceImages[0]',
        },
        {
          from: 'ThenImageProducer[character].TransformedImage',
          to: 'OutputImages[character]',
        },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ArrayLoop',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'ThenImageProducer',
          {
            id: 'ThenImageProducer',
            namespacePath: ['ThenImageProducer'],
            document: producerDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
      ]),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumCharacters': 3,
        'Input:Prompt': 'Turn this into a modern photo',
        'Input:CelebrityThenImages': ['image-a', 'image-b', 'image-c'],
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);
    const producerNodes = expanded.nodes
      .filter(
        (node) =>
          node.type === 'Producer' &&
          node.id.startsWith('Producer:ThenImageProducer')
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    expect(producerNodes).toHaveLength(3);

    for (const producerNode of producerNodes) {
      const indexMatch = producerNode.id.match(/\[(\d+)\]$/);
      expect(indexMatch).toBeDefined();
      const index = parseInt(indexMatch![1]!, 10);

      const bindings = expanded.inputBindings[producerNode.id];
      expect(bindings).toBeDefined();
      expect(bindings?.SourceImages).toBe(
        `Input:ThenImageProducer.SourceImages[${index}]`
      );
      expect(bindings?.['SourceImages[0]']).toBe(
        `Input:CelebrityThenImages[${index}]`
      );
    }
  });

  it('keeps mixed source-image bindings aligned with loop instance', () => {
    const producerDoc: BlueprintDocument = {
      meta: { id: 'ThenImageProducer', name: 'ThenImageProducer' },
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'SourceImages', type: 'collection', required: false },
      ],
      artefacts: [{ name: 'TransformedImage', type: 'image' }],
      producers: [
        {
          name: 'ImageTransformer',
          provider: 'fal-ai',
          model: 'flux-pro/kontext',
        },
      ],
      producerImports: [],
      edges: [
        { from: 'Prompt', to: 'ImageTransformer' },
        { from: 'SourceImages', to: 'ImageTransformer' },
        { from: 'ImageTransformer', to: 'TransformedImage' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ArrayLoop', name: 'ArrayLoop' },
      inputs: [
        { name: 'NumCharacters', type: 'int', required: true },
        { name: 'Prompt', type: 'string', required: true },
        {
          name: 'CelebrityThenImages',
          type: 'array',
          itemType: 'image',
          required: true,
        },
        { name: 'SettingImage', type: 'image', required: true },
      ],
      artefacts: [
        {
          name: 'OutputImages',
          type: 'array',
          itemType: 'image',
          countInput: 'NumCharacters',
        },
      ],
      producers: [],
      producerImports: [],
      loops: [{ name: 'character', countInput: 'NumCharacters' }],
      edges: [
        { from: 'Prompt', to: 'ThenImageProducer[character].Prompt' },
        {
          from: 'CelebrityThenImages[character]',
          to: 'ThenImageProducer[character].SourceImages[0]',
        },
        {
          from: 'SettingImage',
          to: 'ThenImageProducer[character].SourceImages[1]',
        },
        {
          from: 'ThenImageProducer[character].TransformedImage',
          to: 'OutputImages[character]',
        },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ArrayLoop',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'ThenImageProducer',
          {
            id: 'ThenImageProducer',
            namespacePath: ['ThenImageProducer'],
            document: producerDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
      ]),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumCharacters': 2,
        'Input:Prompt': 'Turn this into a modern photo',
        'Input:CelebrityThenImages': ['image-a', 'image-b'],
        'Input:SettingImage': 'setting-image',
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);
    const producerNodes = expanded.nodes
      .filter(
        (node) =>
          node.type === 'Producer' &&
          node.id.startsWith('Producer:ThenImageProducer')
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    expect(producerNodes).toHaveLength(2);

    for (const producerNode of producerNodes) {
      const indexMatch = producerNode.id.match(/\[(\d+)\]$/);
      expect(indexMatch).toBeDefined();
      const index = parseInt(indexMatch![1]!, 10);
      const bindings = expanded.inputBindings[producerNode.id];
      expect(bindings).toBeDefined();
      expect(bindings?.['SourceImages[0]']).toBe(
        `Input:CelebrityThenImages[${index}]`
      );
      expect(bindings?.['SourceImages[1]']).toBe('Input:SettingImage');
    }
  });

  it('creates implicit singleton fan-in for single-source fanIn input without explicit metadata', () => {
    const musicSourceDoc: BlueprintDocument = {
      meta: { id: 'MusicSource', name: 'MusicSource' },
      inputs: [],
      artefacts: [{ name: 'GeneratedMusic', type: 'audio' }],
      producers: [
        { name: 'MusicProducer', provider: 'elevenlabs', model: 'music_v1' },
      ],
      producerImports: [],
      edges: [{ from: 'MusicProducer', to: 'GeneratedMusic' }],
    };

    const timelineComposerDoc: BlueprintDocument = {
      meta: { id: 'TimelineComposer', name: 'TimelineComposer' },
      inputs: [{ name: 'Music', type: 'audio', required: false, fanIn: true }],
      artefacts: [{ name: 'Timeline', type: 'json' }],
      producers: [
        {
          name: 'TimelineProducer',
          provider: 'renku',
          model: 'timeline/ordered',
        },
      ],
      producerImports: [],
      edges: [
        { from: 'Music', to: 'TimelineProducer' },
        { from: 'TimelineProducer', to: 'Timeline' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [],
      artefacts: [],
      producers: [],
      producerImports: [],
      edges: [
        { from: 'MusicSource.GeneratedMusic', to: 'TimelineComposer.Music' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'MusicSource',
          {
            id: 'MusicSource',
            namespacePath: ['MusicSource'],
            document: musicSourceDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
        [
          'TimelineComposer',
          {
            id: 'TimelineComposer',
            namespacePath: ['TimelineComposer'],
            document: timelineComposerDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
      ]),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues({}, inputSources);
    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    expect(expanded.fanIn['Input:TimelineComposer.Music']).toEqual({
      groupBy: 'singleton',
      orderBy: undefined,
      members: [
        {
          id: 'Artifact:MusicSource.GeneratedMusic',
          group: 0,
          order: 0,
        },
      ],
    });
  });

  it('fails when fanIn input has multiple scalar sources without explicit metadata', () => {
    const musicSourceDoc: BlueprintDocument = {
      meta: { id: 'MusicSource', name: 'MusicSource' },
      inputs: [],
      artefacts: [{ name: 'GeneratedMusic', type: 'audio' }],
      producers: [
        { name: 'MusicProducer', provider: 'elevenlabs', model: 'music_v1' },
      ],
      producerImports: [],
      edges: [{ from: 'MusicProducer', to: 'GeneratedMusic' }],
    };

    const timelineComposerDoc: BlueprintDocument = {
      meta: { id: 'TimelineComposer', name: 'TimelineComposer' },
      inputs: [{ name: 'Music', type: 'audio', required: false, fanIn: true }],
      artefacts: [{ name: 'Timeline', type: 'json' }],
      producers: [
        {
          name: 'TimelineProducer',
          provider: 'renku',
          model: 'timeline/ordered',
        },
      ],
      producerImports: [],
      edges: [
        { from: 'Music', to: 'TimelineProducer' },
        { from: 'TimelineProducer', to: 'Timeline' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [],
      artefacts: [],
      producers: [],
      producerImports: [],
      edges: [
        { from: 'MusicSourceA.GeneratedMusic', to: 'TimelineComposer.Music' },
        { from: 'MusicSourceB.GeneratedMusic', to: 'TimelineComposer.Music' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'MusicSourceA',
          {
            id: 'MusicSourceA',
            namespacePath: ['MusicSourceA'],
            document: musicSourceDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
        [
          'MusicSourceB',
          {
            id: 'MusicSourceB',
            namespacePath: ['MusicSourceB'],
            document: musicSourceDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
        [
          'TimelineComposer',
          {
            id: 'TimelineComposer',
            namespacePath: ['TimelineComposer'],
            document: timelineComposerDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
      ]),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues({}, inputSources);

    expect(() =>
      expandBlueprintGraph(graph, canonicalInputs, inputSources)
    ).toThrow(
      'Input node Input:TimelineComposer.Music has multiple scalar upstream dependencies'
    );
  });

  it('infers groupBy for multi-source fanIn connections sharing one loop dimension', () => {
    const videoSourceDoc: BlueprintDocument = {
      meta: { id: 'VideoSource', name: 'VideoSource' },
      inputs: [],
      artefacts: [{ name: 'GeneratedVideo', type: 'video' }],
      producers: [
        { name: 'VideoProducer', provider: 'fal-ai', model: 'image_to_video' },
      ],
      producerImports: [],
      edges: [{ from: 'VideoProducer', to: 'GeneratedVideo' }],
    };

    const timelineComposerDoc: BlueprintDocument = {
      meta: { id: 'TimelineComposer', name: 'TimelineComposer' },
      inputs: [
        { name: 'VideoSegments', type: 'video', required: false, fanIn: true },
      ],
      artefacts: [{ name: 'Timeline', type: 'json' }],
      producers: [
        {
          name: 'TimelineProducer',
          provider: 'renku',
          model: 'timeline/ordered',
        },
      ],
      producerImports: [],
      edges: [
        { from: 'VideoSegments', to: 'TimelineProducer' },
        { from: 'TimelineProducer', to: 'Timeline' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [{ name: 'NumOfCharacters', type: 'number', required: true }],
      artefacts: [],
      producers: [],
      producerImports: [],
      loops: [{ name: 'character', countInput: 'NumOfCharacters' }],
      edges: [
        {
          from: 'MeetingVideoSource[character].GeneratedVideo',
          to: 'TimelineComposer.VideoSegments',
        },
        {
          from: 'TransitionVideoSource[character].GeneratedVideo',
          to: 'TimelineComposer.VideoSegments',
        },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'MeetingVideoSource',
          {
            id: 'MeetingVideoSource',
            namespacePath: ['MeetingVideoSource'],
            document: videoSourceDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
        [
          'TransitionVideoSource',
          {
            id: 'TransitionVideoSource',
            namespacePath: ['TransitionVideoSource'],
            document: videoSourceDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
        [
          'TimelineComposer',
          {
            id: 'TimelineComposer',
            namespacePath: ['TimelineComposer'],
            document: timelineComposerDoc,
            children: new Map(),
            sourcePath: '/test/mock-blueprint.yaml',
          },
        ],
      ]),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumOfCharacters': 2,
      },
      inputSources
    );
    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    const fanIn = expanded.fanIn['Input:TimelineComposer.VideoSegments'];
    expect(fanIn).toBeDefined();
    expect(fanIn?.groupBy).toBe('character');
    expect(fanIn?.members).toHaveLength(4);
    expect(fanIn?.members.map((member) => member.group)).toEqual([0, 1, 0, 1]);
  });
});
