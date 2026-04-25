import {
  expandBlueprintResolutionContext,
  normalizeBlueprintResolutionInputs,
  prepareBlueprintResolutionContext,
  type BlueprintResolutionContext,
} from '../resolution/blueprint-resolution-context.js';
import type { CanonicalBlueprint } from '../resolution/canonical-expander.js';
import { createProducerGraph } from '../resolution/producer-graph.js';
import {
  createPlanAdapter,
  type PlanAdapterOptions,
} from '../planning/adapter.js';
import {
  collectRequiredConditionArtifactIds,
  type PrunedUnrunnableJob,
} from '../planning/planner.js';
import type { PlanExplanation } from '../planning/explanation.js';
import { evaluateInputConditions } from '../condition-evaluator.js';
import {
  formatCanonicalProducerPath,
  formatProducerScopedInputIdForCanonicalProducerId,
  isCanonicalArtifactId,
  isCanonicalInputId,
  parseCanonicalOutputId,
} from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type { EventLog } from '../event-log.js';
import { hashPayload } from '../hashing.js';
import {
  BuildStateNotFoundError,
  type BuildStateService,
} from '../build-state.js';
import { DRAFT_REVISION_ID } from '../revisions.js';
import { type StorageContext } from '../storage.js';
import { computeTopologyLayers } from '../topology/index.js';
import type { Clock } from '../types.js';
import {
  applyArtifactEventsToExecutionState,
  createExecutionState,
} from '../execution-state.js';
import { convertBlobInputToBlobRef } from '../input-blob-storage.js';
import { formatBlobFileName } from '../blob-utils.js';
import { applyOutputSchemasFromProviderOptionsToBlueprintTree } from './output-schema-hydration.js';
import { deriveProducerFamilyId } from './producer-overrides.js';
import {
  buildArtifactOwnershipIndex,
  resolveArtifactOwnershipFromGraph,
  type ArtifactOwnership,
} from '../artifact-ownership.js';
import {
  buildResolvedProducerSummaries,
  resolvePlanningControls,
} from './planning-controls.js';
import type {
  ArtifactEvent,
  ArtifactEventOutput,
  ArtifactEventStatus,
  BlueprintTreeNode,
  BlueprintProducerOutputDefinition,
  ExecutionPlan,
  InputEvent,
  InputEventSource,
  MappingFieldDefinition,
  BuildState,
  ExecutionState,
  ProducerCatalog,
  ProducerGraph,
  PlanningUserControls,
  ProducerRunSummary,
  PlanningWarning,
  RevisionId,
  InputConditionInfo,
  RootOutputBinding,
  SurgicalRegenerationScope,
} from '../types.js';

export type ProviderOptionEntry = {
  sdkMapping?: Record<string, MappingFieldDefinition>;
  outputs?: Record<string, BlueprintProducerOutputDefinition>;
  inputSchema?: string;
  outputSchema?: string;
  config?: Record<string, unknown>;
  selectionInputKeys?: string[];
  configInputPaths?: string[];
};

export interface PendingArtifactDraft {
  artifactId: string;
  producerJobId: string;
  producerId: string;
  lastRevisionBy: 'producer' | 'user';
  output: ArtifactEventOutput;
  inputsHash?: string;
  status?: ArtifactEventStatus;
  diagnostics?: Record<string, unknown>;
  preEditArtifactHash?: string;
}

export interface GeneratePlanArgs {
  movieId: string;
  blueprintTree: BlueprintTreeNode;
  inputValues: Record<string, unknown>;
  providerCatalog: ProducerCatalog;
  providerOptions: Map<string, ProviderOptionEntry>;
  resolutionContext?: BlueprintResolutionContext;
  storage: StorageContext;
  /** Optional persistent storage used to read reusable condition blobs for existing-build replans. */
  conditionFallbackStorage?: StorageContext;
  buildStateService: BuildStateService;
  eventLog: EventLog;
  pendingArtifacts?: PendingArtifactDraft[];
  inputSource?: InputEventSource;
  /** Canonical planning controls from client adapters (CLI/viewer). */
  userControls?: PlanningUserControls;
  /** Scope mode for surgical regeneration targeting. Defaults to lineage-plus-dirty. */
  surgicalRegenerationScope?: SurgicalRegenerationScope;
  /** If true, collect explanation data for why jobs are scheduled */
  collectExplanation?: boolean;
}

