import { describe, expect, it } from 'vitest';
import type { ExecutionPlan, JobDescriptor, JobResult } from '../types.js';
import {
  findLatestSucceededArtifactEvent,
  findSurgicalTargetLayer,
  normalizeSurgicalRegenerationScope,
  sliceExecutionPlanThroughLayer,
} from './surgical-regeneration.js';

function createJob(jobId: string, produces: string[]): JobDescriptor {
  return {
    jobId,
    producer: 'ProducerAlias',
    inputs: [],
    produces,
    provider: 'fal-ai',
    providerModel: 'test/model',
    rateKey: 'fal-ai:test/model',
  };
}

describe('normalizeSurgicalRegenerationScope', () => {
  it('defaults to lineage-plus-dirty when unset', () => {
    expect(normalizeSurgicalRegenerationScope(undefined)).toBe(
      'lineage-plus-dirty'
    );
  });

  it('returns lineage-strict when set', () => {
    expect(normalizeSurgicalRegenerationScope('lineage-strict')).toBe(
      'lineage-strict'
    );
  });
});

describe('findSurgicalTargetLayer', () => {
  it('returns the layer index producing the target artifact', () => {
    const artifactId = 'Artifact:ImageProducer.Output[0]';
    const plan: ExecutionPlan = {
      revision: 'rev-test',
      manifestBaseHash: 'manifest',
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 3,
      layers: [
        [
          createJob('Producer:PromptProducer', [
            'Artifact:PromptProducer.Prompt',
          ]),
        ],
        [createJob('Producer:ImageProducer', [artifactId])],
        [
          createJob('Producer:VideoProducer', [
            'Artifact:VideoProducer.Output',
          ]),
        ],
      ],
    };

    expect(findSurgicalTargetLayer(plan, artifactId)).toBe(1);
  });

  it('throws when target artifact is not produced in the plan', () => {
    const artifactId = 'Artifact:ImageProducer.Output[0]';
    const plan: ExecutionPlan = {
      revision: 'rev-test',
      manifestBaseHash: 'manifest',
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 1,
      layers: [[createJob('Producer:Other', ['Artifact:Other.Output'])]],
    };

    expect(() => findSurgicalTargetLayer(plan, artifactId)).toThrow(
      `Surgical plan does not include a producer job for artifact ${artifactId}.`
    );
  });
});

describe('sliceExecutionPlanThroughLayer', () => {
  it('keeps layers up to and including target layer', () => {
    const plan: ExecutionPlan = {
      revision: 'rev-test',
      manifestBaseHash: 'manifest',
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 3,
      layers: [
        [createJob('Producer:A', ['Artifact:A'])],
        [createJob('Producer:B', ['Artifact:B'])],
        [createJob('Producer:C', ['Artifact:C'])],
      ],
    };

    const sliced = sliceExecutionPlanThroughLayer(plan, 1);

    expect(sliced.layers[0]).toHaveLength(1);
    expect(sliced.layers[1]).toHaveLength(1);
    expect(sliced.layers[2]).toHaveLength(0);
  });
});

describe('findLatestSucceededArtifactEvent', () => {
  it('returns the latest succeeded artifact event', () => {
    const jobs: JobResult[] = [
      {
        jobId: 'Producer:A',
        producer: 'ProducerA',
        status: 'succeeded',
        artifacts: [
          {
            artifactId: 'Artifact:Image.Output',
            revision: 'rev-0001',
            inputsHash: 'inputs-1',
            output: {
              blob: {
                hash: 'hash-1',
                size: 1,
                mimeType: 'image/png',
              },
            },
            status: 'failed',
            producedBy: 'Producer:A',
            createdAt: new Date().toISOString(),
          },
        ],
        layerIndex: 0,
        attempt: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      {
        jobId: 'Producer:B',
        producer: 'ProducerB',
        status: 'succeeded',
        artifacts: [
          {
            artifactId: 'Artifact:Image.Output',
            revision: 'rev-0002',
            inputsHash: 'inputs-2',
            output: {
              blob: {
                hash: 'hash-2',
                size: 2,
                mimeType: 'image/png',
              },
            },
            status: 'succeeded',
            producedBy: 'Producer:B',
            createdAt: new Date().toISOString(),
          },
        ],
        layerIndex: 1,
        attempt: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const event = findLatestSucceededArtifactEvent(
      jobs,
      'Artifact:Image.Output'
    );

    expect(event?.status).toBe('succeeded');
    expect(event?.producedBy).toBe('Producer:B');
  });
});
