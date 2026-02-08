import { isCanonicalArtifactId, isCanonicalInputId } from '../canonical-ids.js';
import type { EventLog } from '../event-log.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import { hashPayload, hashInputContents } from '../hashing.js';
import { deriveArtefactHash } from '../manifest.js';
import { computeTopologyLayers } from '../topology/index.js';
import {
  type ArtifactRegenerationConfig,
  type Clock,
  type ExecutionPlan,
  type InputEvent,
  type Manifest,
  type ArtefactEvent,
  type ProducerGraph,
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
  /** Force re-run from this layer index onwards (0-indexed). Jobs at this layer and above are marked dirty. */
  reRunFrom?: number;
  /** Surgical artifact regeneration - regenerate only the target artifacts and downstream dependencies. */
  artifactRegenerations?: ArtifactRegenerationConfig[];
  /** Limit plan to layers 0 through upToLayer (0-indexed). Jobs in later layers are excluded from the plan. */
  upToLayer?: number;
  /** If true, collect explanation data for why jobs are scheduled (overrides options) */
  collectExplanation?: boolean;
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

export function createPlanner(options: PlannerOptions = {}) {
  const logger = options.logger ?? {};
  const clock = options.clock;
  const notifications = options.notifications;
  const defaultCollectExplanation = options.collectExplanation ?? false;

  return {
    async computePlan(args: ComputePlanArgs): Promise<ComputePlanResult> {
      const collectExplanation = args.collectExplanation ?? defaultCollectExplanation;
      const manifest = args.manifest ?? createEmptyManifest();
      const eventLog = args.eventLog;
      const pendingEdits = args.pendingEdits ?? [];
      const blueprint = args.blueprint;

      const latestInputs = await readLatestInputs(eventLog, args.movieId);
      const combinedInputs = mergeInputs(latestInputs, pendingEdits);
      const dirtyInputs = determineDirtyInputs(manifest, combinedInputs);
      const latestArtefacts = await readLatestArtefacts(eventLog, args.movieId);
      const dirtyArtefacts = determineDirtyArtefacts(manifest, latestArtefacts);

      const metadata = buildGraphMetadata(blueprint);

      // Determine which jobs to include in the plan
      let jobsToInclude: Set<string>;
      let jobReasons: JobDirtyReason[] = [];
      let initialDirtyJobs: string[] = [];
      let propagatedJobs: string[] = [];

      if (args.artifactRegenerations && args.artifactRegenerations.length > 0) {
        // Surgical mode: source jobs + downstream dependencies
        const sourceJobIds = args.artifactRegenerations.map((r) => r.sourceJobId);
        const surgicalJobs = computeMultipleArtifactRegenerationJobs(
          sourceJobIds,
          blueprint,
        );

        // Also detect jobs with missing/dirty artifacts (same logic as normal mode)
        const { dirtyJobs: initialDirty, reasons: initialReasons } = determineInitialDirtyJobs(
          manifest,
          metadata,
          dirtyInputs,
          dirtyArtefacts,
          collectExplanation,
        );
        const { allDirty: propagatedDirty, propagatedReasons } = propagateDirtyJobs(
          initialDirty,
          blueprint,
          metadata,
          collectExplanation,
        );

        // Union: surgical targets + missing/dirty artifacts
        jobsToInclude = new Set([...surgicalJobs, ...propagatedDirty]);

        if (collectExplanation) {
          jobReasons = [...initialReasons, ...propagatedReasons];
          initialDirtyJobs = Array.from(initialDirty);
          propagatedJobs = Array.from(propagatedDirty).filter((j) => !initialDirty.has(j));
        }

        logger.debug?.('planner.surgical.jobs', {
          movieId: args.movieId,
          sourceJobIds,
          targetArtifactIds: args.artifactRegenerations.map((r) => r.targetArtifactId),
          surgicalJobs: Array.from(surgicalJobs),
          dirtyJobs: Array.from(propagatedDirty),
          jobs: Array.from(jobsToInclude),
        });
      } else {
        // Normal mode: use dirty detection only
        const { dirtyJobs: initialDirty, reasons: initialReasons } = determineInitialDirtyJobs(
          manifest,
          metadata,
          dirtyInputs,
          dirtyArtefacts,
          collectExplanation,
        );

        const { allDirty, propagatedReasons } = propagateDirtyJobs(
          initialDirty,
          blueprint,
          metadata,
          collectExplanation,
        );
        jobsToInclude = allDirty;

        if (collectExplanation) {
          jobReasons = [...initialReasons, ...propagatedReasons];
          initialDirtyJobs = Array.from(initialDirty);
          propagatedJobs = Array.from(allDirty).filter((j) => !initialDirty.has(j));
        }

        logger.debug?.('planner.propagatedDirty', {
          movieId: args.movieId,
          initialCount: initialDirty.size,
          propagatedCount: allDirty.size,
          propagatedJobs: Array.from(allDirty).filter((j) => !initialDirty.has(j)),
        });
      }

      const { layers, blueprintLayerCount } = buildExecutionLayers(
        jobsToInclude,
        metadata,
        blueprint,
        args.reRunFrom,
        args.artifactRegenerations,
        args.upToLayer,
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
          surgicalTargets: args.artifactRegenerations?.map((r) => r.targetArtifactId),
        };
      }

      return { plan, explanation };
    },
  };
}

