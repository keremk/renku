import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExecutionPlan, JobDescriptor } from '@gorenku/core';
import {
  findTargetArtifactLayer,
  handleArtifactPreviewEstimate,
  handleArtifactPreviewGenerate,
  readImageDimensions,
  resolveInputsPathForRerun,
  validatePreviewRequest,
  type ArtifactPreviewGenerateRequest,
  type ArtifactPreviewEstimateRequest,
} from './artifact-preview-handler.js';
import {
  createMockResponse,
  parseResponseJson,
} from '../generation/test-utils.js';

function createEstimateRequest(
  overrides: Partial<ArtifactPreviewEstimateRequest> = {}
): ArtifactPreviewEstimateRequest {
  return {
    blueprintFolder: '/tmp/blueprint',
    movieId: 'movie-test',
    artifactId: 'Artifact:ImageProducer.Output[0]',
    mode: 'rerun',
    prompt: '',
    ...overrides,
  };
}

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

function createMinimalJpegBuffer(width: number, height: number): Buffer {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
}

describe('validatePreviewRequest', () => {
  it('accepts rerun with empty prompt and no promptArtifactId', () => {
    expect(() =>
      validatePreviewRequest(createEstimateRequest(), {
        allowEmptyPrompt: true,
      })
    ).not.toThrow();
  });

  it('rejects rerun prompt override when promptArtifactId is missing', () => {
    expect(() =>
      validatePreviewRequest(
        createEstimateRequest({
          prompt: 'new prompt text',
        }),
        {
          allowEmptyPrompt: true,
        }
      )
    ).toThrow('Re-run preview prompt override requires promptArtifactId.');
  });

  it('rejects non-canonical rerun promptArtifactId', () => {
    expect(() =>
      validatePreviewRequest(
        createEstimateRequest({
          prompt: 'new prompt text',
          promptArtifactId: 'StoryProducer.SceneImagePrompt[0]',
        }),
        {
          allowEmptyPrompt: true,
        }
      )
    ).toThrow('Re-run preview promptArtifactId must be canonical');
  });
});

describe('preview request validation status codes', () => {
  it('returns 400 for estimate validation errors', async () => {
    const res = createMockResponse();

    await handleArtifactPreviewEstimate(
      res,
      createEstimateRequest({
        prompt: 'override prompt',
      })
    );

    const payload = parseResponseJson<{ error: string }>(res);
    expect(res.statusCode).toBe(400);
    expect(payload.error).toContain('promptArtifactId');
  });

  it('returns 400 for generate validation errors', async () => {
    const res = createMockResponse();
    const body: ArtifactPreviewGenerateRequest = {
      blueprintFolder: '/tmp/blueprint',
      movieId: 'movie-test',
      artifactId: 'Artifact:ImageProducer.Output[0]',
      mode: 'rerun',
      prompt: 'override prompt',
    };

    await handleArtifactPreviewGenerate(res, body);

    const payload = parseResponseJson<{ error: string }>(res);
    expect(res.statusCode).toBe(400);
    expect(payload.error).toContain('promptArtifactId');
  });
});

describe('resolveInputsPathForRerun', () => {
  it('prefers build-specific inputs.yaml when present', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'renku-rerun-inputs-'));

    try {
      const blueprintFolder = join(tempRoot, 'blueprint');
      const buildDir = join(blueprintFolder, 'builds', 'movie-test');
      const buildInputsPath = join(buildDir, 'inputs.yaml');

      await mkdir(buildDir, { recursive: true });
      await writeFile(buildInputsPath, 'inputs: {}', 'utf8');

      const resolved = await resolveInputsPathForRerun(
        blueprintFolder,
        'movie-test'
      );

      expect(resolved).toBe(buildInputsPath);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('uses metadata.lastInputsPath when build inputs are missing', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'renku-rerun-inputs-'));

    try {
      const blueprintFolder = join(tempRoot, 'blueprint');
      const buildDir = join(blueprintFolder, 'builds', 'movie-test');
      const lastInputsPath = join(tempRoot, 'movie-test-inputs.yaml');

      await mkdir(buildDir, { recursive: true });
      await writeFile(lastInputsPath, 'inputs: {}', 'utf8');

      const resolved = await resolveInputsPathForRerun(
        blueprintFolder,
        'movie-test',
        lastInputsPath
      );

      expect(resolved).toBe(lastInputsPath);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('throws when both build inputs and metadata.lastInputsPath are missing', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'renku-rerun-inputs-'));

    try {
      const blueprintFolder = join(tempRoot, 'blueprint');
      const buildDir = join(blueprintFolder, 'builds', 'movie-test');
      const blueprintInputsPath = join(blueprintFolder, 'inputs.yaml');

      await mkdir(buildDir, { recursive: true });
      await writeFile(blueprintInputsPath, 'inputs: {}', 'utf8');

      await expect(
        resolveInputsPathForRerun(blueprintFolder, 'movie-test')
      ).rejects.toThrow(
        'Could not resolve inputs file for build movie-test. Expected build inputs'
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('findTargetArtifactLayer', () => {
  it('returns the layer index that produces the target artifact', () => {
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

    expect(findTargetArtifactLayer(plan, artifactId)).toBe(1);
  });

  it('throws when no layer produces the target artifact', () => {
    const artifactId = 'Artifact:ImageProducer.Output[0]';
    const plan: ExecutionPlan = {
      revision: 'rev-test',
      manifestBaseHash: 'manifest',
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 1,
      layers: [[createJob('Producer:Other', ['Artifact:Other.Output'])]],
    };

    expect(() => findTargetArtifactLayer(plan, artifactId)).toThrow(
      `Surgical plan does not include a producer job for artifact ${artifactId}.`
    );
  });
});

describe('readImageDimensions', () => {
  it('uses image signature when mime type and bytes do not match', () => {
    const jpeg = createMinimalJpegBuffer(48, 96);

    const dimensions = readImageDimensions(jpeg, 'image/png');

    expect(dimensions).toEqual({ width: 48, height: 96 });
  });
});
