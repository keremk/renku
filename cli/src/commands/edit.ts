import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDefaultCliConfigPath, readCliConfig } from '../lib/cli-config.js';
import type { CliConfig } from '../lib/cli-config.js';
import { WORKSPACE_INPUTS_RELATIVE_PATH } from '../lib/input-files.js';
import { formatMovieId } from './query.js';
import { generatePlan, type PendingArtefactDraft } from '../lib/planner.js';
import {
  executeDryRun,
  type DryRunSummary,
} from '../lib/dry-run.js';
import {
  executeBuild,
  type BuildSummary,
} from '../lib/build.js';
import { expandPath } from '../lib/path.js';
import { confirmPlanExecution } from '../lib/interactive-confirm.js';
import { confirmPlanWithInk } from '../lib/plan-confirmation.js';
import { cleanupPlanFiles } from '../lib/plan-cleanup.js';
import {
  diffWorkspace,
  exportWorkspace,
  persistWorkspaceBlob,
  readWorkspaceState,
  type WorkspaceArtefactChange,
  type WorkspaceDiffResult,
  type WorkspaceState,
} from '../lib/workspace.js';
import { readMovieMetadata } from '../lib/movie-metadata.js';
import { resolveBlueprintSpecifier } from '../lib/config-assets.js';
import { resolveAndPersistConcurrency } from '../lib/concurrency.js';
import type { NotificationBus, Logger } from '@renku/core';
import type { CliLoggerMode } from '../lib/logger.js';

export interface EditOptions {
  movieId: string;
  inputsPath?: string; // optional override (workspace submissions or CLI --inputs during edits)
  dryRun?: boolean;
  nonInteractive?: boolean;
  usingBlueprint?: string;
  pendingArtefacts?: PendingArtefactDraft[];
  concurrency?: number;
  upToLayer?: number;
  mode: CliLoggerMode;
  notifications?: NotificationBus;
  onExecutionStart?: () => void;
  logger: Logger;
}

export interface EditResult {
  storageMovieId: string;
  planPath: string;
  targetRevision: string;
  dryRun?: DryRunSummary;
  build?: BuildSummary;
  manifestPath?: string;
  storagePath: string;
}

