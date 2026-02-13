import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createStorageContext,
  initializeMovieStorage,
  createManifestService,
  createEventLog,
  createPlanningService,
  createMovieMetadataService,
  planStore,
  validateBlueprintTree,
  buildProducerCatalog,
  copyManifestToMemory,
  copyEventsToMemory,
  copyBlobsFromMemoryToLocal,
  buildProviderMetadata,
  convertArtifactOverridesToDrafts,
  persistArtifactOverrideBlobs,
  deriveSurgicalInfoArray,
  createValidationError,
  ValidationErrorCode,
  analyzeConditions,
  conditionAnalysisToVaryingHints,
  type InputEvent,
  type Manifest,
  type ExecutionPlan,
  type PendingArtefactDraft,
  type Logger,
  type PlanExplanation,
  type ProducerOptionsMap,
  type SurgicalInfo,
  type ConditionAnalysis,
} from '@gorenku/core';
export type { PendingArtefactDraft } from '@gorenku/core';
export type { PlanExplanation } from '@gorenku/core';
import {
  loadPricingCatalog,
  estimatePlanCosts,
  loadModelCatalog,
  loadModelInputSchema,
  type PlanCostSummary,
  type LoadedModelCatalog,
  type ConditionHints,
} from '@gorenku/providers';
import type { CliConfig } from './cli-config.js';
import { loadBlueprintBundle } from './blueprint-loader/index.js';
import { loadInputsFromYaml } from './input-loader.js';
import { expandPath } from './path.js';
import chalk from 'chalk';

export interface GeneratePlanOptions {
  cliConfig: CliConfig;
  movieId: string; // storage movie id (e.g., movie-q123)
  isNew: boolean;
  /** Path to inputs YAML file. Required for model selections. */
  inputsPath: string;
  usingBlueprint: string; // Path to blueprint YAML file
  pendingArtefacts?: PendingArtefactDraft[];
  logger?: Logger;
  notifications?: import('@gorenku/core').NotificationBus;
  /** Force re-run from this layer index onwards (0-indexed). Jobs at this layer and above will be included in the plan. */
  reRunFrom?: number;
  /** Target artifact IDs for surgical regeneration (canonical format, e.g., ["Artifact:AudioProducer.GeneratedAudio[0]"]) */
  targetArtifactIds?: string[];
  /** If true, collect explanation data for why jobs are scheduled */
  collectExplanation?: boolean;
}

export interface GeneratePlanResult {
  planPath: string;
  targetRevision: string;
  inputEvents: InputEvent[];
  manifest: Manifest;
  plan: ExecutionPlan;
  manifestHash: string | null;
  resolvedInputs: Record<string, unknown>;
  providerOptions: ProducerOptionsMap;
  blueprintPath: string;
  costSummary: PlanCostSummary;
  /** Pre-loaded model catalog for provider registry. */
  modelCatalog?: LoadedModelCatalog;
  /** Path to the catalog models directory. Required for schema loading in delegation. */
  catalogModelsDir?: string;
  /** Persist the plan to local storage. Call after confirmation. */
  persist: () => Promise<void>;
  /** Surgical regeneration info when targetArtifactIds is provided. */
  surgicalInfo?: SurgicalInfo[];
  /** Plan explanation (only if collectExplanation was true) */
  explanation?: PlanExplanation;
  /** Condition analysis for dry-run simulation */
  conditionAnalysis?: ConditionAnalysis;
  /** Condition hints for dry-run simulation (derived from conditionAnalysis) */
  conditionHints?: ConditionHints;
}

