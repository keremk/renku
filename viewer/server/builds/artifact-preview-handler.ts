/**
 * Temporary image preview generation + apply/cleanup handlers.
 */

import { existsSync, promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import {
  formatCanonicalProducerId,
  getProducerMappings,
  loadYamlBlueprintTree,
} from '@gorenku/core';
import { requireCliConfig } from '../generation/config.js';
import { streamFileWithRange } from '../shared/stream-utils.js';
import { applyArtifactEditWithDerivedArtifactsFromBuffer } from './artifact-edit-handler.js';
import {
  type ArtifactPreviewApplyRequest,
  type ArtifactPreviewDeleteRequest,
  type ArtifactPreviewEditModelsResponse,
  type ArtifactPreviewEstimateRequest,
  type ArtifactPreviewEstimateResponse,
  type ArtifactPreviewGenerateRequest,
  type ArtifactPreviewGenerateResponse,
} from './preview/contracts.js';
import {
  estimateEditOrCameraPreview,
  generateEditOrCameraPreview,
} from './preview/edit-camera-preview.js';
import {
  estimateClipPreview,
  generateClipPreview,
} from './preview/clip-preview.js';
import { readImageDimensions } from './preview/image-dimensions.js';
import {
  estimateRerunPreview,
  generateRerunPreview,
} from './preview/rerun-preview.js';
import {
  buildPreviewUrl,
  cleanupStaleTempPreviews,
  createTempPreview,
  deleteTempPreview,
  readTempPreview,
} from './preview/temp-preview-store.js';
import {
  PreviewRequestValidationError,
  validatePreviewRequest,
} from './preview/validation.js';

const IMAGE_EDIT_PRODUCER_ID = 'ImageEditProducer';

export { readImageDimensions, validatePreviewRequest };
export type {
  ArtifactPreviewApplyRequest,
  ArtifactPreviewDeleteRequest,
  ArtifactPreviewEditModelsResponse,
  ArtifactPreviewEstimateRequest,
  ArtifactPreviewEstimateResponse,
  ArtifactPreviewGenerateRequest,
  ArtifactPreviewGenerateResponse,
};

export async function handleArtifactPreviewGenerate(
  res: ServerResponse,
  body: ArtifactPreviewGenerateRequest
): Promise<void> {
  try {
    validatePreviewRequest(body, { allowEmptyPrompt: false });

    await cleanupStaleTempPreviews(body.blueprintFolder, body.movieId);

    const generationResult = await generatePreviewForMode(body);

    if (
      !generationResult.mimeType.startsWith('image/') &&
      !generationResult.mimeType.startsWith('video/') &&
      !generationResult.mimeType.startsWith('audio/')
    ) {
      throw new Error(
        `Preview produced unsupported MIME type: ${generationResult.mimeType}.`
      );
    }

    const temp = await createTempPreview(
      body.blueprintFolder,
      body.movieId,
      body.artifactId,
      generationResult.previewData,
      generationResult.mimeType
    );

    const response: ArtifactPreviewGenerateResponse = {
      success: true,
      tempId: temp.metadata.tempId,
      previewUrl: buildPreviewUrl(
        body.blueprintFolder,
        body.movieId,
        temp.metadata.tempId
      ),
      mimeType: generationResult.mimeType,
      estimatedCost: generationResult.estimatedCost,
    };

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response));
  } catch (error) {
    respondPreviewError(
      res,
      error,
      'Preview generation failed',
      '[artifact-preview-handler] Generate error:'
    );
  }
}

export async function handleArtifactPreviewEstimate(
  res: ServerResponse,
  body: ArtifactPreviewEstimateRequest
): Promise<void> {
  try {
    validatePreviewRequest(body, { allowEmptyPrompt: true });

    const estimatedCost = await estimatePreviewForMode(body);

    const response: ArtifactPreviewEstimateResponse = {
      success: true,
      estimatedCost,
    };

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response));
  } catch (error) {
    respondPreviewError(
      res,
      error,
      'Cost estimate failed',
      '[artifact-preview-handler] Estimate error:'
    );
  }
}

async function generatePreviewForMode(body: ArtifactPreviewGenerateRequest) {
  if (body.mode === 'rerun') {
    return generateRerunPreview(body);
  }
  if (body.mode === 'edit' || body.mode === 'camera') {
    return generateEditOrCameraPreview(body);
  }
  if (body.mode === 'clip') {
    return generateClipPreview(body);
  }
  throw new Error(`Unsupported preview mode: ${body.mode}.`);
}

