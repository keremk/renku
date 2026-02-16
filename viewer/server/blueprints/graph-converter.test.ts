/**
 * Tests for blueprint graph converter.
 */

import { describe, it, expect } from 'vitest';
import {
  convertTreeToGraph,
  collectNodesAndEdges,
  normalizeProducerName,
  resolveEndpoint,
  resolveEdgeEndpoints,
} from './graph-converter.js';

describe('normalizeProducerName', () => {
  it('removes loop index suffixes', () => {
    expect(normalizeProducerName('VideoProducer[segment]')).toBe(
      'VideoProducer'
    );
    expect(normalizeProducerName('VideoProducer[segment-1]')).toBe(
      'VideoProducer'
    );
    expect(normalizeProducerName('VideoProducer[0]')).toBe('VideoProducer');
    expect(normalizeProducerName('ImageProducer[segment][image]')).toBe(
      'ImageProducer'
    );
  });

  it('preserves names without suffixes', () => {
    expect(normalizeProducerName('VideoProducer')).toBe('VideoProducer');
    expect(normalizeProducerName('SimpleProducer')).toBe('SimpleProducer');
  });

  it('preserves empty brackets (not valid loop syntax)', () => {
    // Empty brackets are not valid loop syntax, so they are preserved
    expect(normalizeProducerName('Producer[]')).toBe('Producer[]');
  });
});

describe('resolveEndpoint', () => {
  const inputNames = new Set(['Title', 'Count', 'Message']);
  const producerNames = new Set(['AudioGen', 'VideoGen', 'TextProducer']);
  const artifactNames = new Set(['FinalVideo', 'GeneratedAudio']);

  it('resolves input references', () => {
    expect(
      resolveEndpoint('Title', inputNames, producerNames, artifactNames)
    ).toEqual({
      type: 'input',
    });
    expect(
      resolveEndpoint('Input.Title', inputNames, producerNames, artifactNames)
    ).toEqual({
      type: 'input',
    });
  });

  it('resolves producer references', () => {
    expect(
      resolveEndpoint('AudioGen', inputNames, producerNames, artifactNames)
    ).toEqual({
      type: 'producer',
      producer: 'AudioGen',
    });
    expect(
      resolveEndpoint(
        'AudioGen.Output',
        inputNames,
        producerNames,
        artifactNames
      )
    ).toEqual({
      type: 'producer',
      producer: 'AudioGen',
    });
  });

  it('resolves output/artifact references', () => {
    expect(
      resolveEndpoint('FinalVideo', inputNames, producerNames, artifactNames)
    ).toEqual({
      type: 'output',
    });
    expect(
      resolveEndpoint(
        'Output.FinalVideo',
        inputNames,
        producerNames,
        artifactNames
      )
    ).toEqual({
      type: 'output',
    });
  });

  it('handles loop-indexed producer names', () => {
    expect(
      resolveEndpoint('VideoGen[0]', inputNames, producerNames, artifactNames)
    ).toEqual({
      type: 'producer',
      producer: 'VideoGen[0]',
    });
  });

  it('returns unknown for unrecognized references', () => {
    expect(
      resolveEndpoint(
        'SomeOther.Thing',
        inputNames,
        producerNames,
        artifactNames
      )
    ).toEqual({
      type: 'unknown',
    });

    expect(
      resolveEndpoint(
        'UnknownProducer.FinalVideo',
        inputNames,
        producerNames,
        artifactNames
      )
    ).toEqual({
      type: 'unknown',
    });
  });

  it('recognizes system input references without explicit input declarations', () => {
    expect(
      resolveEndpoint('Duration', inputNames, producerNames, artifactNames)
    ).toEqual({
      type: 'input',
    });

    expect(
      resolveEndpoint('NumOfSegments', inputNames, producerNames, artifactNames)
    ).toEqual({
      type: 'input',
    });
  });
});