export interface GeneratePlanResult {
  plan: ExecutionPlan;
  buildState: BuildState;
  baselineHash: string | null;
  executionState: ExecutionState;
  inputEvents: InputEvent[];
  artifactEvents: ArtifactEvent[];
  resolvedInputs: Record<string, unknown>;
  /** Explanation of why jobs were scheduled (only if collectExplanation was true) */
  explanation?: PlanExplanation;
  /** Effective producer-level scheduling metadata for UI/CLI displays. */
  producerScheduling?: ProducerRunSummary[];
  /** Non-fatal planning warnings for ignored out-of-scope controls. */
  warnings?: PlanningWarning[];
}

export interface PlanningServiceOptions extends PlanAdapterOptions {
  clock?: Clock;
}

export interface PlanningService {
  // eslint-disable-next-line no-unused-vars
  generatePlan(args: GeneratePlanArgs): Promise<GeneratePlanResult>;
}

export function createPlanningService(
  options: PlanningServiceOptions = {}
): PlanningService {
  const adapter = createPlanAdapter({
    logger: options.logger,
    clock: options.clock,
    notifications: options.notifications,
  });

  return {
    async generatePlan(args) {
      const now = () => options.clock?.now() ?? new Date().toISOString();
      const buildStateService = args.buildStateService;

      const { buildState, hash: baselineHash } = await loadOrCreateBuildState(
        buildStateService,
        args.movieId,
        now
      );

      const context =
        args.resolutionContext ??
        (await prepareBlueprintResolutionContext({
          root: args.blueprintTree,
          schemaSource: {
            kind: 'provider-options',
            providerOptions: args.providerOptions,
          },
        }));
      const normalizedInputs = normalizeBlueprintResolutionInputs(
        context,
        args.inputValues,
        {
          requireCanonicalIds: true,
          additionalCanonicalIds: collectPlanningCanonicalInputIds(
            args.providerOptions
          ),
        }
      );

      // Transform BlobInput to BlobRef BEFORE creating events
      const inputsWithBlobRefs = await transformInputBlobsToRefs(
        normalizedInputs,
        args.storage,
        args.movieId
      );

      // Inject derived system inputs (e.g., SegmentDuration from Duration/NumOfSegments)
      const inputsWithDerived = injectDerivedInputs(inputsWithBlobRefs);

      const inputEvents = createInputEvents(
        inputsWithDerived,
        DRAFT_REVISION_ID,
        args.inputSource ?? 'user',
        now()
      );
      for (const event of inputEvents) {
        await args.eventLog.appendInput(args.movieId, event);
      }
      const resolvedInputs = buildResolvedInputMap(inputEvents);
      const resolvedConditionInputs = expandResolvedConditionInputs(
        resolvedInputs,
        context.inputSources
      );
      // Note: Blueprint defaults are no longer applied - model JSON schemas are the source of truth

      const expanded = expandBlueprintResolutionContext(
        context,
        inputsWithDerived
      );
      const rootOutputBindings = collectRootOutputBindings(expanded.canonical);
      const producerGraph = createProducerGraph(
        expanded.canonical,
        args.providerCatalog,
        args.providerOptions
      );
      const ownershipByArtifactId = buildArtifactOwnershipIndex(producerGraph);
      const finalStageProducerJobIds = collectFinalStageProducerJobIds(
        producerGraph
      );

      const artifactEvents = (args.pendingArtifacts ?? []).map((draft) =>
        makeArtifactEvent(
          ensurePendingArtifactOwnership(draft, ownershipByArtifactId),
          DRAFT_REVISION_ID,
          now()
        )
      );
      for (const artifactEvent of artifactEvents) {
        await args.eventLog.appendArtifact(args.movieId, artifactEvent);
      }

      const latestArtifactSnapshot = await readLatestArtifactSnapshot(
        args.eventLog,
        args.movieId
      );

      const resolvedControls = resolvePlanningControls({
        producerGraph,
        baselineInputs: {},
        userControls: args.userControls,
        latestSnapshot: latestArtifactSnapshot,
        buildState,
      });

      const requiredConditionArtifactIds =
        collectRequiredConditionArtifactIds(producerGraph);
      const resolvedConditionArtifacts =
        requiredConditionArtifactIds.size > 0
          ? await resolveConditionArtifactsForPlanning({
              artifactIds: Array.from(requiredConditionArtifactIds),
              eventLog: args.eventLog,
              storage: args.storage,
              fallbackStorage: args.conditionFallbackStorage,
              movieId: args.movieId,
            })
          : undefined;

      const { plan, explanation, prunedUnrunnableJobs } = await adapter.compute({
        movieId: args.movieId,
        buildState,
        eventLog: args.eventLog,
        blueprint: producerGraph,
        targetRevision: DRAFT_REVISION_ID,
        pendingEdits: inputEvents,
        resolvedConditionArtifacts,
        resolvedConditionInputs,
        artifactRegenerations: resolvedControls.artifactRegenerations,
        surgicalRegenerationScope: args.surgicalRegenerationScope,
        upToLayer: resolvedControls.effectiveUpToLayer,
        collectExplanation: args.collectExplanation,
        pinnedArtifactIds:
          resolvedControls.pinnedArtifactIds.length > 0
            ? resolvedControls.pinnedArtifactIds
            : undefined,
        forceTargetJobIds:
          resolvedControls.forcedJobIds.length > 0
            ? resolvedControls.forcedJobIds
            : undefined,
        blockedProducerJobIds:
          resolvedControls.blockedProducerJobIds.length > 0
            ? resolvedControls.blockedProducerJobIds
            : undefined,
      });
      attachResolvedInputsToPlanJobs(plan, resolvedConditionInputs);

      const scheduledJobIds = new Set(plan.layers.flat().map((job) => job.jobId));
      validateScheduledJobArtifactDependencies({
        movieId: args.movieId,
        producerGraph,
        scheduledJobIds,
        buildState,
        latestSuccessfulArtifactIds: latestArtifactSnapshot.latestSuccessfulIds,
        resolvedConditionArtifacts,
        resolvedConditionInputs,
        prunedUnrunnableJobs,
        upToLayer: resolvedControls.effectiveUpToLayer,
      });
      const producerScheduling = buildResolvedProducerSummaries({
        normalizedOverrides: resolvedControls.normalizedOverrides,
        scheduledJobIds,
      });

      if (rootOutputBindings.length > 0) {
        plan.rootOutputBindings = rootOutputBindings;
      }
      if (finalStageProducerJobIds.length > 0) {
        plan.finalStageProducerJobIds = finalStageProducerJobIds;
      }

      const baseExecutionState = createExecutionState({
        buildState,
        inputEvents,
      });
      const executionState = applyArtifactEventsToExecutionState(
        baseExecutionState,
        artifactEvents
      );

      return {
        plan,
        buildState,
        baselineHash,
        executionState,
        inputEvents,
        artifactEvents,
        resolvedInputs,
        explanation,
        producerScheduling,
        warnings:
          resolvedControls.warnings.length > 0
            ? resolvedControls.warnings
            : undefined,
      };
    },
  };
}