export async function runEdit(options: EditOptions): Promise<EditResult> {
  const configPath = getDefaultCliConfigPath();
  const cliConfig = await readCliConfig(configPath);
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  if (!options.movieId) {
    throw new Error('Movie ID is required for edit.');
  }
  const { concurrency } = await resolveAndPersistConcurrency(cliConfig, {
    override: options.concurrency,
    configPath,
  });

  const storageMovieId = formatMovieId(options.movieId);
  const storageRoot = cliConfig.storage.root;
  const basePath = cliConfig.storage.basePath;
  const movieDir = resolve(storageRoot, basePath, storageMovieId);
  const logger = options.logger;
  const upToLayer = options.upToLayer;
  if (options.dryRun && upToLayer !== undefined) {
    logger.info('--upToLayer applies only to live runs; dry runs will simulate all layers.');
  }

  const defaultInputsPath = resolve(movieDir, 'inputs.yaml');
  const inputsPath = expandPath(options.inputsPath ?? defaultInputsPath);

  const metadata = await readMovieMetadata(movieDir);
  const blueprintInput = options.usingBlueprint ?? metadata?.blueprintPath;
  if (!blueprintInput) {
    throw new Error(
      'Blueprint path is required for edit. Provide --blueprint=/path/to/blueprint.yaml or re-run the initial generation to capture blueprint metadata.',
    );
  }
  const blueprintPath = await resolveBlueprintSpecifier(blueprintInput, {
    cliRoot: cliConfig.storage.root,
  });

  const planResult = await generatePlan({
    cliConfig,
    movieId: storageMovieId,
    isNew: false,
    inputsPath,
    usingBlueprint: blueprintPath,
    pendingArtefacts: options.pendingArtefacts,
    logger,
    notifications: options.notifications,
  });

  if (options.dryRun) {
    logger.debug?.('edit.dryrun.plan.debug', {
      pendingInputs: planResult.inputEvents.length,
      layers: planResult.plan.layers.map((layer) => layer.length),
    });
  }

  const hasJobs = planResult.plan.layers.some((layer) => layer.length > 0);
  const nonInteractive = options.mode === 'log' ? Boolean(options.nonInteractive) : false;
  if (options.nonInteractive && options.mode === 'tui') {
    throw new Error('--non-interactive is only supported in log mode.');
  }

  // Interactive confirmation (skip if dry-run, non-interactive, or no work to perform)
  if (hasJobs && !options.dryRun && !nonInteractive) {
    const confirmed =
      options.mode === 'tui'
        ? await confirmPlanWithInk({
            plan: planResult.plan,
            concurrency,
            upToLayer,
          })
        : await confirmPlanExecution(planResult.plan, {
            inputs: planResult.inputEvents,
            concurrency,
            upToLayer,
            logger,
          });
    if (!confirmed) {
      await cleanupPlanFiles(movieDir);
      logger.info('\nExecution cancelled.');
      logger.info('Tip: Run with --dryrun to see what would happen without executing.');
      options.notifications?.publish({
        type: 'warning',
        message: 'Execution cancelled.',
        timestamp: new Date().toISOString(),
      });
      return {
        storageMovieId,
        planPath: planResult.planPath,
        targetRevision: planResult.targetRevision,
        dryRun: undefined,
        build: undefined,
        manifestPath: undefined,
        storagePath: movieDir,
      };
    }
  }

  if (options.dryRun) {
    options.onExecutionStart?.();
    options.notifications?.publish({
      type: 'progress',
      message: 'Starting dry run...',
      timestamp: new Date().toISOString(),
    });
  }
  const dryRun = options.dryRun
    ? await executeDryRun({
        movieId: storageMovieId,
        plan: planResult.plan,
        manifest: planResult.manifest,
        manifestHash: planResult.manifestHash,
        providerOptions: planResult.providerOptions,
        resolvedInputs: planResult.resolvedInputs,
        concurrency,
        storage: { rootDir: storageRoot, basePath },
        logger,
        notifications: options.notifications,
      })
    : undefined;
  if (options.dryRun && dryRun) {
    options.notifications?.publish({
      type: dryRun.status === 'succeeded' ? 'success' : 'error',
      message: `Dry run ${dryRun.status}.`,
      timestamp: new Date().toISOString(),
    });
  }
  let buildResult: Awaited<ReturnType<typeof executeBuild>> | undefined;
  if (!options.dryRun) {
    options.onExecutionStart?.();
    options.notifications?.publish({
      type: 'progress',
      message: 'Starting live run...',
      timestamp: new Date().toISOString(),
    });
    buildResult = await executeBuild({
      cliConfig,
      movieId: storageMovieId,
      plan: planResult.plan,
      manifest: planResult.manifest,
      manifestHash: planResult.manifestHash,
      providerOptions: planResult.providerOptions,
      resolvedInputs: planResult.resolvedInputs,
      logger,
      concurrency,
      upToLayer,
      notifications: options.notifications,
    });
    options.notifications?.publish({
      type: buildResult.summary.status === 'succeeded' ? 'success' : 'error',
      message: `Run ${buildResult.summary.status}.`,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    storageMovieId,
    planPath: planResult.planPath,
    targetRevision: planResult.targetRevision,
    dryRun,
    build: buildResult?.summary,
    manifestPath: buildResult?.manifestPath,
    storagePath: movieDir,
  };
}

export interface InteractiveEditOptions {
  movieId: string;
  usingBlueprint?: string;
}

export interface InteractiveEditResult {
  workspaceDir: string;
  state: WorkspaceState;
}

export async function runInteractiveEditSetup(options: InteractiveEditOptions): Promise<InteractiveEditResult> {
  const cliConfig = await readCliConfig();
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  if (!options.movieId) {
    throw new Error('Movie ID is required for interactive edit.');
  }

  const storageMovieId = formatMovieId(options.movieId);
  const blueprintOverride = options.usingBlueprint
    ? await resolveBlueprintSpecifier(options.usingBlueprint, { cliRoot: cliConfig.storage.root })
    : undefined;
  const result = await exportWorkspace({
    cliConfig,
    movieId: storageMovieId,
    blueprintOverride,
  });
  return result;
}

export interface WorkspaceSubmitOptions {
  movieId: string;
  dryRun?: boolean;
  nonInteractive?: boolean;
  usingBlueprint?: string;
  concurrency?: number;
  upToLayer?: number;
  mode: CliLoggerMode;
  notifications?: NotificationBus;
  logger?: Logger;
}

export interface WorkspaceSubmitResult {
  workspaceDir: string;
  state: WorkspaceState;
  edit?: EditResult;
  changesApplied: boolean;
}

export async function runWorkspaceSubmit(options: WorkspaceSubmitOptions): Promise<WorkspaceSubmitResult> {
  const cliConfig = await readCliConfig();
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  if (!options.movieId) {
    throw new Error('Movie ID is required for submit.');
  }

  const storageMovieId = formatMovieId(options.movieId);
  const logger = options.logger ?? globalThis.console;
  const workspaceDir = resolve(cliConfig.storage.root, 'workspaces', storageMovieId);
  const state = await readWorkspaceState(workspaceDir).catch((error) => {
    throw new Error(
      `Workspace not found for ${storageMovieId}. Run "renku edit --movieId ${storageMovieId} --interactive-edit" first.\n${error instanceof Error ? error.message : String(error)}`,
    );
  });

  const diff = await diffWorkspace(state, workspaceDir);
  if (!diff.inputsChanged && diff.artefacts.length === 0) {
    logger.info('No edits detected in workspace. Nothing to submit.');
    return { workspaceDir, state, changesApplied: false };
  }

  printWorkspaceSummary(diff, workspaceDir, logger);

  const inputsPath = resolve(workspaceDir, state.inputs.file);
  const pendingArtefacts = await buildPendingArtefactDrafts({
    cliConfig,
    movieId: storageMovieId,
    changes: diff.artefacts,
  });

  const blueprintSource = options.usingBlueprint ?? state.blueprintPath;
  if (!blueprintSource) {
    throw new Error(
      'No blueprint recorded in workspace. Provide --blueprint=/path/to/blueprint.yaml when submitting.',
    );
  }
  const blueprintPath = await resolveBlueprintSpecifier(blueprintSource, {
    cliRoot: cliConfig.storage.root,
  });
  const editResult = await runEdit({
    movieId: storageMovieId,
    inputsPath,
    dryRun: options.dryRun,
    nonInteractive: options.nonInteractive,
    usingBlueprint: blueprintPath,
    pendingArtefacts,
    concurrency: options.concurrency,
    upToLayer: options.upToLayer,
    mode: options.mode,
    notifications: options.notifications,
    logger,
  });

  if (!options.dryRun) {
    await exportWorkspace({
      cliConfig,
      movieId: storageMovieId,
      blueprintOverride: blueprintPath,
    });
  }

  return {
    workspaceDir,
    state,
    edit: editResult,
    changesApplied: true,
  };
}

function printWorkspaceSummary(diff: WorkspaceDiffResult, workspaceDir: string, logger: Logger): void {
  logger.info('Detected workspace edits:');
  if (diff.inputsChanged) {
    logger.info(`- Inputs updated (${workspaceDir}/${WORKSPACE_INPUTS_RELATIVE_PATH})`);
  }
  for (const change of diff.artefacts) {
    logger.info(`- Artefact ${change.entry.id} (${resolve(workspaceDir, change.entry.file)})`);
  }
}

async function buildPendingArtefactDrafts(args: {
  cliConfig: CliConfig;
  movieId: string;
  changes: WorkspaceArtefactChange[];
}): Promise<PendingArtefactDraft[]> {
  const pending: PendingArtefactDraft[] = [];
  for (const change of args.changes) {
    const data = change.mimeType?.startsWith('text/')
      ? Buffer.from(await readFile(change.absolutePath, 'utf8'), 'utf8')
      : await readFile(change.absolutePath);
    const blobRef = await persistWorkspaceBlob({
      cliConfig: args.cliConfig,
      movieId: args.movieId,
      data,
      mimeType: change.mimeType ?? 'application/octet-stream',
    });
    pending.push({
      artefactId: change.entry.id,
      producedBy: 'workspace-edit',
      output: {
        blob: blobRef,
      },
      diagnostics: { source: 'workspace' },
    });
  }
  return pending;
}
