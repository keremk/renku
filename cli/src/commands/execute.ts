import { dirname, isAbsolute, join, resolve } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
	getDefaultCliConfigPath,
	readCliConfig,
	type CliConfig,
} from '../lib/cli-config.js';
import { generatePlan, type PendingArtifactDraft } from '../lib/planner.js';
import { executeBuild, type BuildSummary } from '../lib/build.js';
import { expandPath } from '../lib/path.js';
import { confirmPlanExecution } from '../lib/interactive-confirm.js';
import {
	displayPlanAndCosts,
	displayPlanExplanation,
} from '../lib/plan-display.js';
import { resolveBlueprintSpecifier } from '../lib/config-assets.js';
import { resolveAndPersistConcurrency } from '../lib/concurrency.js';
import { cleanupPartialRunDirectory } from '../lib/cleanup.js';
import {
	buildBlueprintValidationCases,
	commitExecutionDraft,
	conditionAnalysisToVaryingHints,
	parseBlueprintValidationScenario,
	readBlobFromStorage,
	runBlueprintDryRunValidation,
	type BlueprintValidationScenarioFile,
	type BlueprintDryRunValidationResult,
	copyBlobsFromMemoryToLocal,
	createStorageContext,
	createMovieMetadataService,
	initializeMovieStorage,
	type ExecutionPlan,
	type Logger,
	type RunConfig,
	type RootOutputBinding,
} from '@gorenku/core';

/**
 * Unified execution options supporting both new and existing movies.
 */
export interface ExecuteOptions {
	/** Storage movie ID (e.g., "movie-abc123") */
	storageMovieId: string;

	/** Public movie ID for new movies (e.g., "abc123") */
	movieId?: string;

	/** Whether this is a new movie (true) or edit of existing (false) */
	isNew: boolean;

	/** Path to inputs YAML file (required for both new and edit) */
	inputsPath?: string;

	/** Blueprint specifier - used only for new movies, ignored for edits */
	blueprintSpecifier?: string;

	/** Pending artifacts for partial re-rendering (edit only) */
	pendingArtifacts?: PendingArtifactDraft[];

	/** Run in dry-run mode (simulate without executing) */
	dryRun?: boolean;

	/** Skip interactive confirmation */
	nonInteractive?: boolean;

	/** Show costs and exit without executing */
	costsOnly?: boolean;

	/** Generate plan, display explanation, and exit without executing */
	explain?: boolean;

	/** Number of concurrent jobs */
	concurrency?: number;

	/** Canonical planning controls from the CLI adapter. */
	planningControls?: import('@gorenku/core').PlanningUserControls;

	/** Optional dry-run profile path (alias: --profile). */
	dryRunProfilePath?: string;

	/** Persist an inspectable dry-run snapshot into a temp folder. */
	saveDryRun?: boolean;

	/** Logger instance */
	logger: Logger;

	/**
	 * CLI config to use for storage paths.
	 * If provided, uses this config instead of reading from global config file.
	 * This allows generate.ts to pass project-local storage configuration.
	 */
	cliConfig?: CliConfig;
}

/**
 * Unified execution result.
 */
export interface ExecuteResult {
	/** Public movie ID (without "movie-" prefix) */
	movieId: string;

	/** Storage movie ID (with "movie-" prefix) */
	storageMovieId: string;

	/** Path to the saved plan JSON. Dry-runs use a transient plan file unless a temp snapshot was saved. */
	planPath?: string;

	/** Plan revision string for a committed execution. */
	targetRevision?: string;

	/** Build summary (available for both dry-run and live execution) */
	build?: BuildSummary;

	/** Whether this was a dry-run execution */
	isDryRun?: boolean;

	/** Dry-run validation coverage summary (present for dry-runs). */
	dryRunValidation?: BlueprintDryRunValidationResult;

	/** Path to the workspace movie storage directory. Dry-runs may leave this path untouched. */
	storagePath: string;

	/** Exact root Output:... connector bindings captured on the plan. */
	rootOutputBindings?: RootOutputBinding[];

