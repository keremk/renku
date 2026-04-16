import { describe, expect, it } from 'vitest';
import { RuntimeErrorCode } from '../errors/index.js';
import type {
  ArtifactEvent,
  Manifest,
  ProducerGraph,
  ProducerGraphNode,
} from '../types.js';
import {
  buildResolvedProducerSummaries,
  resolvePlanningControls,
} from './planning-controls.js';
import type { LatestArtifactSnapshot } from './planning-controls.js';

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

function buildManifest(): Manifest {
  return {
    revision: 'rev-0001',
    baseRevision: null,
    createdAt: new Date().toISOString(),
    inputs: {},
    artifacts: {
      'Artifact:Script[0]': {
        hash: 'h-script-0',
        producedBy: 'Producer:ScriptProducer',
        status: 'succeeded',
        createdAt: new Date().toISOString(),
      },
      'Artifact:Script[1]': {
        hash: 'h-script-1',
        producedBy: 'Producer:ScriptProducer',
        status: 'succeeded',
        createdAt: new Date().toISOString(),
      },
      'Artifact:Audio[0]': {
        hash: 'h-audio-0',
        producedBy: 'Producer:AudioProducer[0]',
        status: 'succeeded',
        createdAt: new Date().toISOString(),
      },
      'Artifact:Audio[1]': {
        hash: 'h-audio-1',
        producedBy: 'Producer:AudioProducer[1]',
        status: 'succeeded',
        createdAt: new Date().toISOString(),
      },
      'Artifact:Timeline': {
        hash: 'h-timeline',
        producedBy: 'Producer:TimelineProducer',
        status: 'succeeded',
        createdAt: new Date().toISOString(),
      },
    },
    timeline: {},
  };
}

function buildLatestSnapshot(): LatestArtifactSnapshot {
  const manifest = buildManifest();
  const latestById = new Map<string, ArtifactEvent>(
    Object.entries(manifest.artifacts).map(([artifactId, entry]) => [
      artifactId,
      {
        artifactId: artifactId,
        revision: manifest.revision,
        inputsHash: 'inputs-hash',
        output: {},
        status: entry.status,
        producedBy: entry.producedBy,
        createdAt: entry.createdAt,
      },
    ])
  );

  return {
    latestById,
    latestSuccessfulIds: new Set(Object.keys(manifest.artifacts)),
    latestFailedIds: new Set<string>(),
  };
}