function expandResolvedConditionInputs(
  resolvedInputs: Record<string, unknown>,
  inputSources: BlueprintResolutionContext['inputSources']
): Record<string, unknown> {
  const expanded: Record<string, unknown> = { ...resolvedInputs };
  const visiting = new Set<string>();

  const resolveInputValue = (inputId: string): unknown => {
    if (expanded[inputId] !== undefined) {
      return expanded[inputId];
    }

    const upstreamId = inputSources.get(inputId);
    if (!upstreamId) {
      return undefined;
    }

    if (visiting.has(inputId)) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_INPUT_BINDING,
        `Detected circular input source mapping while resolving "${inputId}".`,
        { context: inputId }
      );
    }

    visiting.add(inputId);
    const resolvedValue =
      upstreamId === inputId ? resolvedInputs[upstreamId] : resolveInputValue(upstreamId);
    visiting.delete(inputId);

    if (resolvedValue !== undefined) {
      expanded[inputId] = resolvedValue;
    }
    return resolvedValue;
  };

  for (const inputId of inputSources.keys()) {
    resolveInputValue(inputId);
  }

  return expanded;
}

function attachResolvedInputsToPlanJobs(
  plan: ExecutionPlan,
  resolvedInputs: Record<string, unknown>
): void {
  for (const layer of plan.layers) {
    for (const job of layer) {
      const jobContext = job.context;
      if (!jobContext) {
        continue;
      }

      const relevantInputs = collectJobResolvedInputs(job, resolvedInputs);
      if (Object.keys(relevantInputs).length === 0) {
        continue;
      }

      job.context = {
        ...jobContext,
        extras: {
          ...(jobContext.extras ?? {}),
          resolvedInputs: {
            ...(((jobContext.extras ?? {}).resolvedInputs as Record<string, unknown> | undefined) ??
              {}),
            ...relevantInputs,
          },
        },
      };
    }
  }
}

