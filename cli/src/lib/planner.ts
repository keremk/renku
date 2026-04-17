import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
	createStorageContext,
	initializeMovieStorage,
	createBuildStateService,
	createEventLog,
	createPlanningService,
	commitExecutionDraft,
	createMovieMetadataService,
	validatePreparedBlueprintTree,
	buildProducerCatalog,
	copyRunArchivesToMemory,
	copyPlansToMemory,
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
	recoverFailedArtifactsBeforePlanning,
	createRunLifecycleService,
	type RecoveryPrepassSummary,
	type RecoveryPrepassDependencies,
	type BuildState,
	type ArtifactEvent,
	type ExecutionState,
	type InputEvent,
	type ExecutionPlan,
	type PendingArtifactDraft,
	type Logger,
	type PlanExplanation,
	type ProducerOptionsMap,
	type SurgicalInfo,
	type ConditionAnalysis,
} from '@gorenku/core';
export type { PendingArtifactDraft } from '@gorenku/core';
export type { PlanExplanation } from '@gorenku/core';
import {
	loadPricingCatalog,
	estimatePlanCosts,
	loadModelCatalog,
	loadModelInputSchema,
	type PlanCostSummary,
	type LoadedModelCatalog,
	type ConditionHints,
	checkFalJobStatus,
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
	pendingArtifacts?: PendingArtifactDraft[];
	logger?: Logger;
	notifications?: import('@gorenku/core').NotificationBus;
	/** Canonical planning controls from the CLI adapter. */
	planningControls?: import('@gorenku/core').PlanningUserControls;
	/** If true, collect explanation data for why jobs are scheduled */
	collectExplanation?: boolean;
	/** Optional recovery dependency overrides (primarily for tests). */
	recoveryDependencies?: Omit<
		RecoveryPrepassDependencies,
		'checkFalStatus' | 'recoveredBy'
	> & {
		checkFalStatus?: RecoveryPrepassDependencies['checkFalStatus'];
	};
}

export interface GeneratePlanResult {
	inputEvents: InputEvent[];
	artifactEvents: ArtifactEvent[];
	buildState: BuildState;
	executionState: ExecutionState;
	plan: ExecutionPlan;
	baselineHash: string | null;
	resolvedInputs: Record<string, unknown>;
	providerOptions: ProducerOptionsMap;
	blueprintPath: string;
	costSummary: PlanCostSummary;
	/** Pre-loaded model catalog for provider registry. */
	modelCatalog?: LoadedModelCatalog;
	/** Path to the catalog models directory. Required for schema loading in delegation. */
	catalogModelsDir?: string;
	/** Planning storage context for transient dry-run execution. */
	planningStorage: ReturnType<typeof createStorageContext>;
	/** Commit the transient draft into a real execution-backed revision. */
	persist: (args: {
		runConfig: import('@gorenku/core').RunConfig;
	}) => Promise<{
		planPath: string;
		targetRevision: string;
		plan: ExecutionPlan;
		inputEvents: InputEvent[];
		artifactEvents: ArtifactEvent[];
	}>;
	/** Surgical regeneration info when artifact regeneration targets are provided. */
	surgicalInfo?: SurgicalInfo[];
	/** Effective producer-level scheduling metadata. */
	producerScheduling?: import('@gorenku/core').ProducerSchedulingSummary[];
	/** Non-fatal warnings for ignored out-of-scope controls. */
	warnings?: import('@gorenku/core').PlanningWarning[];
	/** Plan explanation (only if collectExplanation was true) */
	explanation?: PlanExplanation;
	/** Condition analysis for dry-run simulation */
	conditionAnalysis?: ConditionAnalysis;
	/** Condition hints for dry-run simulation (derived from conditionAnalysis) */
	conditionHints?: ConditionHints;
	/** Recovery summary from pre-plan artifact recovery pass (existing movies only). */
	recoverySummary?: RecoveryPrepassSummary;
}

