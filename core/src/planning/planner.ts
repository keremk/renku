import {
  formatCanonicalArtifactId,
  isCanonicalArtifactId,
  isCanonicalInputId,
} from '../canonical-ids.js';
import { evaluateInputConditions } from '../condition-evaluator.js';
import type { EventLog } from '../event-log.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import { hashPayload, hashInputContents } from '../hashing.js';
import { deriveArtefactHash } from '../manifest.js';
import { computeTopologyLayers } from '../topology/index.js';
import {
  type ArtifactRegenerationConfig,
  type Clock,
  type EdgeConditionClause,
  type EdgeConditionDefinition,
  type EdgeConditionGroup,
  type ExecutionPlan,
  type InputEvent,
  type Manifest,
  type ArtefactEvent,
  type ProducerGraph,
  type ResolvedEdgeCondition,
  type ResolvedEdgeConditionGroup,
  type RevisionId,
} from '../types.js';
import type { Logger } from '../logger.js';
import type { NotificationBus } from '../notifications.js';
import type { JobDirtyReason, PlanExplanation } from './explanation.js';

export interface PlannerOptions {
  logger?: Partial<Logger>;
  clock?: Clock;
  notifications?: NotificationBus;
  /** If true, collect explanation data for why jobs are scheduled */
  collectExplanation?: boolean;
}

interface ComputePlanArgs {
  movieId: string;
  manifest: Manifest | null;
  eventLog: EventLog;
  blueprint: ProducerGraph;
  targetRevision: RevisionId;
  pendingEdits?: InputEvent[];
  /** Resolved condition artifacts used to determine conditional job activity. */
  resolvedConditionArtifacts?: Record<string, unknown>;
  /** Force re-run from this layer index onwards (0-indexed). Jobs at this layer and above are marked dirty. */
  reRunFrom?: number;
  /** Surgical artifact regeneration - regenerate only the target artifacts and downstream dependencies. */
  artifactRegenerations?: ArtifactRegenerationConfig[];
  /** Limit plan to layers 0 through upToLayer (0-indexed). Jobs in later layers are excluded from the plan. */
  upToLayer?: number;
  /** If true, collect explanation data for why jobs are scheduled (overrides options) */
  collectExplanation?: boolean;
  /** Artifact IDs that are pinned (kept). Jobs whose produced artifacts are ALL pinned are excluded from the plan. */
  pinnedArtifactIds?: string[];
}

export interface ComputePlanResult {
  plan: ExecutionPlan;
  /** Explanation of why jobs were scheduled (only if collectExplanation was true) */
  explanation?: PlanExplanation;
}

interface GraphMetadata {
  node: ProducerGraph['nodes'][number];
  inputBases: Set<string>;
  artefactInputs: Set<string>;
}

/** Result from initial dirty job detection with reasons */
interface InitialDirtyResult {
  dirtyJobs: Set<string>;
  reasons: JobDirtyReason[];
}

/** Result from dirty job propagation with tracking */
interface PropagateResult {
  allDirty: Set<string>;
  propagatedReasons: JobDirtyReason[];
}

type InputsMap = Map<string, InputEvent>;
type ArtefactMap = Map<string, ArtefactEvent>;
interface ArtefactSnapshot {
  latestSuccessful: ArtefactMap;
  latestFailedIds: Set<string>;
}