	/** Producer:... job IDs belonging to the terminal producer layer of the full blueprint graph. */
	finalStageProducerJobIds?: string[];

	/** Resolved canonical input values used for planning and execution. */
	resolvedInputs: Record<string, unknown>;

	/** Whether cleanup was performed on cancel/costs-only */
	cleanedUp?: boolean;

	/** Temp folder containing an inspectable saved dry-run snapshot. */
	savedDryRunPath?: string;
}

/**
 * Unified execution function that handles both new movies and edits.
 *
 * Consolidates the shared logic from runEdit() and runQuery() into a single
 * parametric function. The `isNew` flag controls blueprint resolution and cleanup behavior.
 */
export async function runExecute(
	options: ExecuteOptions
): Promise<ExecuteResult> {
	const configPath = getDefaultCliConfigPath();

	// Use provided config if available, otherwise read from global config file
	let cliConfig: CliConfig;
	let concurrency: number;

	if (options.cliConfig) {
		// Config was provided by caller (e.g., generate.ts), which already resolved concurrency
		// Don't call resolveAndPersistConcurrency again to avoid rewriting config unexpectedly
		cliConfig = options.cliConfig;
		concurrency = options.concurrency ?? cliConfig.concurrency ?? 1;
	} else {
		const globalConfig = await readCliConfig(configPath);
		if (!globalConfig) {
			throw new Error('Renku CLI is not initialized. Run "renku init" first.');
		}
		const resolved = await resolveAndPersistConcurrency(globalConfig, {
			override: options.concurrency,
			configPath,
		});
		cliConfig = resolved.cliConfig;
		concurrency = resolved.concurrency;
	}

	const { storageMovieId, isNew, logger } = options;
	const storageRoot = cliConfig.storage.root;
	const basePath = cliConfig.storage.basePath;
	const movieDir = resolve(storageRoot, basePath, storageMovieId);
	const planningControls = options.planningControls;
	const upToLayer = planningControls?.scope?.upToLayer;
	const regenerateIds = planningControls?.surgical?.regenerateIds;

	// Resolve inputs path - always required (contains model selections)
	const inputsPath = resolveInputsPath(options.inputsPath);

	// Resolve blueprint path
	const blueprintPath = await resolveBlueprintPath({
		specifier: options.blueprintSpecifier,
		movieDir,
		cliRoot: storageRoot,
		basePath,
		storageMovieId,
		isNew,
	});

	// Generate plan
	const planResult = await generatePlan({
		cliConfig,
		movieId: storageMovieId,
		isNew,
		inputsPath,
		usingBlueprint: blueprintPath,
		pendingArtifacts: options.pendingArtifacts,
		logger,
		planningControls,
		collectExplanation: options.explain,
	});

	if (planResult.warnings && planResult.warnings.length > 0) {
		for (const warning of planResult.warnings) {
			logger.warn?.(`Planning warning: ${warning.message}`);
		}
	}

	if (options.dryRun) {
		logger.debug?.('execute.dryrun.plan.debug', {
			pendingInputs: planResult.inputEvents.length,
			layers: planResult.plan.layers.map((layer) => layer.length),
		});
	}

	const hasJobs = planResult.plan.layers.some((layer) => layer.length > 0);
	const nonInteractive = Boolean(options.nonInteractive);

	// Handle --costs-only: display plan summary and costs, then return early
	if (options.costsOnly) {
		return handleCostsOnly({
			planResult,
			storageMovieId,
			movieDir,
			storageRoot,
			basePath,
			isNew,
			logger,
			movieId: options.movieId,
		});
	}

	// Handle --explain: display plan explanation, then return early
	if (options.explain) {
		return handleExplain({
			planResult,
			storageMovieId,
			movieDir,
			storageRoot,
			basePath,
			isNew,
			logger,
			movieId: options.movieId,
		});
	}

	// For edits with no jobs, skip confirmation entirely
	const skipConfirmation = nonInteractive || options.dryRun || (!isNew && !hasJobs);

	// Interactive confirmation
	if (!skipConfirmation) {
		const confirmed = await confirmPlanExecution(planResult.plan, {
			inputs: planResult.inputEvents,
			concurrency,
			upToLayer,
			logger,
			costSummary: planResult.costSummary,
			surgicalMode: planResult.surgicalInfo,
		});

		if (!confirmed) {
			return handleCancellation({
				planResult,
				storageMovieId,
				movieDir,
				storageRoot,
				basePath,
				isNew,
				logger,
				movieId: options.movieId,
			});
		}

	}

	const runConfig = {
		...(upToLayer !== undefined ? { upToLayer } : {}),
		...(regenerateIds && regenerateIds.length > 0
			? { regenerateIds }
			: {}),
		...(options.dryRun ? { dryRun: true } : {}),
		...(concurrency !== undefined ? { concurrency } : {}),
	};

	let committedPlan:
		| Awaited<ReturnType<typeof planResult.persist>>
		| undefined;
	if (!options.dryRun) {
		committedPlan = await planResult.persist({ runConfig });
	}

	let mainResult: ExecuteResult | undefined;
	let cleanedUp = false;
	try {
		const { buildResult, dryRunValidation } = options.dryRun
			? await executeDryRunWithValidation({
					cliConfig,
					storageMovieId,
					blueprintPath,
					inputsPath,
					planResult,
					runConfig,
					concurrency,
					upToLayer,
					regenerateIds,
					dryRunProfilePath: options.dryRunProfilePath,
					saveDryRun: options.saveDryRun,
					logger,
				})
			: {
					buildResult: await executeBuild({
						cliConfig,
						movieId: storageMovieId,
						plan: committedPlan!.plan,
						buildState: planResult.buildState,
						baselineHash: planResult.baselineHash,
						executionState: planResult.executionState,
						providerOptions: planResult.providerOptions,
						resolvedInputs: planResult.resolvedInputs,
						catalog: planResult.modelCatalog,
						catalogModelsDir: planResult.catalogModelsDir,
						logger,
						concurrency,
						upToLayer,
						regenerateIds,
						dryRun: false,
					}),
					dryRunValidation: undefined,
				};

		const transientPlanPath = options.dryRun
			? await writeTransientPlanFile({
					movieId: storageMovieId,
					plan: planResult.plan,
				})
			: undefined;

		mainResult = {
			movieId: options.movieId ?? normalizePublicId(storageMovieId),
			storageMovieId,
			planPath:
				committedPlan?.planPath ??
				(options.dryRun && 'planPath' in buildResult
					? buildResult.planPath ?? transientPlanPath
					: transientPlanPath),
			targetRevision: committedPlan?.targetRevision,
			build: buildResult.summary,
			isDryRun: buildResult.dryRun,
			dryRunValidation,
			storagePath: movieDir,
			rootOutputBindings: planResult.plan.rootOutputBindings,
			finalStageProducerJobIds: planResult.plan.finalStageProducerJobIds,
			resolvedInputs: planResult.resolvedInputs,
			savedDryRunPath:
				options.dryRun && 'savedDryRunPath' in buildResult
					? buildResult.savedDryRunPath
					: undefined,
		};
	} finally {
		if (options.dryRun) {
			cleanedUp = await cleanupPartialRunDirectory({
				storageRoot,
				basePath,
				movieId: storageMovieId,
				isNew,
			});
		}
	}

	if (!mainResult) {
		throw new Error('Execution completed without producing a result.');
	}

	return {
		...mainResult,
		cleanedUp: options.dryRun ? cleanedUp : mainResult.cleanedUp,
	};
}

