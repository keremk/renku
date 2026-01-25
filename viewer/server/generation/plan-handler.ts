/**
 * Handler for POST /viewer-api/generate/plan
 * Creates an execution plan with cost estimation (does not execute).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve, dirname, relative } from 'node:path';
import { mkdir } from 'node:fs/promises';
import {
  createStorageContext,
  initializeMovieStorage,
  createManifestService,
  createEventLog,
  createPlanningService,
  validateBlueprintTree,
  loadYamlBlueprintTree,
  loadInputsFromYaml as coreLoadInputsFromYaml,
  buildProducerOptionsFromBlueprint,
  buildProducerCatalog,
  persistInputBlob,
  isRenkuError,
  type ExecutionPlan,
  type Manifest,
  type PendingArtefactDraft,
  type ProducerOptionsMap,
  type ProviderOptionEntry,
  type ArtifactOverride,
} from '@gorenku/core';
import {
  loadPricingCatalog,
  estimatePlanCosts,
  loadModelCatalog,
  loadModelInputSchema,
  type LoadedModelCatalog,
  type PlanCostSummary,
} from '@gorenku/providers';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

import type { PlanRequest, PlanResponse, LayerInfo, SurgicalInfo, CachedPlan, SerializablePlanCostSummary } from './types.js';
import type { ProducerCostData } from '@gorenku/providers';
import { requireCliConfig, getCatalogModelsDir, type CliConfig } from './config.js';
import { resolveBlueprintPaths, generateMovieId, normalizeMovieId } from './paths.js';
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
    const paths = await resolveBlueprintPaths(body.blueprint, body.inputs, cliConfig);

    // Compute basePath relative to storage root (e.g., "animated-edu-characters/builds")
    const basePath = relative(cliConfig.storage.root, paths.buildsFolder);

    // Determine movie ID (new or existing)
    const isNew = !body.movieId;
    const movieId = body.movieId ? normalizeMovieId(body.movieId) : generateMovieId();

    // Generate plan
    const planResult = await generatePlan({
      cliConfig,
      movieId,
      isNew,
      blueprintPath: paths.blueprintPath,
      inputsPath: paths.inputsPath,
      buildsFolder: paths.buildsFolder,
      basePath,
      reRunFrom: body.reRunFrom,
      targetArtifactIds: body.artifactIds,
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
    const response = buildPlanResponse(cachedPlan, planResult.plan);
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
async function generatePlan(options: GeneratePlanOptions): Promise<GeneratePlanResult> {
  const { cliConfig, movieId, isNew, blueprintPath, inputsPath, buildsFolder, basePath, reRunFrom, targetArtifactIds } = options;
  const storageRoot = cliConfig.storage.root;
  const movieDir = resolve(buildsFolder, movieId);

  // Use IN-MEMORY storage for planning (no disk writes yet)
  const memoryStorageContext = createStorageContext({ kind: 'memory', basePath });
  await initializeMovieStorage(memoryStorageContext, movieId);

  // For edits (isNew: false), load existing manifest and events from disk
  if (!isNew) {
    const localStorageContext = createStorageContext({
      kind: 'local',
      rootDir: storageRoot,
      basePath,
    });
    await copyManifestToMemory(localStorageContext, memoryStorageContext, movieId);
    await copyEventsToMemory(localStorageContext, memoryStorageContext, movieId);
  }

  const manifestService = createManifestService(memoryStorageContext);
  const eventLog = createEventLog(memoryStorageContext);

  // Load blueprint
  const catalogRoot = cliConfig.catalog?.root ?? undefined;
  const { root: blueprintRoot } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });

  // Validate blueprint
  const validation = validateBlueprintTree(blueprintRoot, { errorsOnly: true });
  if (!validation.valid) {
    const errorMessages = validation.errors.map((e) => `  ${e.code}: ${e.message}`).join('\n');
    throw new Error(`Blueprint validation failed:\n${errorMessages}`);
  }

  // Load inputs from YAML
  const baseInputs = await coreLoadInputsFromYaml(inputsPath, blueprintRoot);
  const baseDir = dirname(inputsPath);
  const providerOptions = await buildProducerOptionsFromBlueprint(
    blueprintRoot,
    baseInputs.modelSelections,
    false,
    { baseDir }
  );

  const inputValues = baseInputs.values;
  const artifactOverrides = baseInputs.artifactOverrides;

  // Build producer catalog
  const catalog = buildProducerCatalog(providerOptions);

  // Load model catalog for schema loading
  const catalogModelsDir = getCatalogModelsDir(cliConfig);
  const modelCatalog = catalogModelsDir ? await loadModelCatalog(catalogModelsDir) : undefined;

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
  const providerMetadata = await buildProviderMetadata(providerOptions, {
    catalogModelsDir,
    modelCatalog,
  });

  // Generate plan
  const planResult = await createPlanningService({}).generatePlan({
    movieId,
    blueprintTree: blueprintRoot,
    inputValues,
    providerCatalog: catalog,
    providerOptions: providerMetadata,
    storage: memoryStorageContext,
    manifestService,
    eventLog,
    pendingArtefacts: allPendingArtefacts.length > 0 ? allPendingArtefacts : undefined,
    reRunFrom,
    targetArtifactIds,
  });

  // Load pricing catalog and estimate costs
  const pricingCatalog = catalogModelsDir
    ? await loadPricingCatalog(catalogModelsDir)
    : { providers: new Map() };
  const costSummary = estimatePlanCosts(planResult.plan, pricingCatalog, planResult.resolvedInputs);

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

      // Copy blobs from memory storage to local storage
      await copyBlobsFromMemoryToLocal(memoryStorageContext, localStorageContext, movieId);

      // Write input events to local event log
      const localEventLog = createEventLog(localStorageContext);
      for (const event of planResult.inputEvents) {
        await localEventLog.appendInput(movieId, event);
      }

      // Write plan to local storage
      const { planStore } = await import('@gorenku/core');
      await planStore.save(planResult.plan, { movieId, storage: localStorageContext });
    },
  };
}

/**
 * Builds the PlanResponse from cached plan and execution plan.
 */
