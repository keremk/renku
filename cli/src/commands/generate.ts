import {
	getDefaultCliConfigPath,
	getProjectLocalStorage,
	readCliConfig,
	type CliConfig,
} from '../lib/cli-config.js';
import { runExecute, formatMovieId, type ExecuteResult } from './execute.js';
import { resolveTargetMovieId } from '../lib/movie-id-utils.js';
import { resolveAndPersistConcurrency } from '../lib/concurrency.js';
import {
	buildArtifactsView,
	loadCurrentBuildState,
	prepareArtifactsPreflight,
	resolveMaterializedRootOutputs,
	selectFinalStageOutputs,
	type MaterializedRootOutput,
} from '../lib/artifacts-view.js';
import crypto from 'node:crypto';
import { resolve } from 'node:path';
import {
	collectOutputBindingConditionArtifactIds,
	createStorageContext,
	createRuntimeError,
	getCliArtifactsConfig,
	isCanonicalArtifactId,
	isCanonicalProducerId,
	parseProducerDirectiveToken,
	resolveBuildStateArtifactValues,
	RuntimeErrorCode,
	type PlanningUserControls,
	type BlueprintDryRunValidationResult,
	type LogLevel,
} from '@gorenku/core';
import { createCliLogger } from '../lib/logger.js';

/**
 * Creates an effective config for generation that uses project-local storage (cwd)
 * while preserving catalog configuration from the global config.
 * @param globalConfig - The global CLI config
 * @param storageOverride - Optional storage override (used in tests)
 */
function createEffectiveConfig(
	globalConfig: CliConfig,
	storageOverride?: { root: string; basePath: string }
): CliConfig {
	const projectStorage = storageOverride ?? getProjectLocalStorage();
	return {
		...globalConfig,
		storage: projectStorage,
	};
}

export interface GenerateOptions {
	movieId?: string;
	inputsPath?: string;
	blueprint?: string;
	dryRun?: boolean;
	nonInteractive?: boolean;
	costsOnly?: boolean;
	/** Generate plan, display explanation, and exit without executing */
	explain?: boolean;
	concurrency?: number;
	upToLayer?: number;
	logLevel: LogLevel;
	/** Override storage root (used in tests). If not provided, uses cwd. */
	storageOverride?: { root: string; basePath: string };
	/** Explicit regeneration targets (canonical Artifact:... or Producer:... IDs). */
	regenerateIds?: string[];
	/** Producer-level surgical targets (canonical format, e.g., "Producer:AudioProducer:1") */
	producerIds?: string[];
	/** Pin IDs (canonical Artifact:... or Producer:...). */
	pinIds?: string[];
	/** Optional path to a dry-run profile file. */
	dryRunProfilePath?: string;

	/** Persist an inspectable dry-run snapshot into a temp folder. */
	saveDryRun?: boolean;
}

export interface GenerateResult {
	movieId: string;
	storageMovieId: string;
	planPath?: string;
	targetRevision?: string;
	/** Build summary (available for both dry-run and live execution) */
	build?: ExecuteResult['build'];
	/** Whether this was a dry-run execution */
	isDryRun?: boolean;
	/** Dry-run validation coverage summary (present for dry-runs). */
	dryRunValidation?: BlueprintDryRunValidationResult;
	storagePath: string;
	/** Temp folder containing an inspectable saved dry-run snapshot. */
	savedDryRunPath?: string;
	/** Path to artifacts folder (symlinks to build outputs) */
	artifactsRoot?: string;
	/** Materialized root outputs whose source artifacts are produced by the terminal producer layer. */
	finalStageOutputs?: MaterializedRootOutput[];
	/** Explicitly materialized root Output:... connectors backed by Artifact:... IDs. */
	rootOutputs?: MaterializedRootOutput[];
	isNew: boolean;
	cleanedUp?: boolean;
}

