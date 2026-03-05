/**
 * Temporary image preview generation + apply/cleanup handlers.
 *
 * These handlers power the image edit dialog's AI preview flow:
 * - generate preview via provider pipeline (re-run/edit/camera)
 * - store preview as temporary file
 * - apply preview to artifact event log on Update
 * - delete temporary previews on cancel/regenerate
 */

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import {
  buildProducerCatalog,
  buildProviderMetadata,
  buildProducerOptionsFromBlueprint,
  convertArtifactOverridesToDrafts,
  copyEventsToMemory,
  copyManifestToMemory,
  createEventLog,
  createLogger,
  createManifestService,
  createMovieMetadataService,
  createNotificationBus,
  createPlanningService,
  createStorageContext,
  executePlanWithConcurrency,
  formatBlobFileName,
  getProducerMappings,
  injectAllSystemInputs,
  initializeMovieStorage,
  isCanonicalArtifactId,
  loadYamlBlueprintTree,
  loadInputs,
  persistArtifactOverrideBlobs,
  resolveBlobRefsToInputs,
  type BlobInput,
  type ArtefactEvent,
  type ExecutionPlan,
  type JobDescriptor,
  type JobResult,
  type Manifest,
  type MappingFieldDefinition,
  type ModelSelection,
  type PendingArtefactDraft,
  type ProducerOptionsMap,
} from '@gorenku/core';
import {
  createProviderProduce,
  createProviderRegistry,
  estimatePlanCosts,
  loadModelCatalog,
  loadModelInputSchema,
  loadPricingCatalog,
  prepareProviderHandlers,
} from '@gorenku/providers';
import { getCatalogModelsDir, requireCliConfig } from '../generation/config.js';
import {
  inferExtension,
  resolveExistingBlobPath,
  streamFileWithRange,
} from '../shared/stream-utils.js';
import {
  applyArtifactEditFromBuffer,
  readLatestArtifactEvent,
} from './artifact-edit-handler.js';

const TEMP_PREVIEW_NAMESPACE = 'image-edit-previews';
const TEMP_PREVIEW_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const TEMP_ID_PATTERN = /^[a-z0-9-]+$/;

const IMAGE_EDIT_PRODUCER_ID = 'ImageEditProducer';
const IMAGE_EDIT_CAMERA_PRODUCER_ID = 'ImageEditCameraProducer';

type ImagePreviewMode = 'rerun' | 'edit' | 'camera';

interface ProducerSpec {
  producerId: string;
  producerFileName: string;
  provider: string;
  model: string;
}

interface TempPreviewMetadata {
  tempId: string;
  artifactId: string;
  mimeType: string;
  size: number;
  fileName: string;
  createdAt: string;
}