async function writeTransientPlanFile(args: {
	movieId: string;
	plan: ExecutionPlan;
}): Promise<string> {
	const tempDir = await mkdtemp(join(tmpdir(), 'renku-plan-'));
	const planPath = join(tempDir, `${args.movieId}-plan.json`);
	await writeFile(planPath, JSON.stringify(args.plan, null, 2), 'utf8');
	return planPath;
}

async function executeDryRunWithValidation(args: {
	cliConfig: CliConfig;
	storageMovieId: string;
	blueprintPath: string;
	inputsPath: string;
	planResult: Awaited<ReturnType<typeof generatePlan>>;
	runConfig: RunConfig;
	concurrency: number;
	upToLayer?: number;
	regenerateIds?: string[];
	dryRunProfilePath?: string;
	saveDryRun?: boolean;
	logger: Logger;
}): Promise<{
	buildResult: Awaited<ReturnType<typeof executeBuild>> & {
		planPath?: string;
		savedDryRunPath?: string;
	};
	dryRunValidation: BlueprintDryRunValidationResult;
}> {
	const silentValidationLogger: Logger = {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
	};

	const conditionAnalysis = args.planResult.conditionAnalysis;
	if (!conditionAnalysis) {
		throw new Error(
			'Dry-run validation requires condition analysis, but none was generated for this plan.'
		);
	}

	const loadedScenario = args.dryRunProfilePath
		? await loadDryRunScenarioFile(args.dryRunProfilePath)
		: undefined;

	if (loadedScenario?.scenario.blueprint) {
		const scenarioBlueprintPath = resolvePathFromInput(
			loadedScenario.scenario.blueprint,
			dirname(loadedScenario.path)
		);
		if (resolve(scenarioBlueprintPath) !== resolve(args.blueprintPath)) {
			throw new Error(
				`Dry-run profile blueprint path mismatch. Expected ${args.blueprintPath}, received ${scenarioBlueprintPath}.`
			);
		}
	}

	if (loadedScenario?.scenario.inputs) {
		const scenarioInputsPath = resolvePathFromInput(
			loadedScenario.scenario.inputs,
			dirname(loadedScenario.path)
		);
		if (resolve(scenarioInputsPath) !== resolve(args.inputsPath)) {
			throw new Error(
				`Dry-run profile inputs path mismatch. Expected ${args.inputsPath}, received ${scenarioInputsPath}.`
			);
		}
	}

	const varyingHints = conditionAnalysisToVaryingHints(conditionAnalysis);
	const cases = buildBlueprintValidationCases({
		scenario: loadedScenario?.scenario,
		baseVaryingHints: varyingHints,
	});

	let baselineHashCursor = args.planResult.baselineHash;
	let primaryBuildResult: Awaited<ReturnType<typeof executeBuild>> | undefined;
	const validationStorage = await createTransientDryRunStorageContext({
		cliConfig: args.cliConfig,
		storageMovieId: args.storageMovieId,
		blueprintPath: args.blueprintPath,
		planResult: args.planResult,
	});

	try {
		const executeDryRunBuild = async (
			conditionHints = args.planResult.conditionHints,
			baselineHash = baselineHashCursor,
			logger = args.logger
		) =>
			executeBuild({
				cliConfig: args.cliConfig,
				movieId: args.storageMovieId,
				plan: args.planResult.plan,
				buildState: args.planResult.buildState,
				baselineHash,
				executionState: args.planResult.executionState,
				providerOptions: args.planResult.providerOptions,
				resolvedInputs: args.planResult.resolvedInputs,
				catalog: args.planResult.modelCatalog,
				catalogModelsDir: args.planResult.catalogModelsDir,
				logger,
				concurrency: args.concurrency,
				upToLayer: args.upToLayer,
				regenerateIds: args.regenerateIds,
				dryRun: true,
				persistRunLifecycle: false,
				storageContext: validationStorage.storageContext,
				systemStorageRoot: validationStorage.tempRoot,
				systemStorageBasePath: 'builds',
				conditionHints,
			});

		const dryRunValidation = await runBlueprintDryRunValidation({
			conditionAnalysis,
			cases,
			sourceTestFilePath: loadedScenario?.path,
			executeCase: async ({ caseDefinition, caseIndex }) => {
				const buildResult = await executeDryRunBuild(
					caseDefinition.conditionHints ?? args.planResult.conditionHints,
					baselineHashCursor,
					silentValidationLogger
				);

				baselineHashCursor = buildResult.baselineHash;
				if (caseIndex === 0) {
					primaryBuildResult = buildResult;
				}

				return {
					movieId: args.storageMovieId,
					failedJobs: collectFailedJobsFromSummary(buildResult.summary),
					artifactIds: Object.keys(buildResult.buildState.artifacts),
					readArtifactText: async (artifactId: string): Promise<string> => {
						const entry = buildResult.buildState.artifacts[artifactId];
						if (!entry) {
							throw new Error(
								`Missing build-state artifact ${artifactId} in dry-run case ${caseDefinition.id}.`
							);
						}
						if (!entry.blob) {
							throw new Error(
								`Expected blob content for ${artifactId} in dry-run case ${caseDefinition.id}.`
							);
						}

						const blob = await readBlobFromStorage(
							validationStorage.storageContext,
							args.storageMovieId,
							entry.blob
						);
						return Buffer.from(blob.data).toString('utf8');
					},
				};
			},
		});

		if (cases.length > 1) {
			const baselineCase = cases[0]!;
			const baselineBuildResult = await executeDryRunBuild(
				baselineCase.conditionHints ?? args.planResult.conditionHints,
				baselineHashCursor,
				silentValidationLogger
			);

			baselineHashCursor = baselineBuildResult.baselineHash;
			primaryBuildResult = baselineBuildResult;
		}

		if (!primaryBuildResult) {
			throw new Error('Dry-run validation did not execute a primary case.');
		}

		if (!args.saveDryRun) {
			return {
				buildResult: primaryBuildResult,
				dryRunValidation,
			};
		}

		const primaryConditionHints =
			cases[0]?.conditionHints ?? args.planResult.conditionHints;
		const materializedBuildResult = await persistDryRunSnapshotToTemp({
			cliConfig: args.cliConfig,
			storageMovieId: args.storageMovieId,
			blueprintPath: args.blueprintPath,
			inputsPath: args.inputsPath,
			planResult: args.planResult,
			runConfig: args.runConfig,
			concurrency: args.concurrency,
			upToLayer: args.upToLayer,
			regenerateIds: args.regenerateIds,
			conditionHints: primaryConditionHints,
			logger: silentValidationLogger,
		});
		return {
			buildResult: materializedBuildResult,
			dryRunValidation,
		};
	} finally {
		await rm(validationStorage.tempRoot, { recursive: true, force: true });
	}
}

