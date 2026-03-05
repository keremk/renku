import { describe, expect, it } from 'vitest';
import {
  handleArtifactPreviewEstimate,
  handleArtifactPreviewGenerate,
  readImageDimensions,
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

  it('accepts rerun with explicit model selection', () => {
    expect(() =>
      validatePreviewRequest(
        createEstimateRequest({
          model: { provider: 'fal-ai', model: 'veo3.1' },
        }),
        {
          allowEmptyPrompt: true,
        }
      )
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

  it('rejects clip mode when clipParams are missing', () => {
    expect(() =>
      validatePreviewRequest(
        createEstimateRequest({
          mode: 'clip',
        }),
        {
          allowEmptyPrompt: true,
        }
      )
    ).toThrow('Clip preview mode requires clipParams.');
  });

  it('accepts clip mode with valid trim bounds', () => {
    expect(() =>
      validatePreviewRequest(
        createEstimateRequest({
          mode: 'clip',
          clipParams: {
            startTimeSeconds: 1,
            endTimeSeconds: 3.5,
          },
        }),
        {
          allowEmptyPrompt: true,
        }
      )
    ).not.toThrow();
  });

  it('accepts clip mode with sourceTempId', () => {
    expect(() =>
      validatePreviewRequest(
        createEstimateRequest({
          mode: 'clip',
          clipParams: {
            startTimeSeconds: 1,
            endTimeSeconds: 3.5,
          },
          sourceTempId: 'tmp-clip-preview',
        }),
        {
          allowEmptyPrompt: true,
        }
      )
    ).not.toThrow();
  });

  it('rejects sourceTempId outside clip mode', () => {
    expect(() =>
      validatePreviewRequest(
        createEstimateRequest({
          mode: 'rerun',
          sourceTempId: 'tmp-clip-preview',
        }),
        {
          allowEmptyPrompt: true,
        }
      )
    ).toThrow('sourceTempId is only supported in clip preview mode.');
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

describe('inputOverrides validation', () => {
  it('accepts rerun with valid inputOverrides', () => {
    expect(() =>
      validatePreviewRequest(
        createEstimateRequest({
          inputOverrides: { VoiceId: 'Rachel', Emotion: 'happy' },
        }),
        { allowEmptyPrompt: true }
      )
    ).not.toThrow();
  });

  it('rejects inputOverrides outside rerun mode', () => {
    expect(() =>
      validatePreviewRequest(
        createEstimateRequest({
          mode: 'edit',
          model: { provider: 'openai', model: 'gpt-image-1' },
          prompt: 'test',
          inputOverrides: { VoiceId: 'Rachel' },
        }),
        { allowEmptyPrompt: false }
      )
    ).toThrow('inputOverrides is only supported in rerun preview mode.');
  });

  it('rejects non-object inputOverrides', () => {
    expect(() =>
      validatePreviewRequest(
        createEstimateRequest({
          inputOverrides: 'invalid' as unknown as Record<string, string>,
        }),
        { allowEmptyPrompt: true }
      )
    ).toThrow('inputOverrides must be a plain object');
  });

  it('rejects inputOverrides with non-string values', () => {
    expect(() =>
      validatePreviewRequest(
        createEstimateRequest({
          inputOverrides: { VoiceId: 123 as unknown as string },
        }),
        { allowEmptyPrompt: true }
      )
    ).toThrow('inputOverrides must have string keys and string values.');
  });
});

describe('readImageDimensions', () => {
  it('uses image signature when mime type and bytes do not match', () => {
    const jpeg = createMinimalJpegBuffer(48, 96);

    const dimensions = readImageDimensions(jpeg, 'image/png');

    expect(dimensions).toEqual({ width: 48, height: 96 });
  });
});