function collectJobResolvedInputs(
  job: ExecutionPlan['layers'][number][number],
  resolvedInputs: Record<string, unknown>
): Record<string, unknown> {
  const relevantInputIds = new Set<string>();

  for (const inputId of Object.keys(job.context?.inputConditions ?? {})) {
    if (isCanonicalInputId(inputId)) {
      relevantInputIds.add(inputId);
    }
  }

  collectConditionInputIds(job.context?.inputConditions, relevantInputIds);
  collectConditionalBindingInputIds(
    job.context?.conditionalInputBindings,
    relevantInputIds
  );

  const relevantInputs: Record<string, unknown> = {};
  for (const inputId of relevantInputIds) {
    const value = resolvedInputs[inputId];
    if (value !== undefined) {
      relevantInputs[inputId] = value;
    }
  }

  return relevantInputs;
}

function collectConditionalBindingInputIds(
  conditionalInputBindings:
    | NonNullable<ExecutionPlan['layers'][number][number]['context']>['conditionalInputBindings']
    | undefined,
  target: Set<string>
): void {
  if (!conditionalInputBindings) {
    return;
  }

  for (const candidates of Object.values(conditionalInputBindings)) {
    for (const candidate of candidates) {
      collectConditionDefinitionInputIds(candidate.condition, target);
    }
  }
}

function collectConditionInputIds(
  inputConditions: Record<string, InputConditionInfo> | undefined,
  target: Set<string>
): void {
  if (!inputConditions) {
    return;
  }

  for (const conditionInfo of Object.values(inputConditions)) {
    collectConditionDefinitionInputIds(conditionInfo.condition, target);
  }
}

function collectConditionDefinitionInputIds(
  condition: InputConditionInfo['condition'],
  target: Set<string>
): void {
  if (Array.isArray(condition)) {
    for (const item of condition) {
      collectConditionItemInputIds(item, target);
    }
    return;
  }

  collectConditionItemInputIds(condition, target);
}

function collectConditionItemInputIds(
  condition:
    | InputConditionInfo['condition']
    | Exclude<InputConditionInfo['condition'], readonly unknown[]>,
  target: Set<string>
): void {
  if (Array.isArray(condition)) {
    collectConditionDefinitionInputIds(condition, target);
    return;
  }

  if ('when' in condition) {
    if (isCanonicalInputId(condition.when)) {
      target.add(condition.when);
    }
    return;
  }

  for (const clause of condition.all ?? []) {
    if (isCanonicalInputId(clause.when)) {
      target.add(clause.when);
    }
  }

  for (const clause of condition.any ?? []) {
    if (isCanonicalInputId(clause.when)) {
      target.add(clause.when);
    }
  }
}

function collectRootOutputBindings(
  canonical: CanonicalBlueprint
): RootOutputBinding[] {
  const rootBindings: RootOutputBinding[] = [];

  for (const binding of canonical.outputSourceBindings) {
    const parsed = parseCanonicalOutputId(binding.outputId);
    if (parsed.path.length > 0) {
      continue;
    }
    rootBindings.push({
      outputId: binding.outputId,
      sourceId: binding.sourceId,
      ...(binding.conditions ? { conditions: binding.conditions } : {}),
      ...(binding.indices ? { indices: binding.indices } : {}),
    });
  }

  return rootBindings;
}

function collectFinalStageProducerJobIds(
  producerGraph: ProducerGraph
): string[] {
  if (producerGraph.nodes.length === 0) {
    return [];
  }

  const jobLayerMap = buildJobLayerMap(producerGraph);
  const maxLayer =
    jobLayerMap.size === 0 ? -1 : Math.max(...jobLayerMap.values());
  if (maxLayer < 0) {
    return [];
  }

  return Array.from(jobLayerMap.entries())
    .filter(([, layer]) => layer === maxLayer)
    .map(([jobId]) => jobId)
    .sort();
}

