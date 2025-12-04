import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import {
  createStorageContext,
  initializeMovieStorage,
  createManifestService,
  createEventLog,
  createPlanningService,
  type InputEvent,
  type Manifest,
  type ExecutionPlan,
  type PendingArtefactDraft,
  type Logger,
} from '@renku/core';
export type { PendingArtefactDraft } from '@renku/core';
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
}

export async function generatePlan(options: GeneratePlanOptions): Promise<GeneratePlanResult> {
  const logger = options.logger ?? globalThis.console;
  const notifications = options.notifications;
  const { cliConfig, movieId } = options;
  const storageRoot = cliConfig.storage.root;
  const basePath = cliConfig.storage.basePath;
  const movieDir = resolve(storageRoot, basePath, movieId);

  await mkdir(movieDir, { recursive: true });

  const storageContext = createStorageContext({
    kind: 'local',
    rootDir: storageRoot,
    basePath,
  });

  await initializeMovieStorage(storageContext, movieId);

  const manifestService = createManifestService(storageContext);
  const eventLog = createEventLog(storageContext);

  const blueprintPath = expandPath(options.usingBlueprint);
  const { root: blueprintRoot } = await loadBlueprintBundle(blueprintPath);
  await mergeMovieMetadata(movieDir, { blueprintPath });

  const { values: inputValues, providerOptions } = await loadInputsFromYaml(
    options.inputsPath,
    blueprintRoot,
  );
  applyProviderDefaults(inputValues, providerOptions);
  await persistInputs(movieDir, inputValues);
  const catalog = buildProducerCatalog(providerOptions);
  logger.info(`Using blueprint: ${blueprintPath}`);

  const planResult = await createPlanningService({
    logger,
    notifications,
  }).generatePlan({
    movieId,
    blueprintTree: blueprintRoot,
    inputValues,
    providerCatalog: catalog,
    providerOptions: buildProviderMetadata(providerOptions),
    storage: storageContext,
    manifestService,
    eventLog,
    pendingArtefacts: options.pendingArtefacts,
  });
  logger.debug('[planner] resolved inputs', { inputs: Object.keys(planResult.resolvedInputs) });
  const absolutePlanPath = resolve(storageRoot, planResult.planPath);

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
  };
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
