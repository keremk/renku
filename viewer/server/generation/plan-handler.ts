/**
 * Handler for POST /viewer-api/generate/plan
 * Creates an execution plan with cost estimation (does not execute).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve, relative } from 'node:path';
import { mkdir } from 'node:fs/promises';
import {
  createStorageContext,
  initializeMovieStorage,
  createManifestService,
  createEventLog,
  createPlanningService,
  createMovieMetadataService,
  validateBlueprintTree,
  loadYamlBlueprintTree,
  loadInputs,
  buildProducerCatalog,
  isRenkuError,
  createValidationError,
  ValidationErrorCode,
  copyManifestToMemory,
  copyEventsToMemory,
  copyBlobsFromMemoryToLocal,
  buildProviderMetadata,
  convertArtifactOverridesToDrafts,
  persistArtifactOverrideBlobs,
  deriveSurgicalInfoArray,
  type ExecutionPlan,
  type Manifest,
  type ProducerOptionsMap,
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

/**
 * Handles POST /viewer-api/generate/plan
 */
export async function handlePlanRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  try {
    // Parse request body
    const body = await parseJsonBody<PlanRequest>(req);
    if (!body.blueprint) {
      sendError(res, 400, 'Missing required field: blueprint');
      return true;
    }

    // Load CLI config
    const cliConfig = await requireCliConfig();

    // Resolve blueprint and inputs paths
    const paths = await resolveBlueprintPaths(
      body.blueprint,
      body.inputs,
      cliConfig
    );

    // Compute basePath relative to storage root (e.g., "animated-edu-characters/builds")
    const basePath = relative(cliConfig.storage.root, paths.buildsFolder);

    // Determine movie ID (new or existing)
    const isNew = !body.movieId;
    const movieId = body.movieId
      ? normalizeMovieId(body.movieId)
      : generateMovieId();

    // Check for build-specific inputs.yaml if movieId is provided and no explicit inputs override
    let inputsPath = paths.inputsPath;
    if (body.movieId && !body.inputs) {
      const buildInputsPath = await resolveBuildInputsPath(
        paths.blueprintFolder,
        movieId
      );
      if (buildInputsPath) {
        inputsPath = buildInputsPath;
      }
    }

    // Generate plan
    const planResult = await generatePlan({
      cliConfig,
      movieId,
      isNew,
      blueprintPath: paths.blueprintPath,
      inputsPath,
      buildsFolder: paths.buildsFolder,
      basePath,
      reRunFrom: body.reRunFrom,
      targetArtifactIds: body.artifactIds,
      upToLayer: body.upToLayer,
      pinIds: body.pinnedArtifactIds,
    });

    // Cache the plan
    const jobManager = getJobManager();
    const cachedPlan = jobManager.cachePlan({
      movieId,
      plan: planResult.plan,
      manifest: planResult.manifest,
      manifestHash: planResult.manifestHash,
      resolvedInputs: planResult.resolvedInputs,
      providerOptions: planResult.providerOptions as Map<string, unknown>,
      blueprintPath: planResult.blueprintPath,
      basePath,
      costSummary: planResult.costSummary,
      catalogModelsDir: planResult.catalogModelsDir,
      surgicalInfo: planResult.surgicalInfo,
      persist: planResult.persist,
    });

    // Build response
    const response = buildPlanResponse(cachedPlan, planResult.plan, {
      blueprintPath: planResult.blueprintPath,
      inputsPath,
      artifactIds: body.artifactIds,
      pinIds: body.pinnedArtifactIds,
      reRunFrom: body.reRunFrom,
      upToLayer: body.upToLayer,
    });
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
  reRunFrom?: number;
  targetArtifactIds?: string[];
  /** Limit plan to layers 0 through upToLayer (0-indexed). */
  upToLayer?: number;
  /** Pin IDs (canonical Artifact:... or Producer:...). */
  pinIds?: string[];
}

/**
 * Result from generatePlan.
 */