function buildGraphMetadata(blueprint: ProducerGraph): Map<string, GraphMetadata> {
  const metadata = new Map<string, GraphMetadata>();
  for (const node of blueprint.nodes) {
    const artefactInputs = node.inputs.filter((input) => isCanonicalArtifactId(input));
    metadata.set(node.jobId, {
      node,
      inputBases: new Set(
        node.inputs
          .map(extractInputBaseId)
          .filter((value): value is string => value !== null),
      ),
      artefactInputs: new Set(artefactInputs),
    });
  }
  return metadata;
}

function determineInitialDirtyJobs(
  manifest: Manifest,
  metadata: Map<string, GraphMetadata>,
  dirtyInputs: Set<string>,
  dirtyArtefacts: Set<string>,
  collectReasons: boolean,
): InitialDirtyResult {
  const dirtyJobs = new Set<string>();
  const reasons: JobDirtyReason[] = [];
  const isInitial = Object.keys(manifest.inputs).length === 0;

  for (const [jobId, info] of metadata) {
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
    const missingArtifacts = info.node.produces.filter(
      (id) => isCanonicalArtifactId(id) && manifest.artefacts[id] === undefined,
    );
    const producesMissing = missingArtifacts.length > 0;

    // Check which inputs are dirty
    const dirtyInputsForJob = Array.from(info.inputBases).filter((id) =>
      dirtyInputs.has(id),
    );
    const touchesDirtyInput = dirtyInputsForJob.length > 0;

    // Check which upstream artifacts are dirty
    const dirtyArtefactsForJob = Array.from(info.artefactInputs).filter((artefactId) =>
      dirtyArtefacts.has(artefactId),
    );
    const touchesDirtyArtefact = dirtyArtefactsForJob.length > 0;

    // Check 4: Job's inputsHash has changed (content of inputs differs from when artifact was produced)
    let hasStaleInputsHash = false;
    const staleInputsHashArtifacts: string[] = [];
    if (!producesMissing && !touchesDirtyInput && !touchesDirtyArtefact) {
      const jobProducedIds = info.node.produces.filter(id => isCanonicalArtifactId(id));
      const expectedHash = hashInputContents(info.node.inputs, manifest);

      for (const artId of jobProducedIds) {
        const entry = manifest.artefacts[artId];
        if (entry?.inputsHash && entry.inputsHash !== expectedHash) {
          staleInputsHashArtifacts.push(artId);
        }
      }
      hasStaleInputsHash = staleInputsHashArtifacts.length > 0;
    }

    if (producesMissing || touchesDirtyInput || touchesDirtyArtefact || hasStaleInputsHash) {
      dirtyJobs.add(jobId);

      if (collectReasons) {
        if (producesMissing) {
          reasons.push({
            jobId,
            producer: info.node.producer,
            reason: 'producesMissing',
            missingArtifacts,
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

function propagateDirtyJobs(
  initialDirty: Set<string>,
  blueprint: ProducerGraph,
  metadata: Map<string, GraphMetadata>,
  collectReasons: boolean,
): PropagateResult {
  const dirty = new Set(initialDirty);
  const queue = Array.from(initialDirty);
  const adjacency = buildAdjacencyMap(blueprint);
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
  blueprint: ProducerGraph,
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
  blueprint: ProducerGraph,
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

function buildExecutionLayers(
  dirtyJobs: Set<string>,
  metadata: Map<string, GraphMetadata>,
  blueprint: ProducerGraph,
  reRunFrom?: number,
  artifactRegenerations?: ArtifactRegenerationConfig[],
  upToLayer?: number,
): BuildExecutionLayersResult {
  // Use shared topology service to compute stable layer indices for all producer jobs
  const nodes = Array.from(metadata.keys()).map((id) => ({ id }));
  const edges = blueprint.edges.filter(
    (e) => metadata.has(e.from) && metadata.has(e.to),
  );

  const {
    layerAssignments: levelMap,
    layerCount: blueprintLayerCount,
    hasCycle,
  } = computeTopologyLayers(nodes, edges);

  if (hasCycle) {
    throw createRuntimeError(
      RuntimeErrorCode.CYCLIC_DEPENDENCY,
      'Producer graph contains a cycle. Unable to create execution plan.',
    );
  }

  const maxLevel = blueprintLayerCount > 0 ? blueprintLayerCount - 1 : 0;
  const layers: ExecutionPlan['layers'] = Array.from({ length: maxLevel + 1 }, () => []);

  // Combine dirty jobs with jobs forced by reRunFrom
  // Note: reRunFrom is NOT applied for surgical regeneration - it would defeat the purpose
  const jobsToInclude = new Set(dirtyJobs);
  const inSurgicalMode = artifactRegenerations && artifactRegenerations.length > 0;
  if (reRunFrom !== undefined && !inSurgicalMode) {
    // Force all jobs at layer >= reRunFrom to be included (normal mode only)
    for (const [jobId] of metadata) {
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

function buildAdjacencyMap(blueprint: ProducerGraph): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const node of blueprint.nodes) {
    adjacency.set(node.jobId, new Set());
  }
  for (const edge of blueprint.edges) {
    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, new Set());
    }
    adjacency.get(edge.from)!.add(edge.to);
  }
  return adjacency;
}

async function readLatestInputs(eventLog: EventLog, movieId: string): Promise<InputsMap> {
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

function determineDirtyInputs(manifest: Manifest, inputs: InputsMap): Set<string> {
  const dirty = new Set<string>();
  for (const [id, event] of inputs) {
    const record = manifest.inputs[id];
    if (!record || record.hash !== event.hash) {
      dirty.add(id);
    }
  }
  return dirty;
}

async function readLatestArtefacts(eventLog: EventLog, movieId: string): Promise<ArtefactMap> {
  const artefacts = new Map<string, ArtefactEvent>();
  for await (const event of eventLog.streamArtefacts(movieId)) {
    if (event.status !== 'succeeded') {
      continue;
    }
    artefacts.set(event.artefactId, event);
  }
  return artefacts;
}

function determineDirtyArtefacts(manifest: Manifest, artefacts: ArtefactMap): Set<string> {
  const dirty = new Set<string>();
  for (const [id, event] of artefacts) {
    const manifestEntry = manifest.artefacts[id];
    const eventHash = deriveArtefactHash(event);
    if (!manifestEntry || manifestEntry.hash !== eventHash) {
      dirty.add(id);
    }
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