async function createTransientDryRunStorageContext(args: {
	cliConfig: CliConfig;
	storageMovieId: string;
	blueprintPath: string;
	planResult: Awaited<ReturnType<typeof generatePlan>>;
}): Promise<{
	tempRoot: string;
	storageContext: import('@gorenku/core').StorageContext;
}> {
	const tempRoot = await mkdtemp(join(tmpdir(), 'renku-dry-run-exec-'));
	const workspaceStorageContext = createStorageContext({
		kind: 'local',
		rootDir: args.cliConfig.storage.root,
		basePath: args.cliConfig.storage.basePath,
	});
	const tempStorageContext = createStorageContext({
		kind: 'local',
		rootDir: tempRoot,
		basePath: 'builds',
	});

	await initializeMovieStorage(tempStorageContext, args.storageMovieId);
	await copyRunArchivesBetweenContexts({
		source: workspaceStorageContext,
		target: tempStorageContext,
		movieId: args.storageMovieId,
	});
	await copyEventLogsBetweenContexts({
		source: workspaceStorageContext,
		target: tempStorageContext,
		movieId: args.storageMovieId,
	});
	await copyBlobsBetweenContexts({
		source: workspaceStorageContext,
		target: tempStorageContext,
		movieId: args.storageMovieId,
	});
	const metadataService = createMovieMetadataService(tempStorageContext);
	await metadataService.merge(args.storageMovieId, {
		blueprintPath: args.blueprintPath,
	});
	await copyBlobsFromMemoryToLocal(
		args.planResult.planningStorage,
		tempStorageContext,
		args.storageMovieId
	);

	return {
		tempRoot,
		storageContext: tempStorageContext,
	};
}

