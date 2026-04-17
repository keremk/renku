/**
 * Handler for POST /viewer-api/generate/plan
 * Creates an execution plan with cost estimation (does not execute).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import {
  createStorageContext,
  initializeMovieStorage,
  createBuildStateService,
  createEventLog,
  createPlanningService,
  commitExecutionDraft,
  createMovieMetadataService,
  validatePreparedBlueprintTree,
  loadYamlBlueprintTree,
  loadInputs,
  buildProducerCatalog,
  isRenkuError,
  createValidationError,
  ValidationErrorCode,
  isCanonicalProducerId,
  copyRunArchivesToMemory,
  copyPlansToMemory,
  copyEventsToMemory,
  copyBlobsFromMemoryToLocal,
  buildProviderMetadata,
  convertArtifactOverridesToDrafts,
  persistArtifactOverrideBlobs,
  isDraftRevisionId,
  deriveSurgicalInfoArray,
  createRuntimeError,
  resolveCurrentBuildContext,
  type BuildState,
  type ArtifactEvent,
  type ExecutionPlan,
  type ExecutionState,
  type ProducerOptionsMap,
  RuntimeErrorCode,
} from '@gorenku/core';
import {
  loadPricingCatalog,
  estimatePlanCosts,
  loadModelCatalog,
  loadModelInputSchema,
  type PlanCostSummary,
} from '@gorenku/providers';

import type {
  PlanRequest,
  PlanResponse,
  ProducerSchedulingCompatibility,
  ProducerSchedulingRequest,
  ProducerSchedulingResponse,
  LayerInfo,
  SurgicalInfo,
  CachedPlan,
  SerializablePlanCostSummary,
} from './types.js';
import type { ProducerCostData } from '@gorenku/providers';
import {
  requireCliConfig,
  getCatalogModelsDir,
  type CliConfig,
} from './config.js';
import {
  resolveBlueprintPaths,
  generateMovieId,
  normalizeMovieId,
  resolveBuildInputsPath,
} from './paths.js';
import { getJobManager } from './job-manager.js';
import { parseJsonBody, sendJson, sendError } from './http-utils.js';
import { recoverFailedArtifactsBeforePlanning } from './recovery-prepass.js';

interface ResolvedPlanRequestContext {
  cliConfig: CliConfig;
  paths: Awaited<ReturnType<typeof resolveBlueprintPaths>>;
  basePath: string;
  movieId: string;
  isNew: boolean;
  inputsPath: string;
}

export async function resolveExistingBuildInputsPath(
  blueprintFolder: string,
  movieId: string
): Promise<string> {
  const buildInputsPath = await resolveBuildInputsPath(blueprintFolder, movieId);
  if (buildInputsPath) {
    return buildInputsPath;
  }

  const storage = createStorageContext({
    kind: 'local',
    rootDir: blueprintFolder,
    basePath: 'builds',
  });
  const { snapshotSourceRun } = await resolveCurrentBuildContext({
    storage,
    movieId,
  });

  if (!snapshotSourceRun) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      `Build "${movieId}" has no editable inputs.yaml and no saved input snapshot.`,
      {
        suggestion:
          `Expected either "${blueprintFolder}/builds/${movieId}/inputs.yaml" ` +
          `or a persisted run snapshot for the current build.`,
      }
    );
  }

  const snapshotInputsPath = resolve(
    blueprintFolder,
    'builds',
    movieId,
    snapshotSourceRun.inputSnapshotPath
  );

  if (!existsSync(snapshotInputsPath)) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      `Build "${movieId}" is missing its saved input snapshot for revision "${snapshotSourceRun.revision}".`,
      {
        suggestion:
          `Expected snapshot at "${snapshotInputsPath}". Re-enable editing for the build ` +
          `or regenerate the plan so a fresh snapshot is recorded.`,
      }
    );
  }

  return snapshotInputsPath;
}

async function resolvePlanRequestContext(args: {
  blueprint: string;
  inputs?: string;
  movieId?: string;
}): Promise<ResolvedPlanRequestContext> {
  const cliConfig = await requireCliConfig();
  const paths = await resolveBlueprintPaths(
    args.blueprint,
    args.inputs,
    cliConfig
  );
  const basePath = relative(cliConfig.storage.root, paths.buildsFolder);
  const isNew = !args.movieId;
  const movieId = args.movieId
    ? normalizeMovieId(args.movieId)
    : generateMovieId();

  let inputsPath = paths.inputsPath;
  if (args.movieId && !args.inputs) {
    inputsPath = await resolveExistingBuildInputsPath(
      paths.blueprintFolder,
      movieId
    );
  }

  return {
    cliConfig,
    paths,
    basePath,
    movieId,
    isNew,
    inputsPath,
  };
}

/**
 * Handles POST /viewer-api/generate/producer-scheduling
 */
