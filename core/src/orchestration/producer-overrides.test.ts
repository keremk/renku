import { describe, expect, it } from 'vitest';
import { RuntimeErrorCode } from '../errors/index.js';
import type {
  ProducerGraph,
  ProducerGraphNode,
  ProducerOverrideDirective,
} from '../types.js';
import {
  buildProducerSchedulingSummary,
  normalizeProducerOverrides,
  parseProducerDirectiveToken,
} from './producer-overrides.js';

function makeNode(args: {
  jobId: string;
  producer: string;
  inputs: string[];
  produces: string[];
}): ProducerGraphNode {
  return {
    jobId: args.jobId,
    producer: args.producer,
    inputs: args.inputs,
    produces: args.produces,
    provider: 'test-provider',
    providerModel: 'test-model',
    rateKey: 'test-rate',
    context: {
      namespacePath: [],
      indices: {},
      producerAlias: args.producer,
      inputs: [],
      produces: [],
    },
  };
}

function buildGraph(): ProducerGraph {
  return {
    nodes: [
      makeNode({
        jobId: 'Producer:ScriptProducer',
        producer: 'ScriptProducer',
        inputs: ['Input:Prompt'],
        produces: ['Artifact:Script[0]', 'Artifact:Script[1]'],
      }),
      makeNode({
        jobId: 'Producer:AudioProducer[0]',
        producer: 'AudioProducer',
        inputs: ['Artifact:Script[0]'],
        produces: ['Artifact:Audio[0]'],
      }),
      makeNode({
        jobId: 'Producer:AudioProducer[1]',
        producer: 'AudioProducer',
        inputs: ['Artifact:Script[1]'],
        produces: ['Artifact:Audio[1]'],
      }),
      makeNode({
        jobId: 'Producer:TimelineProducer',
        producer: 'TimelineProducer',
        inputs: ['Artifact:Audio[0]', 'Artifact:Audio[1]'],
        produces: ['Artifact:Timeline'],
      }),
    ],
    edges: [
      { from: 'Producer:ScriptProducer', to: 'Producer:AudioProducer[0]' },
      { from: 'Producer:ScriptProducer', to: 'Producer:AudioProducer[1]' },
      { from: 'Producer:AudioProducer[0]', to: 'Producer:TimelineProducer' },
      { from: 'Producer:AudioProducer[1]', to: 'Producer:TimelineProducer' },
    ],
  };
}

describe('parseProducerDirectiveToken', () => {
  it('parses canonical producer token with count', () => {
    const parsed = parseProducerDirectiveToken('Producer:AudioProducer:2');
    expect(parsed).toEqual({
      producerId: 'Producer:AudioProducer',
      count: 2,
    } satisfies ProducerOverrideDirective);
  });

  it('fails on non-canonical producer token', () => {
    expect(() => parseProducerDirectiveToken('AudioProducer:2')).toThrowError(
      expect.objectContaining({
        code: RuntimeErrorCode.INVALID_PRODUCER_OVERRIDE_FORMAT,
      })
    );
  });

  it('fails when count is missing', () => {
    expect(() =>
      parseProducerDirectiveToken('Producer:AudioProducer')
    ).toThrowError(
      expect.objectContaining({
        code: RuntimeErrorCode.INVALID_PRODUCER_OVERRIDE_FORMAT,
      })
    );
  });

  it('accepts zero count as disable directive', () => {
    const parsed = parseProducerDirectiveToken('Producer:AudioProducer:0');
    expect(parsed).toEqual({
      producerId: 'Producer:AudioProducer',
      count: 0,
    } satisfies ProducerOverrideDirective);
  });
});

describe('normalizeProducerOverrides', () => {
  it('selects first-dimension subset and blocks remaining producer jobs', () => {
    const normalized = normalizeProducerOverrides({
      producerGraph: buildGraph(),
      overrides: {
        directives: [{ producerId: 'Producer:AudioProducer', count: 1 }],
      },
    });

    expect(normalized.blockedProducerJobIds).toEqual([
      'Producer:AudioProducer[1]',
    ]);
    expect(normalized.cappedProducerJobIds).toEqual([
      'Producer:AudioProducer[1]',
    ]);
    expect(normalized.directives[0]).toMatchObject({
      producerId: 'Producer:AudioProducer',
      count: 1,
      maxSelectableCount: 2,
    });
  });

  it('fails for unknown producer family IDs', () => {
    expect(() =>
      normalizeProducerOverrides({
        producerGraph: buildGraph(),
        overrides: {
          directives: [{ producerId: 'Producer:MissingProducer' }],
        },
      })
    ).toThrowError(
      expect.objectContaining({
        code: RuntimeErrorCode.UNKNOWN_PRODUCER_OVERRIDE_TARGET,
      })
    );
  });

  it('fails for duplicate producer directives', () => {
    expect(() =>
      normalizeProducerOverrides({
        producerGraph: buildGraph(),
        overrides: {
          directives: [
            { producerId: 'Producer:AudioProducer', count: 1 },
            { producerId: 'Producer:AudioProducer', count: 2 },
          ],
        },
      })
    ).toThrowError(
      expect.objectContaining({
        code: RuntimeErrorCode.DUPLICATE_PRODUCER_OVERRIDE,
      })
    );
  });
});

describe('buildProducerSchedulingSummary', () => {
  it('reports effective mode and scheduled counts per producer family', () => {
    const normalized = normalizeProducerOverrides({
      producerGraph: buildGraph(),
      overrides: {
        directives: [{ producerId: 'Producer:AudioProducer', count: 1 }],
      },
    });

    const summary = buildProducerSchedulingSummary({
      normalizedOverrides: normalized,
      scheduledJobIds: new Set([
        'Producer:AudioProducer[0]',
        'Producer:TimelineProducer',
      ]),
    });
    const audio = summary.find(
      (item) => item.producerId === 'Producer:AudioProducer'
    );

    expect(audio).toMatchObject({
      producerId: 'Producer:AudioProducer',
      mode: 'capped',
      maxSelectableCount: 2,
      effectiveCountLimit: 1,
      scheduledCount: 1,
      scheduledJobCount: 1,
      warnings: [],
    });
  });
});