async function persistDryRunSnapshotToTemp(args: {
	cliConfig: CliConfig;
	storageMovieId: string;
	blueprintPath: string;
	inputsPath: string;
	planResult: Awaited<ReturnType<typeof generatePlan>>;
	runConfig: RunConfig;
	concurrency: number;
	upToLayer?: number;
	regenerateIds?: string[];
	conditionHints?: import('@gorenku/providers').ConditionHints;
	logger: Logger;
}): Promise<
	Awaited<ReturnType<typeof executeBuild>> & {
		planPath: string;
		savedDryRunPath: string;
	}
> {
	const tempRoot = await mkdtemp(join(tmpdir(), 'renku-dry-run-'));
	const workspaceStorageContext = createStorageContext({
		kind: 'local',
		rootDir: args.cliConfig.storage.root,
		basePath: args.cliConfig.storage.basePath,
	});
	const localStorageContext = createStorageContext({
		kind: 'local',
		rootDir: tempRoot,
		basePath: 'builds',
	});

	await initializeMovieStorage(localStorageContext, args.storageMovieId);
	await copyRunArchivesBetweenContexts({
		source: workspaceStorageContext,
		target: localStorageContext,
		movieId: args.storageMovieId,
	});
	await copyEventLogsBetweenContexts({
		source: workspaceStorageContext,
		target: localStorageContext,
		movieId: args.storageMovieId,
	});
	const metadataService = createMovieMetadataService(localStorageContext);
	await metadataService.merge(args.storageMovieId, {
		blueprintPath: args.blueprintPath,
	});
	await copyBlobsFromMemoryToLocal(
		args.planResult.planningStorage,
		localStorageContext,
		args.storageMovieId
	);

	const inputSnapshotBytes = await readFile(args.inputsPath);
	const committed = await commitExecutionDraft({
		movieId: args.storageMovieId,
		storage: localStorageContext,
		draftPlan: args.planResult.plan,
		draftInputEvents: args.planResult.inputEvents,
		draftArtifactEvents: args.planResult.artifactEvents,
		inputSnapshotContents: inputSnapshotBytes,
		runConfig: args.runConfig,
	});

	const buildResult = await executeBuild({
		cliConfig: args.cliConfig,
		movieId: args.storageMovieId,
		plan: committed.plan,
		buildState: args.planResult.buildState,
		baselineHash: args.planResult.baselineHash,
		executionState: args.planResult.executionState,
		providerOptions: args.planResult.providerOptions,
		resolvedInputs: args.planResult.resolvedInputs,
		catalog: args.planResult.modelCatalog,
		catalogModelsDir: args.planResult.catalogModelsDir,
		logger: args.logger,
		concurrency: args.concurrency,
		upToLayer: args.upToLayer,
		regenerateIds: args.regenerateIds,
		dryRun: true,
		storageContext: localStorageContext,
		systemStorageRoot: tempRoot,
		systemStorageBasePath: 'builds',
		conditionHints: args.conditionHints,
	});

	const savedDryRunPath = resolve(tempRoot, 'builds', args.storageMovieId);
	return {
		...buildResult,
		planPath: resolve(savedDryRunPath, committed.planPath),
		savedDryRunPath,
	};
}