export async function runGenerate(
	options: GenerateOptions
): Promise<GenerateResult> {
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

	const { concurrency, cliConfig: resolvedCliConfig } =
		await resolveAndPersistConcurrency(globalConfig, {
			override: options.concurrency,
			configPath,
		});
	// Use project-local storage (cwd) while preserving catalog from global config
	// Allow override for testing purposes
	const activeConfig = createEffectiveConfig(
		resolvedCliConfig,
		options.storageOverride
	);

	if (options.dryRunProfilePath && !options.dryRun) {
		throw createRuntimeError(
			RuntimeErrorCode.INVALID_INPUT_VALUE,
			'--dry-run-profile/--profile requires --dry-run. Remove the profile flag or run in dry-run mode.',
			{
				suggestion:
					'Either remove --dry-run-profile/--profile, or add --dry-run to this command.',
			}
		);
	}

	if (options.saveDryRun && !options.dryRun) {
		throw createRuntimeError(
			RuntimeErrorCode.INVALID_INPUT_VALUE,
			'--save-dry-run requires --dry-run. Remove the flag or run in dry-run mode.',
			{
				suggestion:
					'Either remove --save-dry-run, or add --dry-run to this command.',
			}
		);
	}

	// Validate --regen requirements
	const targetingExisting = Boolean(options.movieId);
	if (options.regenerateIds && options.regenerateIds.length > 0) {
		if (!targetingExisting) {
			throw createRuntimeError(
				RuntimeErrorCode.MISSING_REQUIRED_INPUT,
				'--regen requires --movie-id/--id to target an existing movie.',
				{
					suggestion:
						'Provide --movie-id/--id to run regeneration against an existing build.',
				}
			);
		}
	}

	// Input validation - always required (contains model selections)
	if (!options.inputsPath) {
		throw createRuntimeError(
			RuntimeErrorCode.MISSING_REQUIRED_INPUT,
			'Input YAML path is required.',
			{
				suggestion:
					'Provide --inputs=/path/to/inputs.yaml. Inputs are needed for model selections.',
			}
		);
	}

	// Regeneration targets must be canonical Artifact:/Producer: IDs.
	const regenerateIds = normalizeRegenerateIds(options.regenerateIds);
	const producerDirectives = normalizeProducerDirectivesFromCli(
		options.producerIds
	);
	const planningControls = buildPlanningUserControls({
		upToLayer: options.upToLayer,
		regenerateIds,
		pinIds: options.pinIds,
		producerDirectives,
	});
	const artifactsConfig = getCliArtifactsConfig(activeConfig);

	if (options.movieId) {
		const storageMovieId = resolveTargetMovieId({
			explicitMovieId: options.movieId,
		});
		const logFilePath = resolve(
			activeConfig.storage.root,
			activeConfig.storage.basePath,
			storageMovieId,
			'logs',
			`${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
		);
		const logger = createCliLogger({
			level: options.logLevel,
			logFilePath,
		});
		const { buildState } = await loadCurrentBuildState(
			activeConfig,
			storageMovieId
		).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			throw createRuntimeError(
				RuntimeErrorCode.BUILD_STATE_NOT_FOUND,
				`Unable to load build state for ${storageMovieId}. ${message}`,
				{
					cause: error,
					suggestion:
						'Run an initial generation for this movie first, then retry this command.',
				}
			);
		});

		const preflight = artifactsConfig.enabled
			? await prepareArtifactsPreflight({
					cliConfig: activeConfig,
					movieId: storageMovieId,
					buildState,
					allowShardedBlobs: true,
				})
			: { pendingArtifacts: [] };

		const editResult = await runExecute({
			storageMovieId,
			isNew: false,
			inputsPath: options.inputsPath,
			blueprintSpecifier: options.blueprint, // Ignored for edits - uses metadata
			pendingArtifacts: preflight.pendingArtifacts,
			dryRun: options.dryRun,
			nonInteractive: options.nonInteractive,
			costsOnly: options.costsOnly,
			explain: options.explain,
			concurrency,
			planningControls,
			dryRunProfilePath: options.dryRunProfilePath,
			saveDryRun: options.saveDryRun,
			logger,
			cliConfig: activeConfig,
		});

		let artifactsRoot: string | undefined;
		let finalStageOutputs: MaterializedRootOutput[] | undefined;
		let rootOutputs: MaterializedRootOutput[] | undefined;
		if (!options.dryRun && editResult.build && artifactsConfig.enabled) {
			const { buildState: nextBuildState } = await loadCurrentBuildState(
				activeConfig,
				storageMovieId
			);
			const artifacts = await buildArtifactsView({
				cliConfig: activeConfig,
				movieId: storageMovieId,
				buildState: nextBuildState,
			});
			artifactsRoot = artifacts.artifactsRoot;
			const resolvedConditionArtifacts =
				await resolveRootOutputConditionArtifacts({
					cliConfig: activeConfig,
					movieId: storageMovieId,
					buildState: nextBuildState,
					rootOutputBindings: editResult.rootOutputBindings ?? [],
				});
			const materializedRootOutputs = resolveMaterializedRootOutputs({
				rootOutputBindings: editResult.rootOutputBindings ?? [],
				artifacts: artifacts.artifacts,
				resolvedArtifacts: resolvedConditionArtifacts,
				resolvedInputs: editResult.resolvedInputs,
			});
			rootOutputs = materializedRootOutputs;
			finalStageOutputs = selectFinalStageOutputs({
				rootOutputs: materializedRootOutputs,
				finalStageProducerJobIds: editResult.finalStageProducerJobIds ?? [],
			});
		}

		return {
			movieId: normalizePublicId(storageMovieId),
			storageMovieId,
			planPath: editResult.planPath,
			targetRevision: editResult.targetRevision,
			build: editResult.build,
			isDryRun: editResult.isDryRun,
			dryRunValidation: editResult.dryRunValidation,
			storagePath: editResult.storagePath,
			savedDryRunPath: editResult.savedDryRunPath,
			artifactsRoot,
			finalStageOutputs,
			rootOutputs,
			isNew: false,
			cleanedUp: editResult.cleanedUp,
		};
	}

	// Blueprint validation - required for new movies only
	if (!options.blueprint) {
		throw createRuntimeError(
			RuntimeErrorCode.MISSING_REQUIRED_INPUT,
			'Blueprint path is required for a new generation. Provide --blueprint=/path/to/blueprint.yaml',
			{
				suggestion:
					'Provide --blueprint/--bp with a valid blueprint path for new movie generation.',
			}
		);
	}

	const newMovieId = generateMovieId();
	const storageMovieId = formatMovieId(newMovieId);
	const logFilePath = resolve(
		activeConfig.storage.root,
		activeConfig.storage.basePath,
		storageMovieId,
		'logs',
		`${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
	);
	const logger = createCliLogger({
		level: options.logLevel,
		logFilePath,
	});

	const queryResult = await runExecute({
		storageMovieId,
		movieId: newMovieId,
		isNew: true,
		inputsPath: options.inputsPath,
		blueprintSpecifier: options.blueprint,
		dryRun: options.dryRun,
		nonInteractive: options.nonInteractive,
		costsOnly: options.costsOnly,
		explain: options.explain,
		concurrency,
		planningControls,
		dryRunProfilePath: options.dryRunProfilePath,
		saveDryRun: options.saveDryRun,
		logger,
		cliConfig: activeConfig,
	});

	let artifactsRoot: string | undefined;
	let finalStageOutputs: MaterializedRootOutput[] | undefined;
	let rootOutputs: MaterializedRootOutput[] | undefined;
	if (!options.dryRun && queryResult.build && artifactsConfig.enabled) {
		// Try to load build state and build artifacts view, but don't fail if the
		// run did not produce inspectable artifacts.
		try {
			const { buildState } = await loadCurrentBuildState(
				activeConfig,
				queryResult.storageMovieId
			);
			const artifacts = await buildArtifactsView({
				cliConfig: activeConfig,
				movieId: queryResult.storageMovieId,
				buildState,
			});
			artifactsRoot = artifacts.artifactsRoot;
			const resolvedConditionArtifacts =
				await resolveRootOutputConditionArtifacts({
					cliConfig: activeConfig,
					movieId: queryResult.storageMovieId,
					buildState,
					rootOutputBindings: queryResult.rootOutputBindings ?? [],
				});
			const materializedRootOutputs = resolveMaterializedRootOutputs({
				rootOutputBindings: queryResult.rootOutputBindings ?? [],
				artifacts: artifacts.artifacts,
				resolvedArtifacts: resolvedConditionArtifacts,
				resolvedInputs: queryResult.resolvedInputs,
			});
			rootOutputs = materializedRootOutputs;
			finalStageOutputs = selectFinalStageOutputs({
				rootOutputs: materializedRootOutputs,
				finalStageProducerJobIds: queryResult.finalStageProducerJobIds ?? [],
			});
		} catch {
			// Build state may not exist if the run failed early - continue without artifacts view
			logger.debug?.(
				'Could not load build state for artifacts view - build may have failed'
			);
		}
	}

	return {
		movieId: queryResult.movieId,
		storageMovieId: queryResult.storageMovieId,
		planPath: queryResult.planPath,
		targetRevision: queryResult.targetRevision,
		build: queryResult.build,
		isDryRun: queryResult.isDryRun,
		dryRunValidation: queryResult.dryRunValidation,
		storagePath: queryResult.storagePath,
		savedDryRunPath: queryResult.savedDryRunPath,
		artifactsRoot,
		finalStageOutputs,
		rootOutputs,
		isNew: true,
		cleanedUp: queryResult.cleanedUp,
	};
}

async function resolveRootOutputConditionArtifacts(args: {
	cliConfig: CliConfig;
	movieId: string;
	buildState: Awaited<ReturnType<typeof loadCurrentBuildState>>['buildState'];
	rootOutputBindings: ExecuteResult['rootOutputBindings'];
}): Promise<Record<string, unknown>> {
	const rootOutputBindings = args.rootOutputBindings ?? [];
	const artifactIds = collectOutputBindingConditionArtifactIds(rootOutputBindings);
	if (artifactIds.length === 0) {
		return {};
	}

	const storage = createStorageContext({
		kind: 'local',
		rootDir: args.cliConfig.storage.root,
		basePath: args.cliConfig.storage.basePath,
	});

	return resolveBuildStateArtifactValues({
		artifactIds,
		buildState: args.buildState,
		storage,
		movieId: args.movieId,
	});
}

function normalizePublicId(storageMovieId: string): string {
	return storageMovieId.startsWith('movie-')
		? storageMovieId.slice('movie-'.length)
		: storageMovieId;
}

function generateMovieId(): string {
	return crypto.randomUUID().slice(0, 8);
}

function normalizeRegenerateIds(
	regenerateIds: string[] | undefined
): string[] | undefined {
	if (!regenerateIds || regenerateIds.length === 0) {
		return undefined;
	}

	const normalizedRegenerateIds: string[] = [];
	for (const rawId of regenerateIds) {
		const id = rawId.trim();
		if (id.length === 0) {
			throw createRuntimeError(
				RuntimeErrorCode.INVALID_INPUT_VALUE,
				'Invalid --regen value: expected a non-empty canonical Artifact:... or Producer:... ID.'
			);
		}
		if (isCanonicalArtifactId(id) || isCanonicalProducerId(id)) {
			normalizedRegenerateIds.push(id);
			continue;
		}
		throw createRuntimeError(
			RuntimeErrorCode.INVALID_INPUT_VALUE,
			`Invalid --regen value "${rawId}". Expected canonical Artifact:... or Producer:... ID.`,
			{
				suggestion:
					'Use canonical IDs like Artifact:AudioProducer.GeneratedAudio[0] or Producer:AudioProducer.',
			}
		);
	}

	return normalizedRegenerateIds;
}

function normalizeProducerDirectivesFromCli(
	rawProducerDirectives: string[] | undefined
): Array<{ producerId: string; count: number }> | undefined {
	if (!rawProducerDirectives || rawProducerDirectives.length === 0) {
		return undefined;
	}

	return rawProducerDirectives.map((value) =>
		parseProducerDirectiveToken(value)
	);
}

function buildPlanningUserControls(args: {
	upToLayer?: number;
	regenerateIds?: string[];
	pinIds?: string[];
	producerDirectives?: Array<{ producerId: string; count: number }>;
}): PlanningUserControls | undefined {
	const scope: PlanningUserControls['scope'] = {
		...(args.upToLayer !== undefined ? { upToLayer: args.upToLayer } : {}),
		...(args.producerDirectives && args.producerDirectives.length > 0
			? { producerDirectives: args.producerDirectives }
			: {}),
	};
	const surgical: PlanningUserControls['surgical'] = {
		...(args.regenerateIds && args.regenerateIds.length > 0
			? { regenerateIds: args.regenerateIds }
			: {}),
		...(args.pinIds && args.pinIds.length > 0 ? { pinIds: args.pinIds } : {}),
	};

	const hasScope = Object.keys(scope).length > 0;
	const hasSurgical = Object.keys(surgical).length > 0;
	if (!hasScope && !hasSurgical) {
		return undefined;
	}

	return {
		...(hasScope ? { scope } : {}),
		...(hasSurgical ? { surgical } : {}),
	};
}