describe('resolveEdgeEndpoints', () => {
  const inputNames = new Set(['Title', 'Count']);
  const producerNames = new Set(['AudioGen', 'VideoGen']);
  const artifactNames = new Set(['FinalVideo']);

  it('resolves input to producer edge', () => {
    const result = resolveEdgeEndpoints(
      'Title',
      'AudioGen.Input',
      inputNames,
      producerNames,
      artifactNames
    );
    expect(result.sourceType).toBe('input');
    expect(result.targetType).toBe('producer');
    expect(result.targetProducer).toBe('AudioGen');
  });

  it('resolves producer to producer edge', () => {
    const result = resolveEdgeEndpoints(
      'AudioGen.Output',
      'VideoGen.Input',
      inputNames,
      producerNames,
      artifactNames
    );
    expect(result.sourceType).toBe('producer');
    expect(result.sourceProducer).toBe('AudioGen');
    expect(result.targetType).toBe('producer');
    expect(result.targetProducer).toBe('VideoGen');
  });

  it('resolves producer to output edge', () => {
    const result = resolveEdgeEndpoints(
      'VideoGen.Output',
      'FinalVideo',
      inputNames,
      producerNames,
      artifactNames
    );
    expect(result.sourceType).toBe('producer');
    expect(result.sourceProducer).toBe('VideoGen');
    expect(result.targetType).toBe('output');
  });

  it('throws when source endpoint cannot be resolved', () => {
    expect(() =>
      resolveEdgeEndpoints(
        'MissingThing',
        'AudioGen.Input',
        inputNames,
        producerNames,
        artifactNames
      )
    ).toThrow('Unable to resolve edge source endpoint: MissingThing');
  });

  it('throws when target endpoint cannot be resolved', () => {
    expect(() =>
      resolveEdgeEndpoints(
        'Title',
        'UnknownProducer.Param',
        inputNames,
        producerNames,
        artifactNames
      )
    ).toThrow('Unable to resolve edge target endpoint: UnknownProducer.Param');
  });
});

