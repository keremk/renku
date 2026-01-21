import { isCanonicalArtifactId, isCanonicalInputId } from '../canonical-ids.js';
import type { EventLog } from '../event-log.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import { hashPayload } from '../hashing.js';
import { deriveArtefactHash } from '../manifest.js';
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

interface PlannerOptions {
  logger?: Partial<Logger>;
  clock?: Clock;
  notifications?: NotificationBus;
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
  /** Surgical artifact regeneration - regenerate only the target artifact and downstream dependencies. */
  artifactRegeneration?: ArtifactRegenerationConfig;
}

interface GraphMetadata {
  node: ProducerGraph['nodes'][number];
  inputBases: Set<string>;
  artefactInputs: Set<string>;
}

type InputsMap = Map<string, InputEvent>;
type ArtefactMap = Map<string, ArtefactEvent>;

export function createPlanner(options: PlannerOptions = {}) {
  const logger = options.logger ?? {};
  const clock = options.clock;
  const notifications = options.notifications;

  return {
    async computePlan(args: ComputePlanArgs): Promise<ExecutionPlan> {
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

      if (args.artifactRegeneration) {
        // Surgical mode: only include source job + downstream dependencies
        jobsToInclude = computeArtifactRegenerationJobs(
          args.artifactRegeneration.sourceJobId,
          blueprint,
        );
        logger.debug?.('planner.surgical.jobs', {
          movieId: args.movieId,
          sourceJobId: args.artifactRegeneration.sourceJobId,
          targetArtifactId: args.artifactRegeneration.targetArtifactId,
          jobs: Array.from(jobsToInclude),
        });
      } else {
        // Normal mode: use dirty detection
        const initialDirty = determineInitialDirtyJobs(
          manifest,
          metadata,
          dirtyInputs,
          dirtyArtefacts,
        );
        jobsToInclude = propagateDirtyJobs(initialDirty, blueprint);
      }

      const layers = buildExecutionLayers(
        jobsToInclude,
        metadata,
        blueprint,
        args.reRunFrom,
        args.artifactRegeneration,
      );

      logger.debug?.('planner.plan.generated', {
        movieId: args.movieId,
        layers: layers.length,
        jobs: jobsToInclude.size,
      });
      notifications?.publish({
        type: 'progress',
        message: `Plan ready: ${jobsToInclude.size} job${jobsToInclude.size === 1 ? '' : 's'} across ${layers.length} layer${layers.length === 1 ? '' : 's'}.`,
        timestamp: nowIso(clock),
      });

      return {
        revision: args.targetRevision,
        manifestBaseHash: manifestBaseHash(manifest),
        layers,
        createdAt: nowIso(clock),
      };
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
): Set<string> {
  const dirtyJobs = new Set<string>();
  const isInitial = Object.keys(manifest.inputs).length === 0;

  for (const [jobId, info] of metadata) {
    if (isInitial) {
      dirtyJobs.add(jobId);
      continue;
    }
    const producesMissing = info.node.produces.some(
      (id) => isCanonicalArtifactId(id) && manifest.artefacts[id] === undefined,
    );
    const touchesDirtyInput = Array.from(info.inputBases).some((id) =>
      dirtyInputs.has(id),
    );
    const touchesDirtyArtefact = Array.from(info.artefactInputs).some((artefactId) =>
      dirtyArtefacts.has(artefactId),
    );
    if (producesMissing || touchesDirtyInput || touchesDirtyArtefact) {
      dirtyJobs.add(jobId);
    }
  }

  return dirtyJobs;
}

function propagateDirtyJobs(initialDirty: Set<string>, blueprint: ProducerGraph): Set<string> {
  const dirty = new Set(initialDirty);
  const queue = Array.from(initialDirty);
  const adjacency = buildAdjacencyMap(blueprint);

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
      }
    }
  }

  return dirty;
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

function buildExecutionLayers(
  dirtyJobs: Set<string>,
  metadata: Map<string, GraphMetadata>,
  blueprint: ProducerGraph,
  reRunFrom?: number,
  artifactRegeneration?: ArtifactRegenerationConfig,
): ExecutionPlan['layers'] {
  // Determine stable layer indices for all producer jobs, then place dirty jobs into their original layer slots.
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const [jobId] of metadata) {
    indegree.set(jobId, 0);
    adjacency.set(jobId, new Set());
  }

  for (const edge of blueprint.edges) {
    if (!metadata.has(edge.from) || !metadata.has(edge.to)) {
      continue;
    }
    adjacency.get(edge.from)!.add(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const queue: Array<{ node: string; level: number }> = [];
  for (const [jobId, degree] of indegree) {
    if (degree === 0) {
      queue.push({ node: jobId, level: 0 });
    }
  }

  const levelMap = new Map<string, number>();

  while (queue.length > 0) {
    const { node, level } = queue.shift()!;
    const current = levelMap.get(node);
    if (current !== undefined && current <= level) {
      continue;
    }
    levelMap.set(node, level);
    const neighbours = adjacency.get(node);
    if (!neighbours) {
      continue;
    }
    for (const neighbour of neighbours) {
      const remaining = (indegree.get(neighbour) ?? 0) - 1;
      indegree.set(neighbour, remaining);
      if (remaining === 0) {
        queue.push({ node: neighbour, level: level + 1 });
      }
    }
  }

  ensureNoCycles(indegree);

  const maxLevel = levelMap.size === 0 ? 0 : Math.max(...levelMap.values());
  const layers: ExecutionPlan['layers'] = Array.from({ length: maxLevel + 1 }, () => []);

  // Combine dirty jobs with jobs forced by reRunFrom
  // Note: reRunFrom is NOT applied for surgical regeneration - it would defeat the purpose
  const jobsToInclude = new Set(dirtyJobs);
  if (reRunFrom !== undefined && !artifactRegeneration) {
    // Force all jobs at layer >= reRunFrom to be included (normal mode only)
    for (const [jobId] of metadata) {
      const level = levelMap.get(jobId);
      if (level !== undefined && level >= reRunFrom) {
        jobsToInclude.add(jobId);
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

  return layers;
}

function ensureNoCycles(indegree: Map<string, number>): void {
  const remaining = Array.from(indegree.values()).filter((value) => value > 0);
  if (remaining.length > 0) {
    throw createRuntimeError(
      RuntimeErrorCode.CYCLIC_DEPENDENCY,
      'Producer graph contains a cycle. Unable to create execution plan.',
    );
  }
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