interface GenerationCostEstimate {
  cost: number;
  minCost: number;
  maxCost: number;
  isPlaceholder: boolean;
  note?: string;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface SourceArtifactImage {
  blob: BlobInput;
  dimensions: ImageDimensions;
}

interface PreparedPreviewContext {
  producerOptions: ProducerOptionsMap;
  modelCatalog: Awaited<ReturnType<typeof loadModelCatalog>>;
  catalogModelsDir: string;
  job: JobDescriptor;
  plan: ExecutionPlan;
  resolvedInputs: Record<string, unknown>;
  estimatedCost: GenerationCostEstimate;
}

interface PreparedRerunPreviewContext {
  localStorageContext: ReturnType<typeof createStorageContext>;
  memoryStorageContext: ReturnType<typeof createStorageContext>;
  manifestService: ReturnType<typeof createManifestService>;
  eventLog: ReturnType<typeof createEventLog>;
  producerOptions: ProducerOptionsMap;
  modelCatalog: Awaited<ReturnType<typeof loadModelCatalog>>;
  catalogModelsDir: string;
  plan: ExecutionPlan;
  manifest: Manifest;
  resolvedInputs: Record<string, unknown>;
  targetLayerIndex: number;
  estimatedCost: GenerationCostEstimate;
  storageRoot: string;
  storageBasePath: string;
}

interface RerunPreviewExecutionResult {
  previewData: Buffer;
  mimeType: string;
  estimatedCost: GenerationCostEstimate;
}

interface PreviewModelOption {
  provider: string;
  model: string;
}

class PreviewRequestValidationError extends Error {}

export interface ArtifactPreviewGenerateRequest {
  blueprintFolder: string;
  movieId: string;
  artifactId: string;
  mode: ImagePreviewMode;
  prompt: string;
  promptArtifactId?: string;
  model?: {
    provider: string;
    model: string;
  };
  cameraParams?: {
    azimuth: number;
    elevation: number;
    distance: number;
    shotDescription: string;
  };
}

export interface ArtifactPreviewGenerateResponse {
  success: true;
  tempId: string;
  previewUrl: string;
  mimeType: string;
  estimatedCost: GenerationCostEstimate;
}

export interface ArtifactPreviewEstimateRequest {
  blueprintFolder: string;
  movieId: string;
  artifactId: string;
  mode: ImagePreviewMode;
  prompt: string;
  promptArtifactId?: string;
  model?: {
    provider: string;
    model: string;
  };
  cameraParams?: {
    azimuth: number;
    elevation: number;
    distance: number;
    shotDescription: string;
  };
}

export interface ArtifactPreviewEstimateResponse {
  success: true;
  estimatedCost: GenerationCostEstimate;
}

export interface ArtifactPreviewEditModelsResponse {
  success: true;
  models: PreviewModelOption[];
}

export interface ArtifactPreviewApplyRequest {
  blueprintFolder: string;
  movieId: string;
  artifactId: string;
  tempId: string;
}

export interface ArtifactPreviewDeleteRequest {
  blueprintFolder: string;
  movieId: string;
  tempId: string;
}

export async function handleArtifactPreviewGenerate(
  res: ServerResponse,
  body: ArtifactPreviewGenerateRequest
): Promise<void> {
  try {
    validatePreviewRequest(body, { allowEmptyPrompt: false });

    await cleanupStaleTempPreviews(body.blueprintFolder, body.movieId);

    if (body.mode === 'rerun') {
      const rerunResult = await generateRerunPreviewCandidate(body);
      if (!rerunResult.mimeType.startsWith('image/')) {
        throw new Error(
          `Re-run preview produced non-image MIME type: ${rerunResult.mimeType}.`
        );
      }

      const temp = await createTempPreview(
        body.blueprintFolder,
        body.movieId,
        body.artifactId,
        rerunResult.previewData,
        rerunResult.mimeType
      );

      const response: ArtifactPreviewGenerateResponse = {
        success: true,
        tempId: temp.metadata.tempId,
        previewUrl: buildPreviewUrl(
          body.blueprintFolder,
          body.movieId,
          temp.metadata.tempId
        ),
        mimeType: rerunResult.mimeType,
        estimatedCost: rerunResult.estimatedCost,
      };

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(response));
      return;
    }

    const {
      producerOptions,
      modelCatalog,
      catalogModelsDir,
      job,
      plan,
      resolvedInputs,
      estimatedCost,
    } = await preparePreviewContext(body);

    const logger = createLogger({
      level: 'info',
      prefix: '[viewer-image-preview]',
    });
    const notifications = createNotificationBus();

    let producedBlobData: Uint8Array | Buffer | null = null;
    let producedMimeType: string | null = null;

    try {
      const registry = createProviderRegistry({
        mode: 'live',
        logger,
        notifications,
        catalog: modelCatalog,
        catalogModelsDir,
      });

      const preResolved = prepareProviderHandlers(
        registry,
        plan,
        producerOptions
      );
      await registry.warmStart?.(preResolved);

      const produce = createProviderProduce(
        registry,
        producerOptions,
        resolvedInputs,
        preResolved,
        logger,
        notifications
      );

      const produceResult = await produce({
        movieId: body.movieId,
        job,
        layerIndex: 0,
        attempt: 1,
        revision: plan.revision,
      });

      if (produceResult.status !== 'succeeded') {
        throw new Error(
          `Preview generation failed with status ${produceResult.status ?? 'unknown'}.`
        );
      }

      const producedArtifact = produceResult.artefacts.find(
        (artifact) => artifact.artefactId === body.artifactId
      );
      if (!producedArtifact) {
        throw new Error(
          `Provider did not return artifact ${body.artifactId} in preview response.`
        );
      }
      if (!producedArtifact.blob) {
        throw new Error('Provider returned preview without blob output.');
      }

      if (typeof producedArtifact.blob.data === 'string') {
        throw new Error(
          'Provider returned string blob for image preview. Binary output is required.'
        );
      }

      producedBlobData = producedArtifact.blob.data;
      producedMimeType = producedArtifact.blob.mimeType;
    } finally {
      notifications.complete();
    }

    if (!producedBlobData || !producedMimeType) {
      throw new Error('Preview generation did not produce image data.');
    }

    if (!producedMimeType.startsWith('image/')) {
      throw new Error(
        `Preview generation produced non-image MIME type: ${producedMimeType}.`
      );
    }

    const previewData = Buffer.isBuffer(producedBlobData)
      ? producedBlobData
      : Buffer.from(producedBlobData);

    const temp = await createTempPreview(
      body.blueprintFolder,
      body.movieId,
      body.artifactId,
      previewData,
      producedMimeType
    );

    const response: ArtifactPreviewGenerateResponse = {
      success: true,
      tempId: temp.metadata.tempId,
      previewUrl: buildPreviewUrl(
        body.blueprintFolder,
        body.movieId,
        temp.metadata.tempId
      ),
      mimeType: producedMimeType,
      estimatedCost,
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

    if (body.mode === 'rerun') {
      const rerunContext = await prepareRerunSurgicalPreviewContext(body);
      const response: ArtifactPreviewEstimateResponse = {
        success: true,
        estimatedCost: rerunContext.estimatedCost,
      };

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(response));
      return;
    }

    const { estimatedCost } = await preparePreviewContext(body);

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
    const mappings = getProducerMappings(producerTree, IMAGE_EDIT_PRODUCER_ID);
    if (!mappings) {
      throw new Error(
        `Producer mappings are missing for ${IMAGE_EDIT_PRODUCER_ID}.`
      );
    }

    const models: PreviewModelOption[] = [];
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
    const result = await applyArtifactEditFromBuffer(
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

async function preparePreviewContext(
  body: ArtifactPreviewGenerateRequest | ArtifactPreviewEstimateRequest
): Promise<PreparedPreviewContext> {
  if (body.mode !== 'edit' && body.mode !== 'camera') {
    throw new Error(
      `preparePreviewContext does not support mode ${body.mode}.`
    );
  }

  const cliConfig = await requireCliConfig();
  const catalogRoot = cliConfig.catalog?.root;
  if (!catalogRoot) {
    throw new Error(
      'Renku catalog root is not configured. Run "renku init" first.'
    );
  }

  const catalogModelsDir = getCatalogModelsDir(cliConfig);
  if (!catalogModelsDir) {
    throw new Error(
      'Renku catalog models directory is not configured. Run "renku init" first.'
    );
  }

  const modelCatalog = await loadModelCatalog(catalogModelsDir);

  return prepareEditOrCameraPreviewContext(body, {
    catalogRoot,
    catalogModelsDir,
    modelCatalog,
  });
}

async function prepareEditOrCameraPreviewContext(
  body: ArtifactPreviewGenerateRequest | ArtifactPreviewEstimateRequest,
  context: {
    catalogRoot: string;
    catalogModelsDir: string;
    modelCatalog: Awaited<ReturnType<typeof loadModelCatalog>>;
  }
): Promise<PreparedPreviewContext> {
  if (body.mode !== 'edit' && body.mode !== 'camera') {
    throw new Error(
      `prepareEditOrCameraPreviewContext does not support mode ${body.mode}.`
    );
  }

  const { catalogRoot, catalogModelsDir, modelCatalog } = context;

  const producerSpec = resolveProducerSpec(body);
  const sourceImage = await loadSourceArtifactBlob(
    body.blueprintFolder,
    body.movieId,
    body.artifactId
  );

  const producerPath = path.join(
    catalogRoot,
    'producers',
    'image',
    producerSpec.producerFileName
  );
  if (!existsSync(producerPath)) {
    throw new Error(`Producer file not found: ${producerPath}`);
  }

  const modelSelection: ModelSelection = {
    producerId: producerSpec.producerId,
    provider: producerSpec.provider,
    model: producerSpec.model,
  };

  const { root: producerTree } = await loadYamlBlueprintTree(producerPath, {
    catalogRoot,
  });

  const producerOptions = await buildProducerOptionsFromBlueprint(
    producerTree,
    [modelSelection]
  );

  const providerMetadata = await buildProviderMetadata(
    producerOptions,
    { catalogModelsDir, modelCatalog },
    loadModelInputSchema as Parameters<typeof buildProviderMetadata>[2]
  );

  const metadata = providerMetadata.get(producerSpec.producerId);
  if (!metadata) {
    throw new Error(
      `Provider metadata is missing for producer ${producerSpec.producerId}.`
    );
  }
  if (!metadata.sdkMapping || Object.keys(metadata.sdkMapping).length === 0) {
    throw new Error(
      `SDK mapping is missing for ${producerSpec.provider}/${producerSpec.model}.`
    );
  }
  if (!metadata.inputSchema) {
    throw new Error(
      `Input schema is missing for ${producerSpec.provider}/${producerSpec.model}.`
    );
  }

  const sdkMapping = normalizePreviewSdkMapping(body.mode, metadata.sdkMapping);

  const { inputBindings, resolvedInputs } = buildPreviewInputs({
    producerId: producerSpec.producerId,
    artifactId: body.artifactId,
    mode: body.mode,
    prompt: body.prompt,
    cameraParams: body.cameraParams,
    sourceImageBlob: sourceImage.blob,
    sourceImageDimensions: sourceImage.dimensions,
  });

  const job = createPreviewJobDescriptor({
    artifactId: body.artifactId,
    producerSpec,
    inputBindings,
    sdkMapping,
    inputSchema: metadata.inputSchema,
    outputSchema: metadata.outputSchema,
    resolvedInputs,
  });

  const plan = createSingleJobPlan(job);

  const pricingCatalog = await loadPricingCatalog(catalogModelsDir);
  const costSummary = estimatePlanCosts(plan, pricingCatalog, resolvedInputs);
  const estimatedJob = costSummary.jobs[0];
  if (!estimatedJob) {
    throw new Error('Failed to estimate preview generation cost.');
  }

  return {
    producerOptions,
    modelCatalog,
    catalogModelsDir,
    job,
    plan,
    resolvedInputs,
    estimatedCost: toGenerationCostEstimate(estimatedJob.estimate),
  };
}

async function generateRerunPreviewCandidate(
  body: ArtifactPreviewGenerateRequest
): Promise<RerunPreviewExecutionResult> {
  const rerunContext = await prepareRerunSurgicalPreviewContext(body);

  const logger = createLogger({
    level: 'info',
    prefix: '[viewer-rerun-preview]',
  });
  const notifications = createNotificationBus();

  try {
    const registry = createProviderRegistry({
      mode: 'live',
      logger,
      notifications,
      catalog: rerunContext.modelCatalog,
      catalogModelsDir: rerunContext.catalogModelsDir,
    });

    const preResolved = prepareProviderHandlers(
      registry,
      rerunContext.plan,
      rerunContext.producerOptions
    );
    await registry.warmStart?.(preResolved);

    const resolvedInputsWithBlobs = (await resolveBlobRefsToInputs(
      rerunContext.memoryStorageContext,
      body.movieId,
      rerunContext.resolvedInputs
    )) as Record<string, unknown>;

    const resolvedInputsWithSystem = injectAllSystemInputs(
      resolvedInputsWithBlobs,
      body.movieId,
      rerunContext.storageRoot,
      rerunContext.storageBasePath
    );

    const produce = createProviderProduce(
      registry,
      rerunContext.producerOptions,
      resolvedInputsWithSystem,
      preResolved,
      logger,
      notifications
    );

    const run = await executePlanWithConcurrency(
      rerunContext.plan,
      {
        movieId: body.movieId,
        manifest: rerunContext.manifest,
        storage: rerunContext.memoryStorageContext,
        eventLog: rerunContext.eventLog,
        manifestService: rerunContext.manifestService,
        produce,
        logger,
      },
      {
        concurrency: 1,
        upToLayer: rerunContext.targetLayerIndex,
      }
    );

    if (run.status !== 'succeeded') {
      throw new Error('Re-run preview execution failed.');
    }

    const targetArtifact = findLatestSucceededArtifactEvent(
      run.jobs,
      body.artifactId
    );
    if (!targetArtifact?.output.blob) {
      throw new Error(
        `Re-run preview did not produce succeeded output for artifact ${body.artifactId}.`
      );
    }

    const blobRef = targetArtifact.output.blob;
    const prefix = blobRef.hash.slice(0, 2);
    const fileName = formatBlobFileName(blobRef.hash, blobRef.mimeType);
    const blobPath = rerunContext.memoryStorageContext.resolve(
      body.movieId,
      'blobs',
      prefix,
      fileName
    );
    const raw =
      await rerunContext.memoryStorageContext.storage.readToUint8Array(
        blobPath
      );

    return {
      previewData: Buffer.from(raw),
      mimeType: blobRef.mimeType,
      estimatedCost: rerunContext.estimatedCost,
    };
  } finally {
    notifications.complete();
  }
}

async function prepareRerunSurgicalPreviewContext(
  body: ArtifactPreviewGenerateRequest | ArtifactPreviewEstimateRequest
): Promise<PreparedRerunPreviewContext> {
  const cliConfig = await requireCliConfig();
  const catalogRoot = cliConfig.catalog?.root;
  if (!catalogRoot) {
    throw new Error(
      'Renku catalog root is not configured. Run "renku init" first.'
    );
  }

  const catalogModelsDir = getCatalogModelsDir(cliConfig);
  if (!catalogModelsDir) {
    throw new Error(
      'Renku catalog models directory is not configured. Run "renku init" first.'
    );
  }

  const storageBasePath = resolveStorageBasePath(
    cliConfig.storage.root,
    body.blueprintFolder
  );
  const localStorageContext = createStorageContext({
    kind: 'local',
    rootDir: cliConfig.storage.root,
    basePath: storageBasePath,
  });
  const memoryStorageContext = createStorageContext({
    kind: 'memory',
    basePath: storageBasePath,
  });

  await initializeMovieStorage(memoryStorageContext, body.movieId);
  await copyManifestToMemory(
    localStorageContext,
    memoryStorageContext,
    body.movieId
  );
  await copyEventsToMemory(
    localStorageContext,
    memoryStorageContext,
    body.movieId
  );
  await copyLatestSucceededBlobsToMemory(
    body.blueprintFolder,
    localStorageContext,
    memoryStorageContext,
    body.movieId
  );

  const metadata = await createMovieMetadataService(localStorageContext).read(
    body.movieId
  );
  if (!metadata?.blueprintPath) {
    throw new Error(
      `Build ${body.movieId} metadata is missing blueprintPath. Cannot run Re-run preview.`
    );
  }

  const inputsPath = await resolveInputsPathForRerun(
    body.blueprintFolder,
    body.movieId,
    metadata.lastInputsPath
  );

  const { root: blueprintTree } = await loadYamlBlueprintTree(
    metadata.blueprintPath,
    {
      catalogRoot,
    }
  );

  const buildsDir = path.join(body.blueprintFolder, 'builds', body.movieId);
  const {
    values: inputValues,
    providerOptions,
    artifactOverrides,
  } = await loadInputs({
    yamlPath: inputsPath,
    blueprintTree,
    buildsDir,
  });

  const persistedOverrides = await persistArtifactOverrideBlobs(
    artifactOverrides,
    memoryStorageContext,
    body.movieId
  );
  const pendingArtefacts = convertArtifactOverridesToDrafts(persistedOverrides);

  const promptOverrideDraft = await buildRerunPromptOverrideDraft({
    request: body,
    blueprintFolder: body.blueprintFolder,
    movieId: body.movieId,
    storage: memoryStorageContext,
  });
  if (promptOverrideDraft) {
    pendingArtefacts.push(promptOverrideDraft);
  }

  const modelCatalog = await loadModelCatalog(catalogModelsDir);
  const providerMetadata = await buildProviderMetadata(
    providerOptions,
    { catalogModelsDir, modelCatalog },
    loadModelInputSchema as Parameters<typeof buildProviderMetadata>[2]
  );

  const planningService = createPlanningService();
  const manifestService = createManifestService(memoryStorageContext);
  const eventLog = createEventLog(memoryStorageContext);
  const providerCatalog = buildProducerCatalog(providerOptions);

  const planResult = await planningService.generatePlan({
    movieId: body.movieId,
    blueprintTree,
    inputValues,
    providerCatalog,
    providerOptions: providerMetadata,
    storage: memoryStorageContext,
    manifestService,
    eventLog,
    pendingArtefacts:
      pendingArtefacts.length > 0 ? pendingArtefacts : undefined,
    targetArtifactIds: [body.artifactId],
  });

  const targetLayerIndex = findTargetArtifactLayer(
    planResult.plan,
    body.artifactId
  );

  const previewPlan: ExecutionPlan = {
    ...planResult.plan,
    layers: planResult.plan.layers.map((layer, layerIndex) =>
      layerIndex <= targetLayerIndex ? layer : []
    ),
  };

  const pricingCatalog = await loadPricingCatalog(catalogModelsDir);
  const costSummary = estimatePlanCosts(
    previewPlan,
    pricingCatalog,
    planResult.resolvedInputs
  );

  return {
    localStorageContext,
    memoryStorageContext,
    manifestService,
    eventLog,
    producerOptions: providerOptions,
    modelCatalog,
    catalogModelsDir,
    plan: previewPlan,
    manifest: planResult.manifest,
    resolvedInputs: planResult.resolvedInputs,
    targetLayerIndex,
    estimatedCost: toPlanCostEstimate(costSummary),
    storageRoot: cliConfig.storage.root,
    storageBasePath,
  };
}

async function buildRerunPromptOverrideDraft(args: {
  request: ArtifactPreviewGenerateRequest | ArtifactPreviewEstimateRequest;
  blueprintFolder: string;
  movieId: string;
  storage: ReturnType<typeof createStorageContext>;
}): Promise<PendingArtefactDraft | null> {
  const { request, blueprintFolder, movieId, storage } = args;
  const trimmedPrompt = request.prompt.trim();
  if (request.mode !== 'rerun' || trimmedPrompt.length === 0) {
    return null;
  }

  if (!request.promptArtifactId) {
    throw new Error('Re-run prompt override requires promptArtifactId.');
  }

  const latestPromptEvent = await readLatestArtifactEvent(
    blueprintFolder,
    movieId,
    request.promptArtifactId
  );
  if (!latestPromptEvent?.output.blob?.mimeType) {
    throw new Error(
      `Prompt artifact ${request.promptArtifactId} has no latest blob metadata for Re-run override.`
    );
  }

  const blob = await persistArtifactOverrideBlobs(
    [
      {
        artifactId: request.promptArtifactId,
        blob: {
          data: Buffer.from(request.prompt, 'utf8'),
          mimeType: latestPromptEvent.output.blob.mimeType,
        },
      },
    ],
    storage,
    movieId
  );

  const [draft] = convertArtifactOverridesToDrafts(blob);
  if (!draft) {
    throw new Error(
      'Failed to create prompt override draft for Re-run preview.'
    );
  }

  return {
    ...draft,
    producedBy: latestPromptEvent.producedBy,
    inputsHash: latestPromptEvent.inputsHash,
  };
}

async function copyLatestSucceededBlobsToMemory(
  blueprintFolder: string,
  localStorageContext: ReturnType<typeof createStorageContext>,
  memoryStorageContext: ReturnType<typeof createStorageContext>,
  movieId: string
): Promise<void> {
  const localEventLog = createEventLog(localStorageContext);
  const latestBlobs = new Map<string, { hash: string; mimeType: string }>();

  for await (const event of localEventLog.streamArtefacts(movieId)) {
    if (
      event.status === 'succeeded' &&
      event.output.blob?.hash &&
      event.output.blob.mimeType
    ) {
      latestBlobs.set(event.artefactId, {
        hash: event.output.blob.hash,
        mimeType: event.output.blob.mimeType,
      });
    }
  }

  const copiedBlobs = new Set<string>();
  const buildsRoot = path.join(blueprintFolder, 'builds');

  for (const blob of latestBlobs.values()) {
    const blobKey = `${blob.hash}:${blob.mimeType}`;
    if (copiedBlobs.has(blobKey)) {
      continue;
    }

    const sourcePath = await resolveExistingBlobPath(
      buildsRoot,
      movieId,
      blob.hash,
      blob.mimeType
    );
    const payload = await fs.readFile(sourcePath);

    const prefix = blob.hash.slice(0, 2);
    const fileName = formatBlobFileName(blob.hash, blob.mimeType);
    const destinationPath = memoryStorageContext.resolve(
      movieId,
      'blobs',
      prefix,
      fileName
    );
    await memoryStorageContext.storage.write(destinationPath, payload, {
      mimeType: blob.mimeType,
    });

    copiedBlobs.add(blobKey);
  }
}

export function findTargetArtifactLayer(
  plan: ExecutionPlan,
  artifactId: string
): number {
  const matchingLayers: number[] = [];

  for (let layerIndex = 0; layerIndex < plan.layers.length; layerIndex += 1) {
    const layer = plan.layers[layerIndex] ?? [];
    if (layer.some((job) => job.produces.includes(artifactId))) {
      matchingLayers.push(layerIndex);
    }
  }

  if (matchingLayers.length === 0) {
    throw new Error(
      `Surgical plan does not include a producer job for artifact ${artifactId}.`
    );
  }
  if (matchingLayers.length > 1) {
    throw new Error(
      `Surgical plan contains multiple producer layers for artifact ${artifactId}.`
    );
  }

  return matchingLayers[0]!;
}

function findLatestSucceededArtifactEvent(
  jobs: JobResult[],
  artifactId: string
): ArtefactEvent | null {
  for (let jobIndex = jobs.length - 1; jobIndex >= 0; jobIndex -= 1) {
    const artefacts = jobs[jobIndex]?.artefacts ?? [];
    for (
      let artefactIndex = artefacts.length - 1;
      artefactIndex >= 0;
      artefactIndex -= 1
    ) {
      const event = artefacts[artefactIndex];
      if (event.artefactId === artifactId && event.status === 'succeeded') {
        return event;
      }
    }
  }
  return null;
}

function resolveStorageBasePath(
  storageRoot: string,
  blueprintFolder: string
): string {
  const buildsFolder = path.join(blueprintFolder, 'builds');
  const basePath = path.relative(storageRoot, buildsFolder);
  if (basePath.startsWith('..') || path.isAbsolute(basePath)) {
    throw new Error(
      `Blueprint folder ${blueprintFolder} is outside configured storage root ${storageRoot}.`
    );
  }

  return basePath;
}

export async function resolveInputsPathForRerun(
  blueprintFolder: string,
  movieId: string,
  lastInputsPath?: string
): Promise<string> {
  const buildInputsPath = path.join(
    blueprintFolder,
    'builds',
    movieId,
    'inputs.yaml'
  );
  if (existsSync(buildInputsPath)) {
    return buildInputsPath;
  }

  if (lastInputsPath && existsSync(lastInputsPath)) {
    return lastInputsPath;
  }
  throw new Error(
    `Could not resolve inputs file for build ${movieId}. Expected build inputs at ${buildInputsPath} or a valid metadata.lastInputsPath.`
  );
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

function toPlanCostEstimate(summary: {
  totalCost: number;
  minTotalCost: number;
  maxTotalCost: number;
  hasPlaceholders: boolean;
  missingProviders: string[];
}): GenerationCostEstimate {
  return {
    cost: summary.totalCost,
    minCost: summary.minTotalCost,
    maxCost: summary.maxTotalCost,
    isPlaceholder: summary.hasPlaceholders,
    note:
      summary.missingProviders.length > 0
        ? `Missing provider pricing: ${summary.missingProviders.join(', ')}`
        : undefined,
  };
}

function normalizePreviewSdkMapping(
  mode: ImagePreviewMode,
  sdkMapping: Record<string, MappingFieldDefinition>
): Record<string, MappingFieldDefinition> {
  if (mode !== 'camera') {
    return sdkMapping;
  }

  const sourceImageMapping = sdkMapping.SourceImage;
  if (!sourceImageMapping) {
    throw new Error('Camera preview is missing SourceImage SDK mapping.');
  }

  if (sourceImageMapping.field !== 'image_urls') {
    throw new Error(
      `Camera preview expects SourceImage to map to image_urls, got ${sourceImageMapping.field ?? 'undefined'}.`
    );
  }

  const sourceImageWithoutFirstOf: MappingFieldDefinition = {
    ...sourceImageMapping,
  };
  delete sourceImageWithoutFirstOf.firstOf;

  if (sdkMapping.ImageSize) {
    throw new Error(
      'Camera preview mapping already defines ImageSize alias. This conflicts with preview cost normalization.'
    );
  }

  return {
    ...sdkMapping,
    SourceImage: sourceImageWithoutFirstOf,
    ImageSize: {
      field: 'image_size',
    },
  };
}

function resolveProducerSpec(
  body: ArtifactPreviewGenerateRequest | ArtifactPreviewEstimateRequest
): ProducerSpec {
  if (body.mode === 'edit') {
    return {
      producerId: IMAGE_EDIT_PRODUCER_ID,
      producerFileName: 'image-edit.yaml',
      provider: body.model!.provider,
      model: body.model!.model,
    };
  }

  if (body.mode === 'rerun') {
    throw new Error(
      'Re-run preview mode does not use ImageEdit producer spec.'
    );
  }

  return {
    producerId: IMAGE_EDIT_CAMERA_PRODUCER_ID,
    producerFileName: 'image-edit-camera.yaml',
    provider: 'fal-ai',
    model: 'qwen-image-edit-2511-multiple-angles',
  };
}

async function loadSourceArtifactBlob(
  blueprintFolder: string,
  movieId: string,
  artifactId: string
): Promise<SourceArtifactImage> {
  const latestEvent = await readLatestArtifactEvent(
    blueprintFolder,
    movieId,
    artifactId
  );

  const blob = latestEvent?.output.blob;
  if (!blob?.hash) {
    throw new Error(
      `Artifact ${artifactId} has no succeeded blob output in the event log.`
    );
  }
  if (!blob.mimeType) {
    throw new Error(
      `Artifact ${artifactId} is missing MIME type in the latest event.`
    );
  }

  const buildsRoot = path.join(blueprintFolder, 'builds');
  const sourcePath = await resolveExistingBlobPath(
    buildsRoot,
    movieId,
    blob.hash,
    blob.mimeType
  );
  const sourceData = await fs.readFile(sourcePath);
  const dimensions = readImageDimensions(sourceData, blob.mimeType);

  return {
    blob: {
      data: sourceData,
      mimeType: blob.mimeType,
    },
    dimensions,
  };
}

type SupportedImageFormat = 'png' | 'jpeg' | 'webp';

export function readImageDimensions(
  data: Buffer,
  mimeType: string
): ImageDimensions {
  const detectedFormat = detectImageFormat(data);
  if (detectedFormat) {
    return readImageDimensionsByFormat(data, detectedFormat);
  }

  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType === 'image/png') {
    return readPngDimensions(data);
  }
  if (
    normalizedMimeType === 'image/jpeg' ||
    normalizedMimeType === 'image/jpg'
  ) {
    return readJpegDimensions(data);
  }
  if (normalizedMimeType === 'image/webp') {
    return readWebpDimensions(data);
  }

  throw new Error(
    `Cannot estimate image dimensions for MIME type ${mimeType}. Expected image/png, image/jpeg, or image/webp.`
  );
}

function detectImageFormat(data: Buffer): SupportedImageFormat | null {
  if (isPngSignature(data)) {
    return 'png';
  }
  if (isJpegSignature(data)) {
    return 'jpeg';
  }
  if (isWebpSignature(data)) {
    return 'webp';
  }
  return null;
}

function readImageDimensionsByFormat(
  data: Buffer,
  format: SupportedImageFormat
): ImageDimensions {
  if (format === 'png') {
    return readPngDimensions(data);
  }
  if (format === 'jpeg') {
    return readJpegDimensions(data);
  }
  return readWebpDimensions(data);
}

function isPngSignature(data: Buffer): boolean {
  return (
    data.byteLength >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  );
}

function isJpegSignature(data: Buffer): boolean {
  return data.byteLength >= 2 && data[0] === 0xff && data[1] === 0xd8;
}

function isWebpSignature(data: Buffer): boolean {
  return (
    data.byteLength >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  );
}

function readPngDimensions(data: Buffer): ImageDimensions {
  if (data.byteLength < 24) {
    throw new Error('PNG image is too small to contain dimensions.');
  }

  const signatureMatches =
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a;
  if (!signatureMatches) {
    throw new Error('Invalid PNG signature while parsing dimensions.');
  }

  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid PNG dimensions: ${width}x${height}.`);
  }

  return { width, height };
}

function readJpegDimensions(data: Buffer): ImageDimensions {
  if (data.byteLength < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    throw new Error('Invalid JPEG header while parsing dimensions.');
  }

  let offset = 2;
  const sofMarkers = new Set<number>([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);

  while (offset + 3 < data.byteLength) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    let markerOffset = offset + 1;
    while (markerOffset < data.byteLength && data[markerOffset] === 0xff) {
      markerOffset += 1;
    }
    if (markerOffset >= data.byteLength) {
      break;
    }

    const marker = data[markerOffset];
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    const segmentLengthOffset = markerOffset + 1;
    if (segmentLengthOffset + 1 >= data.byteLength) {
      break;
    }
    const segmentLength = data.readUInt16BE(segmentLengthOffset);
    if (segmentLength < 2) {
      throw new Error(
        `Invalid JPEG segment length ${segmentLength} while parsing dimensions.`
      );
    }

    if (sofMarkers.has(marker)) {
      const frameDataOffset = segmentLengthOffset + 2;
      if (frameDataOffset + 4 >= data.byteLength) {
        break;
      }
      const height = data.readUInt16BE(frameDataOffset + 1);
      const width = data.readUInt16BE(frameDataOffset + 3);
      if (width <= 0 || height <= 0) {
        throw new Error(`Invalid JPEG dimensions: ${width}x${height}.`);
      }
      return { width, height };
    }

    offset = segmentLengthOffset + segmentLength;
  }

  throw new Error('Unable to parse JPEG dimensions from source image.');
}

function readWebpDimensions(data: Buffer): ImageDimensions {
  if (
    data.byteLength < 30 ||
    data.toString('ascii', 0, 4) !== 'RIFF' ||
    data.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error('Invalid WebP header while parsing dimensions.');
  }

  const chunkType = data.toString('ascii', 12, 16);
  if (chunkType === 'VP8X') {
    const width = 1 + readUInt24LE(data, 24);
    const height = 1 + readUInt24LE(data, 27);
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid WebP VP8X dimensions: ${width}x${height}.`);
    }
    return { width, height };
  }

