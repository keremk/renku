import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createStorageContext,
  initializeMovieStorage,
  createManifestService,
  createEventLog,
  createPlanningService,
  planStore,
  persistInputBlob,
  inferMimeType,
  validateBlueprintTree,
  type InputEvent,
  type Manifest,
  type ExecutionPlan,
  type PendingArtefactDraft,
  type Logger,
  type ArtifactOverride,
} from '@gorenku/core';
export type { PendingArtefactDraft } from '@gorenku/core';
import {
  loadPricingCatalog,
  estimatePlanCosts,
  loadModelCatalog,
  loadModelInputSchema,
  type PlanCostSummary,
  type LoadedModelCatalog,
} from '@gorenku/providers';
import type { CliConfig } from './cli-config.js';
import { loadBlueprintBundle } from './blueprint-loader/index.js';
import { loadInputsFromYaml } from './input-loader.js';
import { buildProducerCatalog, type ProducerOptionsMap, type ProviderOptionEntry } from '@gorenku/core';
import { expandPath } from './path.js';
import { mergeMovieMetadata } from './movie-metadata.js';
import { applyProviderDefaults } from './provider-defaults.js';
import chalk from 'chalk';
import { Buffer } from 'buffer';

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
  /** Target artifact ID for surgical regeneration (canonical format, e.g., "Artifact:AudioProducer.GeneratedAudio[0]") */
  targetArtifactId?: string;
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
  /** Surgical regeneration info when targetArtifactId is provided. */
  surgicalInfo?: {
    targetArtifactId: string;
    sourceJobId: string;
  };
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
    throw new Error(`Blueprint validation failed:\n${errorMessages}`);
  }

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
  );
  applyProviderDefaults(inputValues, providerOptions);
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
  const providerMetadata = await buildProviderMetadata(providerOptions, {
    catalogModelsDir,
    modelCatalog,
  });
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
    targetArtifactId: options.targetArtifactId,
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

  // Derive surgical info if targetArtifactId was provided
  const surgicalInfo = options.targetArtifactId
    ? deriveSurgicalInfo(options.targetArtifactId, planResult.manifest)
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
    persist: async () => {
      // Create LOCAL storage and write everything
      const localStorageContext = createStorageContext({
        kind: 'local',
        rootDir: storageRoot,
        basePath,
      });

      await mkdir(movieDir, { recursive: true });
      await initializeMovieStorage(localStorageContext, movieId);
      await mergeMovieMetadata(movieDir, { blueprintPath });

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
 * Copy existing manifest from local storage to in-memory storage.
 */
async function copyManifestToMemory(
  localCtx: ReturnType<typeof createStorageContext>,
  memoryCtx: ReturnType<typeof createStorageContext>,
  movieId: string,
): Promise<void> {
  const currentJsonPath = localCtx.resolve(movieId, 'current.json');
  if (await localCtx.storage.fileExists(currentJsonPath)) {
    const content = await localCtx.storage.readToString(currentJsonPath);
    const memoryPath = memoryCtx.resolve(movieId, 'current.json');
    await memoryCtx.storage.write(memoryPath, content, { mimeType: 'application/json' });

    // Also copy the actual manifest file if it exists
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

/**
 * Copy existing event logs from local storage to in-memory storage.
 */
async function copyEventsToMemory(
  localCtx: ReturnType<typeof createStorageContext>,
  memoryCtx: ReturnType<typeof createStorageContext>,
  movieId: string,
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

    // Try to load input schema from model catalog if not already present
    let inputSchema = primary.inputSchema;
    if (!inputSchema && catalogModelsDir && modelCatalog && primary.provider && primary.model) {
      inputSchema = await loadModelInputSchema(
        catalogModelsDir,
        modelCatalog,
        primary.provider,
        primary.model
      ) ?? undefined;
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

/**
 * Resolve the catalog models directory path from CLI config.
 */
function resolveCatalogModelsDir(cliConfig: CliConfig): string | null {
  if (cliConfig.catalog?.root) {
    return resolve(cliConfig.catalog.root, 'models');
  }
  return null;
}

/**
 * Convert artifact overrides from inputs.yaml to PendingArtefactDraft objects.
 * Computes blob hash from the data for dirty tracking.
 */
function convertArtifactOverridesToDrafts(overrides: ArtifactOverride[]): PendingArtefactDraft[] {
  return overrides.map((override) => {
    const buffer = Buffer.isBuffer(override.blob.data)
      ? override.blob.data
      : Buffer.from(override.blob.data);
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

/**
 * Persist artifact override blobs to storage before converting to drafts.
 */
async function persistArtifactOverrideBlobs(
  overrides: ArtifactOverride[],
  storage: ReturnType<typeof createStorageContext>,
  movieId: string,
): Promise<ArtifactOverride[]> {
  // Blob data is already in BlobInput format, persist it
  for (const override of overrides) {
    await persistInputBlob(storage, movieId, override.blob);
  }
  return overrides; // Return as-is, blobs are now persisted
}

/**
 * Copy blobs from in-memory storage to local storage.
 * Follows the same pattern as copyManifestToMemory and copyEventsToMemory.
 */
async function copyBlobsFromMemoryToLocal(
  memoryCtx: ReturnType<typeof createStorageContext>,
  localCtx: ReturnType<typeof createStorageContext>,
  movieId: string,
): Promise<void> {
  const blobsDir = memoryCtx.resolve(movieId, 'blobs');

  // Check if blobs directory exists before listing
  if (!(await memoryCtx.storage.directoryExists(blobsDir))) {
    return; // No blobs to copy
  }

  // List all files in blobs directory recursively
  const listing = memoryCtx.storage.list(blobsDir, { deep: true });

  for await (const item of listing) {
    if (item.type === 'file') {
      // Read from memory storage
      const content = await memoryCtx.storage.readToUint8Array(item.path);

      // Infer MIME type from file extension (reuse existing utility)
      const ext = item.path.split('.').pop() || '';
      const mimeType = inferMimeType(ext);

      // Convert to Buffer for compatibility with FlyStorage local adapter
      const buffer = Buffer.from(content);

      // Write to local storage
      await localCtx.storage.write(item.path, buffer, { mimeType });
    }
  }
}

/**
 * Derive surgical regeneration info from the manifest.
 */
function deriveSurgicalInfo(
  targetArtifactId: string,
  manifest: Manifest,
): { targetArtifactId: string; sourceJobId: string } | undefined {
  const entry = manifest.artefacts[targetArtifactId];
  if (!entry) {
    // If artifact not in manifest, we can't derive the source job
    // This will be handled by the core's resolveArtifactToJob which will throw
    return undefined;
  }
  return {
    targetArtifactId,
    sourceJobId: entry.producedBy,
  };
}