describe('resolvePlanningControls', () => {
  it('ignores producer directives outside upToLayer with warning', () => {
    const result = resolvePlanningControls({
      producerGraph: buildGraph(),
      baselineInputs: {},
      userControls: {
        scope: {
          upToLayer: 0,
          producerDirectives: [{ producerId: 'Producer:AudioProducer', count: 1 }],
        },
      },
      manifest: buildManifest(),
      latestSnapshot: buildLatestSnapshot(),
    });

    expect(result.blockedProducerJobIds).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CONTROL_DIRECTIVE_OUT_OF_SCOPE',
          targetId: 'Producer:AudioProducer',
        }),
      ])
    );
  });

  it('applies disable directives with count 0', () => {
    const result = resolvePlanningControls({
      producerGraph: buildGraph(),
      baselineInputs: {},
      userControls: {
        scope: {
          producerDirectives: [{ producerId: 'Producer:AudioProducer', count: 0 }],
        },
      },
      manifest: buildManifest(),
      latestSnapshot: buildLatestSnapshot(),
    });

    expect(result.blockedProducerJobIds).toEqual(
      expect.arrayContaining([
        'Producer:AudioProducer[0]',
        'Producer:AudioProducer[1]',
      ])
    );
  });

  it('keeps unmentioned producers inheriting baseline behavior', () => {
    const result = resolvePlanningControls({
      producerGraph: buildGraph(),
      baselineInputs: {},
      userControls: {
        scope: {
          producerDirectives: [{ producerId: 'Producer:AudioProducer', count: 1 }],
        },
      },
      manifest: buildManifest(),
      latestSnapshot: buildLatestSnapshot(),
    });

    expect(result.blockedProducerJobIds).toEqual(['Producer:AudioProducer[1]']);
    expect(result.blockedProducerJobIds).not.toContain('Producer:ScriptProducer');
    expect(result.blockedProducerJobIds).not.toContain('Producer:TimelineProducer');
  });

  it('ignores out-of-scope regenerate controls with warnings', () => {
    const result = resolvePlanningControls({
      producerGraph: buildGraph(),
      baselineInputs: {},
      userControls: {
        scope: { upToLayer: 0 },
        surgical: { regenerateIds: ['Artifact:Audio[0]'] },
      },
      manifest: buildManifest(),
      latestSnapshot: buildLatestSnapshot(),
    });

    expect(result.forcedJobIds).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CONTROL_REGEN_OUT_OF_SCOPE',
          targetId: 'Artifact:Audio[0]',
        }),
      ])
    );
  });

  it('ignores out-of-scope pin controls with warnings', () => {
    const result = resolvePlanningControls({
      producerGraph: buildGraph(),
      baselineInputs: {},
      userControls: {
        scope: { upToLayer: 0 },
        surgical: { pinIds: ['Artifact:Audio[0]'] },
      },
      manifest: buildManifest(),
      latestSnapshot: buildLatestSnapshot(),
    });

    expect(result.pinnedArtifactIds).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CONTROL_PIN_OUT_OF_SCOPE',
          targetId: 'Artifact:Audio[0]',
        }),
      ])
    );
  });

  it('does not warn when downstream forced jobs are trimmed by upToLayer', () => {
    const result = resolvePlanningControls({
      producerGraph: buildGraph(),
      baselineInputs: {},
      userControls: {
        scope: { upToLayer: 1 },
        surgical: { regenerateIds: ['Artifact:Audio[0]'] },
      },
      manifest: buildManifest(),
      latestSnapshot: buildLatestSnapshot(),
    });

    expect(result.forcedJobIds).toContain('Producer:AudioProducer[0]');
    expect(result.forcedJobIds).not.toContain('Producer:TimelineProducer');
    expect(result.warnings).toEqual([]);
  });

  it('fails when the same canonical target is in regen and pin', () => {
    expect(() =>
      resolvePlanningControls({
        producerGraph: buildGraph(),
        baselineInputs: {},
        userControls: {
          surgical: {
            regenerateIds: ['Artifact:Audio[0]'],
            pinIds: ['Artifact:Audio[0]'],
          },
        },
        manifest: buildManifest(),
        latestSnapshot: buildLatestSnapshot(),
      })
    ).toThrowError(
      expect.objectContaining({
        code: RuntimeErrorCode.PLANNING_CONFLICT_REGEN_PIN,
      })
    );
  });
});

describe('buildResolvedProducerSummaries', () => {
  it('reports inherit/capped/disabled metadata via effectiveCountLimit', () => {
    const resolved = resolvePlanningControls({
      producerGraph: buildGraph(),
      baselineInputs: {},
      userControls: {
        scope: {
          producerDirectives: [{ producerId: 'Producer:AudioProducer', count: 1 }],
        },
      },
      manifest: buildManifest(),
      latestSnapshot: buildLatestSnapshot(),
    });

    const summaries = buildResolvedProducerSummaries({
      normalizedOverrides: resolved.normalizedOverrides,
      scheduledJobIds: new Set(['Producer:AudioProducer[0]']),
    });
    const audio = summaries.find(
      (summary) => summary.producerId === 'Producer:AudioProducer'
    );
    const script = summaries.find(
      (summary) => summary.producerId === 'Producer:ScriptProducer'
    );

    expect(audio).toMatchObject({
      mode: 'capped',
      effectiveCountLimit: 1,
      scheduledCount: 1,
    });
    expect(script).toMatchObject({
      mode: 'inherit',
      effectiveCountLimit: null,
    });
  });
});
