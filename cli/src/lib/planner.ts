import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import {
  createStorageContext,
  initializeMovieStorage,
  createManifestService,
  createEventLog,
  createPlanningService,
  planStore,
  type InputEvent,
  type Manifest,
  type ExecutionPlan,
  type PendingArtefactDraft,
  type Logger,
  type ArtifactOverride,
} from '@renku/core';
export type { PendingArtefactDraft } from '@renku/core';
import {
  loadPricingCatalog,
  estimatePlanCosts,
  loadModelCatalog,
  type PlanCostSummary,
  type LoadedModelCatalog,
} from '@renku/providers';
import type { CliConfig } from './cli-config.js';
import { writePromptFile } from './prompts.js';
import { loadBlueprintBundle } from './blueprint-loader/index.js';
import { loadInputsFromYaml, type InputMap } from './input-loader.js';
import { buildProducerCatalog, type ProducerOptionsMap } from './producer-options.js';
import type { ProviderOptionEntry } from '@renku/core';
import { expandPath } from './path.js';
import { mergeMovieMetadata } from './movie-metadata.js';
import { INPUT_FILE_NAME } from './input-files.js';
import { applyProviderDefaults } from './provider-defaults.js';
import chalk from 'chalk';
import { Buffer } from 'buffer';

export interface GeneratePlanOptions {
  cliConfig: CliConfig;
  movieId: string; // storage movie id (e.g., movie-q123)
  isNew: boolean;
  inputsPath: string;
  usingBlueprint: string; // Path to blueprint YAML file
  pendingArtefacts?: PendingArtefactDraft[];
  logger?: Logger;
  notifications?: import('@renku/core').NotificationBus;
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
  /** Persist the plan to local storage. Call after confirmation. */
  persist: () => Promise<void>;
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
  const { root: blueprintRoot } = await loadBlueprintBundle(blueprintPath);

  const { values: inputValues, providerOptions, artifactOverrides } = await loadInputsFromYaml(
    options.inputsPath,
    blueprintRoot,
  );
  applyProviderDefaults(inputValues, providerOptions);
  const catalog = buildProducerCatalog(providerOptions);
  logger.info(`${chalk.bold('Using blueprint:')} ${blueprintPath}`);

  // Convert artifact overrides to PendingArtefactDraft objects
  const overrideDrafts = convertArtifactOverridesToDrafts(artifactOverrides);
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
  const planResult = await createPlanningService({
    logger,
    notifications,
  }).generatePlan({
    movieId,
    blueprintTree: blueprintRoot,
    inputValues,
    providerCatalog: catalog,
    providerOptions: buildProviderMetadata(providerOptions),
    storage: memoryStorageContext,
    manifestService,
    eventLog,
    pendingArtefacts: allPendingArtefacts.length > 0 ? allPendingArtefacts : undefined,
  });
  logger.debug('[planner] resolved inputs', { inputs: Object.keys(planResult.resolvedInputs) });
  const absolutePlanPath = resolve(storageRoot, basePath, movieId, 'runs', `${planResult.targetRevision}-plan.json`);

  // Load pricing catalog and estimate costs
  const catalogModelsDir = resolveCatalogModelsDir(cliConfig);
  const pricingCatalog = catalogModelsDir
    ? await loadPricingCatalog(catalogModelsDir)
    : { providers: new Map() };
  const costSummary = estimatePlanCosts(
    planResult.plan,
    pricingCatalog,
    planResult.resolvedInputs
  );

  // Load model catalog for handler generation
  const modelCatalog = catalogModelsDir
    ? await loadModelCatalog(catalogModelsDir)
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
      await persistInputs(movieDir, inputValues);

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

async function persistInputs(movieDir: string, values: InputMap): Promise<void> {
  const contents = stringifyYaml({ inputs: values });
  await writeFile(join(movieDir, INPUT_FILE_NAME), contents, 'utf8');
  const promptValue = values['Input:InquiryPrompt'];
  if (typeof promptValue === 'string' && promptValue.trim().length > 0) {
    await writePromptFile(movieDir, join('prompts', 'inquiry.txt'), promptValue);
  }
}

function buildProviderMetadata(options: ProducerOptionsMap): Map<string, ProviderOptionEntry> {
  const map = new Map<string, ProviderOptionEntry>();
  for (const [key, entries] of options) {
    const primary = entries[0];
    if (!primary) {
      continue;
    }
    map.set(key, {
      sdkMapping: primary.sdkMapping,
      outputs: primary.outputs,
      inputSchema: primary.inputSchema,
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
