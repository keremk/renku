import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { createProviderRegistry } from './index.js';

describe('createProviderRegistry', () => {
  it('returns simulated handlers by default', async () => {
    const registry = createProviderRegistry();
    const handler = registry.resolve({
      provider: 'openai',
      model: 'openai/GPT-5',
      environment: 'cloud',
    });

    expect(handler.mode).toBe('simulated');

    const result = await handler.invoke({
      jobId: 'job-123',
      provider: 'openai',
      model: 'openai/GPT-5',
      revision: 'rev-0001',
      layerIndex: 0,
      attempt: 1,
      inputs: [],
      produces: ['Artifact:NarrationScript'],
      context: {
        environment: 'cloud',
      },
    });

    expect(result.artifacts).toHaveLength(1);
    const artifact = result.artifacts[0];
    const inlinePayload = typeof artifact.blob?.data === 'string'
      ? artifact.blob.data
      : Buffer.from(artifact.blob!.data).toString('utf8');
    expect(inlinePayload).toContain('Simulated response');
    expect(artifact.blob?.mimeType).toBe('text/plain');
    const payload = typeof artifact.blob?.data === 'string'
      ? artifact.blob.data
      : Buffer.from(artifact.blob!.data).toString('utf8');
    expect(payload).toContain('Simulated Provider Invocation');
  });

  it('produces blob artifacts for media outputs', async () => {
    const registry = createProviderRegistry();
    const handler = registry.resolve({
      provider: 'replicate',
      model: 'bytedance/seedance-1-lite',
      environment: 'cloud',
    });

    const result = await handler.invoke({
      jobId: 'job-video',
      provider: 'replicate',
      model: 'bytedance/seedance-1-lite',
      revision: 'rev-0002',
      layerIndex: 1,
      attempt: 1,
      inputs: ['Artifact:StartImage', 'Input:Duration'],
      produces: ['Artifact:GeneratedVideo[segment=0]'],
      context: {
        environment: 'cloud',
        extras: {
          resolvedInputs: {
            'Input:Duration': 2,
          },
          jobContext: {
            inputBindings: {
              Duration: 'Input:Duration',
            },
          },
        },
      },
    });

    expect(result.artifacts).toHaveLength(1);
    const artifact = result.artifacts[0];
    expect(artifact.blob?.mimeType).toBe('video/mp4');
  });

  it('caches handlers across resolveMany calls', () => {
    const registry = createProviderRegistry();
    const descriptors = [
      {
        provider: 'openai' as const,
        model: 'openai/GPT-5',
        environment: 'cloud' as const,
      },
      {
        provider: 'openai' as const,
        model: 'openai/GPT-5',
        environment: 'cloud' as const,
      },
    ];

    const [first, second] = registry.resolveMany(descriptors);
    expect(first.handler).toBe(second.handler);
  });

  it('uses the real timeline handler in simulated mode', async () => {
    const registry = createProviderRegistry();
    const handler = registry.resolve({
      provider: 'renku',
      model: 'OrderedTimeline',
      environment: 'local',
    });

    await expect(
      handler.invoke({
        jobId: 'job-timeline',
        provider: 'renku',
        model: 'OrderedTimeline',
        revision: 'rev-0001',
        layerIndex: 0,
        attempt: 1,
        inputs: [],
        produces: ['Artifact:TimelineComposer.Timeline'],
        context: {
          providerConfig: {
            timeline: {
              tracks: ['Audio'],
              masterTracks: ['Audio'],
              clips: [],
            },
          },
        },
      }),
    ).rejects.toThrow(/TimelineProducer config must define at least one clip/);
  });
});