async function copyRunArchivesBetweenContexts(args: {
	source: import('@gorenku/core').StorageContext;
	target: import('@gorenku/core').StorageContext;
	movieId: string;
}): Promise<void> {
	const runsDir = args.source.resolve(args.movieId, 'runs');
	if (!(await args.source.storage.directoryExists(runsDir))) {
		return;
	}

	const listing = args.source.storage.list(runsDir, { deep: true });
	for await (const item of listing) {
		if (item.type !== 'file') {
			continue;
		}
		const content = await args.source.storage.readToUint8Array(item.path);
		await args.target.storage.write(item.path, Buffer.from(content), {
			mimeType: item.path.endsWith('.json')
				? 'application/json'
				: 'application/x-yaml',
		});
	}
}

async function copyEventLogsBetweenContexts(args: {
	source: import('@gorenku/core').StorageContext;
	target: import('@gorenku/core').StorageContext;
	movieId: string;
}): Promise<void> {
	const eventFiles = [
		'events/inputs.log',
		'events/artifacts.log',
		'events/runs.log',
	];
	for (const eventFile of eventFiles) {
		const sourcePath = args.source.resolve(args.movieId, eventFile);
		if (!(await args.source.storage.fileExists(sourcePath))) {
			continue;
		}
		const content = await args.source.storage.readToString(sourcePath);
		const targetPath = args.target.resolve(args.movieId, eventFile);
		await args.target.storage.write(targetPath, content, {
			mimeType: 'text/plain',
		});
	}
}

