import { Buffer } from 'node:buffer';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import { createSimulatedFallbackArtifacts } from './simulated-fallback-output.js';
import type { ProviderJobContext } from './types.js';

function createRequest(args: {
  inputs: string[];
  produces: string[];
  resolvedInputs?: Record<string, unknown>;
  inputBindings?: Record<string, string>;
}): ProviderJobContext {
  return {
    jobId: 'job-simulated-fallback',
    provider: 'replicate',
    model: 'fallback-model',
    revision: 'rev-0001',
    layerIndex: 0,
    attempt: 1,
    inputs: args.inputs,
    produces: args.produces,
    context: {
      environment: 'cloud',
      extras: {
        resolvedInputs: args.resolvedInputs ?? {},
        jobContext: {
          inputBindings: args.inputBindings ?? {},
        },
      },
    },
  };
}

async function computeDurationSeconds(buffer: Buffer): Promise<number> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BufferSource(buffer),
  });
  try {
    return await input.computeDuration();
  } finally {
    input.dispose();
  }
}

describe('createSimulatedFallbackArtifacts', () => {
  it('emits a valid MP4 using the explicit Duration binding', async () => {
    const artifacts = await createSimulatedFallbackArtifacts(
      createRequest({
        inputs: ['Input:SegmentDuration'],
        produces: ['Artifact:GeneratedVideo[segment=0]'],
        resolvedInputs: {
          'Input:SegmentDuration': 3,
        },
        inputBindings: {
          Duration: 'Input:SegmentDuration',
        },
      })
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.blob?.mimeType).toBe('video/mp4');
    expect(artifacts[0]?.blob?.data).toBeInstanceOf(Buffer);
    expect(artifacts[0]?.diagnostics?.simulatedReport).toContain(
      'Simulated Provider Invocation'
    );

    const duration = await computeDurationSeconds(
      artifacts[0]?.blob?.data as Buffer
    );
    expect(duration).toBeCloseTo(3, 1);
  });

  it('emits a valid MP3 for audio artifacts', async () => {
    const artifacts = await createSimulatedFallbackArtifacts(
      createRequest({
        inputs: ['Input:Duration'],
        produces: ['Artifact:MusicTrack'],
        resolvedInputs: {
          'Input:Duration': 4,
        },
        inputBindings: {
          Duration: 'Input:Duration',
        },
      })
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.blob?.mimeType).toBe('audio/mpeg');
    expect(artifacts[0]?.blob?.data).toBeInstanceOf(Buffer);

    const duration = await computeDurationSeconds(
      artifacts[0]?.blob?.data as Buffer
    );
    expect(duration).toBeCloseTo(4, 1);
  });
});