async function loadOrCreateBuildState(
  service: BuildStateService,
  movieId: string,
  now: () => string
): Promise<{ buildState: BuildState; hash: string | null }> {
  try {
    const result = await service.loadCurrent(movieId);
    return {
      buildState: result.buildState,
      hash: result.hash,
    };
  } catch (error) {
    if (
      error instanceof BuildStateNotFoundError ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === RuntimeErrorCode.BUILD_STATE_NOT_FOUND)
    ) {
      return {
        buildState: {
          revision: 'rev-0000',
          baseRevision: null,
          createdAt: now(),
          inputs: {},
          artifacts: {},
          timeline: {},
        },
        hash: null,
      };
    }
    throw error;
  }
}

function createInputEvents(
  inputValues: Record<string, unknown>,
  revision: RevisionId,
  editedBy: InputEventSource,
  createdAt: string
): InputEvent[] {
  const events: InputEvent[] = [];
  for (const [id, payload] of Object.entries(inputValues)) {
    if (payload === undefined) {
      continue;
    }
    if (!isCanonicalInputId(id)) {
      throw createRuntimeError(
        RuntimeErrorCode.NON_CANONICAL_INPUT_ID,
        `Input "${id}" is not a canonical input id. Expected to start with "Input:".`,
        { context: id }
      );
    }
    events.push(makeInputEvent(id, payload, revision, editedBy, createdAt));
  }
  return events;
}

function buildResolvedInputMap(events: InputEvent[]): Record<string, unknown> {
  const resolved = new Map<string, unknown>();
  for (const event of events) {
    resolved.set(event.id, event.payload);
  }
  return Object.fromEntries(resolved.entries());
}

function makeInputEvent(
  id: string,
  payload: unknown,
  revision: RevisionId,
  editedBy: InputEventSource,
  createdAt: string
): InputEvent {
  const { hash } = hashPayload(payload);
  return {
    id,
    revision,
    payload,
    hash,
    editedBy,
    createdAt,
  };
}

function makeArtifactEvent(
  draft: PendingArtifactDraft,
  revision: RevisionId,
  createdAt: string
): ArtifactEvent {
  return {
    artifactId: draft.artifactId,
    revision,
    inputsHash: draft.inputsHash ?? 'manual-edit',
    output: draft.output,
    status: draft.status ?? 'succeeded',
    producerJobId: draft.producerJobId,
    producerId: draft.producerId,
    diagnostics: draft.diagnostics,
    createdAt,
    lastRevisionBy: draft.lastRevisionBy,
    preEditArtifactHash: draft.preEditArtifactHash,
  };
}

function ensurePendingArtifactOwnership(
  draft: PendingArtifactDraft,
  ownershipByArtifactId: Map<string, ArtifactOwnership>
): PendingArtifactDraft {
  const ownership = resolveArtifactOwnershipFromGraph({
    artifactId: draft.artifactId,
    ownershipByArtifactId,
    context: `planning draft artifact=${draft.artifactId}`,
  });

  if (
    draft.producerJobId !== ownership.producerJobId ||
    draft.producerId !== ownership.producerId
  ) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
      `Draft artifact ${draft.artifactId} has ownership that does not match the current producer graph.`,
      {
        context: `artifactId=${draft.artifactId}`,
        suggestion:
          'Keep draft artifact lineage aligned with the canonical producer graph instead of rewriting ownership for overrides.',
      }
    );
  }

  return draft;
}

async function transformInputBlobsToRefs(
  inputs: Record<string, unknown>,
  storage: StorageContext,
  movieId: string
): Promise<Record<string, unknown>> {
  const transformed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs)) {
    transformed[key] = await convertBlobInputToBlobRef(storage, movieId, value);
  }
  return transformed;
}

/**
 * Apply output schemas from provider options to JSON artifacts in the blueprint tree.
 * This enables virtual artifact decomposition for producers with outputSchema defined
 * in producer metadata and loaded into provider options.
 */
