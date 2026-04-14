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
  createProducerGraph,
  expandBlueprintResolutionContext,
  executePlanWithConcurrency,
  findLatestSucceededArtifactEvent,
  findSurgicalTargetLayer,
  formatBlobFileName,
  formatCanonicalProducerPath,
  formatProducerScopedInputIdForCanonicalProducerId,
  injectAllSystemInputs,
  initializeMovieStorage,
  isCanonicalArtifactId,
  isCanonicalInputId,
  loadYamlBlueprintTree,
  loadInputs,
  prepareBlueprintResolutionContext,
  type BlueprintResolutionContext,
  persistArtifactOverrideBlobs,
  resolveBlobRefsToInputs,
  resolveMappingsForModel,
  resolveMovieInputsPath,
  resolveStorageBasePathForBlueprint,
  sliceExecutionPlanThroughLayer,
  readLlmInvocationSettings,
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
import { resolveInputOverrideTargets } from './input-override-resolver.js';
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
      notifications,
      undefined,
      await readLlmInvocationSettings()
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
      const failedJobs = run.jobs.filter((job) => job.status === 'failed');
      const failureDetails = failedJobs
        .map((job) => {
          const reason =
            job.error?.message ??
            (typeof job.diagnostics?.reason === 'string'
              ? job.diagnostics.reason
              : 'unknown_error');
          return `${job.jobId} (${reason})`;
        })
        .join('; ');
      throw new Error(
        `Re-run preview execution failed.${
          failureDetails.length > 0
            ? ` Failed jobs: ${failureDetails}`
            : ' Failed jobs were reported without diagnostics.'
        }`
      );
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

  const rerunTarget = await applyRerunModelOverride({
    request: body,
    blueprintTree,
    providerOptions,
    resolvedInputs: inputValues,
    blueprintFolder: body.blueprintFolder,
    movieId: body.movieId,
    artifactId: body.artifactId,
  });

  const modelCatalog = await loadModelCatalog(catalogModelsDir);
  const providerMetadata = await buildProviderMetadata(
    providerOptions,
    { catalogModelsDir, modelCatalog },
    loadModelInputSchema as Parameters<typeof buildProviderMetadata>[2]
  );
  const providerCatalog = buildProducerCatalog(providerOptions);
  const resolutionContext = await prepareBlueprintResolutionContext({
    root: blueprintTree,
    schemaSource: {
      kind: 'provider-options',
      providerOptions: providerMetadata,
    },
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

  const inputOverrideDrafts = await applyRerunInputOverrides({
    request: body,
    sourceJobId: rerunTarget?.sourceJobId,
    context: resolutionContext,
    providerCatalog,
    providerMetadata,
    inputValues,
    storage: memoryStorageContext,
    blueprintFolder: body.blueprintFolder,
    movieId: body.movieId,
  });
  if (inputOverrideDrafts.length > 0) {
    pendingArtefacts.push(...inputOverrideDrafts);
  }

  const planningService = createPlanningService();
  const manifestService = createManifestService(memoryStorageContext);
  const eventLog = createEventLog(memoryStorageContext);

  const planResult = await planningService.generatePlan({
    movieId: body.movieId,
    blueprintTree,
    inputValues,
    providerCatalog,
    providerOptions: providerMetadata,
    resolutionContext,
    storage: memoryStorageContext,
    manifestService,
    eventLog,
    pendingArtefacts:
      pendingArtefacts.length > 0 ? pendingArtefacts : undefined,
    userControls: {
      surgical: {
        regenerateIds: [body.artifactId],
      },
    },
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

async function applyRerunModelOverride(args: {
  request: ArtifactPreviewGenerateRequest | ArtifactPreviewEstimateRequest;
  blueprintTree: import('@gorenku/core').BlueprintTreeNode;
  providerOptions: ProducerOptionsMap;
  resolvedInputs: Record<string, unknown>;
  blueprintFolder: string;
  movieId: string;
  artifactId: string;
}): Promise<{ producerAlias: string; sourceJobId: string } | null> {
  const {
    request,
    blueprintTree,
    providerOptions,
    resolvedInputs,
    blueprintFolder,
    movieId,
    artifactId,
  } = args;

  if (request.mode !== 'rerun') {
    return null;
  }

  const latestTargetEvent = await readLatestArtifactEvent(
    blueprintFolder,
    movieId,
    artifactId
  );
  const sourceJobId = latestTargetEvent?.producedBy;
  if (!sourceJobId) {
    throw new Error(
      `Cannot apply rerun model override because artifact ${artifactId} has no source producer event.`
    );
  }

  const producerAlias = parseProducerAliasFromJobId(sourceJobId);

  if (!request.model) {
    return { producerAlias, sourceJobId };
  }
  const currentEntries = providerOptions.get(producerAlias);
  if (!currentEntries || currentEntries.length === 0) {
    throw new Error(
      `Provider options are missing for producer ${producerAlias}.`
    );
  }

  const sdkMapping = resolveMappingsForModel(blueprintTree, {
    provider: request.model.provider,
    model: request.model.model,
    producerId: formatCanonicalProducerPath(producerAlias),
  });
  if (!sdkMapping || Object.keys(sdkMapping).length === 0) {
    throw new Error(
      `Model ${request.model.provider}/${request.model.model} is not mapped for producer ${producerAlias}.`
    );
  }

  const currentPrimary = currentEntries[0]!;
  const updatedPrimary = {
    ...currentPrimary,
    provider: request.model.provider,
    model: request.model.model,
    sdkMapping,
  };
  providerOptions.set(producerAlias, [
    updatedPrimary,
    ...currentEntries.slice(1),
  ]);

  const canonicalProducerId = formatCanonicalProducerPath(producerAlias);
  const providerInputId = formatProducerScopedInputIdForCanonicalProducerId(
    canonicalProducerId,
    'provider'
  );
  const modelInputId = formatProducerScopedInputIdForCanonicalProducerId(
    canonicalProducerId,
    'model'
  );
  resolvedInputs[providerInputId] = request.model.provider;
  resolvedInputs[modelInputId] = request.model.model;

  return { producerAlias, sourceJobId };
}

async function applyRerunInputOverrides(args: {
  request: ArtifactPreviewGenerateRequest | ArtifactPreviewEstimateRequest;
  sourceJobId: string | undefined;
  context: BlueprintResolutionContext;
  providerCatalog: ReturnType<typeof buildProducerCatalog>;
  providerMetadata: Awaited<ReturnType<typeof buildProviderMetadata>>;
  inputValues: Record<string, unknown>;
  storage: ReturnType<typeof createStorageContext>;
  blueprintFolder: string;
  movieId: string;
}): Promise<PendingArtefactDraft[]> {
  const {
    request,
    sourceJobId,
    context,
    providerCatalog,
    providerMetadata,
    inputValues,
    storage,
    blueprintFolder,
    movieId,
  } = args;

  if (
    request.mode !== 'rerun' ||
    !request.inputOverrides ||
    Object.keys(request.inputOverrides).length === 0
  ) {
    return [];
  }

  if (!sourceJobId) {
    throw new Error(
      'Cannot apply rerun input overrides because source producer job id is missing.'
    );
  }

  const resolvedTargets = resolveRerunInputOverrideTargets({
    sourceJobId,
    context,
    providerCatalog,
    providerMetadata,
    inputValues,
    inputOverrides: request.inputOverrides,
  });

  const artifactOverrides: import('@gorenku/core').ArtifactOverride[] = [];
  const artifactEventMeta = new Map<
    string,
    { producedBy: string; inputsHash: string }
  >();

  for (const target of resolvedTargets) {
    if (isCanonicalInputId(target.canonicalId)) {
      inputValues[target.canonicalId] = target.value;
      continue;
    }

    if (isCanonicalArtifactId(target.canonicalId)) {
      if (artifactEventMeta.has(target.canonicalId)) {
        throw new Error(
          `Input overrides map multiple fields to source artifact ${target.canonicalId}.`
        );
      }

      const latestSourceEvent = await readLatestArtifactEvent(
        blueprintFolder,
        movieId,
        target.canonicalId
      );
      if (!latestSourceEvent?.output.blob?.mimeType) {
        throw new Error(
          `Cannot apply input override "${target.inputName}" because source artifact ${target.canonicalId} has no latest blob metadata.`
        );
      }

      artifactEventMeta.set(target.canonicalId, {
        producedBy: latestSourceEvent.producedBy,
        inputsHash: latestSourceEvent.inputsHash,
      });
      artifactOverrides.push({
        artifactId: target.canonicalId,
        blob: {
          data: Buffer.from(target.value, 'utf8'),
          mimeType: latestSourceEvent.output.blob.mimeType,
        },
      });
      continue;
    }

    throw new Error(
      `Override binding for "${target.inputName}" resolved to unsupported id "${target.canonicalId}".`
    );
  }

  if (artifactOverrides.length === 0) {
    return [];
  }

  const persisted = await persistArtifactOverrideBlobs(
    artifactOverrides,
    storage,
    movieId
  );
  const drafts = convertArtifactOverridesToDrafts(persisted);

  return drafts.map((draft) => {
    const meta = artifactEventMeta.get(draft.artefactId);
    if (!meta) {
      throw new Error(
        `Missing source event metadata for overridden artifact ${draft.artefactId}.`
      );
    }

    return {
      ...draft,
      producedBy: meta.producedBy,
      inputsHash: meta.inputsHash,
    };
  });
}

export function resolveRerunInputOverrideTargets(args: {
  sourceJobId: string;
  context: BlueprintResolutionContext;
  providerCatalog: ReturnType<typeof buildProducerCatalog>;
  providerMetadata: Awaited<ReturnType<typeof buildProviderMetadata>>;
  inputValues: Record<string, unknown>;
  inputOverrides: Record<string, string>;
}) {
  const expanded = expandBlueprintResolutionContext(
    args.context,
    args.inputValues
  );
  const producerGraph = createProducerGraph(
    expanded.canonical,
    args.providerCatalog,
    args.providerMetadata
  );

  return resolveInputOverrideTargets({
    sourceJobId: args.sourceJobId,
    producerGraph,
    inputOverrides: args.inputOverrides,
  });
}

function parseProducerAliasFromJobId(jobId: string): string {
  if (!jobId.startsWith('Producer:')) {
    throw new Error(`Expected producer job id, got ${jobId}.`);
  }

  const jobBody = jobId.slice('Producer:'.length);
  const alias = jobBody.replace(/\[[^\]]+\]/g, '');
  if (alias.length === 0) {
    throw new Error(`Producer alias is empty in job id ${jobId}.`);
  }

  return alias;
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
