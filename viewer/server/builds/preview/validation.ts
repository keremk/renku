import { isCanonicalArtifactId } from '@gorenku/core';
import type {
  ArtifactPreviewEstimateRequest,
  ArtifactPreviewGenerateRequest,
} from './contracts.js';

export class PreviewRequestValidationError extends Error {}

export function validatePreviewRequest(
  body: ArtifactPreviewGenerateRequest | ArtifactPreviewEstimateRequest,
  options: { allowEmptyPrompt: boolean }
): void {
  if (!body.blueprintFolder || !body.movieId || !body.artifactId) {
    throw new PreviewRequestValidationError(
      'Missing blueprintFolder, movieId, or artifactId.'
    );
  }
  if (body.mode !== 'rerun' && body.mode !== 'edit' && body.mode !== 'camera') {
    throw new PreviewRequestValidationError(
      `Unsupported preview mode: ${String(body.mode)}.`
    );
  }
  if (typeof body.prompt !== 'string') {
    throw new PreviewRequestValidationError('Prompt must be a string.');
  }
  if (body.mode === 'edit') {
    if (!body.model?.provider || !body.model.model) {
      throw new PreviewRequestValidationError(
        'Edit preview mode requires provider/model selection.'
      );
    }
    if (!options.allowEmptyPrompt && body.prompt.trim().length === 0) {
      throw new PreviewRequestValidationError(
        'Edit preview prompt cannot be empty.'
      );
    }
  }
  if (body.mode === 'rerun' && body.model) {
    throw new PreviewRequestValidationError(
      'Re-run preview mode does not accept model selection.'
    );
  }
  if (body.mode === 'rerun' && body.prompt.trim().length > 0) {
    if (!body.promptArtifactId) {
      throw new PreviewRequestValidationError(
        'Re-run preview prompt override requires promptArtifactId.'
      );
    }
    if (!isCanonicalArtifactId(body.promptArtifactId)) {
      throw new PreviewRequestValidationError(
        `Re-run preview promptArtifactId must be canonical, got ${body.promptArtifactId}.`
      );
    }
  }
  if (body.mode === 'camera' && !body.cameraParams) {
    throw new PreviewRequestValidationError(
      'Camera preview mode requires cameraParams.'
    );
  }
}