export function createPlanner(options: PlannerOptions = {}) {
  const logger = options.logger ?? {};
  const clock = options.clock;
  const notifications = options.notifications;
  const defaultCollectExplanation = options.collectExplanation ?? false;

  return {
    async computePlan(args: ComputePlanArgs): Promise<ComputePlanResult> {
      const collectExplanation =
        args.collectExplanation ?? defaultCollectExplanation;
      const manifest = args.manifest ?? createEmptyManifest();
      const eventLog = args.eventLog;
      const pendingEdits = args.pendingEdits ?? [];
      const blueprint = args.blueprint;

      const latestInputs = await readLatestInputs(eventLog, args.movieId);
      const combinedInputs = mergeInputs(latestInputs, pendingEdits);
      const dirtyInputs = determineDirtyInputs(manifest, combinedInputs);
      const artefactSnapshot = await readLatestArtefactSnapshot(
        eventLog,
        args.movieId
      );
      const latestArtefacts = artefactSnapshot.latestSuccessful;
      const dirtyArtefacts = determineDirtyArtefacts(
        manifest,
        latestArtefacts,
        artefactSnapshot.latestFailedIds
      );
      const requiredConditionArtifactIds =
        collectRequiredConditionArtifactIds(blueprint);
      const missingConditionArtifacts =
        determineMissingRequiredConditionArtifacts(
          manifest,
          requiredConditionArtifactIds,
          latestArtefacts
        );

      const metadata = buildGraphMetadata(blueprint);
      const conditionallyInactiveJobs = deriveConditionallyInactiveJobs(
        metadata,
        args.resolvedConditionArtifacts
      );

      // Determine which jobs to include in the plan
      let jobsToInclude: Set<string>;
      let jobReasons: JobDirtyReason[] = [];
      let initialDirtyJobs: string[] = [];
      let propagatedJobs: string[] = [];

      if (args.artifactRegenerations && args.artifactRegenerations.length > 0) {
        // Surgical mode: source jobs + downstream dependencies
        const sourceJobIds = args.artifactRegenerations.map(
          (r) => r.sourceJobId
        );
        const surgicalJobs = computeMultipleArtifactRegenerationJobs(
          sourceJobIds,
          blueprint
        );

        // Also detect jobs with missing/dirty artifacts (same logic as normal mode)
        const { dirtyJobs: initialDirty, reasons: initialReasons } =
          determineInitialDirtyJobs(
            manifest,
            metadata,
            conditionallyInactiveJobs,
            dirtyInputs,
            dirtyArtefacts,
            latestArtefacts,
            artefactSnapshot.latestFailedIds,
            collectExplanation
          );
        const { allDirty: propagatedDirty, propagatedReasons } =
          propagateDirtyJobs(
            initialDirty,
            blueprint,
            metadata,
            collectExplanation,
            args.resolvedConditionArtifacts
          );

        // Union: surgical targets + missing/dirty artifacts
        jobsToInclude = new Set([...surgicalJobs, ...propagatedDirty]);

        if (collectExplanation) {
          jobReasons = [...initialReasons, ...propagatedReasons];
          initialDirtyJobs = Array.from(initialDirty);
          propagatedJobs = Array.from(propagatedDirty).filter(
            (j) => !initialDirty.has(j)
          );
        }

        logger.debug?.('planner.surgical.jobs', {
          movieId: args.movieId,
          sourceJobIds,
          targetArtifactIds: args.artifactRegenerations.map(
            (r) => r.targetArtifactId
          ),
          surgicalJobs: Array.from(surgicalJobs),
          dirtyJobs: Array.from(propagatedDirty),
          jobs: Array.from(jobsToInclude),
        });
      } else {
        // Normal mode: use dirty detection only
        const { dirtyJobs: initialDirty, reasons: initialReasons } =
          determineInitialDirtyJobs(
            manifest,
            metadata,
            conditionallyInactiveJobs,
            dirtyInputs,
            dirtyArtefacts,
            latestArtefacts,
            artefactSnapshot.latestFailedIds,
            collectExplanation
          );

        const { allDirty, propagatedReasons } = propagateDirtyJobs(
          initialDirty,
          blueprint,
          metadata,
          collectExplanation,
          args.resolvedConditionArtifacts
        );
        jobsToInclude = allDirty;

        if (collectExplanation) {
          jobReasons = [...initialReasons, ...propagatedReasons];
          initialDirtyJobs = Array.from(initialDirty);
          propagatedJobs = Array.from(allDirty).filter(
            (j) => !initialDirty.has(j)
          );
        }

        logger.debug?.('planner.propagatedDirty', {
          movieId: args.movieId,
          initialCount: initialDirty.size,
          propagatedCount: allDirty.size,
          propagatedJobs: Array.from(allDirty).filter(
            (j) => !initialDirty.has(j)
          ),
        });
      }

      // Filter out fully pinned jobs (all their produced artifacts are pinned and reusable)
      const pinnedExcludedJobIds = new Set<string>();
      if (args.pinnedArtifactIds && args.pinnedArtifactIds.length > 0) {
        const pinnedSet = new Set(args.pinnedArtifactIds);
        for (const [jobId, info] of metadata) {
          const producedArtifacts = info.node.produces.filter((id) =>
            isCanonicalArtifactId(id)
          );
          if (producedArtifacts.length === 0) {
            continue;
          }
          const allPinned = producedArtifacts.every((id) => pinnedSet.has(id));
          if (!allPinned) {
            continue;
          }
          const allReusable = producedArtifacts.every((id) =>
            isPinnedArtifactReusable(
              id,
              manifest,
              latestArtefacts,
              artefactSnapshot.latestFailedIds
            )
          );
          if (allReusable) {
            jobsToInclude.delete(jobId);
            pinnedExcludedJobIds.add(jobId);
          }
        }
      }

      const { layers, blueprintLayerCount } = buildExecutionLayers(
        jobsToInclude,
        metadata,
        blueprint,
        args.reRunFrom,
        args.artifactRegenerations,
        args.upToLayer,
        pinnedExcludedJobIds
      );
      validateConditionArtifactsCanBeRegenerated(
        args.movieId,
        missingConditionArtifacts,
        metadata,
        layers,
        args.reRunFrom
      );

      logger.debug?.('planner.plan.generated', {
        movieId: args.movieId,
        layers: layers.length,
        jobs: jobsToInclude.size,
        blueprintLayerCount,
      });
      notifications?.publish({
        type: 'progress',
        message: `Plan ready: ${jobsToInclude.size} job${jobsToInclude.size === 1 ? '' : 's'} across ${layers.length} layer${layers.length === 1 ? '' : 's'}.`,
        timestamp: nowIso(clock),
      });

      const plan: ExecutionPlan = {
        revision: args.targetRevision,
        manifestBaseHash: manifestBaseHash(manifest),
        layers,
        createdAt: nowIso(clock),
        blueprintLayerCount,
      };

      // Build explanation if requested
      let explanation: PlanExplanation | undefined;
      if (collectExplanation) {
        explanation = {
          movieId: args.movieId,
          revision: args.targetRevision,
          dirtyInputs: Array.from(dirtyInputs),
          dirtyArtefacts: Array.from(dirtyArtefacts),
          jobReasons,
          initialDirtyJobs,
          propagatedJobs,
          surgicalTargets: args.artifactRegenerations?.map(
            (r) => r.targetArtifactId
          ),
          pinnedArtifactIds: args.pinnedArtifactIds,
        };
      }

      return { plan, explanation };
    },
  };
}

