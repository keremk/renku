import path from 'node:path';
import {
  buildArtifactOwnershipIndex,
  buildProducerCatalog,
  buildProviderMetadata,
  copyLatestSucceededArtifactBlobsToMemory,
  convertArtifactOverridesToDrafts,
  copyEventsToMemory,
  copyRunArchivesToMemory,
  createEventLog,
  createLogger,
  createBuildStateService,
  createMovieMetadataService,
  createNotificationBus,
  createPlanningService,
  createRuntimeError,
  createStorageContext,
  createProducerGraph,
  expandBlueprintResolutionContext,
  executePlanWithConcurrency,
  findLatestSucceededArtifactEvent,
  findSurgicalTargetLayer,
  formatBlobFileName,
  formatProducerScopedInputIdForCanonicalProducerId,
  getProducerOptionsForCanonicalProducerId,
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
  resolveArtifactOwnershipFromEvent,
  resolveMappingsForModel,
  resolveMovieInputsPath,
  resolveStorageBasePathForBlueprint,
  sliceExecutionPlanThroughLayer,
  readLlmInvocationSettings,
  setProducerOptionsForCanonicalProducerId,
  type BuildState,
  type PendingArtifactDraft,
  type ProducerOptionsMap,
  RuntimeErrorCode,
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
  buildStateService: ReturnType<typeof createBuildStateService>;
  eventLog: ReturnType<typeof createEventLog>;
  producerOptions: ProducerOptionsMap;
  modelCatalog: Awaited<ReturnType<typeof loadModelCatalog>>;
  catalogModelsDir: string;
  plan: import('@gorenku/core').ExecutionPlan;
  buildState: BuildState;
  executionState: import('@gorenku/core').ExecutionState;
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
        buildState: rerunContext.buildState,
        executionState: rerunContext.executionState,
        storage: rerunContext.memoryStorageContext,
        eventLog: rerunContext.eventLog,
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
      throw createRuntimeError(
        RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
        `Re-run preview execution failed.${
          failureDetails.length > 0
            ? ` Failed jobs: ${failureDetails}`
            : ' Failed jobs were reported without diagnostics.'
        }`,
        {
          context: `movieId=${body.movieId}, artifactId=${body.artifactId}`,
          suggestion:
            'Inspect the failed upstream preview jobs and fix the underlying producer or input issue before retrying Re-run preview.',
        }
      );
    }

    const targetArtifact = findLatestSucceededArtifactEvent(
      run.jobs,
      body.artifactId
    );
    if (!targetArtifact?.output.blob) {
      throw createRuntimeError(
        RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
        `Re-run preview did not produce succeeded output for artifact ${body.artifactId}.`,
        {
          context: `movieId=${body.movieId}, artifactId=${body.artifactId}`,
          suggestion:
            'Ensure the targeted artifact is produced by the preview plan and that the upstream jobs complete successfully.',
        }
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
    throw createRuntimeError(
      RuntimeErrorCode.VIEWER_CONFIG_MISSING,
      'Renku catalog root is not configured. Run "renku init" first.',
      {
        suggestion:
          'Initialize the workspace so the viewer can resolve catalog assets before requesting Re-run preview.',
      }
    );
  }

  const catalogModelsDir = getCatalogModelsDir(cliConfig);
  if (!catalogModelsDir) {
    throw createRuntimeError(
      RuntimeErrorCode.VIEWER_CONFIG_MISSING,
      'Renku catalog models directory is not configured. Run "renku init" first.',
      {
        suggestion:
          'Initialize the workspace so the viewer can resolve model catalog metadata before requesting Re-run preview.',
      }
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
  await copyRunArchivesToMemory(
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
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      `Build ${body.movieId} metadata is missing blueprintPath. Cannot run Re-run preview.`,
      {
        context: `movieId=${body.movieId}`,
        suggestion:
          'Persist build metadata with blueprintPath before using Re-run preview for this build.',
      }
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
  const expanded = expandBlueprintResolutionContext(
    resolutionContext,
    inputValues
  );
  const ownershipByArtifactId = buildArtifactOwnershipIndex(
    createProducerGraph(expanded.canonical, providerCatalog, providerMetadata)
  );
  const pendingArtifacts = convertArtifactOverridesToDrafts({
    overrides: persistedOverrides,
    ownershipByArtifactId,
  });

  const promptOverrideDraft = await buildRerunPromptOverrideDraft({
    request: body,
    blueprintFolder: body.blueprintFolder,
    movieId: body.movieId,
    storage: memoryStorageContext,
  });
  if (promptOverrideDraft) {
    pendingArtifacts.push(promptOverrideDraft);
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
    pendingArtifacts.push(...inputOverrideDrafts);
  }

  const planningService = createPlanningService();
  const buildStateService = createBuildStateService(memoryStorageContext);
  const eventLog = createEventLog(memoryStorageContext);

  const planResult = await planningService.generatePlan({
    movieId: body.movieId,
    blueprintTree,
    inputValues,
    providerCatalog,
    providerOptions: providerMetadata,
    resolutionContext,
    storage: memoryStorageContext,
    conditionFallbackStorage: localStorageContext,
    buildStateService,
    eventLog,
    pendingArtifacts:
      pendingArtifacts.length > 0 ? pendingArtifacts : undefined,
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
    buildStateService,
    eventLog,
    producerOptions: providerOptions,
    modelCatalog,
    catalogModelsDir,
    plan: previewPlan,
    buildState: planResult.buildState,
    executionState: planResult.executionState,
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
}): Promise<{ producerId: string; sourceJobId: string } | null> {
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
  const sourceJobId = latestTargetEvent?.producerJobId;
  if (!sourceJobId) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
      `Cannot apply rerun model override because artifact ${artifactId} has no source producer event.`,
      {
        context: `artifactId=${artifactId}`,
        suggestion:
          'Persist canonical artifact ownership before using Re-run model overrides.',
      }
    );
  }
  const producerId = latestTargetEvent?.producerId;
  if (!producerId) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
      `Cannot apply rerun model override because artifact ${artifactId} has no canonical producer ownership.`,
      {
        context: `artifactId=${artifactId}`,
        suggestion:
          'Persist canonical producerId ownership on the source artifact before using Re-run model overrides.',
      }
    );
  }

  if (!request.model) {
    return { producerId, sourceJobId };
  }
  const currentEntries = getProducerOptionsForCanonicalProducerId(
    providerOptions,
    producerId
  );
  if (!currentEntries || currentEntries.length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.NO_PRODUCER_OPTIONS,
      `Provider options are missing for producer ${producerId}.`,
      {
        context: `producerId=${producerId}`,
        suggestion:
          'Load producer options from the current inputs.yaml before applying a Re-run model override.',
      }
    );
  }

  const sdkMapping = resolveMappingsForModel(blueprintTree, {
    provider: request.model.provider,
    model: request.model.model,
    producerId,
  });
  if (!sdkMapping || Object.keys(sdkMapping).length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_DESCRIPTOR_MISSING_FOR_MODEL,
      `Model ${request.model.provider}/${request.model.model} is not mapped for producer ${producerId}.`,
      {
        context: `producerId=${producerId}, provider=${request.model.provider}, model=${request.model.model}`,
        suggestion:
          'Add an explicit SDK mapping for the selected producer/model pair before using it in Re-run preview.',
      }
    );
  }

  const currentPrimary = currentEntries[0]!;
  const updatedPrimary = {
    ...currentPrimary,
    provider: request.model.provider,
    model: request.model.model,
    sdkMapping,
  };
  setProducerOptionsForCanonicalProducerId(providerOptions, producerId, [
    updatedPrimary,
    ...currentEntries.slice(1),
  ]);

  const providerInputId = formatProducerScopedInputIdForCanonicalProducerId(
    producerId,
    'provider'
  );
  const modelInputId = formatProducerScopedInputIdForCanonicalProducerId(
    producerId,
    'model'
  );
  resolvedInputs[providerInputId] = request.model.provider;
  resolvedInputs[modelInputId] = request.model.model;

  return { producerId, sourceJobId };
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
}): Promise<PendingArtifactDraft[]> {
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
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
      'Cannot apply rerun input overrides because source producer job id is missing.',
      {
        suggestion:
          'Resolve the target artifact to a concrete producer job before applying Re-run input overrides.',
      }
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
    { producerJobId: string; producerId: string; inputsHash: string }
  >();

  for (const target of resolvedTargets) {
    if (isCanonicalInputId(target.canonicalId)) {
      inputValues[target.canonicalId] = target.value;
      continue;
    }

    if (isCanonicalArtifactId(target.canonicalId)) {
      if (artifactEventMeta.has(target.canonicalId)) {
        throw createRuntimeError(
          RuntimeErrorCode.INVALID_INPUT_BINDING,
          `Input overrides map multiple fields to source artifact ${target.canonicalId}.`,
          {
            context: `artifactId=${target.canonicalId}`,
            suggestion:
              'Each Re-run input override must bind to one unique source artifact.',
          }
        );
      }

      const latestSourceEvent = await readLatestArtifactEvent(
        blueprintFolder,
        movieId,
        target.canonicalId
      );
      if (!latestSourceEvent?.output.blob?.mimeType) {
        throw createRuntimeError(
          RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
          `Cannot apply input override "${target.inputName}" because source artifact ${target.canonicalId} has no latest blob metadata.`,
          {
            context: `inputName=${target.inputName}, artifactId=${target.canonicalId}`,
            suggestion:
              'Only artifacts with persisted blob metadata can be used as Re-run input override sources.',
          }
        );
      }
      const ownership = resolveArtifactOwnershipFromEvent({
        artifactId: target.canonicalId,
        event: latestSourceEvent,
        context: `rerun input override ${target.canonicalId}`,
      });

      artifactEventMeta.set(target.canonicalId, {
        producerJobId: ownership.producerJobId,
        producerId: ownership.producerId,
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

    throw createRuntimeError(
      RuntimeErrorCode.INVALID_INPUT_BINDING,
      `Override binding for "${target.inputName}" resolved to unsupported id "${target.canonicalId}".`,
      {
        context: `inputName=${target.inputName}, canonicalId=${target.canonicalId}`,
        suggestion:
          'Re-run input overrides must resolve to canonical Input:... or Artifact:... IDs.',
      }
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
  const drafts = artifactOverrides.map((override, index) => {
    const meta = artifactEventMeta.get(override.artifactId);
    if (!meta) {
      throw createRuntimeError(
        RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
        `Missing source event metadata for overridden artifact ${override.artifactId}.`,
        {
          context: `artifactId=${override.artifactId}`,
          suggestion:
            'Resolve source artifact ownership and inputsHash before persisting Re-run artifact overrides.',
        }
      );
    }
    const persistedOverride = persisted[index];
    if (!persistedOverride) {
      throw createRuntimeError(
        RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
        `Persisted override is missing for artifact ${override.artifactId}.`,
        {
          context: `artifactId=${override.artifactId}`,
          suggestion:
            'Persist override blobs for every Re-run artifact override before converting them into draft events.',
        }
      );
    }

    return convertArtifactOverridesToDrafts({
      overrides: [persistedOverride],
      ownershipByArtifactId: new Map([
        [
          override.artifactId,
          {
            producerJobId: meta.producerJobId,
            producerId: meta.producerId,
          },
        ],
      ]),
    })[0];
  });

  return drafts.map((draft) => {
    const meta = artifactEventMeta.get(draft.artifactId);
    if (!meta) {
      throw createRuntimeError(
        RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
        `Missing source event metadata for overridden artifact ${draft.artifactId}.`,
        {
          context: `artifactId=${draft.artifactId}`,
          suggestion:
            'Carry forward source artifact ownership and inputsHash when finalizing Re-run override drafts.',
        }
      );
    }

    return {
      ...draft,
      producerJobId: meta.producerJobId,
      producerId: meta.producerId,
      lastRevisionBy: 'user',
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

async function buildRerunPromptOverrideDraft(args: {
  request: ArtifactPreviewGenerateRequest | ArtifactPreviewEstimateRequest;
  blueprintFolder: string;
  movieId: string;
  storage: ReturnType<typeof createStorageContext>;
}): Promise<PendingArtifactDraft | null> {
  const { request, blueprintFolder, movieId, storage } = args;
  const trimmedPrompt = request.prompt.trim();
  if (request.mode !== 'rerun' || trimmedPrompt.length === 0) {
    return null;
  }

  if (!request.promptArtifactId) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      'Re-run prompt override requires promptArtifactId.',
      {
        suggestion:
          'Provide the canonical promptArtifactId when submitting a Re-run prompt override.',
      }
    );
  }

  const latestPromptEvent = await readLatestArtifactEvent(
    blueprintFolder,
    movieId,
    request.promptArtifactId
  );
  if (!latestPromptEvent?.output.blob?.mimeType) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
      `Prompt artifact ${request.promptArtifactId} has no latest blob metadata for Re-run override.`,
      {
        context: `artifactId=${request.promptArtifactId}`,
        suggestion:
          'Only prompt artifacts with persisted blob metadata can be overridden in Re-run preview.',
      }
    );
  }
  const ownership = resolveArtifactOwnershipFromEvent({
    artifactId: request.promptArtifactId,
    event: latestPromptEvent,
    context: `rerun prompt override ${request.promptArtifactId}`,
  });

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

  const [draft] = convertArtifactOverridesToDrafts({
    overrides: blob,
    ownershipByArtifactId: new Map([
      [
        request.promptArtifactId,
        {
          producerJobId: ownership.producerJobId,
          producerId: ownership.producerId,
        },
      ],
    ]),
  });
  if (!draft) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
      'Failed to create prompt override draft for Re-run preview.',
      {
        context: `artifactId=${request.promptArtifactId}`,
        suggestion:
          'Persist the prompt override blob and resolve ownership before generating the Re-run preview draft.',
      }
    );
  }

  return {
    ...draft,
    producerJobId: ownership.producerJobId,
    producerId: ownership.producerId,
    lastRevisionBy: 'user',
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
