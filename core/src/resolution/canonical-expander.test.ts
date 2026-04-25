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
      meta: { id: 'ScriptGenerator', name: 'ScriptGenerator', kind: 'producer' },
      inputs: [
        { name: 'InquiryPrompt', type: 'string', required: true },
        { name: 'NumOfSegments', type: 'int', required: true },
      ],
      outputs: [
        { name: 'NarrationScript', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [{ name: 'ScriptProducer', provider: 'openai', model: 'gpt' }],
      imports: [],
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
      outputs: [],
      producers: [],
      imports: [],
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

    const artifactNodes = canonical.nodes.filter(
      (node) => node.type === 'Artifact'
    );
    expect(artifactNodes).toHaveLength(2);
    const edges = canonical.edges.filter((edge) =>
      edge.to.includes('Producer:ScriptGenerator')
    );
    expect(edges).toHaveLength(2);
    expect(edges.every((edge) => edge.from.startsWith('Input:'))).toBe(true);
  });

  it('normalizes producer input bindings that flow through collapsed output connectors', () => {
    const imageSourceDoc: BlueprintDocument = {
      meta: { id: 'ImageSource', name: 'ImageSource', kind: 'producer' },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'GeneratedImage', type: 'image' }],
      producers: [{ name: 'ImageGenerator', provider: 'fal-ai', model: 'image' }],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'ImageGenerator' },
        { from: 'ImageGenerator', to: 'GeneratedImage' },
      ],
    };

    const videoProducerDoc: BlueprintDocument = {
      meta: { id: 'VideoProducer', name: 'VideoProducer', kind: 'producer' },
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'SourceImages', type: 'array', required: false },
      ],
      outputs: [{ name: 'GeneratedVideo', type: 'video' }],
      producers: [{ name: 'VideoGenerator', provider: 'fal-ai', model: 'video' }],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'VideoGenerator' },
        { from: 'SourceImages', to: 'VideoGenerator' },
        { from: 'VideoGenerator', to: 'GeneratedVideo' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [
        { name: 'ImagePrompt', type: 'string', required: true },
        { name: 'VideoPrompt', type: 'string', required: true },
      ],
      outputs: [
        { name: 'SharedImage', type: 'image' },
        { name: 'FinalVideo', type: 'video' },
      ],
      producers: [],
      imports: [],
      edges: [
        { from: 'ImagePrompt', to: 'ImageSource.Prompt' },
        { from: 'ImageSource.GeneratedImage', to: 'SharedImage' },
        { from: 'SharedImage', to: 'VideoProducer.SourceImages[0]' },
        { from: 'VideoPrompt', to: 'VideoProducer.Prompt' },
        { from: 'VideoProducer.GeneratedVideo', to: 'FinalVideo' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'ImageSource',
          {
            id: 'ImageSource',
            namespacePath: ['ImageSource'],
            document: imageSourceDoc,
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
        'Input:ImagePrompt': 'Create a style frame',
        'Input:VideoPrompt': 'Animate the frame',
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    expect(expanded.outputSources['Output:SharedImage']).toBe(
      'Artifact:ImageSource.GeneratedImage'
    );
    expect(expanded.inputBindings['Producer:VideoProducer']?.['SourceImages[0]']).toBe(
      'Artifact:ImageSource.GeneratedImage'
    );
    expect(
      Object.values(expanded.inputBindings['Producer:VideoProducer'] ?? {}).some(
        (binding) => binding.startsWith('Output:')
      )
    ).toBe(false);
  });

  it('resolves input-to-output passthrough connectors to canonical input IDs', () => {
    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [{ name: 'Duration', type: 'int', required: true }],
      outputs: [{ name: 'MovieDuration', type: 'int' }],
      producers: [],
      imports: [],
      edges: [{ from: 'Duration', to: 'MovieDuration' }],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map(),
      sourcePath: '/test/mock-blueprint.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:Duration': 42,
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    expect(expanded.outputSources['Output:MovieDuration']).toBe('Input:Duration');
    expect(Object.keys(expanded.inputBindings)).toHaveLength(0);
  });

  it('expands array artifacts using countInput', () => {
    // Test the countInput-based dimension expansion (traditional approach)
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test', kind: 'producer' },
      inputs: [{ name: 'NumOfSegments', type: 'int', required: true }],
      outputs: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      imports: [],
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
      meta: { id: 'Test', name: 'Test', kind: 'producer' },
      inputs: [{ name: 'NumOfSegments', type: 'int', required: true }],
      outputs: [
        {
          name: 'Script',
          type: 'array',
          countInput: 'NumOfSegments',
          countInputOffset: 1,
        },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      imports: [],
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
      meta: { id: 'Test', name: 'Test', kind: 'producer' },
      inputs: [
        { name: 'NumOfSegments', type: 'int', required: true },
        { name: 'NumOfImages', type: 'int', required: true },
      ],
      outputs: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
        { name: 'Image', type: 'array', countInput: 'NumOfImages' },
      ],
      producers: [
        { name: 'ScriptProducer', provider: 'openai', model: 'gpt-4' },
        { name: 'ImageProducer', provider: 'replicate', model: 'flux' },
      ],
      imports: [],
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
      meta: { id: 'Test', name: 'Test', kind: 'producer' },
      inputs: [{ name: 'NumOfSegments', type: 'int', required: true }],
      outputs: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      imports: [],
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
      meta: { id: 'Test', name: 'Test', kind: 'producer' },
      inputs: [
        { name: 'NumRows', type: 'int', required: true },
        { name: 'NumCols', type: 'int', required: true },
      ],
      outputs: [{ name: 'Cell', type: 'array', countInput: 'NumCols' }],
      producers: [{ name: 'CellProducer', provider: 'openai', model: 'gpt-4' }],
      imports: [],
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
      meta: { id: 'Test', name: 'Test', kind: 'producer' },
      inputs: [{ name: 'NumOfSegments', type: 'int', required: true }],
      outputs: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      imports: [],
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
      meta: { id: 'Test', name: 'Test', kind: 'producer' },
      inputs: [{ name: 'NumOfSegments', type: 'int', required: true }],
      outputs: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
        { name: 'Image', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [
        { name: 'ScriptProducer', provider: 'openai', model: 'gpt-4' },
        { name: 'ImageProducer', provider: 'replicate', model: 'flux' },
      ],
      imports: [],
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
      meta: { id: 'Test', name: 'Test', kind: 'producer' },
      inputs: [
        { name: 'NumOfSegments', type: 'int', required: true },
        { name: 'UseSpecialEffect', type: 'boolean', required: true },
      ],
      outputs: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      imports: [],
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
    expect(conditionalEdge?.authoredEdgeConditions).toEqual({
      when: 'Input:UseSpecialEffect',
      is: true,
    });
    expect(conditionalEdge?.activationConditions).toBeUndefined();
    expect(conditionalEdge?.endpointConditions).toBeUndefined();
    const condition = conditionalEdge?.conditions as {
      when: string;
      is: boolean;
    };
    expect(condition.when).toBe('Input:UseSpecialEffect');
    expect(condition.is).toBe(true);
  });

  it('resolves duplicate loop labels in edge conditions using the target job indices', () => {
    const castDoc: BlueprintDocument = {
      meta: { id: 'CastProducer', name: 'CastProducer', kind: 'producer' },
      inputs: [{ name: 'NumOfExperts', type: 'int', required: true }],
      outputs: [
        {
          name: 'VoiceId',
          type: 'array',
          itemType: 'string',
          countInput: 'NumOfExperts',
        },
      ],
      producers: [{ name: 'CastProducer', provider: 'openai', model: 'gpt' }],
      imports: [],
      loops: [{ name: 'expert', countInput: 'NumOfExperts' }],
      edges: [
        { from: 'NumOfExperts', to: 'CastProducer' },
        { from: 'CastProducer', to: 'VoiceId[expert]' },
      ],
    };

    const talkingHeadDoc: BlueprintDocument = {
      meta: { id: 'TalkingHeadAudioProducer', name: 'TalkingHeadAudioProducer', kind: 'producer' },
      inputs: [
        { name: 'Text', type: 'string', required: true },
        { name: 'VoiceId', type: 'string', required: true },
      ],
      outputs: [{ name: 'GeneratedAudio', type: 'audio' }],
      producers: [
        { name: 'TalkingHeadAudioProducer', provider: 'elevenlabs', model: 'eleven_v3' },
      ],
      imports: [],
      edges: [
        { from: 'Text', to: 'TalkingHeadAudioProducer' },
        { from: 'VoiceId', to: 'TalkingHeadAudioProducer' },
        { from: 'TalkingHeadAudioProducer', to: 'GeneratedAudio' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [
        { name: 'NumOfSegments', type: 'int', required: true },
        { name: 'NumOfExperts', type: 'int', required: true },
        { name: 'TalkingHeadText', type: 'multiDimArray', itemType: 'string', required: true },
        { name: 'UseThisExpert', type: 'multiDimArray', itemType: 'boolean', required: true },
      ],
      outputs: [],
      producers: [],
      imports: [
        {
          name: 'CastProducer',
          path: './CastProducer/producer.yaml',
        },
        {
          name: 'TalkingHeadAudioProducer',
          path: './TalkingHeadAudioProducer/producer.yaml',
          loop: 'segment.expert',
        },
      ],
      loops: [
        { name: 'segment', countInput: 'NumOfSegments' },
        { name: 'expert', countInput: 'NumOfExperts' },
      ],
      edges: [
        { from: 'NumOfExperts', to: 'CastProducer.NumOfExperts' },
        {
          from: 'TalkingHeadText[segment][expert]',
          to: 'TalkingHeadAudioProducer[segment][expert].Text',
          conditions: { when: 'UseThisExpert[segment][expert]', is: true },
        },
        {
          from: 'CastProducer.VoiceId[expert]',
          to: 'TalkingHeadAudioProducer[segment][expert].VoiceId',
          conditions: { when: 'UseThisExpert[segment][expert]', is: true },
        },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'CastProducer',
          {
            id: 'CastProducer',
            namespacePath: ['CastProducer'],
            document: castDoc,
            children: new Map(),
            sourcePath: '/test/CastProducer/producer.yaml',
          },
        ],
        [
          'TalkingHeadAudioProducer',
          {
            id: 'TalkingHeadAudioProducer',
            namespacePath: ['TalkingHeadAudioProducer'],
            document: talkingHeadDoc,
            children: new Map(),
            sourcePath: '/test/TalkingHeadAudioProducer/producer.yaml',
          },
        ],
      ]),
      sourcePath: '/test/root.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumOfSegments': 2,
        'Input:NumOfExperts': 2,
        'Input:TalkingHeadText': [
          ['text-0-0', 'text-0-1'],
          ['text-1-0', 'text-1-1'],
        ],
        'Input:UseThisExpert': [
          [true, false],
          [false, true],
        ],
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    const matchingVoiceEdge = expanded.edges.find(
      (edge) =>
        edge.from === 'Artifact:CastProducer.VoiceId[0]' &&
        edge.to === 'Producer:TalkingHeadAudioProducer[1][0]'
    );
    const mismatchedVoiceEdge = expanded.edges.find(
      (edge) =>
        edge.from === 'Artifact:CastProducer.VoiceId[0]' &&
        edge.to === 'Producer:TalkingHeadAudioProducer[0][1]'
    );

    expect(matchingVoiceEdge).toBeDefined();
    expect(matchingVoiceEdge?.conditions).toEqual({
      when: 'Input:UseThisExpert[1][0]',
      is: true,
    });
    expect(mismatchedVoiceEdge).toBeUndefined();
  });

  it('rejects multiple conditional scalar sources instead of preserving runtime candidates', () => {
    const characterDoc: BlueprintDocument = {
      meta: { id: 'CharacterAssets', name: 'CharacterAssets', kind: 'producer' },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'Portrait', type: 'image' }],
      producers: [
        { name: 'CharacterProducer', provider: 'openai', model: 'gpt-image' },
      ],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'CharacterProducer' },
        { from: 'CharacterProducer', to: 'Portrait' },
      ],
    };

    const videoDoc: BlueprintDocument = {
      meta: { id: 'VideoProducer', name: 'VideoProducer', kind: 'producer' },
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'ReferenceImage', type: 'image', required: false },
      ],
      outputs: [{ name: 'Video', type: 'video' }],
      producers: [
        { name: 'ClipProducer', provider: 'fal-ai', model: 'video' },
      ],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'ClipProducer' },
        { from: 'ReferenceImage', to: 'ClipProducer' },
        { from: 'ClipProducer', to: 'Video' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [
        { name: 'NumSegments', type: 'int', required: true },
        { name: 'NumCharacters', type: 'int', required: true },
        { name: 'CharacterPrompt', type: 'string', required: true },
        { name: 'VideoPrompt', type: 'string', required: true },
        {
          name: 'UseReference',
          type: 'multiDimArray',
          itemType: 'boolean',
          required: true,
        },
      ],
      outputs: [],
      producers: [],
      imports: [
        {
          name: 'CharacterAssets',
          path: './character.yaml',
          loop: 'character',
        },
        { name: 'VideoProducer', path: './video.yaml', loop: 'segment' },
      ],
      loops: [
        { name: 'segment', countInput: 'NumSegments' },
        { name: 'character', countInput: 'NumCharacters' },
      ],
      edges: [
        {
          from: 'CharacterPrompt',
          to: 'CharacterAssets[character].Prompt',
        },
        { from: 'VideoPrompt', to: 'VideoProducer[segment].Prompt' },
        {
          from: 'CharacterAssets[character].Portrait',
          to: 'VideoProducer[segment].ReferenceImage',
          conditions: {
            when: 'UseReference[segment][character]',
            is: true,
          },
        },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'CharacterAssets',
          {
            id: 'CharacterAssets',
            namespacePath: ['CharacterAssets'],
            document: characterDoc,
            children: new Map(),
            sourcePath: '/test/character.yaml',
          },
        ],
        [
          'VideoProducer',
          {
            id: 'VideoProducer',
            namespacePath: ['VideoProducer'],
            document: videoDoc,
            children: new Map(),
            sourcePath: '/test/video.yaml',
          },
        ],
      ]),
      sourcePath: '/test/root.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:NumSegments': 2,
        'Input:NumCharacters': 3,
        'Input:CharacterPrompt': 'portrait',
        'Input:VideoPrompt': 'motion',
        'Input:UseReference': [
          [false, false, true],
          [true, false, false],
        ],
      },
      inputSources
    );

    expect(() =>
      expandBlueprintGraph(graph, canonicalInputs, inputSources)
    ).toThrow(/multiple upstream dependencies/);
  });

  it('handles input aliases correctly', () => {
    // Test input aliasing - when a parent blueprint routes its input to a child input
    const childDoc: BlueprintDocument = {
      meta: { id: 'Child', name: 'Child', kind: 'producer' },
      inputs: [{ name: 'ChildInput', type: 'string', required: true }],
      outputs: [{ name: 'ChildOutput', type: 'string' }],
      producers: [
        { name: 'ChildProducer', provider: 'openai', model: 'gpt-4' },
      ],
      imports: [],
      edges: [
        { from: 'ChildInput', to: 'ChildProducer' },
        { from: 'ChildProducer', to: 'ChildOutput' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [{ name: 'ParentInput', type: 'string', required: true }],
      outputs: [],
      producers: [],
      imports: [],
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
      meta: { id: 'Test', name: 'Test', kind: 'producer' },
      inputs: [{ name: 'NumOfSegments', type: 'int', required: true }],
      outputs: [
        {
          name: 'Script',
          type: 'array',
          countInput: 'NumOfSegments',
          countInputOffset: -1,
        },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      imports: [],
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
    ).toThrow('Artifact "Script" declares an invalid countInputOffset (-1).');
  });

  it('creates input nodes for each producer instance', () => {
    // When a producer has dimension, each instance should have access to the same inputs
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test', kind: 'producer' },
      inputs: [
        { name: 'NumOfSegments', type: 'int', required: true },
        { name: 'Prompt', type: 'string', required: true },
      ],
      outputs: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [{ name: 'Producer', provider: 'openai', model: 'gpt-4' }],
      imports: [],
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
      meta: { id: 'Test', name: 'Test', kind: 'producer' },
      inputs: [
        { name: 'NumOfSegments', type: 'int', required: true },
        { name: 'NumOfImages', type: 'int', required: true },
      ],
      outputs: [{ name: 'Image', type: 'array', countInput: 'NumOfImages' }],
      producers: [
        { name: 'ImageProducer', provider: 'replicate', model: 'flux' },
      ],
      imports: [],
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

  it('aliases constant-indexed array inputs to upstream artifacts', () => {
    // Test scenario: VideoProducer with array input ReferenceImages
    // Two different artifacts connect to ReferenceImages[0] and ReferenceImages[1]
    // The producer should receive bindings that resolve to the upstream artifacts

    const videoProducerDoc: BlueprintDocument = {
      meta: { id: 'VideoProducer', name: 'VideoProducer', kind: 'producer' },
      inputs: [
        { name: 'ReferenceImages', type: 'array', required: false },
        { name: 'Prompt', type: 'string', required: true },
      ],
      outputs: [{ name: 'GeneratedVideo', type: 'video' }],
      producers: [
        { name: 'VideoGenerator', provider: 'fal-ai', model: 'video' },
      ],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'VideoGenerator' },
        { from: 'ReferenceImages', to: 'VideoGenerator' },
        { from: 'VideoGenerator', to: 'GeneratedVideo' },
      ],
    };

    const imageProducerDoc: BlueprintDocument = {
      meta: { id: 'ImageProducer', name: 'ImageProducer', kind: 'producer' },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'GeneratedImage', type: 'image' }],
      producers: [
        { name: 'ImageGenerator', provider: 'fal-ai', model: 'image' },
      ],
      imports: [],
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
      outputs: [{ name: 'FinalVideo', type: 'video' }],
      producers: [],
      imports: [],
      edges: [
        { from: 'CharacterPrompt', to: 'CharacterImage.Prompt' },
        { from: 'ProductPrompt', to: 'ProductImage.Prompt' },
        { from: 'VideoPrompt', to: 'VideoProducer[clip].Prompt' },
        // Constant-indexed connections: different artifacts to different array elements
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

  it('aliases symbolic cross-dimension array inputs to upstream artifacts', () => {
    const videoProducerDoc: BlueprintDocument = {
      meta: { id: 'VideoProducer', name: 'VideoProducer', kind: 'producer' },
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'ReferenceImages', type: 'array', required: false },
      ],
      outputs: [{ name: 'GeneratedVideo', type: 'video' }],
      producers: [
        { name: 'VideoGenerator', provider: 'fal-ai', model: 'video' },
      ],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'VideoGenerator' },
        { from: 'ReferenceImages', to: 'VideoGenerator' },
        { from: 'VideoGenerator', to: 'GeneratedVideo' },
      ],
    };

    const imageProducerDoc: BlueprintDocument = {
      meta: { id: 'ImageProducer', name: 'ImageProducer', kind: 'producer' },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'GeneratedImage', type: 'image' }],
      producers: [
        { name: 'ImageGenerator', provider: 'fal-ai', model: 'image' },
      ],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'ImageGenerator' },
        { from: 'ImageGenerator', to: 'GeneratedImage' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [
        { name: 'CharacterPrompt', type: 'string', required: true },
        { name: 'VideoPrompt', type: 'string', required: true },
        { name: 'NumScenes', type: 'int', required: true },
        { name: 'NumCharacters', type: 'int', required: true },
      ],
      outputs: [
        {
          name: 'SceneVideos',
          type: 'array',
          itemType: 'video',
          countInput: 'NumScenes',
        },
      ],
      producers: [],
      imports: [],
      loops: [
        { name: 'scene', countInput: 'NumScenes' },
        { name: 'character', countInput: 'NumCharacters' },
      ],
      edges: [
        { from: 'CharacterPrompt', to: 'CharacterImage[character].Prompt' },
        { from: 'VideoPrompt', to: 'SceneVideo[scene].Prompt' },
        {
          from: 'CharacterImage[character].GeneratedImage',
          to: 'SceneVideo[scene].ReferenceImages[character]',
        },
        { from: 'SceneVideo[scene].GeneratedVideo', to: 'SceneVideos[scene]' },
      ],
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
          'SceneVideo',
          {
            id: 'SceneVideo',
            namespacePath: ['SceneVideo'],
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
        'Input:VideoPrompt': 'scene prompt',
        'Input:NumScenes': 3,
        'Input:NumCharacters': 3,
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);
    const sceneVideoNodes = expanded.nodes
      .filter(
        (node) =>
          node.type === 'Producer' && node.id.startsWith('Producer:SceneVideo')
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    expect(sceneVideoNodes).toHaveLength(3);

    for (const sceneNode of sceneVideoNodes) {
      const bindings = expanded.inputBindings[sceneNode.id];
      expect(bindings).toBeDefined();
      expect(bindings?.['ReferenceImages[0]']).toBe(
        'Artifact:CharacterImage.GeneratedImage[0]'
      );
      expect(bindings?.['ReferenceImages[1]']).toBe(
        'Artifact:CharacterImage.GeneratedImage[1]'
      );
      expect(bindings?.['ReferenceImages[2]']).toBe(
        'Artifact:CharacterImage.GeneratedImage[2]'
      );
    }
  });

  it('keeps array-input element bindings aligned with loop instance', () => {
    const producerDoc: BlueprintDocument = {
      meta: { id: 'ThenImageProducer', name: 'ThenImageProducer', kind: 'producer' },
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'SourceImages', type: 'array', required: false },
      ],
      outputs: [{ name: 'TransformedImage', type: 'image' }],
      producers: [
        {
          name: 'ImageTransformer',
          provider: 'fal-ai',
          model: 'flux-pro/kontext',
        },
      ],
      imports: [],
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
      outputs: [
        {
          name: 'OutputImages',
          type: 'array',
          itemType: 'image',
          countInput: 'NumCharacters',
        },
      ],
      producers: [],
      imports: [],
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
      meta: { id: 'ThenImageProducer', name: 'ThenImageProducer', kind: 'producer' },
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'SourceImages', type: 'array', required: false },
      ],
      outputs: [{ name: 'TransformedImage', type: 'image' }],
      producers: [
        {
          name: 'ImageTransformer',
          provider: 'fal-ai',
          model: 'flux-pro/kontext',
        },
      ],
      imports: [],
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
      outputs: [
        {
          name: 'OutputImages',
          type: 'array',
          itemType: 'image',
          countInput: 'NumCharacters',
        },
      ],
      producers: [],
      imports: [],
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

  it('propagates conditions for indexed element bindings routed through a base array input', () => {
    const producerDoc: BlueprintDocument = {
      meta: { id: 'ThenImageProducer', name: 'ThenImageProducer', kind: 'producer' },
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'SourceImages', type: 'array', required: false },
      ],
      outputs: [{ name: 'TransformedImage', type: 'image' }],
      producers: [
        {
          name: 'ImageTransformer',
          provider: 'fal-ai',
          model: 'flux-pro/kontext',
        },
      ],
      imports: [],
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
        {
          name: 'UseReferenceImage',
          type: 'array',
          itemType: 'boolean',
          required: true,
        },
      ],
      outputs: [
        {
          name: 'OutputImages',
          type: 'array',
          itemType: 'image',
          countInput: 'NumCharacters',
        },
      ],
      producers: [],
      imports: [],
      loops: [{ name: 'character', countInput: 'NumCharacters' }],
      edges: [
        { from: 'Prompt', to: 'ThenImageProducer[character].Prompt' },
        {
          from: 'CelebrityThenImages[character]',
          to: 'ThenImageProducer[character].SourceImages[0]',
          conditions: { when: 'UseReferenceImage[character]', is: true },
        },
        {
          from: 'SettingImage',
          to: 'ThenImageProducer[character].SourceImages[1]',
          conditions: { when: 'UseReferenceImage[character]', is: true },
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
        'Input:UseReferenceImage': [true, false],
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    expect(
      expanded.edges.find(
        (edge) =>
          edge.from === 'Input:CelebrityThenImages[0]' &&
          edge.to === 'Producer:ThenImageProducer[0]' &&
          edge.bindingAlias === 'SourceImages[0]'
      )
    ).toMatchObject({
      conditions: {
        when: 'Input:UseReferenceImage[0]',
        is: true,
      },
    });

    expect(
      expanded.edges.find(
        (edge) =>
          edge.from === 'Input:SettingImage' &&
          edge.to === 'Producer:ThenImageProducer[0]' &&
          edge.bindingAlias === 'SourceImages[1]'
      )
    ).toMatchObject({
      conditions: {
        when: 'Input:UseReferenceImage[0]',
        is: true,
      },
    });
  });

  it('creates implicit singleton fan-in for single-source fanIn input without explicit metadata', () => {
    const musicSourceDoc: BlueprintDocument = {
      meta: { id: 'MusicSource', name: 'MusicSource', kind: 'producer' },
      inputs: [],
      outputs: [{ name: 'GeneratedMusic', type: 'audio' }],
      producers: [
        { name: 'MusicProducer', provider: 'elevenlabs', model: 'music_v1' },
      ],
      imports: [],
      edges: [{ from: 'MusicProducer', to: 'GeneratedMusic' }],
    };

    const timelineComposerDoc: BlueprintDocument = {
      meta: { id: 'TimelineComposer', name: 'TimelineComposer', kind: 'producer' },
      inputs: [{ name: 'Music', type: 'audio', required: false, fanIn: true }],
      outputs: [{ name: 'Timeline', type: 'json' }],
      producers: [
        {
          name: 'TimelineProducer',
          provider: 'renku',
          model: 'timeline/ordered',
        },
      ],
      imports: [],
      edges: [
        { from: 'Music', to: 'TimelineProducer' },
        { from: 'TimelineProducer', to: 'Timeline' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [],
      outputs: [],
      producers: [],
      imports: [],
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
      meta: { id: 'MusicSource', name: 'MusicSource', kind: 'producer' },
      inputs: [],
      outputs: [{ name: 'GeneratedMusic', type: 'audio' }],
      producers: [
        { name: 'MusicProducer', provider: 'elevenlabs', model: 'music_v1' },
      ],
      imports: [],
      edges: [{ from: 'MusicProducer', to: 'GeneratedMusic' }],
    };

    const timelineComposerDoc: BlueprintDocument = {
      meta: { id: 'TimelineComposer', name: 'TimelineComposer', kind: 'producer' },
      inputs: [{ name: 'Music', type: 'audio', required: false, fanIn: true }],
      outputs: [{ name: 'Timeline', type: 'json' }],
      producers: [
        {
          name: 'TimelineProducer',
          provider: 'renku',
          model: 'timeline/ordered',
        },
      ],
      imports: [],
      edges: [
        { from: 'Music', to: 'TimelineProducer' },
        { from: 'TimelineProducer', to: 'Timeline' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [],
      outputs: [],
      producers: [],
      imports: [],
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
      meta: { id: 'VideoSource', name: 'VideoSource', kind: 'producer' },
      inputs: [],
      outputs: [{ name: 'GeneratedVideo', type: 'video' }],
      producers: [
        { name: 'VideoProducer', provider: 'fal-ai', model: 'image_to_video' },
      ],
      imports: [],
      edges: [{ from: 'VideoProducer', to: 'GeneratedVideo' }],
    };

    const timelineComposerDoc: BlueprintDocument = {
      meta: { id: 'TimelineComposer', name: 'TimelineComposer', kind: 'producer' },
      inputs: [
        { name: 'VideoSegments', type: 'video', required: false, fanIn: true },
      ],
      outputs: [{ name: 'Timeline', type: 'json' }],
      producers: [
        {
          name: 'TimelineProducer',
          provider: 'renku',
          model: 'timeline/ordered',
        },
      ],
      imports: [],
      edges: [
        { from: 'VideoSegments', to: 'TimelineProducer' },
        { from: 'TimelineProducer', to: 'Timeline' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [{ name: 'NumOfCharacters', type: 'number', required: true }],
      outputs: [],
      producers: [],
      imports: [],
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

  it('keeps import-level conditions on activation instead of route conditions', () => {
    const promptCompilerDoc: BlueprintDocument = {
      meta: { id: 'PromptCompiler', name: 'PromptCompiler', kind: 'producer' },
      inputs: [
        { name: 'Workflow', type: 'string', required: true },
        { name: 'SceneIntent', type: 'string', required: true },
      ],
      outputs: [{ name: 'Prompt', type: 'string' }],
      producers: [
        { name: 'PromptCompiler', provider: 'openai', model: 'gpt' },
      ],
      imports: [],
      edges: [
        { from: 'Workflow', to: 'PromptCompiler' },
        { from: 'SceneIntent', to: 'PromptCompiler' },
        { from: 'PromptCompiler', to: 'Prompt' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [
        { name: 'Workflow', type: 'string', required: true },
        { name: 'SceneIntent', type: 'string', required: true },
      ],
      outputs: [{ name: 'Prompt', type: 'string' }],
      producers: [],
      imports: [
        {
          name: 'TextPromptCompiler',
          path: './prompt-compiler.yaml',
          conditions: { when: 'Workflow', is: 'Text' },
        },
      ],
      edges: [
        { from: 'Workflow', to: 'TextPromptCompiler.Workflow' },
        { from: 'SceneIntent', to: 'TextPromptCompiler.SceneIntent' },
        { from: 'TextPromptCompiler.Prompt', to: 'Prompt' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'TextPromptCompiler',
          {
            id: 'PromptCompiler',
            namespacePath: ['TextPromptCompiler'],
            document: promptCompilerDoc,
            children: new Map(),
            sourcePath: '/test/prompt-compiler.yaml',
            importConditions: { when: 'Workflow', is: 'Text' },
          },
        ],
      ]),
      sourcePath: '/test/root.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const graphProducer = graph.nodes.find(
      (node) =>
        node.type === 'Producer' &&
        node.namespacePath.length === 1 &&
        node.namespacePath[0] === 'TextPromptCompiler' &&
        node.name === 'PromptCompiler'
    );
    expect(graphProducer?.activation).toEqual({
      condition: { when: 'Input:Workflow', is: 'Text' },
      inheritedFrom: [
        {
          namespacePath: ['TextPromptCompiler'],
          importName: 'TextPromptCompiler',
          parentNamespacePath: [],
          sourcePath: '/test/prompt-compiler.yaml',
          condition: { when: 'Input:Workflow', is: 'Text' },
        },
      ],
    });

    const childSceneIntentEdge = graph.edges.find(
      (edge) =>
        edge.from.nodeId === 'InputSource:TextPromptCompiler.SceneIntent' &&
        edge.to.nodeId === 'Producer:TextPromptCompiler'
    );
    expect(childSceneIntentEdge?.activationConditions).toBeUndefined();
    expect(childSceneIntentEdge?.endpointConditions).toBeUndefined();
    expect(childSceneIntentEdge?.authoredEdgeConditions).toBeUndefined();
    expect(childSceneIntentEdge?.conditions).toEqual({
      when: 'Input:Workflow',
      is: 'Text',
    });

    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:Workflow': 'Text',
        'Input:SceneIntent': 'Ottoman cannons bombing the castle',
      },
      inputSources
    );
    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);
    const canonicalProducer = expanded.nodes.find(
      (node) =>
        node.type === 'Producer' &&
        node.namespacePath.length === 1 &&
        node.namespacePath[0] === 'TextPromptCompiler' &&
        node.name === 'PromptCompiler'
    );
    expect(canonicalProducer?.activation).toEqual({
      condition: { when: 'Input:Workflow', is: 'Text' },
      indices: {},
      inheritedFrom: [
        {
          namespacePath: ['TextPromptCompiler'],
          importName: 'TextPromptCompiler',
          parentNamespacePath: [],
          sourcePath: '/test/prompt-compiler.yaml',
          condition: { when: 'Input:Workflow', is: 'Text' },
        },
      ],
    });

    const sceneIntentEdge = expanded.edges.find(
      (edge) =>
        edge.from === 'Input:SceneIntent' &&
        edge.to === 'Producer:TextPromptCompiler'
    );
    expect(sceneIntentEdge?.activationConditions).toBeUndefined();
    expect(sceneIntentEdge?.endpointConditions).toBeUndefined();
    expect(sceneIntentEdge?.authoredEdgeConditions).toBeUndefined();
    expect(sceneIntentEdge?.conditions).toEqual({
      when: 'Input:Workflow',
      is: 'Text',
    });

    const rootPromptBinding = expanded.outputSourceBindings.find(
      (binding) =>
        binding.outputId === 'Output:Prompt' &&
        binding.sourceId === 'Artifact:TextPromptCompiler.Prompt'
    );
    expect(rootPromptBinding?.endpointConditions).toEqual({
      when: 'Input:Workflow',
      is: 'Text',
    });
    expect(rootPromptBinding?.conditions).toBeUndefined();
  });

  it('collapses one public output to multiple explicit conditional route sources', () => {
    const routeProducerDoc: BlueprintDocument = {
      meta: { id: 'RouteProducer', name: 'RouteProducer', kind: 'producer' },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'GeneratedVideo', type: 'video' }],
      producers: [
        { name: 'VideoProducer', provider: 'fal-ai', model: 'video' },
      ],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'VideoProducer' },
        { from: 'VideoProducer', to: 'GeneratedVideo' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [
        { name: 'Workflow', type: 'string', required: true },
        { name: 'Prompt', type: 'string', required: true },
      ],
      outputs: [{ name: 'GeneratedVideo', type: 'video' }],
      producers: [],
      imports: [
        { name: 'TextRoute', path: './route.yaml' },
        { name: 'ReferenceRoute', path: './route.yaml' },
      ],
      edges: [
        { from: 'Prompt', to: 'TextRoute.Prompt' },
        { from: 'Prompt', to: 'ReferenceRoute.Prompt' },
        {
          from: 'TextRoute.GeneratedVideo',
          to: 'GeneratedVideo',
          conditions: { when: 'Workflow', is: 'Text' },
        },
        {
          from: 'ReferenceRoute.GeneratedVideo',
          to: 'GeneratedVideo',
          conditions: { when: 'Workflow', is: 'Reference' },
        },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'TextRoute',
          {
            id: 'RouteProducer',
            namespacePath: ['TextRoute'],
            document: routeProducerDoc,
            children: new Map(),
            sourcePath: '/test/route.yaml',
          },
        ],
        [
          'ReferenceRoute',
          {
            id: 'RouteProducer',
            namespacePath: ['ReferenceRoute'],
            document: routeProducerDoc,
            children: new Map(),
            sourcePath: '/test/route.yaml',
          },
        ],
      ]),
      sourcePath: '/test/root.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:Workflow': 'Text',
        'Input:Prompt': 'Ottoman cannons bombing the castle',
      },
      inputSources
    );
    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    expect(expanded.outputSources).not.toHaveProperty('Output:GeneratedVideo');
    expect(expanded.outputSourceBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outputId: 'Output:GeneratedVideo',
          sourceId: 'Artifact:TextRoute.GeneratedVideo',
          conditions: { when: 'Input:Workflow', is: 'Text' },
          authoredEdgeConditions: { when: 'Input:Workflow', is: 'Text' },
          indices: {},
        }),
        expect.objectContaining({
          outputId: 'Output:GeneratedVideo',
          sourceId: 'Artifact:ReferenceRoute.GeneratedVideo',
          conditions: { when: 'Input:Workflow', is: 'Reference' },
          authoredEdgeConditions: { when: 'Input:Workflow', is: 'Reference' },
          indices: {},
        }),
      ])
    );
  });

  it('exposes resolved activation, scalar binding, fan-in, and output route structures', () => {
    const gateDoc: BlueprintDocument = {
      meta: { id: 'GateProducer', name: 'GateProducer', kind: 'producer' },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'ShouldPublish', type: 'json' }],
      producers: [{ name: 'GateProducer', provider: 'openai', model: 'gpt-4o' }],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'GateProducer' },
        { from: 'GateProducer', to: 'ShouldPublish' },
      ],
    };

    const previewDoc: BlueprintDocument = {
      meta: { id: 'PreviewProducer', name: 'PreviewProducer', kind: 'producer' },
      inputs: [
        { name: 'Duration', type: 'int', required: true },
        { name: 'OptionalNote', type: 'string', required: false },
      ],
      outputs: [{ name: 'GeneratedVideo', type: 'video' }],
      producers: [
        { name: 'PreviewProducer', provider: 'fal-ai', model: 'video' },
      ],
      imports: [],
      edges: [
        { from: 'Duration', to: 'PreviewProducer' },
        { from: 'OptionalNote', to: 'PreviewProducer' },
        { from: 'PreviewProducer', to: 'GeneratedVideo' },
      ],
    };

    const timelineDoc: BlueprintDocument = {
      meta: { id: 'TimelineProducer', name: 'TimelineProducer', kind: 'producer' },
      inputs: [{ name: 'Clips', type: 'array', required: false, fanIn: true }],
      outputs: [{ name: 'Movie', type: 'video' }],
      producers: [
        { name: 'TimelineProducer', provider: 'renku', model: 'timeline' },
      ],
      imports: [],
      edges: [
        { from: 'Clips', to: 'TimelineProducer' },
        { from: 'TimelineProducer', to: 'Movie' },
      ],
    };

    const usePreview = { when: 'UsePreview', is: true };
    const publishPreview = {
      when: 'GateProducer.ShouldPublish',
      is: true,
    };
    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [
        { name: 'UsePreview', type: 'boolean', required: true },
        { name: 'Prompt', type: 'string', required: true },
        { name: 'Duration', type: 'int', required: true },
        { name: 'OptionalNote', type: 'string', required: false },
      ],
      outputs: [
        { name: 'Movie', type: 'video' },
        { name: 'PreviewVideo', type: 'video' },
      ],
      producers: [],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'GateProducer.Prompt' },
        { from: 'Duration', to: 'PreviewProducer.Duration' },
        {
          from: 'OptionalNote',
          to: 'PreviewProducer.OptionalNote',
          conditions: publishPreview,
        },
        {
          from: 'PreviewProducer.GeneratedVideo',
          to: 'TimelineProducer.Clips',
          conditions: publishPreview,
        },
        { from: 'TimelineProducer.Movie', to: 'Movie' },
        {
          from: 'PreviewProducer.GeneratedVideo',
          to: 'PreviewVideo',
          conditions: publishPreview,
        },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'GateProducer',
          {
            id: 'GateProducer',
            namespacePath: ['GateProducer'],
            document: gateDoc,
            children: new Map(),
            sourcePath: '/test/gate.yaml',
          },
        ],
        [
          'PreviewProducer',
          {
            id: 'PreviewProducer',
            namespacePath: ['PreviewProducer'],
            document: previewDoc,
            children: new Map(),
            sourcePath: '/test/preview.yaml',
            importConditions: usePreview,
          },
        ],
        [
          'TimelineProducer',
          {
            id: 'TimelineProducer',
            namespacePath: ['TimelineProducer'],
            document: timelineDoc,
            children: new Map(),
            sourcePath: '/test/timeline.yaml',
          },
        ],
      ]),
      sourcePath: '/test/root.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:UsePreview': true,
        'Input:Prompt': 'preview this',
        'Input:Duration': 8,
        'Input:OptionalNote': 'lower thirds',
      },
      inputSources
    );

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    expect(
      expanded.resolvedProducerActivations['Producer:PreviewProducer']
    ).toMatchObject({
      condition: { when: 'Input:UsePreview', is: true },
      indices: {},
      inheritedFrom: [
        expect.objectContaining({
          importName: 'PreviewProducer',
          namespacePath: ['PreviewProducer'],
        }),
      ],
    });

    const previewScalarBindings =
      expanded.resolvedScalarBindings['Producer:PreviewProducer'] ?? [];
    expect(previewScalarBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inputId: 'Duration',
          sourceId: 'Input:Duration',
          optionalCondition: expect.objectContaining({
            indices: {},
          }),
        }),
        expect.objectContaining({
          inputId: 'OptionalNote',
          sourceId: 'Input:OptionalNote',
          optionalCondition: expect.objectContaining({
            indices: {},
          }),
        }),
      ])
    );
    expect(JSON.stringify(previewScalarBindings)).toContain('Input:UsePreview');
    expect(JSON.stringify(previewScalarBindings)).toContain(
      'Output:GateProducer.ShouldPublish'
    );

    const clipsFanIn =
      expanded.resolvedFanInDescriptors['Input:TimelineProducer.Clips'];
    expect(clipsFanIn).toMatchObject({
      groupBy: 'singleton',
      orderBy: undefined,
      members: [
        expect.objectContaining({
          id: 'Artifact:PreviewProducer.GeneratedVideo',
          group: 0,
          order: 0,
          condition: expect.objectContaining({
            indices: {},
          }),
        }),
      ],
    });
    expect(JSON.stringify(clipsFanIn)).toContain(
      'Artifact:GateProducer.ShouldPublish'
    );

    const previewRoute = expanded.resolvedOutputRoutes.find(
      (route) => route.outputId === 'Output:PreviewVideo'
    );
    expect(previewRoute).toMatchObject({
      outputId: 'Output:PreviewVideo',
      sourceId: 'Artifact:PreviewProducer.GeneratedVideo',
      indices: {},
    });
    expect(JSON.stringify(previewRoute)).toContain(
      'Artifact:GateProducer.ShouldPublish'
    );
  });

  it('rejects multi-source public outputs without explicit route conditions', () => {
    const routeProducerDoc: BlueprintDocument = {
      meta: { id: 'RouteProducer', name: 'RouteProducer', kind: 'producer' },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'GeneratedVideo', type: 'video' }],
      producers: [
        { name: 'VideoProducer', provider: 'fal-ai', model: 'video' },
      ],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'VideoProducer' },
        { from: 'VideoProducer', to: 'GeneratedVideo' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [
        { name: 'Workflow', type: 'string', required: true },
        { name: 'Prompt', type: 'string', required: true },
      ],
      outputs: [{ name: 'GeneratedVideo', type: 'video' }],
      producers: [],
      imports: [
        { name: 'TextRoute', path: './route.yaml' },
        { name: 'ReferenceRoute', path: './route.yaml' },
      ],
      edges: [
        { from: 'Prompt', to: 'TextRoute.Prompt' },
        { from: 'Prompt', to: 'ReferenceRoute.Prompt' },
        { from: 'TextRoute.GeneratedVideo', to: 'GeneratedVideo' },
        {
          from: 'ReferenceRoute.GeneratedVideo',
          to: 'GeneratedVideo',
          conditions: { when: 'Workflow', is: 'Reference' },
        },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        [
          'TextRoute',
          {
            id: 'RouteProducer',
            namespacePath: ['TextRoute'],
            document: routeProducerDoc,
            children: new Map(),
            sourcePath: '/test/route.yaml',
          },
        ],
        [
          'ReferenceRoute',
          {
            id: 'RouteProducer',
            namespacePath: ['ReferenceRoute'],
            document: routeProducerDoc,
            children: new Map(),
            sourcePath: '/test/route.yaml',
          },
        ],
      ]),
      sourcePath: '/test/root.yaml',
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues(
      {
        'Input:Workflow': 'Text',
        'Input:Prompt': 'Ottoman cannons bombing the castle',
      },
      inputSources
    );

    expect(() =>
      expandBlueprintGraph(graph, canonicalInputs, inputSources)
    ).toThrow(
      'Every route to a multi-source Output must declare an explicit condition'
    );
  });
});
