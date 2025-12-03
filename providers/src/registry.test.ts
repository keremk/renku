import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { createProviderRegistry } from './index.js';

describe('createProviderRegistry', () => {
  it('returns mock handlers by default', async () => {
    const registry = createProviderRegistry();
    const handler = registry.resolve({
      provider: 'openai',
      model: 'openai/GPT-5',
      environment: 'cloud',
    });

    expect(handler.mode).toBe('mock');

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

    expect(result.artefacts).toHaveLength(1);
    const artefact = result.artefacts[0];
    const inlinePayload = typeof artefact.blob?.data === 'string'
      ? artefact.blob.data
      : Buffer.from(artefact.blob!.data).toString('utf8');
    expect(inlinePayload).toContain('Mock response');
    expect(artefact.blob?.mimeType).toBe('text/plain');
    const payload = typeof artefact.blob?.data === 'string'
      ? artefact.blob.data
      : Buffer.from(artefact.blob!.data).toString('utf8');
    expect(payload).toContain('Mock Provider Invocation');
  });

  it('produces blob artefacts for media outputs', async () => {
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
      inputs: ['Artifact:StartImage'],
      produces: ['Artifact:SegmentVideo[segment=0]'],
      context: {
        environment: 'cloud',
      },
    });

    expect(result.artefacts).toHaveLength(1);
    const artefact = result.artefacts[0];
    expect(artefact.blob?.mimeType).toBe('video/mp4');
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

  it('uses the real timeline handler in mock mode', async () => {
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
            tracks: ['Audio'],
            masterTrack: {
              kind: 'Audio',
            },
            clips: [],
          },
        },
      }),
    ).rejects.toThrow(/TimelineProducer config must define at least one clip/);
  });
});