export function applyOutputSchemasToBlueprintTree(
  tree: BlueprintTreeNode,
  providerOptions: Map<string, ProviderOptionEntry>
): void {
  applyOutputSchemasFromProviderOptionsToBlueprintTree(tree, providerOptions);
}

/**
 * Injects derived system inputs into the normalized inputs map.
 * Auto-computes SegmentDuration from Duration and NumOfSegments.
 *
 * This is called during planning to ensure cost estimation and plan preview
 * see the correct derived values.
 *
 * @param inputs - The normalized inputs map with canonical IDs
 * @returns A new inputs map with derived system inputs added
 */
export function injectDerivedInputs(
  inputs: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...inputs };

  // Auto-compute SegmentDuration if Duration and NumOfSegments are present
  const duration = inputs['Input:Duration'];
  const numSegments = inputs['Input:NumOfSegments'];

  if (
    typeof duration === 'number' &&
    typeof numSegments === 'number' &&
    numSegments > 0 &&
    result['Input:SegmentDuration'] === undefined
  ) {
    result['Input:SegmentDuration'] = duration / numSegments;
  }

  return result;
}

function collectPlanningCanonicalInputIds(
  providerOptions: Map<string, ProviderOptionEntry>
): Set<string> {
  const ids = new Set<string>();

  for (const [producerAlias, option] of providerOptions.entries()) {
    const canonicalProducerId = formatCanonicalProducerPath(producerAlias);
    for (const key of option.selectionInputKeys ?? []) {
      ids.add(
        formatProducerScopedInputIdForCanonicalProducerId(
          canonicalProducerId,
          key
        )
      );
    }
    for (const key of option.configInputPaths ?? []) {
      ids.add(
        formatProducerScopedInputIdForCanonicalProducerId(
          canonicalProducerId,
          key
        )
      );
    }
  }

  return ids;
}

export function validateScheduledJobArtifactDependencies(args: {
  movieId: string;
  producerGraph: ProducerGraph;
  scheduledJobIds: Set<string>;
  buildState: BuildState;
  latestSuccessfulArtifactIds: Set<string>;
  resolvedConditionArtifacts?: Record<string, unknown>;
  resolvedConditionInputs?: Record<string, unknown>;
  prunedUnrunnableJobs?: PrunedUnrunnableJob[];
  upToLayer?: number;
}): void {
  if (
    args.scheduledJobIds.size === 0 &&
    (args.prunedUnrunnableJobs?.length ?? 0) === 0
  ) {
    return;
  }

  const nodeById = new Map(
    args.producerGraph.nodes.map((node) => [node.jobId, node])
  );

  const layerByJobId =
    args.upToLayer === undefined
      ? undefined
      : buildJobLayerMap(args.producerGraph);
  const isJobInScope = (jobId: string): boolean => {
    if (args.upToLayer === undefined) {
      return true;
    }
    const layer = layerByJobId?.get(jobId);
    return layer === undefined || layer <= args.upToLayer;
  };

  const producedByScheduled = new Set<string>();
  for (const jobId of args.scheduledJobIds) {
    const node = nodeById.get(jobId);
    if (!node) {
      continue;
    }
    const producedArtifactIds = node.produces;
    for (const artifactId of producedArtifactIds) {
      if (isCanonicalArtifactId(artifactId)) {
        producedByScheduled.add(artifactId);
      }
    }
  }

  const reusableArtifacts = new Set<string>(args.latestSuccessfulArtifactIds);
  for (const [artifactId, entry] of Object.entries(args.buildState.artifacts)) {
    if (entry.status === 'succeeded') {
      reusableArtifacts.add(artifactId);
    }
  }

  const missingDependencies = new Set<string>();
  for (const jobId of args.scheduledJobIds) {
    if (!isJobInScope(jobId)) {
      continue;
    }
    const node = nodeById.get(jobId);
    if (!node) {
      continue;
    }

    const conditionResults = evaluateInputConditions(
      node.context?.inputConditions,
      {
        resolvedArtifacts: args.resolvedConditionArtifacts ?? {},
        resolvedInputs: args.resolvedConditionInputs ?? {},
      }
    );

    const artifactInputs = new Set<string>();
    for (const inputId of node.inputs) {
      if (isCanonicalArtifactId(inputId)) {
        artifactInputs.add(inputId);
      }
    }
    const fanIn = node.context?.fanIn;
    if (fanIn) {
      for (const spec of Object.values(fanIn)) {
        for (const member of spec.members) {
          if (isCanonicalArtifactId(member.id)) {
            artifactInputs.add(member.id);
          }
        }
      }
    }

    for (const artifactId of artifactInputs) {
      if (
        !isScheduledArtifactInputActive(
          artifactId,
          node.context?.inputConditions,
          conditionResults
        )
      ) {
        continue;
      }
      if (producedByScheduled.has(artifactId)) {
        continue;
      }
      if (reusableArtifacts.has(artifactId)) {
        continue;
      }
      missingDependencies.add(`${deriveProducerFamilyId(jobId)} requires ${artifactId}`);
    }
  }

  for (const prunedJob of args.prunedUnrunnableJobs ?? []) {
    if (!isJobInScope(prunedJob.jobId)) {
      continue;
    }
    for (const artifactId of prunedJob.missingArtifactInputs) {
      if (producedByScheduled.has(artifactId)) {
        continue;
      }
      if (reusableArtifacts.has(artifactId)) {
        continue;
      }
      missingDependencies.add(
        `${deriveProducerFamilyId(prunedJob.jobId)} requires ${artifactId}`
      );
    }
  }

  if (missingDependencies.size > 0) {
    throw createRuntimeError(
      RuntimeErrorCode.PRODUCER_OVERRIDE_DEPENDENCY_MISSING,
      `Scheduled jobs require upstream artifacts that are not available or scheduled: ${Array.from(missingDependencies).join('; ')}`,
      {
        context: `movieId=${args.movieId}`,
        suggestion:
          'Check conditional blueprint branches so every active consumer only references artifacts produced by the same branch, or regenerate the missing upstream artifacts first.',
      }
    );
  }
}