function buildGraphMetadata(
  blueprint: ProducerGraph
): Map<string, GraphMetadata> {
  const metadata = new Map<string, GraphMetadata>();
  for (const node of blueprint.nodes) {
    const artefactInputs = node.inputs.filter((input) =>
      isCanonicalArtifactId(input)
    );
    metadata.set(node.jobId, {
      node,
      inputBases: new Set(
        node.inputs
          .map(extractInputBaseId)
          .filter((value): value is string => value !== null)
      ),
      artefactInputs: new Set(artefactInputs),
    });
  }
  return metadata;
}

function deriveConditionallyInactiveJobs(
  metadata: Map<string, GraphMetadata>,
  resolvedConditionArtifacts: Record<string, unknown> | undefined
): Set<string> {
  const inactive = new Set<string>();
  const conditionContext = {
    resolvedArtifacts: resolvedConditionArtifacts ?? {},
  };

  for (const [jobId, info] of metadata) {
    const inputConditions = info.node.context?.inputConditions;
    if (!inputConditions || Object.keys(inputConditions).length === 0) {
      continue;
    }

    const conditionResults = evaluateInputConditions(
      inputConditions,
      conditionContext
    );
    const conditionalInputIds = new Set(Object.keys(inputConditions));

    let anySatisfied = false;
    let anyUnknown = false;
    for (const [, result] of conditionResults) {
      if (result.satisfied) {
        anySatisfied = true;
        break;
      }
      if (isConditionEvaluationUnknown(result.reason)) {
        anyUnknown = true;
      }
    }

    const hasUnconditionalArtifactInputs = info.node.inputs.some(
      (inputId) =>
        !conditionalInputIds.has(inputId) && isCanonicalArtifactId(inputId)
    );
    const fanIn = info.node.context?.fanIn;
    const hasUnconditionalFanInMembers =
      fanIn !== undefined &&
      Object.values(fanIn).some((spec) =>
        spec.members.some((member) => !conditionalInputIds.has(member.id))
      );

    if (
      !anySatisfied &&
      !anyUnknown &&
      !hasUnconditionalArtifactInputs &&
      !hasUnconditionalFanInMembers
    ) {
      inactive.add(jobId);
    }
  }

  return inactive;
}