function buildPlanResponse(cachedPlan: CachedPlan, plan: ExecutionPlan): PlanResponse {
  // Build job cost lookup map for quick access
  const jobCostMap = new Map<string, { cost: number; min: number; max: number; isPlaceholder: boolean }>();
  for (const jobCost of cachedPlan.costSummary.jobs) {
    const cost = jobCost.estimate.cost;
    const min = jobCost.estimate.range?.min ?? cost;
    const max = jobCost.estimate.range?.max ?? cost;
    jobCostMap.set(jobCost.jobId, { cost, min, max, isPlaceholder: jobCost.estimate.isPlaceholder });
  }

  // Build layerBreakdown with per-layer costs
  const layerBreakdown: LayerInfo[] = plan.layers.map((layerJobs, index) => {
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
  });

  const totalJobs = plan.layers.reduce((sum, layerJobs) => sum + layerJobs.length, 0);

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

  return {
    planId: cachedPlan.planId,
    movieId: cachedPlan.movieId,
    revision: plan.revision,
    blueprintPath: cachedPlan.blueprintPath,
    layers: plan.layers.length,
    totalJobs,
    costSummary,
    layerBreakdown,
    surgicalInfo: cachedPlan.surgicalInfo,
  };
}

// =============================================================================
// Helper Functions (adapted from cli/src/lib/planner.ts)
// =============================================================================

async function copyManifestToMemory(
  localCtx: ReturnType<typeof createStorageContext>,
  memoryCtx: ReturnType<typeof createStorageContext>,
  movieId: string
): Promise<void> {
  const currentJsonPath = localCtx.resolve(movieId, 'current.json');
  if (await localCtx.storage.fileExists(currentJsonPath)) {
    const content = await localCtx.storage.readToString(currentJsonPath);
    const memoryPath = memoryCtx.resolve(movieId, 'current.json');
    await memoryCtx.storage.write(memoryPath, content, { mimeType: 'application/json' });

    const parsed = JSON.parse(content) as { manifestPath?: string | null };
    if (parsed.manifestPath) {
      const manifestFullPath = localCtx.resolve(movieId, parsed.manifestPath);
      if (await localCtx.storage.fileExists(manifestFullPath)) {
        const manifestContent = await localCtx.storage.readToString(manifestFullPath);
        const memoryManifestPath = memoryCtx.resolve(movieId, parsed.manifestPath);
        await memoryCtx.storage.write(memoryManifestPath, manifestContent, { mimeType: 'application/json' });
      }
    }
  }
}