function buildJobLayerMap(producerGraph: ProducerGraph): Map<string, number> {
  const nodes = producerGraph.nodes.map((node) => ({ id: node.jobId }));
  const edges = producerGraph.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
  }));
  const { layerAssignments } = computeTopologyLayers(nodes, edges);
  return layerAssignments;
}

function isScheduledArtifactInputActive(
  artifactId: string,
  inputConditions: Record<string, InputConditionInfo> | undefined,
  conditionResults: Map<string, { satisfied: boolean; reason?: string }>
): boolean {
  if (!inputConditions || !(artifactId in inputConditions)) {
    return true;
  }
  const result = conditionResults.get(artifactId);
  if (!result) {
    return true;
  }
  if (result.satisfied) {
    return true;
  }
  return (
    typeof result.reason === 'string' &&
    result.reason.includes('Artifact not found')
  );
}

async function readLatestArtifactSnapshot(
  eventLog: EventLog,
  movieId: string
): Promise<{
  latestById: Map<string, ArtifactEvent>;
  latestSuccessfulIds: Set<string>;
  latestFailedIds: Set<string>;
}> {
  const latestById = new Map<string, ArtifactEvent>();
  for await (const event of eventLog.streamArtifacts(movieId)) {
    latestById.set(event.artifactId, event);
  }

  const latestSuccessfulIds = new Set<string>();
  const latestFailedIds = new Set<string>();
  for (const [artifactId, event] of latestById) {
    if (event.status === 'succeeded') {
      latestSuccessfulIds.add(artifactId);
      continue;
    }
    if (event.status === 'failed') {
      latestFailedIds.add(artifactId);
    }
  }

  return {
    latestById,
    latestSuccessfulIds,
    latestFailedIds,
  };
}

const TRUE_LITERAL_HASH =
  'b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b';
const FALSE_LITERAL_HASH =
  'fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa';
const NULL_LITERAL_HASH =
  '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b';

