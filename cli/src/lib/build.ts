import { resolve as resolvePath } from 'node:path';
import {
	createEventLog,
	createBuildStateService,
	createRunLifecycleService,
	createStorageContext,
	initializeMovieStorage,
	resolveBlobRefsToInputs,
	injectAllSystemInputs,
	executePlanWithConcurrency,
	readLlmInvocationSettings,
	type BuildState,
	type ExecutionPlan,
	type ExecutionState,
	type RunResult,
	type Logger,
	type ProducerOptionsMap,
} from '@gorenku/core';
import {
	createProviderRegistry,
	createProviderProduce,
	prepareProviderHandlers,
	type LoadedModelCatalog,
	type ConditionHints,
} from '@gorenku/providers';
import type { CliConfig } from './cli-config.js';
import { normalizeConcurrency } from './cli-config.js';
import chalk from 'chalk';

export interface ExecuteBuildOptions {
	cliConfig: CliConfig;
	movieId: string;
	plan: ExecutionPlan;
	buildState: BuildState;
	baselineHash: string | null;
	executionState?: ExecutionState;
	providerOptions: ProducerOptionsMap;
	resolvedInputs: Record<string, unknown>;
	/** Pre-loaded model catalog for provider registry. */
	catalog?: LoadedModelCatalog;
	/** Path to the catalog models directory. Required for schema loading in delegation. */
	catalogModelsDir?: string;
	concurrency?: number;
	/** Layer to stop at (only used when dryRun=false). */
	upToLayer?: number;
	/** Explicit regeneration targets (canonical Artifact:/Producer: IDs). */
	regenerateIds?: string[];
	/** Enable dry-run mode: simulated providers, no S3 uploads. */
	dryRun?: boolean;
	/** Persist run lifecycle events for this execution attempt. */
	persistRunLifecycle?: boolean;
	/** Condition hints for dry-run simulation (controls value alternation). */
	conditionHints?: ConditionHints;
	logger?: Logger;
	notifications?: import('@gorenku/core').NotificationBus;
}

export interface JobSummary {
	jobId: string;
	producer: string;
	status: 'succeeded' | 'failed' | 'skipped';
	layerIndex: number;
	errorMessage?: string;
}

export interface BuildSummary {
	status: RunResult['status'];
	jobCount: number;
	counts: {
		succeeded: number;
		failed: number;
		skipped: number;
	};
	/** Number of layers in the execution plan */
	layers: number;
	/** Job-level details for display (optional) */
	jobs?: JobSummary[];
	revision: string;
	runLogPath: string;
}

export interface ExecuteBuildResult {
	run: RunResult;
	buildState: BuildState;
	runLogPath: string;
	baselineHash: string;
	summary: BuildSummary;
	/** True if this was a dry-run (simulated execution). */
	dryRun: boolean;
}

