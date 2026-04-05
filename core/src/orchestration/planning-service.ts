import { buildBlueprintGraph } from '../resolution/canonical-graph.js';
import { expandBlueprintGraph } from '../resolution/canonical-expander.js';
import {
  buildInputSourceMapFromCanonical,
  normalizeInputValues,
} from '../resolution/input-sources.js';
import { createProducerGraph } from '../resolution/producer-graph.js';
import {
  createPlanAdapter,
  type PlanAdapterOptions,
} from '../planning/adapter.js';
import {
  collectRequiredConditionArtifactIds,
  computeMultipleArtifactRegenerationJobs,
} from '../planning/planner.js';
import type { PlanExplanation } from '../planning/explanation.js';
import { evaluateInputConditions } from '../condition-evaluator.js';
import {
  isCanonicalArtifactId,
  isCanonicalInputId,
  isCanonicalProducerId,
} from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type { EventLog } from '../event-log.js';
import { hashPayload } from '../hashing.js';
import { ManifestNotFoundError, type ManifestService } from '../manifest.js';
import { nextRevisionId } from '../revisions.js';
import { planStore, type StorageContext } from '../storage.js';
import { computeTopologyLayers } from '../topology/index.js';
import type { Clock } from '../types.js';
import { convertBlobInputToBlobRef } from '../input-blob-storage.js';
import { formatBlobFileName } from '../blob-utils.js';
import {
  applyOutputSchemasFromProviderOptionsToBlueprintTree,
} from './output-schema-hydration.js';
import {
  buildProducerSchedulingSummary,
  deriveProducerFamilyId,
  normalizeProducerOverrides,
} from './producer-overrides.js';
import type {
  ArtefactEvent,
  ArtefactEventOutput,
  ArtefactEventStatus,
  ArtifactRegenerationConfig,
  BlueprintTreeNode,
  BlueprintProducerOutputDefinition,
  ExecutionPlan,
  InputEvent,
  InputEventSource,
  MappingFieldDefinition,
  Manifest,
  ProducerCatalog,
  ProducerGraph,
  ProducerOverrides,
  ProducerSchedulingSummary,
  PlanningWarning,
  RevisionId,
  InputConditionInfo,
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

export interface PendingArtefactDraft {
  artefactId: string;
  producedBy: string;
  output: ArtefactEventOutput;
  inputsHash?: string;
  status?: ArtefactEventStatus;
  diagnostics?: Record<string, unknown>;
}

export interface GeneratePlanArgs {
  movieId: string;
  blueprintTree: BlueprintTreeNode;
  inputValues: Record<string, unknown>;
  providerCatalog: ProducerCatalog;
  providerOptions: Map<string, ProviderOptionEntry>;
  storage: StorageContext;
  manifestService: ManifestService;
  eventLog: EventLog;
  pendingArtefacts?: PendingArtefactDraft[];
  inputSource?: InputEventSource;
  /**
   * Explicit regeneration targets.
   * Supports canonical Artifact:... and Producer:... IDs.
   */
  regenerateIds?: string[];
  /** Scope mode for surgical regeneration targeting. Defaults to lineage-plus-dirty. */
  surgicalRegenerationScope?: SurgicalRegenerationScope;
  /** Limit plan to layers 0 through upToLayer (0-indexed). Jobs in later layers are excluded from the plan. */
  upToLayer?: number;
  /** If true, collect explanation data for why jobs are scheduled */
  collectExplanation?: boolean;
  /** Canonical pin IDs (`Artifact:...` or `Producer:...`) from wrappers. */
  pinIds?: string[];
  /** Artifact IDs that are pinned (kept). Jobs whose produced artifacts are ALL pinned are excluded from the plan. */
  pinnedArtifactIds?: string[];
  /** Producer IDs that are pinned (legacy/compat). */
  pinnedProducerIds?: string[];
  /** Producer-level scheduling overrides. */
  producerOverrides?: ProducerOverrides;
}

export interface GeneratePlanResult {
  plan: ExecutionPlan;
  planPath: string;
  targetRevision: RevisionId;
  manifest: Manifest;
  manifestHash: string | null;
  inputEvents: InputEvent[];
  resolvedInputs: Record<string, unknown>;
  /** Explanation of why jobs were scheduled (only if collectExplanation was true) */
  explanation?: PlanExplanation;
  /** Effective producer-level scheduling metadata for UI/CLI displays. */
  producerScheduling?: ProducerSchedulingSummary[];
  /** Non-fatal warnings about override interactions. */
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

      const { manifest, hash: manifestHash } = await loadOrCreateManifest(
        args.manifestService,
        args.movieId,
        now
      );

      let targetRevision = nextRevisionId(manifest.revision ?? null);
      targetRevision = await ensureUniquePlanRevision(
        args.storage,
        args.movieId,
        targetRevision
      );

      // Apply output schemas from provider options to JSON artifacts.
      // This enables virtual artifact decomposition for producers with outputSchema in producer metadata.
      applyOutputSchemasFromProviderOptionsToBlueprintTree(
        args.blueprintTree,
        args.providerOptions
      );

      const blueprintGraph = buildBlueprintGraph(args.blueprintTree);
      const inputSources = buildInputSourceMapFromCanonical(blueprintGraph);
      const normalizedInputs = normalizeInputValues(
        args.inputValues,
        inputSources
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
        targetRevision,
        args.inputSource ?? 'user',
        now()
      );
      for (const event of inputEvents) {
        await args.eventLog.appendInput(args.movieId, event);
      }
      const resolvedInputs = buildResolvedInputMap(inputEvents);
      // Note: Blueprint defaults are no longer applied - model JSON schemas are the source of truth

      const artefactEvents = (args.pendingArtefacts ?? []).map((draft) =>
        makeArtefactEvent(draft, targetRevision, now())
      );
      for (const artefactEvent of artefactEvents) {
        await args.eventLog.appendArtefact(args.movieId, artefactEvent);
      }

      const canonicalBlueprint = expandBlueprintGraph(
        blueprintGraph,
        normalizedInputs,
        inputSources
      );
      const producerGraph = createProducerGraph(
        canonicalBlueprint,
        args.providerCatalog,
        args.providerOptions
      );

      const normalizedProducerOverrides = normalizeProducerOverrides({
        producerGraph,
        overrides: args.producerOverrides,
      });

      const latestArtefactSnapshot = await readLatestArtefactSnapshot(
        args.eventLog,
        args.movieId
      );

      const planningWarnings: PlanningWarning[] = [];
      const regenerationIds = args.regenerateIds ?? [];

      // Resolve explicit regeneration targets.
      let artifactRegenerations: ArtifactRegenerationConfig[] | undefined;
      const targetedArtifactIds: string[] = [];
      const targetedProducerIds: string[] = [];
      for (const id of regenerationIds) {
        if (isCanonicalArtifactId(id)) {
          targetedArtifactIds.push(id);
          continue;
        }
        if (isCanonicalProducerId(id)) {
          targetedProducerIds.push(id);
          continue;
        }
        throw createRuntimeError(
          RuntimeErrorCode.INVALID_PIN_ID,
          `Invalid regenerate target "${id}". Expected canonical Artifact:... or Producer:... ID.`,
          {
            context: `regenerateId=${id}`,
            suggestion:
              'Use canonical IDs, for example Artifact:AudioProducer.GeneratedAudio[0] or Producer:AudioProducer.',
          }
        );
      }

      if (targetedArtifactIds.length > 0) {
        artifactRegenerations = resolveArtifactsToJobs(
          targetedArtifactIds,
          manifest,
          producerGraph,
          latestArtefactSnapshot.latestById
        );
      }

      const artifactSourceJobIds = artifactRegenerations?.map(
        (item) => item.sourceJobId
      ) ?? [];
      const producerSourceJobIds =
        targetedProducerIds.length > 0
          ? resolveProducerIdsToJobs(targetedProducerIds, producerGraph)
          : [];
      const forceSourceJobIds = Array.from(
        new Set([...artifactSourceJobIds, ...producerSourceJobIds])
      );

      const artifactForceTargetJobIds = forceSourceJobIds.length > 0
        ? Array.from(
            computeMultipleArtifactRegenerationJobs(
              forceSourceJobIds,
              producerGraph
            )
          )
        : [];

      const forceTargetJobIdSet = new Set<string>(artifactForceTargetJobIds);

      if (normalizedProducerOverrides.allowedProducerJobIds.length > 0) {
        const allowedScope = new Set(normalizedProducerOverrides.allowedProducerJobIds);
        const droppedScopeJobs: string[] = [];
        for (const jobId of Array.from(forceTargetJobIdSet)) {
          if (!allowedScope.has(jobId)) {
            forceTargetJobIdSet.delete(jobId);
            droppedScopeJobs.push(jobId);
          }
        }
        if (droppedScopeJobs.length > 0) {
          planningWarnings.push({
            code: 'REGEN_SCOPE_EXCLUDED',
            message:
              `Some regenerate targets were excluded by producer scope: ${droppedScopeJobs.join(', ')}`,
          });
        }
      }

      if (normalizedProducerOverrides.blockedProducerJobIds.length > 0) {
        const blockedJobs = new Set(normalizedProducerOverrides.blockedProducerJobIds);
        const droppedBlockedJobs: string[] = [];
        for (const jobId of Array.from(forceTargetJobIdSet)) {
          if (blockedJobs.has(jobId)) {
            forceTargetJobIdSet.delete(jobId);
            droppedBlockedJobs.push(jobId);
          }
        }
        if (droppedBlockedJobs.length > 0) {
          planningWarnings.push({
            code: 'REGEN_SCOPE_EXCLUDED',
            message:
              `Some regenerate targets were excluded by producer count/disable directives: ${droppedBlockedJobs.join(', ')}`,
          });
        }
      }

      const effectiveUpToLayer =
        normalizedProducerOverrides.hasOverrides ? undefined : args.upToLayer;
      if (effectiveUpToLayer !== undefined && forceTargetJobIdSet.size > 0) {
        const layerByJobId = buildJobLayerMap(producerGraph);
        const droppedLayerJobs: string[] = [];
        for (const jobId of Array.from(forceTargetJobIdSet)) {
          const layer = layerByJobId.get(jobId);
          if (layer !== undefined && layer > effectiveUpToLayer) {
            forceTargetJobIdSet.delete(jobId);
            droppedLayerJobs.push(jobId);
          }
        }
        if (droppedLayerJobs.length > 0) {
          planningWarnings.push({
            code: 'REGEN_SCOPE_EXCLUDED',
            message:
              `Some regenerate targets were excluded by --up scope: ${droppedLayerJobs.join(', ')}`,
          });
        }
      }

      const forceTargetArtifactIds = new Set<string>();
      if (targetedArtifactIds.length > 0) {
        for (const artifactId of targetedArtifactIds) {
          forceTargetArtifactIds.add(artifactId);
        }
      }
      const nodeById = new Map(
        producerGraph.nodes.map((node) => [node.jobId, node])
      );
      for (const jobId of forceTargetJobIdSet) {
        const node = nodeById.get(jobId);
        if (!node) {
          continue;
        }
        for (const artifactId of node.produces) {
          if (isCanonicalArtifactId(artifactId)) {
            forceTargetArtifactIds.add(artifactId);
          }
        }
      }

      const pinResolution = await resolveAndValidatePinIds({
        movieId: args.movieId,
        pinIds: args.pinIds,
        pinnedArtifactIds: args.pinnedArtifactIds,
        pinnedProducerIds: args.pinnedProducerIds,
        manifest,
        eventLog: args.eventLog,
        producerGraph,
        forceTargetArtifactIds: Array.from(forceTargetArtifactIds),
        latestSnapshot: latestArtefactSnapshot,
      });
      if (pinResolution.warnings.length > 0) {
        planningWarnings.push(...pinResolution.warnings);
      }
      const resolvedPinnedArtifactIds = pinResolution.pinnedArtifactIds;

      const requiredConditionArtifactIds =
        collectRequiredConditionArtifactIds(producerGraph);
      const resolvedConditionArtifacts =
        requiredConditionArtifactIds.size > 0
          ? await resolveConditionArtifactsForPlanning({
              artifactIds: Array.from(requiredConditionArtifactIds),
              eventLog: args.eventLog,
              storage: args.storage,
              movieId: args.movieId,
            })
          : undefined;

      const { plan, explanation } = await adapter.compute({
        movieId: args.movieId,
        manifest,
        eventLog: args.eventLog,
        blueprint: producerGraph,
        targetRevision,
        pendingEdits: inputEvents,
        resolvedConditionArtifacts,
        artifactRegenerations,
        surgicalRegenerationScope: args.surgicalRegenerationScope,
        upToLayer: effectiveUpToLayer,
        collectExplanation: args.collectExplanation,
        pinnedArtifactIds:
          resolvedPinnedArtifactIds.length > 0
            ? resolvedPinnedArtifactIds
            : undefined,
        forceTargetJobIds:
          forceTargetJobIdSet.size > 0
            ? Array.from(forceTargetJobIdSet)
            : undefined,
        allowedProducerJobIds:
          normalizedProducerOverrides.allowedProducerJobIds.length > 0
            ? normalizedProducerOverrides.allowedProducerJobIds
            : undefined,
        blockedProducerJobIds:
          normalizedProducerOverrides.blockedProducerJobIds.length > 0
            ? normalizedProducerOverrides.blockedProducerJobIds
            : undefined,
      });

      const scheduledJobIds = new Set(plan.layers.flat().map((job) => job.jobId));
      if (normalizedProducerOverrides.hasOverrides) {
        validateProducerOverrideDependencies({
          movieId: args.movieId,
          producerGraph,
          scheduledJobIds,
          manifest,
          latestSuccessfulArtifactIds: latestArtefactSnapshot.latestSuccessfulIds,
          resolvedConditionArtifacts,
        });
      }

      const producerScheduling = buildProducerSchedulingSummary({
        normalizedOverrides: normalizedProducerOverrides,
        scheduledJobIds,
      });

      await planStore.save(plan, {
        movieId: args.movieId,
        storage: args.storage,
      });
      const planPath = args.storage.resolve(
        args.movieId,
        'runs',
        `${targetRevision}-plan.json`
      );

      // Merge current input events into the manifest so the runner has
      // up-to-date input hashes for content-aware inputsHash computation.
      const manifestWithInputs = mergeInputEventsIntoManifest(
        manifest,
        inputEvents
      );

      return {
        plan,
        planPath,
        targetRevision,
        manifest: manifestWithInputs,
        manifestHash,
        inputEvents,
        resolvedInputs,
        explanation,
        producerScheduling,
        warnings: planningWarnings.length > 0 ? planningWarnings : undefined,
      };
    },
  };
}