function determineInitialDirtyJobs(
  manifest: Manifest,
  metadata: Map<string, GraphMetadata>,
  conditionallyInactiveJobs: Set<string>,
  dirtyInputs: Set<string>,
  dirtyArtefacts: Set<string>,
  latestArtefacts: ArtefactMap,
  latestFailedArtefacts: Set<string>,
  collectReasons: boolean
): InitialDirtyResult {
  const dirtyJobs = new Set<string>();
  const reasons: JobDirtyReason[] = [];
  const isInitial = Object.keys(manifest.inputs).length === 0;

  for (const [jobId, info] of metadata) {
    if (conditionallyInactiveJobs.has(jobId)) {
      continue;
    }

    if (isInitial) {
      dirtyJobs.add(jobId);
      if (collectReasons) {
        reasons.push({
          jobId,
          producer: info.node.producer,
          reason: 'initial',
        });
      }
      continue;
    }

    // Check which artifacts are missing from manifest
    const missingArtifacts = info.node.produces.filter((id) => {
      if (!isCanonicalArtifactId(id)) {
        return false;
      }
      return manifest.artefacts[id] === undefined && !latestArtefacts.has(id);
    });
    const producesMissing = missingArtifacts.length > 0;
    const failedArtifacts = info.node.produces.filter(
      (id) => isCanonicalArtifactId(id) && latestFailedArtefacts.has(id)
    );
    const latestAttemptFailed = failedArtifacts.length > 0;

    // Check which inputs are dirty
    const dirtyInputsForJob = Array.from(info.inputBases).filter((id) =>
      dirtyInputs.has(id)
    );
    const touchesDirtyInput = dirtyInputsForJob.length > 0;

    // Check which upstream artifacts are dirty
    const dirtyArtefactsForJob = Array.from(info.artefactInputs).filter(
      (artefactId) => dirtyArtefacts.has(artefactId)
    );
    const touchesDirtyArtefact = dirtyArtefactsForJob.length > 0;

    // Check 4: Job's inputsHash has changed (content of inputs differs from when artifact was produced)
    let hasStaleInputsHash = false;
    const staleInputsHashArtifacts: string[] = [];
    if (
      !producesMissing &&
      !touchesDirtyInput &&
      !touchesDirtyArtefact &&
      !latestAttemptFailed
    ) {
      const jobProducedIds = info.node.produces.filter((id) =>
        isCanonicalArtifactId(id)
      );
      const expectedHash = hashInputContents(info.node.inputs, manifest);

      for (const artId of jobProducedIds) {
        const entry = manifest.artefacts[artId];
        if (entry?.inputsHash && entry.inputsHash !== expectedHash) {
          staleInputsHashArtifacts.push(artId);
        }
      }
      hasStaleInputsHash = staleInputsHashArtifacts.length > 0;
    }

    if (
      producesMissing ||
      touchesDirtyInput ||
      touchesDirtyArtefact ||
      latestAttemptFailed ||
      hasStaleInputsHash
    ) {
      dirtyJobs.add(jobId);

      if (collectReasons) {
        if (producesMissing) {
          reasons.push({
            jobId,
            producer: info.node.producer,
            reason: 'producesMissing',
            missingArtifacts,
          });
        } else if (latestAttemptFailed) {
          reasons.push({
            jobId,
            producer: info.node.producer,
            reason: 'latestAttemptFailed',
            failedArtifacts,
          });
        } else if (touchesDirtyInput) {
          reasons.push({
            jobId,
            producer: info.node.producer,
            reason: 'touchesDirtyInput',
            dirtyInputs: dirtyInputsForJob,
          });
        } else if (touchesDirtyArtefact) {
          reasons.push({
            jobId,
            producer: info.node.producer,
            reason: 'touchesDirtyArtefact',
            dirtyArtefacts: dirtyArtefactsForJob,
          });
        } else if (hasStaleInputsHash) {
          reasons.push({
            jobId,
            producer: info.node.producer,
            reason: 'inputsHashChanged',
            staleArtifacts: staleInputsHashArtifacts,
          });
        }
      }
    }
  }

  return { dirtyJobs, reasons };
}

function determineMissingRequiredConditionArtifacts(
  manifest: Manifest,
  requiredConditionArtifactIds: Set<string>,
  latestArtefacts: ArtefactMap
): string[] {
  const missing: string[] = [];
  for (const artifactId of requiredConditionArtifactIds) {
    if (
      manifest.artefacts[artifactId] === undefined &&
      !latestArtefacts.has(artifactId)
    ) {
      missing.push(artifactId);
    }
  }
  return missing;
}

function validateConditionArtifactsCanBeRegenerated(
  movieId: string,
  missingConditionArtifacts: string[],
  metadata: Map<string, GraphMetadata>,
  layers: ExecutionPlan['layers'],
  reRunFrom: number | undefined
): void {
  if (missingConditionArtifacts.length === 0) {
    return;
  }

  const artifactProducer = new Map<string, string>();
  for (const [jobId, info] of metadata) {
    for (const producesId of info.node.produces) {
      if (isCanonicalArtifactId(producesId)) {
        artifactProducer.set(producesId, jobId);
      }
    }
  }

  const jobLayerIndex = new Map<string, number>();
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    for (const job of layers[layerIndex] ?? []) {
      jobLayerIndex.set(job.jobId, layerIndex);
    }
  }

  const unresolved: string[] = [];
  for (const artifactId of missingConditionArtifacts) {
    const producerJobId = artifactProducer.get(artifactId);
    if (!producerJobId) {
      unresolved.push(`${artifactId} (no producer in graph)`);
      continue;
    }

    const layerIndex = jobLayerIndex.get(producerJobId);
    if (layerIndex === undefined) {
      unresolved.push(
        `${artifactId} (producer ${producerJobId} not scheduled)`
      );
      continue;
    }

    const isSkippedByReRunFrom =
      reRunFrom !== undefined && layerIndex < reRunFrom;
    if (isSkippedByReRunFrom) {
      unresolved.push(
        `${artifactId} (producer ${producerJobId} is at layer ${layerIndex}, but reRunFrom=${reRunFrom})`
      );
    }
  }

  if (unresolved.length > 0) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_CANONICAL_CONDITION_ARTIFACT,
      `Missing canonical condition artifact(s) cannot be regenerated in this run: ${unresolved.join('; ')}`,
      {
        context: movieId,
        suggestion:
          'Re-run with layer settings that include the producer generating these artifacts (for example, reRunFrom=0 and a sufficient upToLayer).',
      }
    );
  }
}

export function collectRequiredConditionArtifactIds(
  blueprint: ProducerGraph
): Set<string> {
  const ids = new Set<string>();
  for (const node of blueprint.nodes) {
    const inputConditions = node.context?.inputConditions;
    if (!inputConditions) {
      continue;
    }
    for (const conditionInfo of Object.values(inputConditions)) {
      const conditionIds = extractConditionArtifactIds(
        conditionInfo.condition,
        conditionInfo.indices
      );
      for (const id of conditionIds) {
        ids.add(id);
      }
    }
  }
  return ids;
}