export async function handleProducerSchedulingRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  try {
    const body = await parseJsonBody<ProducerSchedulingRequest>(req);
    if (!body.blueprint) {
      sendError(res, 400, 'Missing required field: blueprint');
      return true;
    }
    if (!body.producerId) {
      sendError(res, 400, 'Missing required field: producerId');
      return true;
    }
    if (!isCanonicalProducerId(body.producerId)) {
      sendError(
        res,
        400,
        `Invalid producerId "${body.producerId}". Expected canonical Producer:... ID.`
      );
      return true;
    }
    if (!Number.isInteger(body.producerLayer) || body.producerLayer < 0) {
      sendError(
        res,
        400,
        `Invalid producerLayer "${String(body.producerLayer)}". Expected a non-negative integer layer index.`
      );
      return true;
    }

    const context = await resolvePlanRequestContext({
      blueprint: body.blueprint,
      inputs: body.inputs,
      movieId: body.movieId,
    });

    const planningControls = {
      ...(body.planningControls ?? {}),
      scope: {
        ...(body.planningControls?.scope ?? {}),
        upToLayer: body.producerLayer,
      },
    };

    const planResult = await generatePlan({
      cliConfig: context.cliConfig,
      movieId: context.movieId,
      isNew: context.isNew,
      blueprintPath: context.paths.blueprintPath,
      inputsPath: context.inputsPath,
      buildsFolder: context.paths.buildsFolder,
      basePath: context.basePath,
      planningControls,
    });

    const producerScheduling = planResult.producerScheduling?.find(
      (item) => item.producerId === body.producerId
    );

    if (!producerScheduling) {
      throw createValidationError(
        ValidationErrorCode.BLUEPRINT_VALIDATION_FAILED,
        `Producer scheduling not found for ${body.producerId} at layer ${body.producerLayer}.`
      );
    }

    let compatibility: ProducerSchedulingCompatibility = { ok: true };
    try {
      await generatePlan({
        cliConfig: context.cliConfig,
        movieId: context.movieId,
        isNew: context.isNew,
        blueprintPath: context.paths.blueprintPath,
        inputsPath: context.inputsPath,
        buildsFolder: context.paths.buildsFolder,
        basePath: context.basePath,
        planningControls: body.planningControls,
      });
    } catch (error) {
      if (!isRenkuError(error)) {
        throw error;
      }
      compatibility = {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
        },
      };
    }

    const response: ProducerSchedulingResponse = {
      producerId: body.producerId,
      probeUpToLayer: body.producerLayer,
      producerScheduling,
      compatibility,
    };

    sendJson(res, response);
    return true;
  } catch (error) {
    if (isRenkuError(error)) {
      sendError(res, 400, error.message, error.code);
    } else if (error instanceof Error) {
      sendError(res, 500, error.message);
    } else {
      sendError(res, 500, 'Unknown error occurred');
    }
    return true;
  }
}

/**
 * Handles POST /viewer-api/generate/plan
 */