async function loadOrCreateManifest(
  service: ManifestService,
  movieId: string,
  now: () => string
): Promise<{ manifest: Manifest; hash: string | null }> {
  try {
    const { manifest, hash } = await service.loadCurrent(movieId);
    return { manifest, hash };
  } catch (error) {
    if (error instanceof ManifestNotFoundError) {
      return {
        manifest: {
          revision: 'rev-0000',
          baseRevision: null,
          createdAt: now(),
          inputs: {},
          artefacts: {},
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

function makeArtefactEvent(
  draft: PendingArtefactDraft,
  revision: RevisionId,
  createdAt: string
): ArtefactEvent {
  return {
    artefactId: draft.artefactId,
    revision,
    inputsHash: draft.inputsHash ?? 'manual-edit',
    output: draft.output,
    status: draft.status ?? 'succeeded',
    producedBy: draft.producedBy,
    diagnostics: draft.diagnostics,
    createdAt,
  };
}

/**
 * Merge current input events into the manifest's inputs map.
 * This ensures the runner has up-to-date input hashes for content-aware
 * inputsHash computation (so hashInputContents can resolve real content
 * hashes instead of falling back to hashing ID strings).
 */
function mergeInputEventsIntoManifest(
  manifest: Manifest,
  inputEvents: InputEvent[]
): Manifest {
  if (inputEvents.length === 0) {
    return manifest;
  }
  const mergedInputs = { ...manifest.inputs };
  for (const event of inputEvents) {
    mergedInputs[event.id] = {
      hash: event.hash,
      payloadDigest: hashPayload(event.payload).canonical,
      createdAt: event.createdAt,
    };
  }
  return { ...manifest, inputs: mergedInputs };
}

async function ensureUniquePlanRevision(
  storage: StorageContext,
  movieId: string,
  initial: RevisionId
): Promise<RevisionId> {
  let candidate = initial;
  while (await planExists(storage, movieId, candidate)) {
    candidate = nextRevisionId(candidate);
  }
  return candidate;
}

async function planExists(
  storage: StorageContext,
  movieId: string,
  revision: RevisionId
): Promise<boolean> {
  const planPath = storage.resolve(movieId, 'runs', `${revision}-plan.json`);
  return storage.storage.fileExists(planPath);
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

interface ResolveAndValidatePinIdsArgs {
  movieId: string;
  pinIds?: string[];
  pinnedArtifactIds?: string[];
  pinnedProducerIds?: string[];
  manifest: Manifest;
  eventLog: EventLog;
  producerGraph: { nodes: Array<{ jobId: string; produces: string[] }> };
  forceTargetArtifactIds?: string[];
  latestSnapshot?: {
    latestById: Map<string, ArtefactEvent>;
    latestSuccessfulIds: Set<string>;
    latestFailedIds: Set<string>;
  };
}

interface PinResolutionResult {
  pinnedArtifactIds: string[];
  warnings: PlanningWarning[];
}

async function resolveAndValidatePinIds(
  args: ResolveAndValidatePinIdsArgs
): Promise<PinResolutionResult> {
  const requestedPinIds = [
    ...(args.pinIds ?? []),
    ...(args.pinnedArtifactIds ?? []),
    ...(args.pinnedProducerIds ?? []),
  ];

  if (requestedPinIds.length === 0) {
    return {
      pinnedArtifactIds: [],
      warnings: [],
    };
  }

  const artifactPins = new Set<string>();
  const producerPins = new Set<string>();

  for (const id of requestedPinIds) {
    if (isCanonicalArtifactId(id)) {
      artifactPins.add(id);
      continue;
    }
    if (isCanonicalProducerId(id)) {
      producerPins.add(id);
      continue;
    }
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_PIN_ID,
      `Invalid pin ID "${id}". Expected canonical Artifact:... or Producer:...`,
      {
        context: `pinId=${id}`,
        suggestion:
          'Use canonical IDs, for example Artifact:ScriptProducer.NarrationScript[0] or Producer:ScriptProducer.',
      }
    );
  }

  const producerNodeMap = new Map<
    string,
    { jobId: string; produces: string[] }
  >();
  for (const node of args.producerGraph.nodes) {
    producerNodeMap.set(node.jobId, node);
  }

  for (const producerId of producerPins) {
    const node = producerNodeMap.get(producerId);
    if (!node) {
      throw createRuntimeError(
        RuntimeErrorCode.PIN_PRODUCER_NOT_FOUND,
        `Pinned producer "${producerId}" was not found in the current producer graph.`,
        {
          context: `producerId=${producerId}`,
          suggestion:
            'Check the producer canonical ID against the current blueprint graph.',
        }
      );
    }
    const producedArtifacts = node.produces.filter((id) =>
      isCanonicalArtifactId(id)
    );
    if (producedArtifacts.length === 0) {
      throw createRuntimeError(
        RuntimeErrorCode.PIN_TARGET_NOT_REUSABLE,
        `Pinned producer "${producerId}" does not produce reusable canonical artifacts.`,
        {
          context: `producerId=${producerId}`,
          suggestion:
            'Pin canonical artifact IDs produced by this run, or pin a producer that emits canonical artifacts.',
        }
      );
    }
    for (const artifactId of producedArtifacts) {
      artifactPins.add(artifactId);
    }
  }

  const resolvedPinnedArtifactIds = [...artifactPins];

  const snapshot =
    args.latestSnapshot ??
    (await readLatestArtefactSnapshot(args.eventLog, args.movieId));
  const hasSucceededManifestArtifacts = Object.values(
    args.manifest.artefacts
  ).some((entry) => entry.status === 'succeeded');
  const hasPriorReusableArtifacts =
    hasSucceededManifestArtifacts || snapshot.latestSuccessfulIds.size > 0;
  if (!hasPriorReusableArtifacts) {
    throw createRuntimeError(
      RuntimeErrorCode.PIN_REQUIRES_EXISTING_MOVIE,
      'Pinning requires an existing movie with reusable outputs. Use --last or --movie-id/--id after a successful run.',
      {
        context: `movieId=${args.movieId}`,
        suggestion:
          'Run the first generation without --pin, then pin artifacts/producers on subsequent runs.',
      }
    );
  }

  await validatePinnedTargetsReusable(
    args.movieId,
    resolvedPinnedArtifactIds,
    args.manifest,
    snapshot
  );

  const forceTargets = new Set(args.forceTargetArtifactIds ?? []);
  const overlappingPins = resolvedPinnedArtifactIds.filter((artifactId) =>
    forceTargets.has(artifactId)
  );
  const pinnedArtifactIds = resolvedPinnedArtifactIds.filter(
    (artifactId) => !forceTargets.has(artifactId)
  );

  const warnings: PlanningWarning[] = [];
  if (overlappingPins.length > 0) {
    warnings.push({
      code: 'PIN_REGEN_CONFLICT',
      message:
        `Regenerate targets override pinned artifacts for this plan: ${overlappingPins.join(', ')}`,
    });
  }

  return {
    pinnedArtifactIds,
    warnings,
  };
}

async function validatePinnedTargetsReusable(
  movieId: string,
  pinnedArtifactIds: string[],
  manifest: Manifest,
  snapshot: { latestSuccessfulIds: Set<string>; latestFailedIds: Set<string> }
): Promise<void> {
  if (pinnedArtifactIds.length === 0) {
    return;
  }
  const invalid: string[] = [];

  for (const artifactId of pinnedArtifactIds) {
    if (snapshot.latestFailedIds.has(artifactId)) {
      invalid.push(`${artifactId} (latest attempt failed)`);
      continue;
    }
    if (snapshot.latestSuccessfulIds.has(artifactId)) {
      continue;
    }
    const manifestEntry = manifest.artefacts[artifactId];
    if (manifestEntry?.status === 'succeeded') {
      continue;
    }
    invalid.push(`${artifactId} (no reusable successful artifact found)`);
  }

  if (invalid.length > 0) {
    throw createRuntimeError(
      RuntimeErrorCode.PIN_TARGET_NOT_REUSABLE,
      `Pinned artifact(s) are not reusable: ${invalid.join('; ')}`,
      {
        context: `movieId=${movieId}`,
        suggestion: 'Unpin these IDs or regenerate them before pinning.',
      }
    );
  }
}

function validateProducerOverrideDependencies(args: {
  movieId: string;
  producerGraph: ProducerGraph;
  scheduledJobIds: Set<string>;
  manifest: Manifest;
  latestSuccessfulArtifactIds: Set<string>;
  resolvedConditionArtifacts?: Record<string, unknown>;
}): void {
  if (args.scheduledJobIds.size === 0) {
    return;
  }

  const nodeById = new Map(
    args.producerGraph.nodes.map((node) => [node.jobId, node])
  );
  const producedByScheduled = new Set<string>();
  for (const jobId of args.scheduledJobIds) {
    const node = nodeById.get(jobId);
    if (!node) {
      continue;
    }
    for (const artifactId of node.produces) {
      if (isCanonicalArtifactId(artifactId)) {
        producedByScheduled.add(artifactId);
      }
    }
  }

  const reusableArtifacts = new Set<string>(args.latestSuccessfulArtifactIds);
  for (const [artifactId, entry] of Object.entries(args.manifest.artefacts)) {
    if (entry.status === 'succeeded') {
      reusableArtifacts.add(artifactId);
    }
  }

  const missingDependencies = new Set<string>();
  for (const jobId of args.scheduledJobIds) {
    const node = nodeById.get(jobId);
    if (!node) {
      continue;
    }

    const conditionResults = evaluateInputConditions(
      node.context?.inputConditions,
      {
        resolvedArtifacts: args.resolvedConditionArtifacts ?? {},
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

  if (missingDependencies.size > 0) {
    throw createRuntimeError(
      RuntimeErrorCode.PRODUCER_OVERRIDE_DEPENDENCY_MISSING,
      `Producer overrides leave required upstream artifacts unavailable: ${Array.from(missingDependencies).join('; ')}`,
      {
        context: `movieId=${args.movieId}`,
        suggestion:
          'Adjust producer selection/count overrides so required upstream artifacts are scheduled or already reusable.',
      }
    );
  }
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

async function readLatestArtefactSnapshot(
  eventLog: EventLog,
  movieId: string
): Promise<{
  latestById: Map<string, ArtefactEvent>;
  latestSuccessfulIds: Set<string>;
  latestFailedIds: Set<string>;
}> {
  const latestById = new Map<string, ArtefactEvent>();
  for await (const event of eventLog.streamArtefacts(movieId)) {
    latestById.set(event.artefactId, event);
  }

  const latestSuccessfulIds = new Set<string>();
  const latestFailedIds = new Set<string>();
  for (const [artefactId, event] of latestById) {
    if (event.status === 'succeeded') {
      latestSuccessfulIds.add(artefactId);
      continue;
    }
    if (event.status === 'failed') {
      latestFailedIds.add(artefactId);
    }
  }

  return {
    latestById,
    latestSuccessfulIds,
    latestFailedIds,
  };
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

function resolveProducerIdsToJobs(
  producerIds: string[],
  producerGraph: ProducerGraph
): string[] {
  const jobIds: string[] = [];
  const graphJobIds = producerGraph.nodes.map((node) => node.jobId);
  const seenFamilies = new Set<string>();

  for (const producerId of producerIds) {
    if (!isCanonicalProducerId(producerId) || producerId.includes('[')) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_PRODUCER_OVERRIDE_FORMAT,
        `Invalid producer regenerate target "${producerId}". Expected canonical Producer:Alias.`,
        {
          context: `producerId=${producerId}`,
          suggestion:
            'Use canonical producer IDs, for example Producer:AudioProducer.',
        }
      );
    }

    if (seenFamilies.has(producerId)) {
      continue;
    }
    seenFamilies.add(producerId);

    const familyJobIds = graphJobIds.filter(
      (jobId) => deriveProducerFamilyId(jobId) === producerId
    );
    if (familyJobIds.length === 0) {
      throw createRuntimeError(
        RuntimeErrorCode.UNKNOWN_PRODUCER_OVERRIDE_TARGET,
        `Producer regenerate target "${producerId}" was not found in the current producer graph.`,
        {
          context: `producerId=${producerId}`,
          suggestion:
            'Check the canonical producer ID against the current blueprint graph.',
        }
      );
    }
    jobIds.push(...familyJobIds);
  }

  return jobIds;
}

/**
 * Resolve multiple artifact IDs to their producing jobs.
 * Used for surgical regeneration of multiple artifacts.
 *
 * @param artifactIds - Array of canonical artifact IDs (e.g., ["Artifact:AudioProducer.GeneratedAudio[0]"])
 * @param manifest - The current manifest containing artifact entries
 * @param latestById - Latest artifact events keyed by artifact ID (fallback when manifest is stale)
 * @param producerGraph - The producer graph with all job nodes
 * @returns Array of ArtifactRegenerationConfig with target artifacts and source jobs
 * @throws ARTIFACT_NOT_IN_MANIFEST if any artifact not found in manifest or event log
 * @throws ARTIFACT_JOB_NOT_FOUND if any producing job not found in graph
 */
export function resolveArtifactsToJobs(
  artifactIds: string[],
  manifest: Manifest,
  producerGraph: { nodes: Array<{ jobId: string }> },
  latestById?: Map<string, ArtefactEvent>
): ArtifactRegenerationConfig[] {
  return artifactIds.map((id) =>
    resolveArtifactToJob(id, manifest, producerGraph, latestById)
  );
}

/**
 * Resolve an artifact ID to the job that produces it.
 * Used for surgical artifact regeneration.
 *
 * @param artifactId - The canonical artifact ID (e.g., "Artifact:AudioProducer.GeneratedAudio[0]")
 * @param manifest - The current manifest containing artifact entries
 * @param latestById - Latest artifact events keyed by artifact ID (fallback when manifest is stale)
 * @param producerGraph - The producer graph with all job nodes
 * @returns ArtifactRegenerationConfig with target artifact and source job
 * @throws ARTIFACT_NOT_IN_MANIFEST if artifact not found in manifest or event log
 * @throws ARTIFACT_JOB_NOT_FOUND if producing job not found in graph
 */
export function resolveArtifactToJob(
  artifactId: string,
  manifest: Manifest,
  producerGraph: { nodes: Array<{ jobId: string }> },
  latestById?: Map<string, ArtefactEvent>
): ArtifactRegenerationConfig {
  const entry = manifest.artefacts[artifactId];
  const latestEvent = latestById?.get(artifactId);
  const sourceJobId = entry?.producedBy ?? latestEvent?.producedBy;

  if (!sourceJobId) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_NOT_IN_MANIFEST,
      `Artifact "${artifactId}" not found in manifest or event log. ` +
        `The artifact may not have been generated yet, or the ID may be incorrect.`,
      { context: `artifactId=${artifactId}` }
    );
  }

  // Verify the job exists in the producer graph
  const jobExists = producerGraph.nodes.some(
    (node) => node.jobId === sourceJobId
  );
  if (!jobExists) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_JOB_NOT_FOUND,
      `Job "${sourceJobId}" that produced artifact "${artifactId}" not found in producer graph. ` +
        `The blueprint structure may have changed since the artifact was generated.`,
      { context: `artifactId=${artifactId}, sourceJobId=${sourceJobId}` }
    );
  }

  return {
    targetArtifactId: artifactId,
    sourceJobId,
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
  movieId: string;
}): Promise<Record<string, unknown>> {
  if (args.artifactIds.length === 0) {
    return {};
  }

  const requested = new Set(args.artifactIds);
  const latestEvents = new Map<string, ArtefactEvent>();
  for await (const event of args.eventLog.streamArtefacts(args.movieId)) {
    if (event.status !== 'succeeded') {
      continue;
    }
    if (!requested.has(event.artefactId)) {
      continue;
    }
    latestEvents.set(event.artefactId, event);
  }

  const resolved: Record<string, unknown> = {};
  for (const [artifactId, event] of latestEvents) {
    const blob = event.output.blob;
    if (!blob) {
      continue;
    }

    const prefix = blob.hash.slice(0, 2);
    const fileName = formatBlobFileName(blob.hash, blob.mimeType);
    const blobPath = args.storage.resolve(
      args.movieId,
      'blobs',
      prefix,
      fileName
    );

    try {
      const payload = await args.storage.storage.readToUint8Array(blobPath);
      resolved[artifactId] = decodeConditionPayload(payload, blob.mimeType);
      continue;
    } catch {
      const inferred = inferConditionLiteralFromHash(blob.hash, blob.mimeType);
      if (inferred !== undefined) {
        resolved[artifactId] = inferred;
      }
    }
  }

  return resolved;
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
