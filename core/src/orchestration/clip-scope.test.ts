import { describe, expect, it } from 'vitest';
import { RuntimeErrorCode } from '../errors/index.js';
import type { ProducerGraph, ProducerGraphNode } from '../types.js';
import { resolveClipScope } from './clip-scope.js';

function makeNode(args: {
  jobId: string;
  indices?: Record<string, number>;
}): ProducerGraphNode {
  return {
    jobId: args.jobId,
    producer: args.jobId,
    inputs: [],
    produces: [],
    provider: 'test-provider',
    providerModel: 'test-model',
    rateKey: 'test-rate',
    context: {
      namespacePath: [],
      indices: args.indices ?? {},
      producerAlias: args.jobId,
      inputs: [],
      produces: [],
    },
  };
}

function buildGraph(): ProducerGraph {
  return {
    nodes: [
      makeNode({ jobId: 'Producer:Planner' }),
      makeNode({ jobId: 'Producer:ClipWorker[0]', indices: { clip: 0 } }),
      makeNode({ jobId: 'Producer:ClipWorker[1]', indices: { clip: 1 } }),
      makeNode({ jobId: 'Producer:ClipWorker[2]', indices: { clip: 2 } }),
      makeNode({
        jobId: 'Producer:NestedWorker[2][1]',
        indices: { clip: 2, image: 1 },
      }),
      makeNode({ jobId: 'Producer:FinalAssembly' }),
    ],
    edges: [
      { from: 'Producer:Planner', to: 'Producer:ClipWorker[0]' },
      { from: 'Producer:Planner', to: 'Producer:ClipWorker[1]' },
      { from: 'Producer:Planner', to: 'Producer:ClipWorker[2]' },
      { from: 'Producer:ClipWorker[2]', to: 'Producer:NestedWorker[2][1]' },
      { from: 'Producer:ClipWorker[0]', to: 'Producer:FinalAssembly' },
      { from: 'Producer:ClipWorker[1]', to: 'Producer:FinalAssembly' },
      { from: 'Producer:ClipWorker[2]', to: 'Producer:FinalAssembly' },
    ],
  };
}