export async function handlePlanRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  try {
    const body = await parseJsonBody<PlanRequest>(req);
    if (!body.blueprint) {
      sendError(res, 400, 'Missing required field: blueprint');
      return true;
    }

    const context = await resolvePlanRequestContext({
      blueprint: body.blueprint,
      inputs: body.inputs,
      movieId: body.movieId,
    });

    const planResult = await generatePlan({
      cliConfig: context.cliConfig,
      movieId: context.movieId,
      isNew: context.isNew,
      blueprintPath: context.paths.blueprintPath,
      inputsPath: context.inputsPath,
      buildsFolder: context.paths.buildsFolder,
      basePath: context.basePath,
      planningControls: body.planningControls,
    });

    const jobManager = getJobManager();
    const cachedPlan = jobManager.cachePlan({
      movieId: context.movieId,
      plan: planResult.plan,
      buildState: planResult.buildState,
      executionState: planResult.executionState,
      baselineHash: planResult.baselineHash,
      resolvedInputs: planResult.resolvedInputs,
      providerOptions: planResult.providerOptions as Map<string, unknown>,
      blueprintPath: planResult.blueprintPath,
      basePath: context.basePath,
      costSummary: planResult.costSummary,
      catalogModelsDir: planResult.catalogModelsDir,
      surgicalInfo: planResult.surgicalInfo,
      producerScheduling: planResult.producerScheduling,
      warnings: planResult.warnings,
      planningStorage: planResult.planningStorage,
      persist: planResult.persist,
    });

    // Build response
    const producerPidValues = deriveCliProducerIdFlags(
      body.planningControls?.scope?.producerDirectives
    );
    const response = buildPlanResponse(
      cachedPlan,
      planResult.plan,
      {
        blueprintPath: planResult.blueprintPath,
        inputsPath: context.inputsPath,
        regenerateIds: body.planningControls?.surgical?.regenerateIds,
        pinIds: body.planningControls?.surgical?.pinIds,
        upToLayer: body.planningControls?.scope?.upToLayer,
        producerPidValues,
      }
    );
    sendJson(res, response);
    return true;
  } catch (error) {
    if (isRenkuError(error)) {
      sendError(res, 400, error.message, error.code);
    } else if (error instanceof Error) {
      sendError(res, 500, error.message);
    } else {
      sendError(res, 500, 'Unknown error occurred');
    }
    return true;
  }
}

/**
 * Options for generatePlan.
 */
interface GeneratePlanOptions {
  cliConfig: CliConfig;
  movieId: string;
  isNew: boolean;
  blueprintPath: string;
  inputsPath: string;
  /** Full path to builds folder (e.g., /Users/.../animated-edu-characters/builds) */
  buildsFolder: string;
  /** Relative basePath from storage root (e.g., "animated-edu-characters/builds") */
  basePath: string;
  planningControls?: PlanRequest['planningControls'];
}

/**
 * Result from generatePlan.
 */
interface GeneratePlanResult {
  plan: ExecutionPlan;
  buildState: BuildState;
  executionState: ExecutionState;
  baselineHash: string | null;
  artifactEvents: ArtifactEvent[];
  resolvedInputs: Record<string, unknown>;
  providerOptions: ProducerOptionsMap;
  blueprintPath: string;
  costSummary: PlanCostSummary;
  catalogModelsDir?: string;
  surgicalInfo?: SurgicalInfo[];
  producerScheduling?: import('@gorenku/core').ProducerSchedulingSummary[];
  warnings?: import('@gorenku/core').PlanningWarning[];
  planningStorage: ReturnType<typeof createStorageContext>;
  persist: (args: {
    runConfig: import('@gorenku/core').RunConfig;
  }) => Promise<{
    planPath: string;
    targetRevision: string;
    plan: ExecutionPlan;
  }>;
}

/**
 * Generates an execution plan.
 * Based on cli/src/lib/planner.ts but adapted for viewer use.
 */