function extractConditionArtifactIds(
  condition: EdgeConditionDefinition,
  indices: Record<string, number>
): string[] {
  if (Array.isArray(condition)) {
    return condition.flatMap((item) =>
      extractConditionArtifactIdsFromItem(item, indices)
    );
  }
  return extractConditionArtifactIdsFromItem(condition, indices);
}

function extractConditionArtifactIdsFromItem(
  item: EdgeConditionClause | EdgeConditionGroup,
  indices: Record<string, number>
): string[] {
  if ('all' in item || 'any' in item) {
    const group = item as EdgeConditionGroup;
    const collected: string[] = [];
    if (group.all) {
      for (const clause of group.all) {
        const id = resolveConditionArtifactId(clause.when, indices);
        if (id) {
          collected.push(id);
        }
      }
    }
    if (group.any) {
      for (const clause of group.any) {
        const id = resolveConditionArtifactId(clause.when, indices);
        if (id) {
          collected.push(id);
        }
      }
    }
    return collected;
  }

  const clause = item as EdgeConditionClause;
  const id = resolveConditionArtifactId(clause.when, indices);
  return id ? [id] : [];
}

function resolveConditionArtifactId(
  whenPath: string,
  indices: Record<string, number>
): string | undefined {
  if (!whenPath || whenPath.startsWith('Input:')) {
    return undefined;
  }

  const pathWithoutPrefix = whenPath.startsWith('Artifact:')
    ? whenPath.slice('Artifact:'.length)
    : whenPath;
  let resolvedPath = pathWithoutPrefix;
  const indexEntries = Object.entries(indices).reverse();
  for (const [symbol, index] of indexEntries) {
    const label = extractDimensionLabel(symbol);
    resolvedPath = resolvedPath.replace(
      new RegExp(`\\[${escapeRegexChars(label)}\\]`, 'g'),
      `[${index}]`
    );
  }

  return formatCanonicalArtifactId([], resolvedPath);
}

function extractDimensionLabel(symbol: string): string {
  const parts = symbol.split(':');
  return parts.length > 0 ? (parts[parts.length - 1] ?? symbol) : symbol;
}