async function resolveConditionArtifactsForPlanning(args: {
  artifactIds: string[];
  eventLog: EventLog;
  storage: StorageContext;
  fallbackStorage?: StorageContext;
  movieId: string;
}): Promise<Record<string, unknown>> {
  if (args.artifactIds.length === 0) {
    return {};
  }

  const requested = new Set(args.artifactIds);
  const latestEvents = new Map<string, ArtifactEvent>();
  for await (const event of args.eventLog.streamArtifacts(args.movieId)) {
    if (!requested.has(event.artifactId)) {
      continue;
    }
    latestEvents.set(event.artifactId, event);
  }

  const resolved: Record<string, unknown> = {};
  for (const [artifactId, event] of latestEvents) {
    if (event.status !== 'succeeded') {
      continue;
    }

    const blob = event.output.blob;
    if (!blob) {
      continue;
    }

    const payload = await readConditionBlobPayload({
      artifactId,
      blob,
      movieId: args.movieId,
      storages: [args.storage, args.fallbackStorage].filter(
        (storage): storage is StorageContext => storage !== undefined
      ),
    });
    if (payload === null) {
      const inferred = inferConditionLiteralFromHash(blob.hash, blob.mimeType);
      if (inferred !== undefined) {
        resolved[artifactId] = inferred;
        continue;
      }

      throw createRuntimeError(
        RuntimeErrorCode.CONDITION_EVALUATION_ERROR,
        `Condition artifact "${artifactId}" points to blob "${blob.hash}" but its payload could not be found in planning or persistent storage.`,
        {
          context: `movieId=${args.movieId}`,
          suggestion:
            'Restore the missing blob or regenerate the upstream artifact before replanning.',
        }
      );
    }

    try {
      resolved[artifactId] = decodeConditionPayload(payload, blob.mimeType);
    } catch (error) {
      throw createRuntimeError(
        RuntimeErrorCode.CONDITION_EVALUATION_ERROR,
        `Failed to decode condition artifact "${artifactId}" from blob "${blob.hash}".`,
        {
          context: `movieId=${args.movieId}`,
          cause: error,
        }
      );
    }
  }

  return resolved;
}

async function readConditionBlobPayload(args: {
  artifactId: string;
  blob: { hash: string; mimeType?: string };
  movieId: string;
  storages: StorageContext[];
}): Promise<Uint8Array | null> {
  for (const storage of args.storages) {
    const blobPath = await resolveConditionBlobPath({
      storage,
      movieId: args.movieId,
      hash: args.blob.hash,
      mimeType: args.blob.mimeType,
    });
    if (!blobPath) {
      continue;
    }

    try {
      return await storage.storage.readToUint8Array(blobPath);
    } catch (error) {
      throw createRuntimeError(
        RuntimeErrorCode.CONDITION_EVALUATION_ERROR,
        `Failed to read condition artifact "${args.artifactId}" blob at "${blobPath}".`,
        {
          context: `movieId=${args.movieId}`,
          filePath: blobPath,
          cause: error,
        }
      );
    }
  }

  return null;
}

async function resolveConditionBlobPath(args: {
  storage: StorageContext;
  movieId: string;
  hash: string;
  mimeType?: string;
}): Promise<string | null> {
  const prefix = args.hash.slice(0, 2);
  const fileName = formatBlobFileName(args.hash, args.mimeType);
  const primaryPath = args.storage.resolve(args.movieId, 'blobs', prefix, fileName);
  if (await args.storage.storage.fileExists(primaryPath)) {
    return primaryPath;
  }

  const legacyPath = args.storage.resolve(args.movieId, 'blobs', prefix, args.hash);
  if (legacyPath !== primaryPath && (await args.storage.storage.fileExists(legacyPath))) {
    return legacyPath;
  }

  return null;
}

function decodeConditionPayload(
  payload: Uint8Array,
  mimeType: string | undefined
): unknown {
  if (!isTextLikeMimeType(mimeType)) {
    return payload;
  }

  const text = new TextDecoder().decode(payload);
  if (mimeType?.toLowerCase() === 'application/json') {
    return JSON.parse(text);
  }

  const normalized = text.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  if (normalized === 'null') {
    return null;
  }

  return text;
}

function inferConditionLiteralFromHash(
  hash: string,
  mimeType: string | undefined
): boolean | null | undefined {
  if (!isTextLikeMimeType(mimeType)) {
    return undefined;
  }

  if (hash === TRUE_LITERAL_HASH) {
    return true;
  }
  if (hash === FALSE_LITERAL_HASH) {
    return false;
  }
  if (hash === NULL_LITERAL_HASH) {
    return null;
  }

  return undefined;
}

function isTextLikeMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) {
    return false;
  }
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith('text/') || normalized === 'application/json';
}