async function generatePlan(
  options: GeneratePlanOptions
): Promise<GeneratePlanResult> {
  const {
    cliConfig,
    movieId,
    isNew,
    blueprintPath,
    inputsPath,
    buildsFolder,
    basePath,
    planningControls,
  } = options;
  const storageRoot = cliConfig.storage.root;
  const movieDir = resolve(buildsFolder, movieId);

  // Use IN-MEMORY storage for planning (no disk writes yet)
  const memoryStorageContext = createStorageContext({
    kind: 'memory',
    basePath,
  });
  await initializeMovieStorage(memoryStorageContext, movieId);

  // For edits (isNew: false), load existing run archives and events from disk
  if (!isNew) {
    const localStorageContext = createStorageContext({
      kind: 'local',
      rootDir: storageRoot,
      basePath,
    });
    await recoverFailedArtifactsBeforePlanning({
      storage: localStorageContext,
      movieId,
    });
    await copyRunArchivesToMemory(
      localStorageContext,
      memoryStorageContext,
      movieId
    );
    await copyPlansToMemory(
      localStorageContext,
      memoryStorageContext,
      movieId
    );
    await copyEventsToMemory(
      localStorageContext,
      memoryStorageContext,
      movieId
    );
  }

  const buildStateService = createBuildStateService(memoryStorageContext);
  const eventLog = createEventLog(memoryStorageContext);

  // Load blueprint
  const catalogRoot = cliConfig.catalog?.root ?? undefined;
  const { root: blueprintRoot } = await loadYamlBlueprintTree(blueprintPath, {
    catalogRoot,
  });

  const metadataValidation = await validatePreparedBlueprintTree({
    root: blueprintRoot,
    schemaSource: { kind: 'producer-metadata' },
    options: { errorsOnly: true },
  });
  throwIfBlueprintValidationFailed(metadataValidation.validation);

  // Load inputs from YAML + TOML prompts (unified)
  const buildsDir = resolve(buildsFolder, movieId);
  const {
    values: inputValues,
    providerOptions,
    artifactOverrides,
  } = await loadInputs({
    yamlPath: inputsPath,
    blueprintTree: blueprintRoot,
    buildsDir,
  });

  // Build producer catalog
  const catalog = buildProducerCatalog(providerOptions);

  // Load model catalog for schema loading
  const catalogModelsDir = getCatalogModelsDir(cliConfig);
  const modelCatalog = catalogModelsDir
    ? await loadModelCatalog(catalogModelsDir)
    : undefined;

  // Persist artifact override blobs to storage
  const persistedOverrides = await persistArtifactOverrideBlobs(
    artifactOverrides,
    memoryStorageContext,
    movieId
  );

  // Convert artifact overrides to PendingArtifactDraft objects
  const overrideDrafts = convertArtifactOverridesToDrafts(persistedOverrides);
  const allPendingArtifacts = overrideDrafts;

  // Build provider metadata with schemas
  const providerMetadata = await buildProviderMetadata(
    providerOptions,
    { catalogModelsDir, modelCatalog },
    loadModelInputSchema as Parameters<typeof buildProviderMetadata>[2]
  );
  const preparedValidation = await validatePreparedBlueprintTree({
    root: blueprintRoot,
    schemaSource: {
      kind: 'provider-options',
      providerOptions: providerMetadata,
    },
    options: { errorsOnly: true },
  });
  throwIfBlueprintValidationFailed(preparedValidation.validation);
  if (!preparedValidation.context) {
    throw new Error(
      'Prepared blueprint validation succeeded without a resolution context.'
    );
  }

  // Generate plan
  const planResult = await createPlanningService().generatePlan({
    movieId,
    blueprintTree: blueprintRoot,
    inputValues,
    providerCatalog: catalog,
    providerOptions: providerMetadata,
    resolutionContext: preparedValidation.context,
    storage: memoryStorageContext,
    buildStateService,
    eventLog,
    pendingArtifacts:
      allPendingArtifacts.length > 0 ? allPendingArtifacts : undefined,
    userControls: planningControls,
  });

  // Load pricing catalog and estimate costs
  const pricingCatalog = catalogModelsDir
    ? await loadPricingCatalog(catalogModelsDir)
    : { providers: new Map() };
  const costSummary = estimatePlanCosts(
    planResult.plan,
    pricingCatalog,
    planResult.resolvedInputs
  );

  // Derive surgical info for explicitly targeted artifact regeneration.
  const artifactRegenerateIds =
    planningControls?.surgical?.regenerateIds?.filter((id) =>
      id.startsWith('Artifact:')
    ) ?? [];
  const surgicalInfo = artifactRegenerateIds.length
    ? deriveSurgicalInfoArray(artifactRegenerateIds, planResult.buildState)
    : undefined;

  return {
    plan: planResult.plan,
    buildState: planResult.buildState,
    executionState: planResult.executionState,
    baselineHash: planResult.baselineHash,
    artifactEvents: planResult.artifactEvents,
    resolvedInputs: planResult.resolvedInputs,
    providerOptions,
    blueprintPath,
    costSummary,
    catalogModelsDir: catalogModelsDir ?? undefined,
    planningStorage: memoryStorageContext,
    surgicalInfo,
    producerScheduling: planResult.producerScheduling,
    warnings: planResult.warnings,
    persist: async ({ runConfig }) => {
      // Create LOCAL storage and write everything
      const localStorageContext = createStorageContext({
        kind: 'local',
        rootDir: storageRoot,
        basePath,
      });

      await mkdir(movieDir, { recursive: true });
      await initializeMovieStorage(localStorageContext, movieId);

      // Write movie metadata using the core service (blueprintPath for CLI compatibility)
      const metadataService = createMovieMetadataService(localStorageContext);
      await metadataService.merge(movieId, { blueprintPath });

      // Copy blobs from memory storage to local storage
      await copyBlobsFromMemoryToLocal(
        memoryStorageContext,
        localStorageContext,
        movieId
      );

      const inputSnapshotBytes = await readFile(inputsPath);
      const committed = await commitExecutionDraft({
        movieId,
        storage: localStorageContext,
        draftPlan: planResult.plan,
        draftInputEvents: planResult.inputEvents,
        draftArtifactEvents: planResult.artifactEvents,
        inputSnapshotContents: inputSnapshotBytes,
        runConfig,
      });
      return {
        planPath: committed.planPath,
        targetRevision: committed.revision,
        plan: committed.plan,
      };
    },
  };
}