function escapeRegexChars(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function propagateDirtyJobs(
  initialDirty: Set<string>,
  blueprint: ProducerGraph,
  metadata: Map<string, GraphMetadata>,
  collectReasons: boolean,
  resolvedConditionArtifacts: Record<string, unknown> | undefined
): PropagateResult {
  const dirty = new Set(initialDirty);
  const queue = Array.from(initialDirty);
  const adjacency = buildAdjacencyMap(blueprint, resolvedConditionArtifacts);
  const artifactProducer = buildArtifactProducerMap(metadata);
  const conditionResultsCache = new Map<
    string,
    Map<string, { satisfied: boolean; reason?: string }>
  >();
  const propagatedReasons: JobDirtyReason[] = [];
  // Track which job caused propagation to each downstream job
  const propagationSource = new Map<string, string>();

  while (queue.length > 0) {
    const jobId = queue.shift()!;
    const neighbours = adjacency.get(jobId);
    if (!neighbours) {
      continue;
    }
    for (const next of neighbours) {
      if (
        !hasActiveArtifactDependency(
          jobId,
          next,
          metadata,
          artifactProducer,
          conditionResultsCache,
          resolvedConditionArtifacts
        )
      ) {
        continue;
      }

      if (!dirty.has(next)) {
        dirty.add(next);
        queue.push(next);
        propagationSource.set(next, jobId);
      }
    }
  }

  if (collectReasons) {
    for (const [jobId, sourceJobId] of propagationSource) {
      const info = metadata.get(jobId);
      if (info) {
        propagatedReasons.push({
          jobId,
          producer: info.node.producer,
          reason: 'propagated',
          propagatedFrom: sourceJobId,
        });
      }
    }
  }

  return { allDirty: dirty, propagatedReasons };
}

/**
 * Compute which jobs to include for surgical artifact regeneration.
 * Starts from the source job and BFS propagates to downstream dependencies.
 * This ensures sibling jobs (jobs at the same layer but not downstream) are NOT included.
 */
export function computeArtifactRegenerationJobs(
  sourceJobId: string,
  blueprint: ProducerGraph
): Set<string> {
  const jobs = new Set<string>([sourceJobId]);
  const queue = [sourceJobId];
  const adjacency = buildAdjacencyMap(blueprint);

  while (queue.length > 0) {
    const jobId = queue.shift()!;
    const downstream = adjacency.get(jobId);
    if (!downstream) {
      continue;
    }
    for (const next of downstream) {
      if (!jobs.has(next)) {
        jobs.add(next);
        queue.push(next);
      }
    }
  }

  return jobs;
}

/**
 * Compute which jobs to include for multiple artifact regeneration.
 * Returns the union of all downstream jobs from all source jobs.
 * This enables regenerating multiple specific artifacts in a single operation.
 *
 * @param sourceJobIds - Array of source job IDs to regenerate
 * @param blueprint - The producer graph containing all job nodes and edges
 * @returns Set of all job IDs to include (source jobs + all downstream dependencies)
 */
export function computeMultipleArtifactRegenerationJobs(
  sourceJobIds: string[],
  blueprint: ProducerGraph
): Set<string> {
  const allJobs = new Set<string>();
  for (const sourceJobId of sourceJobIds) {
    const jobs = computeArtifactRegenerationJobs(sourceJobId, blueprint);
    for (const job of jobs) {
      allJobs.add(job);
    }
  }
  return allJobs;
}

interface BuildExecutionLayersResult {
  layers: ExecutionPlan['layers'];
  blueprintLayerCount: number;
}

function isPinnedArtifactReusable(
  artifactId: string,
  manifest: Manifest,
  latestArtefacts: ArtefactMap,
  latestFailedIds: Set<string>
): boolean {
  if (latestFailedIds.has(artifactId)) {
    return false;
  }
  if (latestArtefacts.has(artifactId)) {
    return true;
  }
  const manifestEntry = manifest.artefacts[artifactId];
  return manifestEntry?.status === 'succeeded';
}

function buildExecutionLayers(
  dirtyJobs: Set<string>,
  metadata: Map<string, GraphMetadata>,
  blueprint: ProducerGraph,
  reRunFrom?: number,
  artifactRegenerations?: ArtifactRegenerationConfig[],
  upToLayer?: number,
  excludedJobIds?: Set<string>
): BuildExecutionLayersResult {
  // Use shared topology service to compute stable layer indices for all producer jobs
  const nodes = Array.from(metadata.keys()).map((id) => ({ id }));
  const edges = blueprint.edges.filter(
    (e) => metadata.has(e.from) && metadata.has(e.to)
  );

  const {
    layerAssignments: levelMap,
    layerCount: blueprintLayerCount,
    hasCycle,
  } = computeTopologyLayers(nodes, edges);

  if (hasCycle) {
    throw createRuntimeError(
      RuntimeErrorCode.CYCLIC_DEPENDENCY,
      'Producer graph contains a cycle. Unable to create execution plan.'
    );
  }

  const maxLevel = blueprintLayerCount > 0 ? blueprintLayerCount - 1 : 0;
  const layers: ExecutionPlan['layers'] = Array.from(
    { length: maxLevel + 1 },
    () => []
  );

  // Combine dirty jobs with jobs forced by reRunFrom
  // Note: reRunFrom is NOT applied for surgical regeneration - it would defeat the purpose
  const jobsToInclude = new Set(dirtyJobs);
  const inSurgicalMode =
    artifactRegenerations && artifactRegenerations.length > 0;
  if (reRunFrom !== undefined && !inSurgicalMode) {
    // Force all jobs at layer >= reRunFrom to be included (normal mode only)
    for (const [jobId] of metadata) {
      if (excludedJobIds?.has(jobId)) {
        continue;
      }
      const level = levelMap.get(jobId);
      if (level !== undefined && level >= reRunFrom) {
        jobsToInclude.add(jobId);
      }
    }
  }

  // Filter by upToLayer: exclude jobs at layers beyond upToLayer
  if (upToLayer !== undefined) {
    for (const jobId of [...jobsToInclude]) {
      const level = levelMap.get(jobId);
      if (level !== undefined && level > upToLayer) {
        jobsToInclude.delete(jobId);
      }
    }
  }

  for (const jobId of jobsToInclude) {
    const info = metadata.get(jobId);
    const level = levelMap.get(jobId);
    if (!info || level === undefined) {
      continue;
    }
    layers[level].push({
      jobId: info.node.jobId,
      producer: info.node.producer,
      inputs: info.node.inputs,
      produces: info.node.produces,
      provider: info.node.provider,
      providerModel: info.node.providerModel,
      rateKey: info.node.rateKey,
      context: info.node.context,
    });
  }

  // Trim empty trailing layers AFTER placing jobs
  while (layers.length > 0 && layers[layers.length - 1].length === 0) {
    layers.pop();
  }

  return { layers, blueprintLayerCount };
}

function buildArtifactProducerMap(
  metadata: Map<string, GraphMetadata>
): Map<string, string> {
  const producers = new Map<string, string>();
  for (const [jobId, info] of metadata) {
    for (const artifactId of info.node.produces) {
      if (isCanonicalArtifactId(artifactId)) {
        producers.set(artifactId, jobId);
      }
    }
  }
  return producers;
}

function hasActiveArtifactDependency(
  fromJobId: string,
  toJobId: string,
  metadata: Map<string, GraphMetadata>,
  artifactProducer: Map<string, string>,
  conditionResultsCache: Map<
    string,
    Map<string, { satisfied: boolean; reason?: string }>
  >,
  resolvedConditionArtifacts: Record<string, unknown> | undefined
): boolean {
  const target = metadata.get(toJobId);
  if (!target) {
    return true;
  }

  const inputConditions = target.node.context?.inputConditions;
  const conditionalInputIds = new Set(Object.keys(inputConditions ?? {}));
  let conditionResults = conditionResultsCache.get(toJobId);
  if (!conditionResults) {
    conditionResults = evaluateInputConditions(inputConditions, {
      resolvedArtifacts: resolvedConditionArtifacts ?? {},
    });
    conditionResultsCache.set(toJobId, conditionResults);
  }

  const isInputActive = (inputId: string): boolean => {
    if (!conditionalInputIds.has(inputId)) {
      return true;
    }
    const result = conditionResults.get(inputId);
    if (!result) {
      return true;
    }
    if (result.satisfied) {
      return true;
    }
    return isConditionEvaluationUnknown(result.reason);
  };

  for (const inputId of target.node.inputs) {
    if (!isCanonicalArtifactId(inputId)) {
      continue;
    }
    if (artifactProducer.get(inputId) !== fromJobId) {
      continue;
    }
    if (isInputActive(inputId)) {
      return true;
    }
  }

  const fanIn = target.node.context?.fanIn;
  if (fanIn) {
    for (const spec of Object.values(fanIn)) {
      for (const member of spec.members) {
        if (!isCanonicalArtifactId(member.id)) {
          continue;
        }
        if (artifactProducer.get(member.id) !== fromJobId) {
          continue;
        }
        if (isInputActive(member.id)) {
          return true;
        }
      }
    }
  }

  return false;
}

function buildAdjacencyMap(
  blueprint: ProducerGraph,
  resolvedConditionArtifacts?: Record<string, unknown>
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const node of blueprint.nodes) {
    adjacency.set(node.jobId, new Set());
  }
  for (const edge of blueprint.edges) {
    if (
      edge.conditions &&
      resolvedConditionArtifacts !== undefined &&
      !isResolvedConditionGroupSatisfied(
        edge.conditions,
        resolvedConditionArtifacts
      )
    ) {
      continue;
    }

    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, new Set());
    }
    adjacency.get(edge.from)!.add(edge.to);
  }
  return adjacency;
}