async function copyBlobsBetweenContexts(args: {
	source: import('@gorenku/core').StorageContext;
	target: import('@gorenku/core').StorageContext;
	movieId: string;
}): Promise<void> {
	const blobsDir = args.source.resolve(args.movieId, 'blobs');
	if (!(await args.source.storage.directoryExists(blobsDir))) {
		return;
	}

	const listing = args.source.storage.list(blobsDir, { deep: true });
	for await (const item of listing) {
		if (item.type !== 'file') {
			continue;
		}
		const content = await args.source.storage.readToUint8Array(item.path);
		await args.target.storage.write(item.path, Buffer.from(content), {});
	}
}

async function loadDryRunScenarioFile(profilePath: string): Promise<{
	path: string;
	scenario: BlueprintValidationScenarioFile;
}> {
	const path = resolvePathFromInput(profilePath);
	const contents = await readFile(path, 'utf8');
	const scenario = parseBlueprintValidationScenario(contents, path);
	return {
		path,
		scenario,
	};
}

function collectFailedJobsFromSummary(summary: BuildSummary): string[] {
	return (summary.jobs ?? [])
		.filter((job) => job.status === 'failed')
		.map((job) => `${job.producer} (${job.jobId})`);
}

function resolvePathFromInput(inputPath: string, baseDir?: string): string {
	const expanded = expandPath(inputPath);
	if (isAbsolute(expanded)) {
		return resolve(expanded);
	}
	return resolve(baseDir ?? process.cwd(), expanded);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve inputs path - always required (contains model selections).
 * @param explicitPath - The explicit path provided by the user
 */
function resolveInputsPath(explicitPath: string | undefined): string {
	if (!explicitPath) {
		// Note: This should be caught earlier in generate.ts validation,
		// but we keep this check as a safety net
		throw new Error(
			'Input YAML path is required. Provide --inputs=/path/to/inputs.yaml'
		);
	}
	return expandPath(explicitPath);
}

/**
 * Resolve blueprint path.
 * - For new movies: use the specifier (required)
 * - For edits: always use the blueprint from movie metadata (ignore specifier)
 */
async function resolveBlueprintPath(args: {
	specifier?: string;
	movieDir: string;
	cliRoot: string;
	basePath: string;
	storageMovieId: string;
	isNew: boolean;
}): Promise<string> {
	let blueprintInput: string | undefined;

	if (args.isNew) {
		// For new movies, use the provided specifier
		blueprintInput = args.specifier;
	} else {
		// For edits, prefer explicit specifier if provided, otherwise use metadata
		if (args.specifier && args.specifier.trim().length > 0) {
			blueprintInput = args.specifier;
		} else {
			// Use core MovieMetadataService for reading metadata
			const storageContext = createStorageContext({
				kind: 'local',
				rootDir: args.cliRoot,
				basePath: args.basePath,
			});
			const metadataService = createMovieMetadataService(storageContext);
			const metadata = await metadataService.read(args.storageMovieId);
			blueprintInput = metadata?.blueprintPath;
		}
	}

	if (!blueprintInput || blueprintInput.trim().length === 0) {
		throw new Error(
			'Blueprint path is required. Provide --blueprint=/path/to/blueprint.yaml'
		);
	}

	return resolveBlueprintSpecifier(blueprintInput, { cliRoot: args.cliRoot });
}

/**
 * Normalize storage movie ID to public ID (remove "movie-" prefix).
 */
function normalizePublicId(storageMovieId: string): string {
	return storageMovieId.startsWith('movie-')
		? storageMovieId.slice('movie-'.length)
		: storageMovieId;
}

/**
 * Handle --costs-only: display plan and costs, cleanup, return early.
 */
async function handleCostsOnly(args: {
	planResult: Awaited<ReturnType<typeof generatePlan>>;
	storageMovieId: string;
	movieDir: string;
	storageRoot: string;
	basePath: string;
	isNew: boolean;
	logger: Logger;
	movieId?: string;
}): Promise<ExecuteResult> {
	const {
		planResult,
		storageMovieId,
		movieDir,
		storageRoot,
		basePath,
		isNew,
		logger,
	} = args;

	displayPlanAndCosts({
		plan: planResult.plan,
		inputs: planResult.inputEvents,
		costSummary: planResult.costSummary,
		logger,
	});

	const cleanedUp = await cleanupPartialRunDirectory({
		storageRoot,
		basePath,
		movieId: storageMovieId,
		isNew,
	});

	return {
		movieId: args.movieId ?? normalizePublicId(storageMovieId),
		storageMovieId,
		build: undefined,
		isDryRun: undefined,
		storagePath: movieDir,
		resolvedInputs: planResult.resolvedInputs,
		cleanedUp,
	};
}

/**
 * Handle --explain: display plan explanation, cleanup, return early.
 */
async function handleExplain(args: {
	planResult: Awaited<ReturnType<typeof generatePlan>>;
	storageMovieId: string;
	movieDir: string;
	storageRoot: string;
	basePath: string;
	isNew: boolean;
	logger: Logger;
	movieId?: string;
}): Promise<ExecuteResult> {
	const {
		planResult,
		storageMovieId,
		movieDir,
		storageRoot,
		basePath,
		isNew,
		logger,
	} = args;

	// Display explanation if available
	if (planResult.explanation) {
		displayPlanExplanation({
			explanation: planResult.explanation,
			recoverySummary: planResult.recoverySummary,
			logger,
		});
	} else {
		logger.error(
			'No explanation data available. This should not happen when --explain is used.'
		);
	}

	// Also display cost summary for context
	displayPlanAndCosts({
		plan: planResult.plan,
		inputs: planResult.inputEvents,
		costSummary: planResult.costSummary,
		logger,
	});

	const cleanedUp = await cleanupPartialRunDirectory({
		storageRoot,
		basePath,
		movieId: storageMovieId,
		isNew,
	});

	return {
		movieId: args.movieId ?? normalizePublicId(storageMovieId),
		storageMovieId,
		build: undefined,
		isDryRun: undefined,
		storagePath: movieDir,
		resolvedInputs: planResult.resolvedInputs,
		cleanedUp,
	};
}

/**
 * Handle user cancellation: log message, cleanup, return early.
 */
async function handleCancellation(args: {
	planResult: Awaited<ReturnType<typeof generatePlan>>;
	storageMovieId: string;
	movieDir: string;
	storageRoot: string;
	basePath: string;
	isNew: boolean;
	logger: Logger;
	movieId?: string;
}): Promise<ExecuteResult> {
	const {
		planResult,
		storageMovieId,
		movieDir,
		storageRoot,
		basePath,
		isNew,
		logger,
	} = args;

	logger.info('\nExecution cancelled.');
	logger.info(
		'Tip: Run with --dry-run to see what would happen without executing.'
	);

	const cleanedUp = await cleanupPartialRunDirectory({
		storageRoot,
		basePath,
		movieId: storageMovieId,
		isNew,
	});

	return {
		movieId: args.movieId ?? normalizePublicId(storageMovieId),
		storageMovieId,
		build: undefined,
		isDryRun: undefined,
		storagePath: movieDir,
		resolvedInputs: planResult.resolvedInputs,
		cleanedUp,
	};
}

/**
 * Format a movie ID with the "movie-" prefix if not present.
 */
export function formatMovieId(publicId: string): string {
	return publicId.startsWith('movie-') ? publicId : `movie-${publicId}`;
}