export async function generatePlan(options: GeneratePlanOptions): Promise<GeneratePlanResult> {
  const logger = options.logger ?? globalThis.console;
  const notifications = options.notifications;
  const { cliConfig, movieId } = options;
  const storageRoot = cliConfig.storage.root;
  const basePath = cliConfig.storage.basePath;
  const movieDir = resolve(storageRoot, basePath, movieId);

  // Use IN-MEMORY storage for planning (no disk writes yet)
  const memoryStorageContext = createStorageContext({ kind: 'memory', basePath });
  await initializeMovieStorage(memoryStorageContext, movieId);

  // For edits (isNew: false), we need to load existing manifest and events from disk
  // For new movies, we use empty in-memory state
  if (!options.isNew) {
    // Load existing manifest and events from local storage into memory context
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

  const blueprintPath = expandPath(options.usingBlueprint);
  const catalogRoot = cliConfig.catalog?.root ?? undefined;
  const { root: blueprintRoot } = await loadBlueprintBundle(blueprintPath, { catalogRoot });

  // Validate blueprint before proceeding
  const validation = validateBlueprintTree(blueprintRoot, { errorsOnly: true });
  if (!validation.valid) {
    const errorMessages = validation.errors
      .map((e) => `  ${e.code}: ${e.message}`)
      .join('\n');
    throw createValidationError(
      ValidationErrorCode.BLUEPRINT_VALIDATION_FAILED,
      `Blueprint validation failed:\n${errorMessages}`,
    );
  }

  // Analyze conditions for dry-run simulation
  const conditionAnalysisResult = analyzeConditions(blueprintRoot.document);
  const varyingHints = conditionAnalysisToVaryingHints(conditionAnalysisResult);
  const conditionHints: ConditionHints | undefined = varyingHints.length > 0
    ? { varyingFields: varyingHints, mode: 'alternating' }
    : undefined;

  // Load inputs from YAML - always required (contains model selections)
  if (!options.inputsPath) {
    const { createRuntimeError, RuntimeErrorCode } = await import('@gorenku/core');
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      'Input YAML path is required.',
      { suggestion: 'Provide --inputs=/path/to/inputs.yaml. Inputs are needed for model selections, even when using --re-run-from.' }
    );
  }

  const { values: inputValues, providerOptions, artifactOverrides } = await loadInputsFromYaml(
    options.inputsPath,
    blueprintRoot,
    false,
    movieDir,
  );
  const catalog = buildProducerCatalog(providerOptions);
  logger.info(`${chalk.bold('Using blueprint:')} ${blueprintPath}`);

  // Load model catalog early - needed for schema loading in buildProviderMetadata
  const catalogModelsDir = resolveCatalogModelsDir(cliConfig);
  const modelCatalog = catalogModelsDir
    ? await loadModelCatalog(catalogModelsDir)
    : undefined;

  // Persist artifact override blobs to storage before converting to drafts
  const persistedOverrides = await persistArtifactOverrideBlobs(
    artifactOverrides,
    memoryStorageContext,
    movieId,
  );

  // Convert artifact overrides to PendingArtefactDraft objects
  const overrideDrafts = convertArtifactOverridesToDrafts(persistedOverrides);
  const allPendingArtefacts = [
    ...(options.pendingArtefacts ?? []),
    ...overrideDrafts,
  ];

  if (artifactOverrides.length > 0) {
    logger.info(`${chalk.bold('Artifact overrides:')} ${artifactOverrides.length} artifact(s) will be replaced`);
    for (const override of artifactOverrides) {
      logger.debug(`  - ${override.artifactId} (${override.blob.mimeType})`);
    }
  }

  // Generate plan (writes go to in-memory storage)
  const providerMetadata = await buildProviderMetadata(
    providerOptions,
    { catalogModelsDir, modelCatalog },
    loadModelInputSchema as Parameters<typeof buildProviderMetadata>[2],
  );
  const planResult = await createPlanningService({
    logger,
    notifications,
  }).generatePlan({
    movieId,
    blueprintTree: blueprintRoot,
    inputValues,
    providerCatalog: catalog,
    providerOptions: providerMetadata,
    storage: memoryStorageContext,
    manifestService,
    eventLog,
    pendingArtefacts: allPendingArtefacts.length > 0 ? allPendingArtefacts : undefined,
    reRunFrom: options.reRunFrom,
    targetArtifactIds: options.targetArtifactIds,
    collectExplanation: options.collectExplanation,
  });
  logger.debug('[planner] resolved inputs', { inputs: Object.keys(planResult.resolvedInputs) });
  const absolutePlanPath = resolve(storageRoot, basePath, movieId, 'runs', `${planResult.targetRevision}-plan.json`);

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
  const surgicalInfo = options.targetArtifactIds?.length
    ? deriveSurgicalInfoArray(options.targetArtifactIds, planResult.manifest)
    : undefined;

  return {
    planPath: absolutePlanPath,
    targetRevision: planResult.targetRevision,
    inputEvents: planResult.inputEvents,
    manifest: planResult.manifest,
    plan: planResult.plan,
    manifestHash: planResult.manifestHash,
    resolvedInputs: planResult.resolvedInputs,
    providerOptions,
    blueprintPath,
    costSummary,
    modelCatalog,
    catalogModelsDir: catalogModelsDir ?? undefined,
    surgicalInfo,
    explanation: planResult.explanation,
    conditionAnalysis: conditionAnalysisResult,
    conditionHints,
    persist: async () => {
      // Create LOCAL storage and write everything
      const localStorageContext = createStorageContext({
        kind: 'local',
        rootDir: storageRoot,
        basePath,
      });

      await mkdir(movieDir, { recursive: true });
      await initializeMovieStorage(localStorageContext, movieId);

      // Write movie metadata using the core service
      const metadataService = createMovieMetadataService(localStorageContext);
      await metadataService.merge(movieId, { blueprintPath });

      // Copy blobs from memory storage to local storage
      await copyBlobsFromMemoryToLocal(
        memoryStorageContext,
        localStorageContext,
        movieId,
      );

      // Write input events to local event log
      const localEventLog = createEventLog(localStorageContext);
      for (const event of planResult.inputEvents) {
        await localEventLog.appendInput(movieId, event);
      }

      // Write plan to local storage
      await planStore.save(planResult.plan, { movieId, storage: localStorageContext });
    },
  };
}


/**
 * Resolve the catalog models directory path from CLI config.
 */
function resolveCatalogModelsDir(cliConfig: CliConfig): string | null {
  if (cliConfig.catalog?.root) {
    return resolve(cliConfig.catalog.root, 'models');
  }
  return null;
}

