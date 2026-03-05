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
  if (
    body.mode !== 'rerun' &&
    body.mode !== 'edit' &&
    body.mode !== 'camera' &&
    body.mode !== 'clip'
  ) {
    throw new PreviewRequestValidationError(
      `Unsupported preview mode: ${String(body.mode)}.`
    );
  }
  if (typeof body.prompt !== 'string') {
    throw new PreviewRequestValidationError('Prompt must be a string.');
  }
  if (body.model) {
    if (!body.model.provider || !body.model.model) {
      throw new PreviewRequestValidationError(
        'Model selection requires both provider and model.'
      );
    }
  }
  if (body.sourceTempId !== undefined) {
    if (
      typeof body.sourceTempId !== 'string' ||
      body.sourceTempId.trim().length === 0
    ) {
      throw new PreviewRequestValidationError(
        'sourceTempId must be a non-empty string when provided.'
      );
    }
    if (body.mode !== 'clip') {
      throw new PreviewRequestValidationError(
        'sourceTempId is only supported in clip preview mode.'
      );
    }
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
  if (body.inputOverrides !== undefined) {
    if (body.mode !== 'rerun') {
      throw new PreviewRequestValidationError(
        'inputOverrides is only supported in rerun preview mode.'
      );
    }
    if (
      typeof body.inputOverrides !== 'object' ||
      body.inputOverrides === null ||
      Array.isArray(body.inputOverrides)
    ) {
      throw new PreviewRequestValidationError(
        'inputOverrides must be a plain object with string keys and values.'
      );
    }
    for (const [key, value] of Object.entries(body.inputOverrides)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        throw new PreviewRequestValidationError(
          'inputOverrides must have string keys and string values.'
        );
      }
    }
  }
  if (body.mode === 'camera' && !body.cameraParams) {
    throw new PreviewRequestValidationError(
      'Camera preview mode requires cameraParams.'
    );
  }
  if (body.mode === 'clip') {
    if (!body.clipParams) {
      throw new PreviewRequestValidationError(
        'Clip preview mode requires clipParams.'
      );
    }

    const { startTimeSeconds, endTimeSeconds } = body.clipParams;
    if (
      !Number.isFinite(startTimeSeconds) ||
      !Number.isFinite(endTimeSeconds)
    ) {
      throw new PreviewRequestValidationError(
        'Clip preview start/end times must be finite numbers.'
      );
    }
    if (startTimeSeconds < 0) {
      throw new PreviewRequestValidationError(
        'Clip preview start time must be >= 0.'
      );
    }
    if (endTimeSeconds <= startTimeSeconds) {
      throw new PreviewRequestValidationError(
        'Clip preview end time must be greater than start time.'
      );
    }
  }
}