describe('collectNodesAndEdges', () => {
  it('attaches detailed input/output bindings to producer nodes', () => {
    const node = {
      document: {
        meta: { id: 'id', name: 'test' },
        inputs: [{ name: 'Title', type: 'string', required: true }],
        producerImports: [
          { name: 'AudioGen', producer: 'asset/text-to-audio' },
          { name: 'VideoGen', producer: 'asset/text-to-video' },
        ],
        artefacts: [{ name: 'FinalVideo', type: 'video' }],
        edges: [
          { from: 'Title', to: 'AudioGen.Input' },
          { from: 'AudioGen.Output', to: 'VideoGen.Input', if: 'HasAudio' },
          { from: 'VideoGen.Output', to: 'FinalVideo' },
        ],
      },
    } as unknown as import('@gorenku/core').BlueprintTreeNode;

    const nodes: import('../types.js').BlueprintGraphNode[] = [];
    const edges: import('../types.js').BlueprintGraphEdge[] = [];
    const conditions: import('../types.js').ConditionDef[] = [];

    collectNodesAndEdges(node, nodes, edges, conditions);

    const audioNode = nodes.find((n) => n.id === 'Producer:AudioGen');
    const videoNode = nodes.find((n) => n.id === 'Producer:VideoGen');

    expect(audioNode?.inputBindings).toEqual([
      expect.objectContaining({
        from: 'Title',
        to: 'AudioGen.Input',
        sourceType: 'input',
        targetType: 'producer',
      }),
    ]);
    expect(audioNode?.outputBindings).toEqual([
      expect.objectContaining({
        from: 'AudioGen.Output',
        to: 'VideoGen.Input',
        sourceType: 'producer',
        targetType: 'producer',
        conditionName: 'HasAudio',
        isConditional: true,
      }),
    ]);

    expect(videoNode?.inputBindings).toEqual([
      expect.objectContaining({
        from: 'AudioGen.Output',
        to: 'VideoGen.Input',
        sourceType: 'producer',
        targetType: 'producer',
      }),
    ]);
    expect(videoNode?.outputBindings).toEqual([
      expect.objectContaining({
        from: 'VideoGen.Output',
        to: 'FinalVideo',
        sourceType: 'producer',
        targetType: 'output',
      }),
    ]);
  });

  it('resolves nested loop producer references and wires ImageProducer bindings', () => {
    const node = {
      document: {
        meta: { id: 'id', name: 'test' },
        inputs: [
          { name: 'Size', type: 'string', required: false },
          { name: 'AspectRatio', type: 'string', required: false },
        ],
        producerImports: [
          { name: 'ImagePromptProducer', producer: 'prompt/image' },
          { name: 'ImageProducer', producer: 'asset/text-to-image' },
          {
            name: 'TimelineComposer',
            producer: 'composition/timeline-composer',
          },
        ],
        artefacts: [{ name: 'SegmentImage', type: 'array', itemType: 'image' }],
        edges: [
          {
            from: 'ImagePromptProducer.ImagePrompt[segment][image]',
            to: 'ImageProducer[segment][image].Prompt',
          },
          {
            from: 'Size',
            to: 'ImageProducer[segment][image].Resolution',
          },
          {
            from: 'AspectRatio',
            to: 'ImageProducer[segment][image].AspectRatio',
          },
          {
            from: 'ImageProducer[segment][image].GeneratedImage',
            to: 'SegmentImage[segment][image]',
          },
          {
            from: 'ImageProducer[segment][image].GeneratedImage',
            to: 'TimelineComposer.ImageSegments',
          },
        ],
      },
    } as unknown as import('@gorenku/core').BlueprintTreeNode;

    const nodes: import('../types.js').BlueprintGraphNode[] = [];
    const edges: import('../types.js').BlueprintGraphEdge[] = [];
    const conditions: import('../types.js').ConditionDef[] = [];

    collectNodesAndEdges(node, nodes, edges, conditions);

    const imageNode = nodes.find((n) => n.id === 'Producer:ImageProducer');

    expect(imageNode?.inputBindings).toEqual([
      expect.objectContaining({
        from: 'ImagePromptProducer.ImagePrompt[segment][image]',
        to: 'ImageProducer[segment][image].Prompt',
        sourceType: 'producer',
        targetType: 'producer',
      }),
      expect.objectContaining({
        from: 'Size',
        to: 'ImageProducer[segment][image].Resolution',
        sourceType: 'input',
        targetType: 'producer',
      }),
      expect.objectContaining({
        from: 'AspectRatio',
        to: 'ImageProducer[segment][image].AspectRatio',
        sourceType: 'input',
        targetType: 'producer',
      }),
    ]);

    expect(imageNode?.outputBindings).toEqual([
      expect.objectContaining({
        from: 'ImageProducer[segment][image].GeneratedImage',
        to: 'SegmentImage[segment][image]',
        sourceType: 'producer',
        targetType: 'output',
      }),
      expect.objectContaining({
        from: 'ImageProducer[segment][image].GeneratedImage',
        to: 'TimelineComposer.ImageSegments',
        sourceType: 'producer',
        targetType: 'producer',
      }),
    ]);

    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Inputs',
          target: 'Producer:ImageProducer',
        }),
        expect.objectContaining({
          source: 'Producer:ImagePromptProducer',
          target: 'Producer:ImageProducer',
        }),
        expect.objectContaining({
          source: 'Producer:ImageProducer',
          target: 'Producer:TimelineComposer',
        }),
        expect.objectContaining({
          source: 'Producer:ImageProducer',
          target: 'Outputs',
        }),
      ])
    );
  });

  it('throws on unresolved edge endpoints instead of applying fallback classification', () => {
    const node = {
      document: {
        meta: { id: 'id', name: 'test' },
        inputs: [{ name: 'Title', type: 'string', required: true }],
        producerImports: [
          { name: 'AudioGen', producer: 'asset/text-to-audio' },
        ],
        artefacts: [{ name: 'FinalAudio', type: 'audio' }],
        edges: [
          { from: 'Title', to: 'AudioGen.Input' },
          { from: 'UnknownThing', to: 'AudioGen.Input' },
        ],
      },
    } as unknown as import('@gorenku/core').BlueprintTreeNode;

    const nodes: import('../types.js').BlueprintGraphNode[] = [];
    const edges: import('../types.js').BlueprintGraphEdge[] = [];
    const conditions: import('../types.js').ConditionDef[] = [];

    expect(() => collectNodesAndEdges(node, nodes, edges, conditions)).toThrow(
      'Unable to resolve edge source endpoint: UnknownThing'
    );
  });
});

describe('convertTreeToGraph', () => {
  it('injects referenced system inputs into graph input definitions', () => {
    const root = {
      document: {
        meta: { id: 'id', name: 'test' },
        inputs: [],
        producerImports: [
          { name: 'AudioGen', producer: 'asset/text-to-audio' },
        ],
        artefacts: [{ name: 'FinalAudio', type: 'audio' }],
        edges: [
          { from: 'Duration', to: 'AudioGen.Duration' },
          { from: 'AudioGen.Output', to: 'FinalAudio' },
        ],
      },
    } as unknown as import('@gorenku/core').BlueprintTreeNode;

    const graph = convertTreeToGraph(root);

    expect(graph.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Duration',
          type: 'number',
          required: false,
        }),
      ])
    );

    const inputsNode = graph.nodes.find((node) => node.id === 'Inputs');
    expect(inputsNode?.description).toBe('1 input');
  });
});