export async function executeBuild(
	options: ExecuteBuildOptions
): Promise<ExecuteBuildResult> {
	const { dryRun = false } = options;
	const persistRunLifecycle = options.persistRunLifecycle ?? true;
	const logger = options.logger ?? globalThis.console;
	const notifications = options.notifications;
	const storage = createStorageContext({
		kind: 'local',
		rootDir: options.cliConfig.storage.root,
		basePath: options.cliConfig.storage.basePath,
	});
	const concurrency = normalizeConcurrency(options.concurrency);

	await initializeMovieStorage(storage, options.movieId);

	const eventLog = createEventLog(storage);
	const buildStateService = createBuildStateService(storage);
	const runLifecycleService = createRunLifecycleService(storage);
	const executionStartedAt = new Date().toISOString();
	if (persistRunLifecycle) {
		await runLifecycleService.appendStarted(options.movieId, {
			type: 'run-started',
			revision: options.plan.revision,
			startedAt: executionStartedAt,
			runConfig: {
				...(options.upToLayer !== undefined
					? { upToLayer: options.upToLayer }
					: {}),
				...(options.regenerateIds && options.regenerateIds.length > 0
					? { regenerateIds: options.regenerateIds }
					: {}),
				...(dryRun ? { dryRun: true } : {}),
				...(concurrency !== undefined ? { concurrency } : {}),
			},
		});
	}

	try {
		// Provider registry: mode differs based on dryRun flag
		const registry = createProviderRegistry({
			mode: dryRun ? 'simulated' : 'live',
			logger,
			notifications,
			catalog: options.catalog,
			catalogModelsDir: options.catalogModelsDir,
		});
		const preResolved = prepareProviderHandlers(
			registry,
			options.plan,
			options.providerOptions
		);
		await registry.warmStart?.(preResolved);

		// Resolve BlobRef objects to BlobInput format for provider execution
		// BlobRefs are stored in inputs.log for efficiency, but providers need actual blob data
		const resolvedInputsWithBlobs = (await resolveBlobRefsToInputs(
			storage,
			options.movieId,
			options.resolvedInputs
		)) as Record<string, unknown>;

		// Inject all system inputs (base and derived)
		const resolvedInputsWithSystem = injectAllSystemInputs(
			resolvedInputsWithBlobs,
			options.movieId,
			options.cliConfig.storage.root,
			options.cliConfig.storage.basePath
		);

		const produce = createProviderProduce(
			registry,
			options.providerOptions,
			resolvedInputsWithSystem,
			preResolved,
			logger,
			notifications,
			options.conditionHints,
			await readLlmInvocationSettings()
		);

		const run = await executePlanWithConcurrency(
			options.plan,
			{
				movieId: options.movieId,
				buildState: options.buildState,
				executionState: options.executionState,
				storage,
				eventLog,
				produce,
				logger,
				notifications,
			},
			{
				concurrency,
				upToLayer: options.upToLayer,
				onProgress: (event) => {
					// Log progress events with chalk formatting
					if (event.type === 'layer-empty') {
						logger.info?.(`${chalk.dim(`--- ${event.message} ---`)}\n`);
					} else if (event.type === 'layer-start') {
						logger.info?.(`${chalk.blue(`--- ${event.message} ---`)}\n`);
					} else if (event.type === 'layer-complete') {
						logger.info?.(`\n${chalk.blue(`--- ${event.message} ---`)}\n`);
					}
				},
			}
		);

		const buildState = await buildStateService.buildFromEvents({
			movieId: options.movieId,
			targetRevision: run.revision,
			baseRevision: options.buildState.revision,
		});

		const runLogPath = resolvePath(
			options.cliConfig.storage.root,
			storage.resolve(options.movieId, 'events', 'runs.log')
		);
		const summary = summarizeRun(run, runLogPath, options.plan);
		if (persistRunLifecycle) {
			await runLifecycleService.appendCompleted(options.movieId, {
				type: 'run-completed',
				revision: run.revision,
				completedAt: run.completedAt,
				status: run.status,
				summary: {
					jobCount: summary.jobCount,
					counts: summary.counts,
					layers: summary.layers,
				},
			});
		}

		// Log warning if build had failures
		if (run.status === 'failed') {
			const failedJobs = run.jobs.filter((j) => j.status === 'failed');
			logger.warn?.(
				`Build completed with ${failedJobs.length} failed job(s). ` +
					`Run history saved - you can retry with: renku generate --movie-id=${options.movieId.replace('movie-', '')} --in=<inputs.yaml>`
			);
		}

		return {
			run,
			buildState,
			runLogPath,
			baselineHash: run.baselineHash,
			summary: {
				...summary,
			},
			dryRun,
		};
	} catch (error) {
		if (persistRunLifecycle) {
			await runLifecycleService.appendCompleted(options.movieId, {
				type: 'run-completed',
				revision: options.plan.revision,
				completedAt: new Date().toISOString(),
				status: 'failed',
				summary: {
					jobCount: options.plan.layers.reduce(
						(total, layer) => total + layer.length,
						0
					),
					counts: {
						succeeded: 0,
						failed: 0,
						skipped: 0,
					},
					layers: options.plan.layers.length,
				},
			});
		}
		throw error;
	}
}

function summarizeRun(
	run: RunResult,
	runLogPath: string,
	plan: ExecutionPlan
): BuildSummary {
	const counts = {
		succeeded: 0,
		failed: 0,
		skipped: 0,
	};

	const jobs: JobSummary[] = [];

	for (const job of run.jobs) {
		if (job.status === 'failed') {
			counts.failed += 1;
		} else if (job.status === 'skipped') {
			counts.skipped += 1;
		} else {
			counts.succeeded += 1;
		}

		jobs.push({
			jobId: job.jobId,
			producer: job.producer,
			status: job.status,
			layerIndex: job.layerIndex,
			errorMessage: job.error?.message,
		});
	}

	return {
		status: run.status,
		jobCount: run.jobs.length,
		counts,
		layers: plan.layers.length,
		jobs,
		revision: run.revision,
		runLogPath,
	};
}