function isResolvedConditionGroupSatisfied(
  group: ResolvedEdgeConditionGroup,
  resolvedArtifacts: Record<string, unknown>
): boolean {
  const evaluations = group.conditions.map((condition) =>
    isResolvedConditionSatisfied(condition, resolvedArtifacts)
  );
  if (group.logic === 'and') {
    return evaluations.every((value) => value);
  }
  return evaluations.some((value) => value);
}

function isResolvedConditionSatisfied(
  condition: ResolvedEdgeCondition | ResolvedEdgeConditionGroup,
  resolvedArtifacts: Record<string, unknown>
): boolean {
  if ('logic' in condition) {
    return isResolvedConditionGroupSatisfied(condition, resolvedArtifacts);
  }
  return evaluateResolvedCondition(condition, resolvedArtifacts);
}

function evaluateResolvedCondition(
  condition: ResolvedEdgeCondition,
  resolvedArtifacts: Record<string, unknown>
): boolean {
  const value = readResolvedConditionValue(
    condition.sourceArtifactId,
    condition.fieldPath,
    resolvedArtifacts
  );
  return evaluateResolvedOperator(
    condition.operator,
    value,
    condition.compareValue
  );
}

function readResolvedConditionValue(
  sourceArtifactId: string,
  fieldPath: string[],
  resolvedArtifacts: Record<string, unknown>
): unknown {
  let current: unknown = resolvedArtifacts[sourceArtifactId];
  for (const segment of fieldPath) {
    current = readResolvedSegment(current, segment);
    if (current === undefined) {
      break;
    }
  }
  return current;
}