interface CliCommandOptions {
  blueprintPath: string;
  inputsPath?: string;
  regenerateIds?: string[];
  pinIds?: string[];
  upToLayer?: number;
  producerPidValues?: string[];
}

/**
 * Build the equivalent CLI command for the given plan options.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildCliCommand(movieId: string, options: CliCommandOptions): string {
  const parts: string[] = ['renku generate'];

  // Movie ID
  parts.push(`--movie-id=${shellQuote(movieId)}`);

  // Blueprint path (required for CLI to work properly)
  parts.push(`--blueprint=${shellQuote(options.blueprintPath)}`);

  // Inputs path (if provided)
  if (options.inputsPath) {
    parts.push(`--inputs=${shellQuote(options.inputsPath)}`);
  }

  // Regeneration target IDs (artifact or producer)
  if (options.regenerateIds && options.regenerateIds.length > 0) {
    for (const regenerateId of options.regenerateIds) {
      parts.push(`--regen=${shellQuote(regenerateId)}`);
    }
  }

  // Pin IDs
  if (options.pinIds && options.pinIds.length > 0) {
    for (const pinId of options.pinIds) {
      parts.push(`--pin=${shellQuote(pinId)}`);
    }
  }

  // Producer IDs (repeatable --pid)
  if (options.producerPidValues && options.producerPidValues.length > 0) {
    for (const producerPidValue of options.producerPidValues) {
      parts.push(`--pid=${shellQuote(producerPidValue)}`);
    }
  }

  // Up to layer
  if (options.upToLayer !== undefined) {
    parts.push(`--up=${options.upToLayer}`);
  }

  // Add --explain flag to help debug
  parts.push('--explain');

  return parts.join(' ');
}

function deriveCliProducerIdFlags(
  producerDirectives: Array<{ producerId: string; count: number }> | undefined
): string[] | undefined {
  if (!producerDirectives || producerDirectives.length === 0) {
    return undefined;
  }

  const pidValues = producerDirectives.map(
    (directive) => `${directive.producerId}:${directive.count}`
  );

  return pidValues.length > 0 ? pidValues : undefined;
}

function throwIfBlueprintValidationFailed(
  validation: import('@gorenku/core').ValidationResult
): void {
  if (validation.valid) {
    return;
  }

  const errorMessages = validation.errors
    .map((error) => `  ${error.code}: ${error.message}`)
    .join('\n');
  throw createValidationError(
    ValidationErrorCode.BLUEPRINT_VALIDATION_FAILED,
    `Blueprint validation failed:\n${errorMessages}`
  );
}

/**
 * Builds the PlanResponse from cached plan and execution plan.
 * @internal Exported for testing
 */