interface GeneratePlanResult {
  plan: ExecutionPlan;
  manifest: Manifest;
  manifestHash: string | null;
  resolvedInputs: Record<string, unknown>;
  providerOptions: ProducerOptionsMap;
  blueprintPath: string;
  costSummary: PlanCostSummary;
  catalogModelsDir?: string;
  surgicalInfo?: SurgicalInfo[];
  persist: () => Promise<void>;
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
    reRunFrom,
    targetArtifactIds,
    upToLayer,
    pinIds,
  } = options;
  const storageRoot = cliConfig.storage.root;
  const movieDir = resolve(buildsFolder, movieId);

  // Use IN-MEMORY storage for planning (no disk writes yet)
  const memoryStorageContext = createStorageContext({
    kind: 'memory',
    basePath,
  });
  await initializeMovieStorage(memoryStorageContext, movieId);

  // For edits (isNew: false), load existing manifest and events from disk
  if (!isNew) {
    const localStorageContext = createStorageContext({
      kind: 'local',
      rootDir: storageRoot,
      basePath,
    });
    await copyManifestToMemory(
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

  const manifestService = createManifestService(memoryStorageContext);
  const eventLog = createEventLog(memoryStorageContext);

  // Load blueprint
  const catalogRoot = cliConfig.catalog?.root ?? undefined;
  const { root: blueprintRoot } = await loadYamlBlueprintTree(blueprintPath, {
    catalogRoot,
  });

  // Validate blueprint
  const validation = validateBlueprintTree(blueprintRoot, { errorsOnly: true });
  if (!validation.valid) {
    const errorMessages = validation.errors
      .map((e) => `  ${e.code}: ${e.message}`)
      .join('\n');
    throw createValidationError(
      ValidationErrorCode.BLUEPRINT_VALIDATION_FAILED,
      `Blueprint validation failed:\n${errorMessages}`
    );
  }

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

  // Convert artifact overrides to PendingArtefactDraft objects
  const overrideDrafts = convertArtifactOverridesToDrafts(persistedOverrides);
  const allPendingArtefacts = overrideDrafts;

  // Build provider metadata with schemas
  const providerMetadata = await buildProviderMetadata(
    providerOptions,
    { catalogModelsDir, modelCatalog },
    loadModelInputSchema as Parameters<typeof buildProviderMetadata>[2]
  );

  // Generate plan
  const planResult = await createPlanningService().generatePlan({
    movieId,
    blueprintTree: blueprintRoot,
    inputValues,
    providerCatalog: catalog,
    providerOptions: providerMetadata,
    storage: memoryStorageContext,
    manifestService,
    eventLog,
    pendingArtefacts:
      allPendingArtefacts.length > 0 ? allPendingArtefacts : undefined,
    reRunFrom,
    targetArtifactIds,
    upToLayer,
    pinIds,
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

  // Derive surgical info if targetArtifactIds was provided
  const surgicalInfo = targetArtifactIds?.length
    ? deriveSurgicalInfoArray(targetArtifactIds, planResult.manifest)
    : undefined;

  return {
    plan: planResult.plan,
    manifest: planResult.manifest,
    manifestHash: planResult.manifestHash,
    resolvedInputs: planResult.resolvedInputs,
    providerOptions,
    blueprintPath,
    costSummary,
    catalogModelsDir: catalogModelsDir ?? undefined,
    surgicalInfo,
    persist: async () => {
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

      // Write input events to local event log
      const localEventLog = createEventLog(localStorageContext);
      for (const event of planResult.inputEvents) {
        await localEventLog.appendInput(movieId, event);
      }

      // Write plan to local storage
      const { planStore } = await import('@gorenku/core');
      await planStore.save(planResult.plan, {
        movieId,
        storage: localStorageContext,
      });
    },
  };
}

interface CliCommandOptions {
  blueprintPath: string;
  inputsPath?: string;
  artifactIds?: string[];
  pinIds?: string[];
  reRunFrom?: number;
  upToLayer?: number;
}

/**
 * Build the equivalent CLI command for the given plan options.
 */
function buildCliCommand(movieId: string, options: CliCommandOptions): string {
  const parts: string[] = ['renku generate'];

  // Movie ID
  parts.push(`--movie-id=${movieId}`);

  // Blueprint path (required for CLI to work properly)
  parts.push(`--blueprint=${options.blueprintPath}`);

  // Inputs path (if provided)
  if (options.inputsPath) {
    parts.push(`--inputs=${options.inputsPath}`);
  }

  // Artifact IDs for surgical regeneration
  if (options.artifactIds && options.artifactIds.length > 0) {
    for (const artifactId of options.artifactIds) {
      parts.push(`--aid=${artifactId}`);
    }
  }

  // Pin IDs
  if (options.pinIds && options.pinIds.length > 0) {
    for (const pinId of options.pinIds) {
      parts.push(`--pin=${pinId}`);
    }
  }

  // Re-run from layer
  if (options.reRunFrom !== undefined) {
    parts.push(`--from=${options.reRunFrom}`);
  }

  // Up to layer
  if (options.upToLayer !== undefined) {
    parts.push(`--up=${options.upToLayer}`);
  }

  // Add --explain flag to help debug
  parts.push('--explain');

  return parts.join(' ');
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
    revision: plan.revision,
    blueprintPath: cachedPlan.blueprintPath,
    // Only count layers that have jobs to execute (layerBreakdown already filtered)
    layers: layerBreakdown.length,
    blueprintLayers: plan.blueprintLayerCount,
    totalJobs,
    costSummary,
    layerBreakdown,
    surgicalInfo: cachedPlan.surgicalInfo,
    cliCommand,
  };
}
