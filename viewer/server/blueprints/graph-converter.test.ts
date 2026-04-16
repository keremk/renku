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
import type { BlueprintTreeNode } from '@gorenku/core';

function makeTreeNode(
  document: Record<string, unknown>,
  namespacePath: string[] = []
): BlueprintTreeNode {
  const meta = document.meta as { id: string };
  const normalizedDocument = {
    inputs: [],
    outputs: [],
    producers: [],
    imports: [],
    edges: [],
    loops: [],
    ...document,
  };
  return {
    id: String(meta.id),
    namespacePath,
    document: normalizedDocument,
    children: new Map(),
    sourcePath: '/tmp/test-blueprint.yaml',
  } as unknown as BlueprintTreeNode;
}

function makeProducerTreeNode(args: {
  name: string;
  inputs?: Array<{ name: string; type: string; required?: boolean }>;
  outputs?: Array<{ name: string; type: string; itemType?: string }>;
  producerType?: string;
  namespacePath?: string[];
}): BlueprintTreeNode {
  const namespacePath = args.namespacePath ?? [args.name];
  return makeTreeNode(
    {
      meta: { id: `${args.name}-id`, name: args.name, kind: 'producer' },
      inputs: args.inputs ?? [],
      outputs: args.outputs ?? [],
      producers: [
        {
          name: args.name,
          producer: args.producerType ?? 'test/producer',
        },
      ],
    },
    namespacePath
  );
}

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
    const node = makeTreeNode({
      meta: { id: 'id', name: 'test' },
      inputs: [{ name: 'Title', type: 'string', required: true }],
      producers: [],
      imports: [
        { name: 'AudioGen', producer: 'asset/text-to-audio' },
        { name: 'VideoGen', producer: 'asset/text-to-video' },
      ],
      outputs: [{ name: 'FinalVideo', type: 'video' }],
      edges: [
        { from: 'Title', to: 'AudioGen.Input' },
        { from: 'AudioGen.Output', to: 'VideoGen.Input', if: 'HasAudio' },
        { from: 'VideoGen.Output', to: 'FinalVideo' },
      ],
    });
    node.children.set(
      'AudioGen',
      makeProducerTreeNode({
        name: 'AudioGen',
        namespacePath: ['AudioGen'],
        inputs: [{ name: 'Input', type: 'string', required: true }],
        outputs: [{ name: 'Output', type: 'audio' }],
        producerType: 'asset/text-to-audio',
      })
    );
    node.children.set(
      'VideoGen',
      makeProducerTreeNode({
        name: 'VideoGen',
        namespacePath: ['VideoGen'],
        inputs: [{ name: 'Input', type: 'string', required: true }],
        outputs: [{ name: 'Output', type: 'video' }],
        producerType: 'asset/text-to-video',
      })
    );

    const nodes: import('../types.js').BlueprintGraphNode[] = [];
    const edges: import('../types.js').BlueprintGraphEdge[] = [];
    const conditions: import('../types.js').ConditionDef[] = [];

    collectNodesAndEdges(node, nodes, edges, conditions);

    const audioNode = nodes.find((n) => n.id === 'Producer:AudioGen');
    const videoNode = nodes.find((n) => n.id === 'Producer:VideoGen');

    expect(audioNode?.inputBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'Input.Title',
          to: 'AudioGen.Input',
          sourceType: 'input',
          targetType: 'producer',
        }),
      ])
    );
    expect(audioNode?.outputBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'AudioGen.Output',
          to: 'VideoGen.Input',
          sourceType: 'producer',
          targetType: 'producer',
          isConditional: true,
          conditionName: 'HasAudio',
        }),
      ])
    );

    expect(videoNode?.inputBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'AudioGen.Output',
          to: 'VideoGen.Input',
          sourceType: 'producer',
          targetType: 'producer',
          isConditional: true,
          conditionName: 'HasAudio',
        }),
      ])
    );
    expect(videoNode?.outputBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'VideoGen.Output',
          to: 'Output.FinalVideo',
          sourceType: 'producer',
          targetType: 'output',
        }),
      ])
    );
  });

  it('resolves nested loop producer references and wires ImageProducer bindings', () => {
    const node = makeTreeNode({
      meta: { id: 'id', name: 'test' },
      inputs: [
        { name: 'Size', type: 'string', required: false },
        { name: 'AspectRatio', type: 'string', required: false },
      ],
      imports: [
        { name: 'ImagePromptProducer', producer: 'prompt/image' },
        { name: 'ImageProducer', producer: 'asset/text-to-image' },
        {
          name: 'TimelineComposer',
          producer: 'composition/timeline-composer',
        },
      ],
      outputs: [{ name: 'SegmentImage', type: 'array', itemType: 'image' }],
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
    });
    node.children.set(
      'ImagePromptProducer',
      makeProducerTreeNode({
        name: 'ImagePromptProducer',
        namespacePath: ['ImagePromptProducer'],
        outputs: [{ name: 'ImagePrompt', type: 'string' }],
        producerType: 'prompt/image',
      })
    );
    node.children.set(
      'ImageProducer',
      makeProducerTreeNode({
        name: 'ImageProducer',
        namespacePath: ['ImageProducer'],
        inputs: [
          { name: 'Prompt', type: 'string' },
          { name: 'Resolution', type: 'string' },
          { name: 'AspectRatio', type: 'string' },
        ],
        outputs: [{ name: 'GeneratedImage', type: 'image' }],
        producerType: 'asset/text-to-image',
      })
    );
    node.children.set(
      'TimelineComposer',
      makeProducerTreeNode({
        name: 'TimelineComposer',
        namespacePath: ['TimelineComposer'],
        inputs: [{ name: 'ImageSegments', type: 'image' }],
        outputs: [{ name: 'Timeline', type: 'json' }],
        producerType: 'composition/timeline-composer',
      })
    );

    const nodes: import('../types.js').BlueprintGraphNode[] = [];
    const edges: import('../types.js').BlueprintGraphEdge[] = [];
    const conditions: import('../types.js').ConditionDef[] = [];

    collectNodesAndEdges(node, nodes, edges, conditions);

    const imageNode = nodes.find((n) => n.id === 'Producer:ImageProducer');

    expect(imageNode?.inputBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'ImagePromptProducer.ImagePrompt',
          to: 'ImageProducer.Prompt',
          sourceType: 'producer',
          targetType: 'producer',
          targetEndpoint: expect.objectContaining({
            producerId: 'Producer:ImageProducer',
            selectorPath: [
              expect.objectContaining({ kind: 'loop', symbol: 'segment' }),
              expect.objectContaining({ kind: 'loop', symbol: 'image' }),
            ],
          }),
        }),
        expect.objectContaining({
          from: 'Input.Size',
          to: 'ImageProducer.Resolution',
          sourceType: 'input',
          targetType: 'producer',
        }),
        expect.objectContaining({
          from: 'Input.AspectRatio',
          to: 'ImageProducer.AspectRatio',
          sourceType: 'input',
          targetType: 'producer',
        }),
      ])
    );

    expect(imageNode?.outputBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'ImageProducer.GeneratedImage',
          to: 'Output.SegmentImage',
          sourceType: 'producer',
          targetType: 'output',
        }),
        expect.objectContaining({
          from: 'ImageProducer.GeneratedImage',
          to: 'TimelineComposer.ImageSegments',
          sourceType: 'producer',
          targetType: 'producer',
        }),
      ])
    );

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
    const node = makeTreeNode({
      meta: { id: 'id', name: 'test' },
      inputs: [{ name: 'Title', type: 'string', required: true }],
      producers: [],
      imports: [{ name: 'AudioGen', producer: 'asset/text-to-audio' }],
      outputs: [{ name: 'FinalAudio', type: 'audio' }],
      edges: [
        { from: 'Title', to: 'AudioGen.Input' },
        { from: 'UnknownThing', to: 'AudioGen.Input' },
      ],
    });
    node.children.set(
      'AudioGen',
      makeProducerTreeNode({
        name: 'AudioGen',
        namespacePath: ['AudioGen'],
        inputs: [{ name: 'Input', type: 'string', required: true }],
        outputs: [{ name: 'Output', type: 'audio' }],
        producerType: 'asset/text-to-audio',
      })
    );

    const nodes: import('../types.js').BlueprintGraphNode[] = [];
    const edges: import('../types.js').BlueprintGraphEdge[] = [];
    const conditions: import('../types.js').ConditionDef[] = [];

    expect(() => collectNodesAndEdges(node, nodes, edges, conditions)).toThrow(
      'Canonical graph edge references missing node(s): Output:UnknownThing -> InputSource:AudioGen.Input.'
    );
  });
});