  if (chunkType === 'VP8 ') {
    if (data.byteLength < 30) {
      throw new Error('WebP VP8 image is too small to contain dimensions.');
    }
    const startCode =
      data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a;
    if (!startCode) {
      throw new Error('Invalid WebP VP8 start code while parsing dimensions.');
    }
    const width = data.readUInt16LE(26) & 0x3fff;
    const height = data.readUInt16LE(28) & 0x3fff;
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid WebP VP8 dimensions: ${width}x${height}.`);
    }
    return { width, height };
  }

  if (chunkType === 'VP8L') {
    if (data.byteLength < 25) {
      throw new Error('WebP VP8L image is too small to contain dimensions.');
    }
    if (data[20] !== 0x2f) {
      throw new Error('Invalid WebP VP8L signature while parsing dimensions.');
    }

    const b0 = data[21];
    const b1 = data[22];
    const b2 = data[23];
    const b3 = data[24];

    const width = 1 + (b0 | ((b1 & 0x3f) << 8));
    const height = 1 + (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));

    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid WebP VP8L dimensions: ${width}x${height}.`);
    }
    return { width, height };
  }

  throw new Error(`Unsupported WebP chunk type ${chunkType} for dimensions.`);
}

function readUInt24LE(data: Buffer, offset: number): number {
  if (offset + 2 >= data.byteLength) {
    throw new Error(
      `Cannot read 24-bit integer at offset ${offset}; buffer is too small.`
    );
  }
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

function buildPreviewInputs(params: {
  producerId: string;
  artifactId: string;
  mode: ImagePreviewMode;
  prompt: string;
  cameraParams?: ArtifactPreviewGenerateRequest['cameraParams'];
  sourceImageBlob: BlobInput;
  sourceImageDimensions: ImageDimensions;
}): {
  inputBindings: Record<string, string>;
  resolvedInputs: Record<string, unknown>;
} {
  const {
    producerId,
    artifactId,
    mode,
    prompt,
    cameraParams,
    sourceImageBlob,
    sourceImageDimensions,
  } = params;

  const resolvedInputs: Record<string, unknown> = {
    [artifactId]: sourceImageBlob,
  };

  const inputBindings: Record<string, string> = {
    SourceImage: artifactId,
  };

  if (mode === 'edit') {
    const promptInputId = `Input:${producerId}.Prompt`;
    inputBindings.Prompt = promptInputId;
    resolvedInputs[promptInputId] = prompt;
    return { inputBindings, resolvedInputs };
  }

  if (!cameraParams) {
    throw new Error('Camera params are required for camera preview mode.');
  }

  const azimuthInputId = `Input:${producerId}.CameraAzimuth`;
  const elevationInputId = `Input:${producerId}.CameraElevation`;
  const zoomInputId = `Input:${producerId}.CameraZoom`;
  const imageSizeInputId = `Input:${producerId}.ImageSize`;
  const promptInputId = `Input:${producerId}.Prompt`;

  inputBindings.CameraAzimuth = azimuthInputId;
  inputBindings.CameraElevation = elevationInputId;
  inputBindings.CameraZoom = zoomInputId;
  inputBindings.ImageSize = imageSizeInputId;
  inputBindings.Prompt = promptInputId;

  resolvedInputs[azimuthInputId] = convertCameraAzimuthToProvider(
    cameraParams.azimuth
  );
  resolvedInputs[elevationInputId] = cameraParams.elevation;
  resolvedInputs[zoomInputId] = convertCameraDistanceToZoom(
    cameraParams.distance
  );
  resolvedInputs[imageSizeInputId] = {
    width: sourceImageDimensions.width,
    height: sourceImageDimensions.height,
  };
  resolvedInputs[promptInputId] = buildCameraPrompt(
    prompt,
    cameraParams.shotDescription
  );

  return { inputBindings, resolvedInputs };
}

function convertCameraAzimuthToProvider(azimuth: number): number {
  if (!Number.isFinite(azimuth)) {
    throw new Error(`Camera azimuth must be a finite number, got ${azimuth}.`);
  }
  if (azimuth < 0 || azimuth > 360) {
    throw new Error(
      `Camera azimuth ${azimuth} is out of expected range 0-360.`
    );
  }

  const normalized = ((azimuth % 360) + 360) % 360;
  return (360 - normalized) % 360;
}

function convertCameraDistanceToZoom(distance: number): number {
  if (!Number.isFinite(distance)) {
    throw new Error(
      `Camera distance must be a finite number, got ${distance}.`
    );
  }
  if (distance < 0.6 || distance > 1.4) {
    throw new Error(
      `Camera distance ${distance} is out of expected range 0.6-1.4.`
    );
  }

  const normalized = (distance - 0.6) / 0.8;
  return Number((normalized * 10).toFixed(3));
}

function buildCameraPrompt(
  basePrompt: string,
  shotDescription: string
): string {
  if (
    typeof shotDescription !== 'string' ||
    shotDescription.trim().length === 0
  ) {
    throw new Error('Camera shot description is required.');
  }

  const normalizedBasePrompt = basePrompt.trim();
  if (normalizedBasePrompt.length === 0) {
    return shotDescription;
  }

  return `${shotDescription}. ${normalizedBasePrompt}`;
}

function createPreviewJobDescriptor(params: {
  artifactId: string;
  producerSpec: ProducerSpec;
  inputBindings: Record<string, string>;
  sdkMapping: Record<string, MappingFieldDefinition>;
  inputSchema?: string;
  outputSchema?: string;
  resolvedInputs: Record<string, unknown>;
}): JobDescriptor {
  const {
    artifactId,
    producerSpec,
    inputBindings,
    sdkMapping,
    inputSchema,
    outputSchema,
    resolvedInputs,
  } = params;

  const boundInputIds = Object.values(inputBindings);
  const uniqueInputIds = Array.from(new Set(boundInputIds));

  const jobId = `Producer:${producerSpec.producerId}`;
  return {
    jobId,
    producer: producerSpec.producerId,
    inputs: uniqueInputIds,
    produces: [artifactId],
    provider: producerSpec.provider,
    providerModel: producerSpec.model,
    rateKey: `${producerSpec.provider}:${producerSpec.model}`,
    context: {
      namespacePath: [],
      indices: {},
      producerAlias: producerSpec.producerId,
      inputs: uniqueInputIds,
      produces: [artifactId],
      inputBindings,
      sdkMapping,
      extras: {
        resolvedInputs,
        schema: {
          input: inputSchema,
          output: outputSchema,
        },
      },
    },
  };
}

function createSingleJobPlan(job: JobDescriptor): ExecutionPlan {
  const revision = `rev-preview-${Date.now().toString(36)}` as `rev-${string}`;
  return {
    revision,
    manifestBaseHash: 'preview',
    layers: [[job]],
    createdAt: new Date().toISOString(),
    blueprintLayerCount: 1,
  };
}

function toGenerationCostEstimate(estimate: {
  cost: number;
  isPlaceholder: boolean;
  note?: string;
  range?: { min: number; max: number };
}): GenerationCostEstimate {
  const minCost = estimate.range?.min ?? estimate.cost;
  const maxCost = estimate.range?.max ?? estimate.cost;
  return {
    cost: estimate.cost,
    minCost,
    maxCost,
    isPlaceholder: estimate.isPlaceholder,
    note: estimate.note,
  };
}

function getTempPreviewDir(blueprintFolder: string, movieId: string): string {
  return path.join(
    blueprintFolder,
    'builds',
    movieId,
    'temp',
    TEMP_PREVIEW_NAMESPACE
  );
}

function getTempMetadataPath(
  blueprintFolder: string,
  movieId: string,
  tempId: string
): string {
  return path.join(
    getTempPreviewDir(blueprintFolder, movieId),
    `${tempId}.json`
  );
}

function assertSafeTempPath(filePath: string, blueprintFolder: string): void {
  const resolvedFile = path.resolve(filePath);
  const resolvedRoot = path.resolve(blueprintFolder);
  if (
    !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`) &&
    resolvedFile !== resolvedRoot
  ) {
    throw new Error('Invalid temporary preview path.');
  }
}

function validateTempId(tempId: string): void {
  if (!TEMP_ID_PATTERN.test(tempId)) {
    throw new Error(`Invalid temp preview id: ${tempId}`);
  }
}

function createTempId(): string {
  return `tmp-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
}

async function createTempPreview(
  blueprintFolder: string,
  movieId: string,
  artifactId: string,
  data: Buffer,
  mimeType: string
): Promise<{ metadata: TempPreviewMetadata; filePath: string }> {
  const tempDir = getTempPreviewDir(blueprintFolder, movieId);
  assertSafeTempPath(tempDir, blueprintFolder);

  await fs.mkdir(tempDir, { recursive: true });

  const tempId = createTempId();
  const extension = inferExtension(mimeType);
  const fileName = extension ? `${tempId}.${extension}` : tempId;
  const filePath = path.join(tempDir, fileName);
  const metadataPath = getTempMetadataPath(blueprintFolder, movieId, tempId);

  assertSafeTempPath(filePath, blueprintFolder);
  assertSafeTempPath(metadataPath, blueprintFolder);

  const metadata: TempPreviewMetadata = {
    tempId,
    artifactId,
    mimeType,
    size: data.byteLength,
    fileName,
    createdAt: new Date().toISOString(),
  };

  await fs.writeFile(filePath, data);
  await fs.writeFile(metadataPath, JSON.stringify(metadata), 'utf8');

  return { metadata, filePath };
}

async function readTempPreview(
  blueprintFolder: string,
  movieId: string,
  tempId: string
): Promise<{ metadata: TempPreviewMetadata; filePath: string }> {
  validateTempId(tempId);

  const metadataPath = getTempMetadataPath(blueprintFolder, movieId, tempId);
  assertSafeTempPath(metadataPath, blueprintFolder);

  if (!existsSync(metadataPath)) {
    throw new Error(`Preview ${tempId} not found.`);
  }

  const raw = await fs.readFile(metadataPath, 'utf8');
  const parsed = JSON.parse(raw) as TempPreviewMetadata;
  if (!parsed.fileName || !parsed.mimeType) {
    throw new Error(`Preview ${tempId} metadata is invalid.`);
  }

  const filePath = path.join(
    getTempPreviewDir(blueprintFolder, movieId),
    parsed.fileName
  );
  assertSafeTempPath(filePath, blueprintFolder);
  if (!existsSync(filePath)) {
    throw new Error(`Preview file for ${tempId} not found.`);
  }

  return { metadata: parsed, filePath };
}

async function deleteTempPreview(
  blueprintFolder: string,
  movieId: string,
  tempId: string
): Promise<void> {
  validateTempId(tempId);

  const metadataPath = getTempMetadataPath(blueprintFolder, movieId, tempId);
  assertSafeTempPath(metadataPath, blueprintFolder);

  if (!existsSync(metadataPath)) {
    return;
  }

  const raw = await fs.readFile(metadataPath, 'utf8');
  const parsed = JSON.parse(raw) as TempPreviewMetadata;
  const filePath = path.join(
    getTempPreviewDir(blueprintFolder, movieId),
    parsed.fileName
  );
  assertSafeTempPath(filePath, blueprintFolder);

  await fs.rm(metadataPath, { force: true });
  await fs.rm(filePath, { force: true });
}

async function cleanupStaleTempPreviews(
  blueprintFolder: string,
  movieId: string
): Promise<void> {
  const tempDir = getTempPreviewDir(blueprintFolder, movieId);
  assertSafeTempPath(tempDir, blueprintFolder);

  if (!existsSync(tempDir)) {
    return;
  }

  const entries = await fs.readdir(tempDir, { withFileTypes: true });
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const metadataPath = path.join(tempDir, entry.name);
    assertSafeTempPath(metadataPath, blueprintFolder);

    try {
      const raw = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(raw) as TempPreviewMetadata;
      const createdAt = new Date(metadata.createdAt).getTime();
      if (!Number.isFinite(createdAt)) {
        continue;
      }
      if (now - createdAt < TEMP_PREVIEW_MAX_AGE_MS) {
        continue;
      }

      if (metadata.tempId && TEMP_ID_PATTERN.test(metadata.tempId)) {
        await deleteTempPreview(blueprintFolder, movieId, metadata.tempId);
      }
    } catch {
      // Ignore stale cleanup failures for malformed files.
    }
  }
}

function buildPreviewUrl(
  blueprintFolder: string,
  movieId: string,
  tempId: string
): string {
  const url = new URL(
    '/viewer-api/blueprints/builds/artifacts/preview-file',
    'http://viewer.local'
  );
  url.searchParams.set('folder', blueprintFolder);
  url.searchParams.set('movieId', movieId);
  url.searchParams.set('tempId', tempId);
  return `${url.pathname}${url.search}`;
}