export function buildPlanResponse(
  cachedPlan: CachedPlan,
  plan: ExecutionPlan,
  cliOptions?: CliCommandOptions
): PlanResponse {
  // Build job cost lookup map for quick access
  const jobCostMap = new Map<
    string,
    { cost: number; min: number; max: number; isPlaceholder: boolean }
  >();
  for (const jobCost of cachedPlan.costSummary.jobs) {
    const cost = jobCost.estimate.cost;
    const min = jobCost.estimate.range?.min ?? cost;
    const max = jobCost.estimate.range?.max ?? cost;
    jobCostMap.set(jobCost.jobId, {
      cost,
      min,
      max,
      isPlaceholder: jobCost.estimate.isPlaceholder,
    });
  }

  // Build layerBreakdown with per-layer costs (only include layers with jobs)
  const layerBreakdown: LayerInfo[] = plan.layers
    .map((layerJobs, index) => {
      let layerCost = 0;
      let layerMinCost = 0;
      let layerMaxCost = 0;
      let hasPlaceholders = false;

      const jobs = layerJobs.map((job) => {
        const costEntry = jobCostMap.get(job.jobId);
        const estimatedCost = costEntry?.cost;

        if (costEntry) {
          layerCost += costEntry.cost;
          layerMinCost += costEntry.min;
          layerMaxCost += costEntry.max;
          if (costEntry.isPlaceholder) {
            hasPlaceholders = true;
          }
        }

        return {
          jobId: job.jobId,
          producer: typeof job.producer === 'string' ? job.producer : 'unknown',
          estimatedCost,
        };
      });

      return {
        index,
        jobCount: layerJobs.length,
        jobs,
        layerCost,
        layerMinCost,
        layerMaxCost,
        hasPlaceholders,
      };
    })
    // Filter out layers with no jobs (skipped layers)
    .filter((layer) => layer.jobCount > 0);

  const totalJobs = plan.layers.reduce(
    (sum, layerJobs) => sum + layerJobs.length,
    0
  );

  // Convert byProducer Map to plain object for JSON serialization
  const byProducerObj: Record<string, ProducerCostData> = {};
  for (const [name, data] of cachedPlan.costSummary.byProducer) {
    byProducerObj[name] = data;
  }

  // Build serializable cost summary
  const costSummary: SerializablePlanCostSummary = {
    jobs: cachedPlan.costSummary.jobs,
    byProducer: byProducerObj,
    totalCost: cachedPlan.costSummary.totalCost,
    hasPlaceholders: cachedPlan.costSummary.hasPlaceholders,
    hasRanges: cachedPlan.costSummary.hasRanges,
    minTotalCost: cachedPlan.costSummary.minTotalCost,
    maxTotalCost: cachedPlan.costSummary.maxTotalCost,
    missingProviders: cachedPlan.costSummary.missingProviders,
  };

  // Build CLI command if options provided
  const cliCommand = cliOptions
    ? buildCliCommand(cachedPlan.movieId, cliOptions)
    : undefined;

  return {
    planId: cachedPlan.planId,
    movieId: cachedPlan.movieId,
    revision: isDraftRevisionId(plan.revision) ? null : plan.revision,
    blueprintPath: cachedPlan.blueprintPath,
    // Only count layers that have jobs to execute (layerBreakdown already filtered)
    layers: layerBreakdown.length,
    blueprintLayers: plan.blueprintLayerCount,
    totalJobs,
    costSummary,
    layerBreakdown,
    surgicalInfo: cachedPlan.surgicalInfo,
    producerScheduling: cachedPlan.producerScheduling,
    warnings: cachedPlan.warnings,
    cliCommand,
  };
}