describe('convertTreeToGraph', () => {
  it('injects referenced system inputs into graph input definitions', () => {
    const root = makeTreeNode({
      meta: { id: 'id', name: 'test' },
      inputs: [],
      producers: [],
      imports: [{ name: 'AudioGen', producer: 'asset/text-to-audio' }],
      outputs: [{ name: 'FinalAudio', type: 'audio' }],
      edges: [
        { from: 'Duration', to: 'AudioGen.Duration' },
        { from: 'AudioGen.Output', to: 'FinalAudio' },
      ],
    });
    root.children.set(
      'AudioGen',
      makeProducerTreeNode({
        name: 'AudioGen',
        namespacePath: ['AudioGen'],
        inputs: [{ name: 'Duration', type: 'number', required: true }],
        outputs: [{ name: 'Output', type: 'audio' }],
        producerType: 'asset/text-to-audio',
      })
    );

    const graph = convertTreeToGraph(root);

    expect(graph.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Duration',
          type: 'number',
          required: false,
          system: expect.objectContaining({
            kind: 'user',
            userSupplied: true,
          }),
        }),
      ])
    );

    const inputsNode = graph.nodes.find((node) => node.id === 'Inputs');
    expect(inputsNode?.description).toBe('1 input');
  });

  it('marks derived system inputs as non-user-supplied in metadata', () => {
    const root = makeTreeNode({
      meta: { id: 'id', name: 'test' },
      inputs: [],
      producers: [],
      imports: [{ name: 'VideoGen', producer: 'asset/text-to-video' }],
      outputs: [{ name: 'FinalVideo', type: 'video' }],
      edges: [
        { from: 'SegmentDuration', to: 'VideoGen.Duration' },
        { from: 'VideoGen.Output', to: 'FinalVideo' },
      ],
    });
    root.children.set(
      'VideoGen',
      makeProducerTreeNode({
        name: 'VideoGen',
        namespacePath: ['VideoGen'],
        inputs: [{ name: 'Duration', type: 'number', required: true }],
        outputs: [{ name: 'Output', type: 'video' }],
        producerType: 'asset/text-to-video',
      })
    );

    const graph = convertTreeToGraph(root);
    const segmentDuration = graph.inputs.find(
      (input) => input.name === 'SegmentDuration'
    );

    expect(segmentDuration).toBeDefined();
    expect(segmentDuration?.system).toEqual({
      kind: 'derived',
      userSupplied: false,
      source: 'declared',
    });
  });

  it('injects NumOfSegments when referenced only through loop cardinality', () => {
    const root = makeTreeNode({
      meta: { id: 'id', name: 'test' },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      producers: [],
      imports: [
        { name: 'ImageGen', producer: 'asset/text-to-image', loop: 'scene' },
      ],
      outputs: [
        {
          name: 'SceneImages',
          type: 'array',
          itemType: 'image',
          countInput: 'NumOfSegments',
        },
      ],
      loops: [{ name: 'scene', countInput: 'NumOfSegments' }],
      edges: [
        { from: 'Prompt', to: 'ImageGen[scene].Prompt' },
        { from: 'ImageGen[scene].Output', to: 'SceneImages[scene]' },
      ],
    });
    root.children.set(
      'ImageGen',
      makeProducerTreeNode({
        name: 'ImageGen',
        namespacePath: ['ImageGen'],
        inputs: [{ name: 'Prompt', type: 'string', required: true }],
        outputs: [{ name: 'Output', type: 'image' }],
        producerType: 'asset/text-to-image',
      })
    );

    const graph = convertTreeToGraph(root);
    const numOfSegments = graph.inputs.find(
      (input) => input.name === 'NumOfSegments'
    );

    expect(numOfSegments).toBeDefined();
    expect(numOfSegments?.system).toEqual({
      kind: 'user',
      userSupplied: true,
      source: 'declared',
    });
  });
});
