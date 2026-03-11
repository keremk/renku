import type { IncomingMessage } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockResponse } from '../generation/test-utils.js';

const {
  parseJsonBodyMock,
  handleArtifactPreviewGenerateMock,
  handleArtifactPreviewEstimateMock,
  handleArtifactPreviewEditModelsMock,
  handleArtifactPreviewApplyMock,
  handleArtifactPreviewDeleteMock,
  handleArtifactPreviewFileMock,
  handleOpenArtifactsProducerFolderMock,
} = vi.hoisted(() => ({
  parseJsonBodyMock: vi.fn(),
  handleArtifactPreviewGenerateMock: vi.fn(),
  handleArtifactPreviewEstimateMock: vi.fn(),
  handleArtifactPreviewEditModelsMock: vi.fn(),
  handleArtifactPreviewApplyMock: vi.fn(),
  handleArtifactPreviewDeleteMock: vi.fn(),
  handleArtifactPreviewFileMock: vi.fn(),
  handleOpenArtifactsProducerFolderMock: vi.fn(),
}));

vi.mock('../http-utils.js', async () => {
  const actual = await vi.importActual('../http-utils.js');
  return {
    ...actual,
    parseJsonBody: parseJsonBodyMock,
  };
});

vi.mock('./artifact-preview-handler.js', () => ({
  handleArtifactPreviewGenerate: handleArtifactPreviewGenerateMock,
  handleArtifactPreviewEstimate: handleArtifactPreviewEstimateMock,
  handleArtifactPreviewEditModels: handleArtifactPreviewEditModelsMock,
  handleArtifactPreviewApply: handleArtifactPreviewApplyMock,
  handleArtifactPreviewDelete: handleArtifactPreviewDeleteMock,
  handleArtifactPreviewFile: handleArtifactPreviewFileMock,
}));

vi.mock('./artifact-open-folder-handler.js', () => ({
  handleOpenArtifactsProducerFolder: handleOpenArtifactsProducerFolderMock,
}));

import { handleBuildsSubRoute } from './builds-handler.js';

function createReq(method: string): IncomingMessage {
  return { method } as IncomingMessage;
}

describe('handleBuildsSubRoute artifacts preview routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes preview-generate to handler', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({
      blueprintFolder: '/tmp/blueprint',
      movieId: 'movie-abc',
      artifactId: 'Artifact:Image.Output',
      mode: 'edit',
      prompt: 'new prompt',
      model: { provider: 'fal-ai', model: 'flux-dev' },
    });

    const req = createReq('POST');
    const res = createMockResponse();
    const url = new URL(
      'http://localhost/viewer-api/blueprints/builds/artifacts/preview-generate'
    );

    const handled = await handleBuildsSubRoute(req, res, url, 'artifacts', [
      'artifacts',
      'preview-generate',
    ]);

    expect(handled).toBe(true);
    expect(handleArtifactPreviewGenerateMock).toHaveBeenCalledWith(res, {
      blueprintFolder: '/tmp/blueprint',
      movieId: 'movie-abc',
      artifactId: 'Artifact:Image.Output',
      mode: 'edit',
      prompt: 'new prompt',
      model: { provider: 'fal-ai', model: 'flux-dev' },
    });
  });

  it('returns 400 when preview-apply payload is missing artifactId', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({
      blueprintFolder: '/tmp/blueprint',
      movieId: 'movie-abc',
      tempId: 'tmp-123',
    });

    const req = createReq('POST');
    const res = createMockResponse();
    const url = new URL(
      'http://localhost/viewer-api/blueprints/builds/artifacts/preview-apply'
    );

    const handled = await handleBuildsSubRoute(req, res, url, 'artifacts', [
      'artifacts',
      'preview-apply',
    ]);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(res.body).toBe('Missing blueprintFolder, movieId, or artifactId');
    expect(handleArtifactPreviewApplyMock).not.toHaveBeenCalled();
  });

  it('routes preview-estimate to handler', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({
      blueprintFolder: '/tmp/blueprint',
      movieId: 'movie-abc',
      artifactId: 'Artifact:Image.Output',
      mode: 'rerun',
      prompt: '',
    });

    const req = createReq('POST');
    const res = createMockResponse();
    const url = new URL(
      'http://localhost/viewer-api/blueprints/builds/artifacts/preview-estimate'
    );

    const handled = await handleBuildsSubRoute(req, res, url, 'artifacts', [
      'artifacts',
      'preview-estimate',
    ]);

    expect(handled).toBe(true);
    expect(handleArtifactPreviewEstimateMock).toHaveBeenCalledWith(res, {
      blueprintFolder: '/tmp/blueprint',
      movieId: 'movie-abc',
      artifactId: 'Artifact:Image.Output',
      mode: 'rerun',
      prompt: '',
    });
  });

  it('routes preview-edit-models to handler', async () => {
    const req = createReq('GET');
    const res = createMockResponse();
    const url = new URL(
      'http://localhost/viewer-api/blueprints/builds/artifacts/preview-edit-models'
    );

    const handled = await handleBuildsSubRoute(req, res, url, 'artifacts', [
      'artifacts',
      'preview-edit-models',
    ]);

    expect(handled).toBe(true);
    expect(handleArtifactPreviewEditModelsMock).toHaveBeenCalledWith(res);
  });

  it('routes preview-delete to handler', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({
      blueprintFolder: '/tmp/blueprint',
      movieId: 'movie-abc',
      tempId: 'tmp-456',
    });

    const req = createReq('POST');
    const res = createMockResponse();
    const url = new URL(
      'http://localhost/viewer-api/blueprints/builds/artifacts/preview-delete'
    );

    const handled = await handleBuildsSubRoute(req, res, url, 'artifacts', [
      'artifacts',
      'preview-delete',
    ]);

    expect(handled).toBe(true);
    expect(handleArtifactPreviewDeleteMock).toHaveBeenCalledWith(res, {
      blueprintFolder: '/tmp/blueprint',
      movieId: 'movie-abc',
      tempId: 'tmp-456',
    });
  });

  it('routes preview-file to handler with query params', async () => {
    const req = createReq('GET');
    const res = createMockResponse();
    const url = new URL(
      'http://localhost/viewer-api/blueprints/builds/artifacts/preview-file?folder=%2Ftmp%2Fblueprint&movieId=movie-abc&tempId=tmp-file-1'
    );

    const handled = await handleBuildsSubRoute(req, res, url, 'artifacts', [
      'artifacts',
      'preview-file',
    ]);

    expect(handled).toBe(true);
    expect(handleArtifactPreviewFileMock).toHaveBeenCalledWith(
      req,
      res,
      '/tmp/blueprint',
      'movie-abc',
      'tmp-file-1'
    );
  });

  it('routes open-folder to handler', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({
      blueprintFolder: '/tmp/blueprint',
      movieId: 'movie-abc',
      producerName: 'CharacterImageProducer',
    });

    const req = createReq('POST');
    const res = createMockResponse();
    const url = new URL(
      'http://localhost/viewer-api/blueprints/builds/artifacts/open-folder'
    );

    const handled = await handleBuildsSubRoute(req, res, url, 'artifacts', [
      'artifacts',
      'open-folder',
    ]);

    expect(handled).toBe(true);
    expect(handleOpenArtifactsProducerFolderMock).toHaveBeenCalledWith(res, {
      blueprintFolder: '/tmp/blueprint',
      movieId: 'movie-abc',
      producerName: 'CharacterImageProducer',
    });
  });
});