async function estimatePreviewForMode(body: ArtifactPreviewEstimateRequest) {
  if (body.mode === 'rerun') {
    return estimateRerunPreview(body);
  }
  if (body.mode === 'edit' || body.mode === 'camera') {
    return estimateEditOrCameraPreview(body);
  }
  if (body.mode === 'clip') {
    return estimateClipPreview(body);
  }
  throw new Error(`Unsupported preview mode: ${body.mode}.`);
}

export async function handleArtifactPreviewEditModels(
  res: ServerResponse
): Promise<void> {
  try {
    const cliConfig = await requireCliConfig();
    const catalogRoot = cliConfig.catalog?.root;
    if (!catalogRoot) {
      throw new Error(
        'Renku catalog root is not configured. Run "renku init" first.'
      );
    }

    const producerPath = path.join(
      catalogRoot,
      'producers',
      'image',
      'image-edit.yaml'
    );
    if (!existsSync(producerPath)) {
      throw new Error(`Producer file not found: ${producerPath}`);
    }

    const { root: producerTree } = await loadYamlBlueprintTree(producerPath, {
      catalogRoot,
    });
    const mappings = getProducerMappings(
      producerTree,
      formatCanonicalProducerId([], IMAGE_EDIT_PRODUCER_ID)
    );
    if (!mappings) {
      throw new Error(
        `Producer mappings are missing for ${IMAGE_EDIT_PRODUCER_ID}.`
      );
    }

    const models: Array<{ provider: string; model: string }> = [];
    for (const [provider, providerModels] of Object.entries(mappings)) {
      for (const model of Object.keys(providerModels)) {
        models.push({ provider, model });
      }
    }

    const response: ArtifactPreviewEditModelsResponse = {
      success: true,
      models,
    };

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response));
  } catch (error) {
    console.error('[artifact-preview-handler] Edit models error:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load image edit models',
      })
    );
  }
}

export async function handleArtifactPreviewApply(
  res: ServerResponse,
  body: ArtifactPreviewApplyRequest
): Promise<void> {
  try {
    if (
      !body.blueprintFolder ||
      !body.movieId ||
      !body.artifactId ||
      !body.tempId
    ) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing required parameters' }));
      return;
    }

    const temp = await readTempPreview(
      body.blueprintFolder,
      body.movieId,
      body.tempId
    );

    if (temp.metadata.artifactId !== body.artifactId) {
      throw new Error(
        `Preview ${body.tempId} does not belong to artifact ${body.artifactId}.`
      );
    }

    const data = await fs.readFile(temp.filePath);
    const result = await applyArtifactEditWithDerivedArtifactsFromBuffer(
      body.blueprintFolder,
      body.movieId,
      body.artifactId,
      data,
      temp.metadata.mimeType
    );

    await deleteTempPreview(body.blueprintFolder, body.movieId, body.tempId);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error('[artifact-preview-handler] Apply error:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : 'Failed to apply preview',
      })
    );
  }
}

export async function handleArtifactPreviewDelete(
  res: ServerResponse,
  body: ArtifactPreviewDeleteRequest
): Promise<void> {
  try {
    if (!body.blueprintFolder || !body.movieId || !body.tempId) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing required parameters' }));
      return;
    }

    await deleteTempPreview(body.blueprintFolder, body.movieId, body.tempId);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    console.error('[artifact-preview-handler] Delete error:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : 'Failed to delete preview',
      })
    );
  }
}

export async function handleArtifactPreviewFile(
  req: IncomingMessage,
  res: ServerResponse,
  blueprintFolder: string,
  movieId: string,
  tempId: string
): Promise<void> {
  try {
    if (!blueprintFolder || !movieId || !tempId) {
      res.statusCode = 400;
      res.end('Missing required parameters');
      return;
    }

    const temp = await readTempPreview(blueprintFolder, movieId, tempId);
    await streamFileWithRange(
      req,
      res,
      temp.filePath,
      temp.metadata.mimeType,
      temp.metadata.size
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      res.statusCode = 404;
      res.end('Preview not found');
      return;
    }
    console.error('[artifact-preview-handler] File stream error:', error);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}

function respondPreviewError(
  res: ServerResponse,
  error: unknown,
  fallbackMessage: string,
  logPrefix: string
): void {
  const isValidationError = error instanceof PreviewRequestValidationError;
  if (!isValidationError) {
    console.error(logPrefix, error);
  }

  res.statusCode = isValidationError ? 400 : 500;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      error: error instanceof Error ? error.message : fallbackMessage,
    })
  );
}