function readResolvedSegment(value: unknown, segment: string): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }

  const directIndexMatch = segment.match(/^\[(\d+)\]$/);
  if (directIndexMatch) {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const index = Number.parseInt(directIndexMatch[1]!, 10);
    return value[index];
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const objectValue = value as Record<string, unknown>;
  const withIndexMatch = segment.match(/^([^\[]+)((?:\[\d+\])+)$/);
  if (!withIndexMatch) {
    return objectValue[segment];
  }

  const baseKey = withIndexMatch[1]!;
  const indexSuffix = withIndexMatch[2]!;
  let current: unknown = objectValue[baseKey];
  const indices = Array.from(indexSuffix.matchAll(/\[(\d+)\]/g)).map((match) =>
    Number.parseInt(match[1]!, 10)
  );
  for (const index of indices) {
    if (!Array.isArray(current)) {
      return undefined;
    }
    current = current[index];
  }
  return current;
}

function evaluateResolvedOperator(
  operator: string,
  value: unknown,
  compareValue: unknown
): boolean {
  const coercedValue = coerceConditionValue(value, compareValue);

  switch (operator) {
    case 'is':
      return deepEqualValue(coercedValue, compareValue);
    case 'isNot':
      return !deepEqualValue(coercedValue, compareValue);
    case 'contains':
      if (typeof value === 'string' && typeof compareValue === 'string') {
        return value.includes(compareValue);
      }
      if (Array.isArray(value)) {
        return value.some((item) => deepEqualValue(item, compareValue));
      }
      return false;
    case 'greaterThan':
      return (
        typeof coercedValue === 'number' &&
        typeof compareValue === 'number' &&
        coercedValue > compareValue
      );
    case 'lessThan':
      return (
        typeof coercedValue === 'number' &&
        typeof compareValue === 'number' &&
        coercedValue < compareValue
      );
    case 'greaterOrEqual':
      return (
        typeof coercedValue === 'number' &&
        typeof compareValue === 'number' &&
        coercedValue >= compareValue
      );
    case 'lessOrEqual':
      return (
        typeof coercedValue === 'number' &&
        typeof compareValue === 'number' &&
        coercedValue <= compareValue
      );
    case 'exists': {
      const shouldExist = compareValue === true;
      const doesExist = value !== null && value !== undefined;
      return shouldExist === doesExist;
    }
    case 'matches':
      if (typeof value !== 'string' || typeof compareValue !== 'string') {
        return false;
      }
      return new RegExp(compareValue).test(value);
    default:
      return false;
  }
}

function coerceConditionValue(value: unknown, compareValue: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (typeof compareValue === 'boolean') {
      if (trimmed === 'true') {
        return true;
      }
      if (trimmed === 'false') {
        return false;
      }
    }
    if (typeof compareValue === 'number') {
      const parsed = Number(trimmed);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return value;
}

function deepEqualValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null) {
    return a === b;
  }
  if (typeof a !== 'object') {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqualValue(item, b[index]));
  }
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  const keysA = Object.keys(recordA);
  const keysB = Object.keys(recordB);
  if (keysA.length !== keysB.length) {
    return false;
  }
  return keysA.every((key) => deepEqualValue(recordA[key], recordB[key]));
}

function isConditionEvaluationUnknown(reason: string | undefined): boolean {
  if (!reason) {
    return false;
  }
  return reason.includes('Artifact not found');
}

async function readLatestInputs(
  eventLog: EventLog,
  movieId: string
): Promise<InputsMap> {
  const inputs = new Map<string, InputEvent>();
  for await (const event of eventLog.streamInputs(movieId)) {
    inputs.set(event.id, event);
  }
  return inputs;
}

function mergeInputs(latest: InputsMap, pending: InputEvent[]): InputsMap {
  const merged = new Map(latest);
  for (const event of pending) {
    merged.set(event.id, event);
  }
  return merged;
}

function determineDirtyInputs(
  manifest: Manifest,
  inputs: InputsMap
): Set<string> {
  const dirty = new Set<string>();
  for (const [id, event] of inputs) {
    const record = manifest.inputs[id];
    if (!record || record.hash !== event.hash) {
      dirty.add(id);
    }
  }
  return dirty;
}

async function readLatestArtefactSnapshot(
  eventLog: EventLog,
  movieId: string
): Promise<ArtefactSnapshot> {
  const latestById = new Map<string, ArtefactEvent>();
  for await (const event of eventLog.streamArtefacts(movieId)) {
    latestById.set(event.artefactId, event);
  }

  const latestSuccessful = new Map<string, ArtefactEvent>();
  const latestFailedIds = new Set<string>();
  for (const [artefactId, event] of latestById) {
    if (event.status === 'succeeded') {
      latestSuccessful.set(artefactId, event);
      continue;
    }
    if (event.status === 'failed') {
      latestFailedIds.add(artefactId);
    }
  }

  return {
    latestSuccessful,
    latestFailedIds,
  };
}

function determineDirtyArtefacts(
  manifest: Manifest,
  artefacts: ArtefactMap,
  latestFailedIds: Set<string>
): Set<string> {
  const dirty = new Set<string>();
  for (const [id, event] of artefacts) {
    const manifestEntry = manifest.artefacts[id];
    const eventHash = deriveArtefactHash(event);
    if (!manifestEntry || manifestEntry.hash !== eventHash) {
      dirty.add(id);
    }
  }
  for (const artefactId of latestFailedIds) {
    dirty.add(artefactId);
  }
  return dirty;
}

function manifestBaseHash(manifest: Manifest): string {
  return hashPayload(manifest).hash;
}

function nowIso(clock?: Clock): string {
  return clock?.now() ?? new Date().toISOString();
}

function createEmptyManifest(): Manifest {
  return {
    revision: 'rev-0000',
    baseRevision: null,
    createdAt: new Date().toISOString(),
    inputs: {},
    artefacts: {},
    timeline: {},
  };
}

function extractInputBaseId(input: string): string | null {
  if (!isCanonicalInputId(input)) {
    return null;
  }
  return input.replace(/\[.*?\]/g, '');
}