describe('resolveClipScope', () => {
  it('includes jobs through the requested clip index', () => {
    const result = resolveClipScope({
      producerGraph: buildGraph(),
      scope: {
        dimension: 'clip',
        indices: [1],
        mode: 'through',
        includeUpstream: true,
      },
    });

    expect(Array.from(result.selectedJobIds).sort()).toEqual([
      'Producer:ClipWorker[0]',
      'Producer:ClipWorker[1]',
    ]);
    expect(Array.from(result.upstreamJobIds)).toEqual(['Producer:Planner']);
    expect(result.blockedJobIds).toEqual(
      new Set([
        'Producer:ClipWorker[2]',
        'Producer:NestedWorker[2][1]',
        'Producer:FinalAssembly',
      ])
    );
  });

  it('includes only the selected clip and required upstream jobs', () => {
    const result = resolveClipScope({
      producerGraph: buildGraph(),
      scope: {
        dimension: 'clip',
        indices: [1],
        mode: 'only',
        includeUpstream: true,
      },
    });

    expect(result.selectedJobIds).toEqual(new Set(['Producer:ClipWorker[1]']));
    expect(result.scopedJobIds).toEqual(
      new Set(['Producer:ClipWorker[1]', 'Producer:Planner'])
    );
    expect(result.blockedJobIds.has('Producer:ClipWorker[0]')).toBe(true);
    expect(result.blockedJobIds.has('Producer:FinalAssembly')).toBe(true);
  });

  it('uses structured indices instead of parsing job IDs', () => {
    const producerGraph: ProducerGraph = {
      nodes: [
        makeNode({ jobId: 'Producer:Planner[1]' }),
        makeNode({ jobId: 'Producer:MisleadingClip7' }),
        makeNode({ jobId: 'Producer:ActuallyClipOne', indices: { clip: 1 } }),
      ],
      edges: [
        { from: 'Producer:Planner[1]', to: 'Producer:ActuallyClipOne' },
      ],
    };

    const result = resolveClipScope({
      producerGraph,
      scope: {
        dimension: 'clip',
        indices: [1],
        mode: 'only',
        includeUpstream: true,
      },
    });

    expect(result.selectedJobIds).toEqual(new Set(['Producer:ActuallyClipOne']));
    expect(result.upstreamJobIds).toEqual(new Set(['Producer:Planner[1]']));
    expect(result.blockedJobIds).toEqual(new Set(['Producer:MisleadingClip7']));
  });

  it('uses nested dimension metadata to select clip-local jobs', () => {
    const result = resolveClipScope({
      producerGraph: buildGraph(),
      scope: {
        dimension: 'clip',
        indices: [2],
        mode: 'only',
        includeUpstream: true,
      },
    });

    expect(result.selectedJobIds).toEqual(
      new Set(['Producer:ClipWorker[2]', 'Producer:NestedWorker[2][1]'])
    );
    expect(result.scopedJobIds).toEqual(
      new Set([
        'Producer:ClipWorker[2]',
        'Producer:NestedWorker[2][1]',
        'Producer:Planner',
      ])
    );
  });

  it('rejects clip scope dimensions that do not exist in the graph', () => {
    expect(() =>
      resolveClipScope({
        producerGraph: buildGraph(),
        scope: {
          dimension: 'scene',
          indices: [0],
          mode: 'only',
          includeUpstream: true,
        },
      })
    ).toThrowError(
      expect.objectContaining({
        code: RuntimeErrorCode.INVALID_CLIP_SCOPE,
        message:
          'Invalid clip scope: dimension "scene" does not exist in the producer graph.',
      })
    );
  });

  it('rejects exact clip indices that do not exist in the graph', () => {
    expect(() =>
      resolveClipScope({
        producerGraph: buildGraph(),
        scope: {
          dimension: 'clip',
          indices: [99],
          mode: 'only',
          includeUpstream: true,
        },
      })
    ).toThrowError(
      expect.objectContaining({
        code: RuntimeErrorCode.INVALID_CLIP_SCOPE,
        message:
          'Invalid clip scope: dimension "clip" does not contain selected index 99. Available indices: 0, 1, 2.',
      })
    );
  });

  it('rejects through clip scopes when any expanded index is missing', () => {
    expect(() =>
      resolveClipScope({
        producerGraph: buildGraph(),
        scope: {
          dimension: 'clip',
          indices: [4],
          mode: 'through',
          includeUpstream: true,
        },
      })
    ).toThrowError(
      expect.objectContaining({
        code: RuntimeErrorCode.INVALID_CLIP_SCOPE,
        message:
          'Invalid clip scope: dimension "clip" does not contain selected index 3, 4. Available indices: 0, 1, 2.',
      })
    );
  });

  it('rejects invalid scope controls', () => {
    expect(() =>
      resolveClipScope({
        producerGraph: buildGraph(),
        scope: {
          dimension: '',
          indices: [0],
          mode: 'only',
          includeUpstream: true,
        },
      })
    ).toThrowError(
      expect.objectContaining({ code: RuntimeErrorCode.INVALID_CLIP_SCOPE })
    );

    expect(() =>
      resolveClipScope({
        producerGraph: buildGraph(),
        scope: {
          dimension: 'clip',
          indices: [0],
          mode: 'only',
          includeUpstream: false as true,
        },
      })
    ).toThrowError(
      expect.objectContaining({ code: RuntimeErrorCode.INVALID_CLIP_SCOPE })
    );

    expect(() =>
      resolveClipScope({
        producerGraph: buildGraph(),
        scope: {
          dimension: 'clip',
          indices: [0],
          mode: 'only',
          includeUpstream: true,
          assetKinds: [],
        },
      })
    ).toThrowError(
      expect.objectContaining({ code: RuntimeErrorCode.INVALID_CLIP_SCOPE })
    );
  });
});
