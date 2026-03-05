import path from 'node:path';
import {
  buildProducerCatalog,
  buildProviderMetadata,
  copyLatestSucceededArtifactBlobsToMemory,
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
  findLatestSucceededArtifactEvent,
  findSurgicalTargetLayer,
  formatBlobFileName,
  injectAllSystemInputs,
  initializeMovieStorage,
  loadYamlBlueprintTree,
  loadInputs,
  persistArtifactOverrideBlobs,
  resolveBlobRefsToInputs,
  resolveMovieInputsPath,
  resolveStorageBasePathForBlueprint,
  sliceExecutionPlanThroughLayer,
  type Manifest,
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
import {
  getCatalogModelsDir,
  requireCliConfig,
} from '../../generation/config.js';
import { readLatestArtifactEvent } from '../artifact-edit-handler.js';
import type {
  ArtifactPreviewEstimateRequest,
  ArtifactPreviewGenerateRequest,
  GenerationCostEstimate,
  PreviewGenerationResult,
} from './contracts.js';

interface PreparedRerunPreviewContext {
  memoryStorageContext: ReturnType<typeof createStorageContext>;
  manifestService: ReturnType<typeof createManifestService>;
  eventLog: ReturnType<typeof createEventLog>;
  producerOptions: ProducerOptionsMap;
  modelCatalog: Awaited<ReturnType<typeof loadModelCatalog>>;
  catalogModelsDir: string;
  plan: import('@gorenku/core').ExecutionPlan;
  manifest: Manifest;
  resolvedInputs: Record<string, unknown>;
  targetLayerIndex: number;
  estimatedCost: GenerationCostEstimate;
  storageRoot: string;
  storageBasePath: string;
}

export async function estimateRerunPreview(
  body: ArtifactPreviewEstimateRequest
): Promise<GenerationCostEstimate> {
  const context = await prepareRerunSurgicalPreviewContext(body);
  return context.estimatedCost;
}

export async function generateRerunPreview(
  body: ArtifactPreviewGenerateRequest
): Promise<PreviewGenerationResult> {
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

  const storageBasePath = resolveStorageBasePathForBlueprint(
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
  await copyLatestSucceededArtifactBlobsToMemory(
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

  const inputsPath = await resolveMovieInputsPath(
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
    surgicalRegenerationScope: 'lineage-strict',
  });

  const targetLayerIndex = findSurgicalTargetLayer(
    planResult.plan,
    body.artifactId
  );
  const previewPlan = sliceExecutionPlanThroughLayer(
    planResult.plan,
    targetLayerIndex
  );

  const pricingCatalog = await loadPricingCatalog(catalogModelsDir);
  const costSummary = estimatePlanCosts(
    previewPlan,
    pricingCatalog,
    planResult.resolvedInputs
  );

  return {
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
