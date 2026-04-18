import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import {
  buildProviderMetadata,
  buildProducerOptionsFromBlueprint,
  createLogger,
  createNotificationBus,
  readLlmInvocationSettings,
  loadYamlBlueprintTree,
  type BlobInput,
  type ExecutionPlan,
  type JobDescriptor,
  type MappingFieldDefinition,
  type ModelSelection,
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
import {
  getCatalogModelsDir,
  requireCliConfig,
} from '../../generation/config.js';
import { resolveExistingBlobPath } from '../../shared/stream-utils.js';
import { readLatestArtifactEvent } from '../artifact-edit-handler.js';
import type {
  ArtifactPreviewEstimateRequest,
  ArtifactPreviewGenerateRequest,
  GenerationCostEstimate,
  ImageDimensions,
  ImagePreviewMode,
  PreviewGenerationResult,
} from './contracts.js';
import { readImageDimensions } from './image-dimensions.js';

const IMAGE_EDIT_PRODUCER_ID = 'ImageEditProducer';
const IMAGE_EDIT_CAMERA_PRODUCER_ID = 'ImageEditCameraProducer';

interface ProducerSpec {
  producerId: string;
  producerFileName: string;
  provider: string;
  model: string;
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

export async function estimateEditOrCameraPreview(
  body: ArtifactPreviewEstimateRequest
): Promise<GenerationCostEstimate> {
  const context = await preparePreviewContext(body);
  return context.estimatedCost;
}

export async function generateEditOrCameraPreview(
  body: ArtifactPreviewGenerateRequest
): Promise<PreviewGenerationResult> {
  if (body.mode !== 'edit' && body.mode !== 'camera') {
    throw new Error(
      `generateEditOrCameraPreview does not support ${body.mode}.`
    );
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
      notifications,
      undefined,
      await readLlmInvocationSettings()
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

    const producedArtifact = produceResult.artifacts.find(
      (artifact) => artifact.artifactId === body.artifactId
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

  return {
    previewData,
    mimeType: producedMimeType,
    estimatedCost,
  };
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
      producerId: `Producer:${producerSpec.producerId}`,
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
    baselineHash: 'preview',
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
