import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { getDefaultCliConfigPath, getProjectLocalStorage, readCliConfig, type CliConfig } from '../lib/cli-config.js';
import { resolveTargetMovieId } from '../lib/movie-id-utils.js';
import { displayPlanExplanation } from '../lib/plan-display.js';
import {
  createStorageContext,
  createBuildStateService,
  createEventLog,
  planStore,
  createRuntimeError,
  RuntimeErrorCode,
  type BuildState,
  type ExecutionPlan,
  type PlanExplanation,
  type Logger,
  type RevisionId,
} from '@gorenku/core';

export interface ExplainOptions {
  /** Explicit movie ID to explain */
  movieId?: string;
  /** Optional: specific revision to explain (defaults to latest) */
  revision?: string;
  /** Logger instance */
  logger?: Logger;
}

export interface ExplainResult {
  movieId: string;
  revision: string;
  explanation: PlanExplanation;
}

/**
 * Explain a previously saved plan from disk.
 * Reconstructs the explanation from the saved plan and build state.
 */
export async function runExplain(options: ExplainOptions): Promise<ExplainResult> {
  const logger = options.logger ?? globalThis.console;
  const configPath = getDefaultCliConfigPath();
  const globalConfig = await readCliConfig(configPath);

  if (!globalConfig) {
    throw createRuntimeError(
      RuntimeErrorCode.CLI_CONFIG_MISSING,
      'Renku CLI is not initialized. Run "renku init" first.',
      {
        suggestion: 'Initialize your workspace with: renku init --root=<path>',
      }
    );
  }

  // Use project-local storage (cwd) while preserving catalog from global config
  const projectStorage = getProjectLocalStorage();
  const activeConfig: CliConfig = {
    ...globalConfig,
    storage: projectStorage,
  };

  const storageMovieId = resolveTargetMovieId({
    explicitMovieId: options.movieId,
  });

  const storageRoot = activeConfig.storage.root;
  const basePath = activeConfig.storage.basePath;
  const movieDir = resolve(storageRoot, basePath, storageMovieId);

  // Create storage context
  const storageContext = createStorageContext({
    kind: 'local',
    rootDir: storageRoot,
    basePath,
  });

  // Load build state
  const buildStateService = createBuildStateService(storageContext);
  let buildState: BuildState;
  try {
    const { buildState: loadedBuildState } = await buildStateService.loadCurrent(storageMovieId);
    buildState = loadedBuildState;
  } catch (error) {
    throw createRuntimeError(
      RuntimeErrorCode.BUILD_STATE_NOT_FOUND,
      `No build state found for movie "${storageMovieId}". The movie may not have completed a run.`,
      {
        cause: error,
        suggestion: 'Run generation for this movie before using explain.',
      }
    );
  }

  // Determine the revision to explain
  let revision: RevisionId | undefined = options.revision as RevisionId | undefined;
  if (!revision) {
    // Find the latest plan file
    const latestRevision = await findLatestPlanRevision(movieDir);
    if (!latestRevision) {
      throw createRuntimeError(
        RuntimeErrorCode.PLAN_NOT_FOUND,
        `No plan files found for movie "${storageMovieId}".`,
        {
          suggestion: 'Run generation for this movie first so a plan revision exists.',
        }
      );
    }
    revision = latestRevision;
  }

  // Load the plan
  const plan = await planStore.load(storageMovieId, revision, storageContext);
  if (!plan) {
    throw createRuntimeError(
      RuntimeErrorCode.PLAN_NOT_FOUND,
      `Plan revision "${revision}" not found for movie "${storageMovieId}".`,
      {
        suggestion: 'List available revisions and retry with an existing --revision value.',
      }
    );
  }

  // Load event log for dirty detection
  const eventLog = createEventLog(storageContext);

  // Reconstruct the explanation from the plan and build state
  const explanation = await reconstructExplanation({
    movieId: storageMovieId,
    plan,
    buildState,
    eventLog,
    logger,
  });

  // Display the explanation
  displayPlanExplanation({ explanation, logger });

  return {
    movieId: storageMovieId,
    revision,
    explanation,
  };
}

/**
 * Find the latest plan revision in the movie's runs directory.
 */
async function findLatestPlanRevision(movieDir: string): Promise<RevisionId | null> {
  const runsDir = resolve(movieDir, 'runs');

  try {
    const files = await readdir(runsDir);
    const planFiles = files
      .filter((f) => f.endsWith('-plan.json') && f.startsWith('rev-'))
      .map((f) => f.replace('-plan.json', '') as RevisionId)
      .sort((a, b) => {
        // Sort by revision number (rev-0001, rev-0002, etc.)
        const numA = parseInt(a.replace('rev-', ''), 10);
        const numB = parseInt(b.replace('rev-', ''), 10);
        return numB - numA; // Descending order
      });

    return planFiles[0] ?? null;
  } catch {
    return null;
  }
}

interface ReconstructExplanationArgs {
  movieId: string;
  plan: ExecutionPlan;
  buildState: BuildState;
  eventLog: ReturnType<typeof createEventLog>;
  logger: Logger;
}

/**
 * Reconstruct plan explanation from a saved plan and build state.
 * This is a simplified version that shows what jobs are in the plan.
 * For full dirty detection details, use `renku generate --explain`.
 */
async function reconstructExplanation(args: ReconstructExplanationArgs): Promise<PlanExplanation> {
  const { movieId, plan } = args;

  // Extract job information from the plan
  const allJobs = plan.layers.flat();
  const jobReasons = allJobs.map((job) => ({
    jobId: job.jobId,
    producer: job.producer,
    reason: 'initial' as const, // We can't fully reconstruct the reason from a saved plan
  }));

  // We can't fully reconstruct dirty inputs/artifacts from a saved plan,
  // but we can show the jobs that were scheduled
  return {
    movieId,
    revision: plan.revision,
    dirtyInputs: [], // Not available from saved plan
    dirtyArtifacts: [], // Not available from saved plan
    jobReasons,
    initialDirtyJobs: allJobs.map((job) => job.jobId),
    propagatedJobs: [],
    surgicalTargets: undefined, // Not stored in plan
  };
}