export async function generatePlan(
	options: GeneratePlanOptions
): Promise<GeneratePlanResult> {
	const logger = options.logger ?? globalThis.console;
	const notifications = options.notifications;
	const { cliConfig, movieId } = options;
	const storageRoot = cliConfig.storage.root;
	const basePath = cliConfig.storage.basePath;
	const movieDir = resolve(storageRoot, basePath, movieId);

	// Use IN-MEMORY storage for planning (no disk writes yet)
	const memoryStorageContext = createStorageContext({
		kind: 'memory',
		basePath,
	});
	await initializeMovieStorage(memoryStorageContext, movieId);

	// For edits (isNew: false), we need to load existing run archives and events from disk
	// For new movies, we use empty in-memory state
	let recoverySummary: RecoveryPrepassSummary | undefined;
	if (!options.isNew) {
		// Load existing run archives and events from local storage into memory context
		const localStorageContext = createStorageContext({
			kind: 'local',
			rootDir: storageRoot,
			basePath,
		});
		recoverySummary = await recoverFailedArtifactsBeforePlanning({
			storage: localStorageContext,
			movieId,
			dependencies: {
				...options.recoveryDependencies,
				checkFalStatus:
					options.recoveryDependencies?.checkFalStatus ?? checkFalJobStatus,
				logger: options.recoveryDependencies?.logger ?? {
					debug: (message, meta) => {
						logger.debug?.(message, meta);
					},
					warn: (message, meta) => {
						logger.warn?.(message, meta);
					},
				},
				recoveredBy: 'cli.preplan',
			},
		});
		await copyRunArchivesToMemory(
			localStorageContext,
			memoryStorageContext,
			movieId
		);
		await copyPlansToMemory(
			localStorageContext,
			memoryStorageContext,
			movieId
		);
		await copyEventsToMemory(
			localStorageContext,
			memoryStorageContext,
			movieId
		);
	}

	const buildStateService = createBuildStateService(memoryStorageContext);
	const eventLog = createEventLog(memoryStorageContext);

	const blueprintPath = expandPath(options.usingBlueprint);
	const catalogRoot = cliConfig.catalog?.root ?? undefined;
	const { root: blueprintRoot } = await loadBlueprintBundle(blueprintPath, {
		catalogRoot,
	});

	const metadataValidation = await validatePreparedBlueprintTree({
		root: blueprintRoot,
		schemaSource: { kind: 'producer-metadata' },
		options: { errorsOnly: true },
	});
	throwIfBlueprintValidationFailed(metadataValidation.validation);

	// Analyze conditions for dry-run simulation
	const conditionAnalysisResult = analyzeConditions(blueprintRoot.document);
	const varyingHints = conditionAnalysisToVaryingHints(conditionAnalysisResult);
	const conditionHints: ConditionHints | undefined =
		varyingHints.length > 0
			? { varyingFields: varyingHints, mode: 'alternating' }
			: undefined;

	// Load inputs from YAML - always required (contains model selections)
	if (!options.inputsPath) {
		const { createRuntimeError, RuntimeErrorCode } = await import(
			'@gorenku/core'
		);
		throw createRuntimeError(
			RuntimeErrorCode.MISSING_REQUIRED_INPUT,
			'Input YAML path is required.',
			{
				suggestion:
					'Provide --inputs=/path/to/inputs.yaml. Inputs are needed for model selections.',
			}
		);
	}

	const {
		values: inputValues,
		providerOptions,
		artifactOverrides,
	} = await loadInputsFromYaml(
		options.inputsPath,
		blueprintRoot,
		false,
		movieDir
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
		movieId
	);

	// Convert artifact overrides to PendingArtifactDraft objects
	const overrideDrafts = convertArtifactOverridesToDrafts(persistedOverrides);
	const allPendingArtifacts = [
		...(options.pendingArtifacts ?? []),
		...overrideDrafts,
	];

	if (artifactOverrides.length > 0) {
		logger.info(
			`${chalk.bold('Artifact overrides:')} ${artifactOverrides.length} artifact(s) will be replaced`
		);
		for (const override of artifactOverrides) {
			logger.debug(`  - ${override.artifactId} (${override.blob.mimeType})`);
		}
	}

	// Generate plan (writes go to in-memory storage)
	const providerMetadata = await buildProviderMetadata(
		providerOptions,
		{ catalogModelsDir, modelCatalog },
		loadModelInputSchema as Parameters<typeof buildProviderMetadata>[2]
	);
	const preparedValidation = await validatePreparedBlueprintTree({
		root: blueprintRoot,
		schemaSource: {
			kind: 'provider-options',
			providerOptions: providerMetadata,
		},
		options: { errorsOnly: true },
	});
	throwIfBlueprintValidationFailed(preparedValidation.validation);
	if (!preparedValidation.context) {
		throw new Error(
			'Prepared blueprint validation succeeded without a resolution context.'
		);
	}
	const planningControls = options.planningControls;
	const planResult = await createPlanningService({
		logger,
		notifications,
	}).generatePlan({
		movieId,
		blueprintTree: blueprintRoot,
		inputValues,
		providerCatalog: catalog,
		providerOptions: providerMetadata,
		resolutionContext: preparedValidation.context,
		storage: memoryStorageContext,
		buildStateService,
		eventLog,
		pendingArtifacts:
			allPendingArtifacts.length > 0 ? allPendingArtifacts : undefined,
		userControls: planningControls,
		collectExplanation: options.collectExplanation,
	});
	logger.debug('[planner] resolved inputs', {
		inputs: Object.keys(planResult.resolvedInputs),
	});
	// Load pricing catalog and estimate costs
	const pricingCatalog = catalogModelsDir
		? await loadPricingCatalog(catalogModelsDir)
		: { providers: new Map() };
	const costSummary = estimatePlanCosts(
		planResult.plan,
		pricingCatalog,
		planResult.resolvedInputs
	);

	// Derive surgical info for artifact regeneration targets.
	const artifactRegenerateIds =
		planningControls?.surgical?.regenerateIds?.filter((id) =>
			id.startsWith('Artifact:')
		) ?? [];
	const surgicalInfo = artifactRegenerateIds.length > 0
		? deriveSurgicalInfoArray(artifactRegenerateIds, planResult.buildState)
		: undefined;

	return {
		inputEvents: planResult.inputEvents,
		artifactEvents: planResult.artifactEvents,
		buildState: planResult.buildState,
		executionState: planResult.executionState,
		plan: planResult.plan,
		baselineHash: planResult.baselineHash,
		resolvedInputs: planResult.resolvedInputs,
		providerOptions,
		blueprintPath,
		costSummary,
		modelCatalog,
		catalogModelsDir: catalogModelsDir ?? undefined,
		planningStorage: memoryStorageContext,
		surgicalInfo,
		producerScheduling: planResult.producerScheduling,
		warnings: planResult.warnings,
		explanation: planResult.explanation,
		conditionAnalysis: conditionAnalysisResult,
		conditionHints,
		recoverySummary,
		persist: async ({ runConfig }) => {
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
				movieId
			);

			const inputSnapshotBytes = await readFile(options.inputsPath);
			const committed = await commitExecutionDraft({
				movieId,
				storage: localStorageContext,
				draftPlan: planResult.plan,
				draftInputEvents: planResult.inputEvents,
				draftArtifactEvents: planResult.artifactEvents,
				inputSnapshotContents: inputSnapshotBytes,
				runConfig,
			});

			return {
				planPath: resolve(
					storageRoot,
					basePath,
					movieId,
					committed.planPath
				),
				targetRevision: committed.revision,
				plan: committed.plan,
				inputEvents: committed.inputEvents,
				artifactEvents: committed.artifactEvents,
			};
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

function throwIfBlueprintValidationFailed(
	validation: import('@gorenku/core').ValidationResult
): void {
	if (validation.valid) {
		return;
	}

	const errorMessages = validation.errors
		.map((error) => `  ${error.code}: ${error.message}`)
		.join('\n');
	throw createValidationError(
		ValidationErrorCode.BLUEPRINT_VALIDATION_FAILED,
		`Blueprint validation failed:\n${errorMessages}`
	);
}