async function copyEventsToMemory(
  localCtx: ReturnType<typeof createStorageContext>,
  memoryCtx: ReturnType<typeof createStorageContext>,
  movieId: string
): Promise<void> {
  const eventFiles = ['events/inputs.log', 'events/artefacts.log'];
  for (const eventFile of eventFiles) {
    const localPath = localCtx.resolve(movieId, eventFile);
    if (await localCtx.storage.fileExists(localPath)) {
      const content = await localCtx.storage.readToString(localPath);
      const memoryPath = memoryCtx.resolve(movieId, eventFile);
      await memoryCtx.storage.write(memoryPath, content, { mimeType: 'text/plain' });
    }
  }
}

async function copyBlobsFromMemoryToLocal(
  memoryCtx: ReturnType<typeof createStorageContext>,
  localCtx: ReturnType<typeof createStorageContext>,
  movieId: string
): Promise<void> {
  const { inferMimeType } = await import('@gorenku/core');
  const blobsDir = memoryCtx.resolve(movieId, 'blobs');

  if (!(await memoryCtx.storage.directoryExists(blobsDir))) {
    return;
  }

  const listing = memoryCtx.storage.list(blobsDir, { deep: true });

  for await (const item of listing) {
    if (item.type === 'file') {
      const content = await memoryCtx.storage.readToUint8Array(item.path);
      const ext = item.path.split('.').pop() || '';
      const mimeType = inferMimeType(ext);
      const buffer = Buffer.from(content);
      await localCtx.storage.write(item.path, buffer, { mimeType });
    }
  }
}

interface CatalogSchemaOptions {
  catalogModelsDir: string | null;
  modelCatalog?: LoadedModelCatalog;
}

async function buildProviderMetadata(
  options: ProducerOptionsMap,
  catalogOptions: CatalogSchemaOptions
): Promise<Map<string, ProviderOptionEntry>> {
  const { catalogModelsDir, modelCatalog } = catalogOptions;
  const map = new Map<string, ProviderOptionEntry>();

  for (const [key, entries] of options) {
    const primary = entries[0];
    if (!primary) {
      continue;
    }

    let inputSchema = primary.inputSchema;
    if (!inputSchema && catalogModelsDir && modelCatalog && primary.provider && primary.model) {
      inputSchema =
        (await loadModelInputSchema(catalogModelsDir, modelCatalog, primary.provider, primary.model)) ?? undefined;
    }

    map.set(key, {
      sdkMapping: primary.sdkMapping,
      outputs: primary.outputs,
      inputSchema,
      outputSchema: primary.outputSchema,
      config: primary.config,
      selectionInputKeys: primary.selectionInputKeys,
      configInputPaths: primary.configInputPaths,
    });
  }
  return map;
}

function convertArtifactOverridesToDrafts(overrides: ArtifactOverride[]): PendingArtefactDraft[] {
  return overrides.map((override) => {
    const buffer = Buffer.isBuffer(override.blob.data) ? override.blob.data : Buffer.from(override.blob.data);
    const hash = createHash('sha256').update(buffer).digest('hex');

    return {
      artefactId: override.artifactId,
      producedBy: 'user-override',
      output: {
        blob: {
          hash,
          size: buffer.byteLength,
          mimeType: override.blob.mimeType,
        },
      },
    };
  });
}

async function persistArtifactOverrideBlobs(
  overrides: ArtifactOverride[],
  storage: ReturnType<typeof createStorageContext>,
  movieId: string
): Promise<ArtifactOverride[]> {
  for (const override of overrides) {
    await persistInputBlob(storage, movieId, override.blob);
  }
  return overrides;
}

function deriveSurgicalInfoArray(
  targetArtifactIds: string[],
  manifest: Manifest
): SurgicalInfo[] | undefined {
  const results: SurgicalInfo[] = [];
  for (const targetArtifactId of targetArtifactIds) {
    const entry = manifest.artefacts[targetArtifactId];
    if (!entry) {
      continue;
    }
    results.push({
      targetArtifactId,
      sourceJobId: entry.producedBy,
    });
  }
  return results.length > 0 ? results : undefined;
}
