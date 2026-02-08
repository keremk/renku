import { buildBlueprintGraph } from '../resolution/canonical-graph.js';
import { decomposeJsonSchema } from '../resolution/schema-decomposition.js';
import { expandBlueprintGraph } from '../resolution/canonical-expander.js';
import { buildInputSourceMapFromCanonical, normalizeInputValues } from '../resolution/input-sources.js';
import { createProducerGraph } from '../resolution/producer-graph.js';
import { createPlanAdapter, type PlanAdapterOptions } from '../planning/adapter.js';
import type { PlanExplanation } from '../planning/explanation.js';
import { isCanonicalInputId, formatProducerAlias } from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type { EventLog } from '../event-log.js';
import { hashPayload } from '../hashing.js';
import { ManifestNotFoundError, type ManifestService } from '../manifest.js';
import { nextRevisionId } from '../revisions.js';
import { planStore, type StorageContext } from '../storage.js';
import type { Clock } from '../types.js';
import { convertBlobInputToBlobRef } from '../input-blob-storage.js';
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
  JsonSchemaDefinition,
  MappingFieldDefinition,
  Manifest,
  ProducerCatalog,
  RevisionId,
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
  /** Force re-run from this layer index onwards (0-indexed). Jobs at this layer and above will be included in the plan. */
  reRunFrom?: number;
  /** Target artifact IDs for surgical regeneration. When provided, only these artifacts and their downstream dependencies will be regenerated. */
  targetArtifactIds?: string[];
  /** Limit plan to layers 0 through upToLayer (0-indexed). Jobs in later layers are excluded from the plan. */
  upToLayer?: number;
  /** If true, collect explanation data for why jobs are scheduled */
  collectExplanation?: boolean;
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
}

export interface PlanningServiceOptions extends PlanAdapterOptions {
  clock?: Clock;
}

export interface PlanningService {
  // eslint-disable-next-line no-unused-vars
  generatePlan(args: GeneratePlanArgs): Promise<GeneratePlanResult>;
}

export function createPlanningService(options: PlanningServiceOptions = {}): PlanningService {
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
        now,
      );

      let targetRevision = nextRevisionId(manifest.revision ?? null);
      targetRevision = await ensureUniquePlanRevision(args.storage, args.movieId, targetRevision);

      // Apply output schemas from provider options to JSON artifacts
      // This enables virtual artifact decomposition for producers with outputSchema in input templates
      applyOutputSchemasToBlueprintTree(args.blueprintTree, args.providerOptions);

      const blueprintGraph = buildBlueprintGraph(args.blueprintTree);
      const inputSources = buildInputSourceMapFromCanonical(blueprintGraph);
      const normalizedInputs = normalizeInputValues(args.inputValues, inputSources);

      // Transform BlobInput to BlobRef BEFORE creating events
      const inputsWithBlobRefs = await transformInputBlobsToRefs(
        normalizedInputs,
        args.storage,
        args.movieId,
      );

      // Inject derived system inputs (e.g., SegmentDuration from Duration/NumOfSegments)
      const inputsWithDerived = injectDerivedInputs(inputsWithBlobRefs);

      const inputEvents = createInputEvents(
        inputsWithDerived,
        targetRevision,
        args.inputSource ?? 'user',
        now(),
      );
      for (const event of inputEvents) {
        await args.eventLog.appendInput(args.movieId, event);
      }
      const resolvedInputs = buildResolvedInputMap(inputEvents);
      // Note: Blueprint defaults are no longer applied - model JSON schemas are the source of truth

      const artefactEvents = (args.pendingArtefacts ?? []).map((draft) =>
        makeArtefactEvent(draft, targetRevision, now()),
      );
      for (const artefactEvent of artefactEvents) {
        await args.eventLog.appendArtefact(args.movieId, artefactEvent);
      }

      const canonicalBlueprint = expandBlueprintGraph(blueprintGraph, normalizedInputs, inputSources);
      const producerGraph = createProducerGraph(
        canonicalBlueprint,
        args.providerCatalog,
        args.providerOptions,
      );

      // Resolve artifact regeneration configs if targetArtifactIds is provided
      let artifactRegenerations: ArtifactRegenerationConfig[] | undefined;
      if (args.targetArtifactIds && args.targetArtifactIds.length > 0) {
        artifactRegenerations = resolveArtifactsToJobs(
          args.targetArtifactIds,
          manifest,
          producerGraph,
        );
      }

      const { plan, explanation } = await adapter.compute({
        movieId: args.movieId,
        manifest,
        eventLog: args.eventLog,
        blueprint: producerGraph,
        targetRevision,
        pendingEdits: inputEvents,
        reRunFrom: args.reRunFrom,
        artifactRegenerations,
        upToLayer: args.upToLayer,
        collectExplanation: args.collectExplanation,
      });

      await planStore.save(plan, { movieId: args.movieId, storage: args.storage });
      const planPath = args.storage.resolve(args.movieId, 'runs', `${targetRevision}-plan.json`);

      // Merge current input events into the manifest so the runner has
      // up-to-date input hashes for content-aware inputsHash computation.
      const manifestWithInputs = mergeInputEventsIntoManifest(manifest, inputEvents);

      return {
        plan,
        planPath,
        targetRevision,
        manifest: manifestWithInputs,
        manifestHash,
        inputEvents,
        resolvedInputs,
        explanation,
      };
    },
  };
}

async function loadOrCreateManifest(
  service: ManifestService,
  movieId: string,
  now: () => string,
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
  createdAt: string,
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
        { context: id },
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
  createdAt: string,
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
  createdAt: string,
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
function mergeInputEventsIntoManifest(manifest: Manifest, inputEvents: InputEvent[]): Manifest {
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
  initial: RevisionId,
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
  revision: RevisionId,
): Promise<boolean> {
  const planPath = storage.resolve(movieId, 'runs', `${revision}-plan.json`);
  return storage.storage.fileExists(planPath);
}

async function transformInputBlobsToRefs(
  inputs: Record<string, unknown>,
  storage: StorageContext,
  movieId: string,
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
 * in input templates (after the migration from inline models).
 */
export function applyOutputSchemasToBlueprintTree(
  tree: BlueprintTreeNode,
  providerOptions: Map<string, ProviderOptionEntry>,
): void {
  applyOutputSchemasToNode(tree, providerOptions);
  for (const child of tree.children.values()) {
    applyOutputSchemasToBlueprintTree(child, providerOptions);
  }
}

function applyOutputSchemasToNode(
  node: BlueprintTreeNode,
  providerOptions: Map<string, ProviderOptionEntry>,
): void {
  for (const producer of node.document.producers) {
    const producerAlias = formatProducerAlias(node.namespacePath, producer.name);
    const options = providerOptions.get(producerAlias);
    if (!options?.outputSchema) {
      continue;
    }

    // Parse the output schema JSON
    const parsedSchema = parseJsonSchemaDefinition(options.outputSchema);

    // Apply to JSON artifacts with arrays that don't already have a schema
    // and add edges from producer to decomposed virtual artifacts
    node.document.artefacts = node.document.artefacts.map((art) => {
      if (art.type === 'json' && art.arrays && art.arrays.length > 0 && !art.schema) {
        // Decompose the schema and add edges for each virtual artifact
        const decomposed = decomposeJsonSchema(parsedSchema, art.name, art.arrays);
        for (const field of decomposed) {
          // Add edge for all decomposed virtual artifacts (both scalar and array items)
          const edgeExists = node.document.edges.some(
            (e) => e.from === producer.name && e.to === field.path,
          );
          if (!edgeExists) {
            node.document.edges.push({ from: producer.name, to: field.path });
          }
        }
        return { ...art, schema: parsedSchema };
      }
      return art;
    });
  }
}

function parseJsonSchemaDefinition(schemaJson: string): JsonSchemaDefinition {
  try {
    const parsed = JSON.parse(schemaJson);
    const name = typeof parsed.name === 'string' ? parsed.name : 'Schema';
    const strict = typeof parsed.strict === 'boolean' ? parsed.strict : undefined;
    const schema = parsed.schema ?? parsed;
    return { name, strict, schema };
  } catch {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_OUTPUT_SCHEMA_JSON,
      `Invalid schema JSON: ${schemaJson.slice(0, 100)}... ` +
        `Please provide valid JSON schema.`,
    );
  }
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
  inputs: Record<string, unknown>,
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

/**
 * Resolve multiple artifact IDs to their producing jobs.
 * Used for surgical regeneration of multiple artifacts.
 *
 * @param artifactIds - Array of canonical artifact IDs (e.g., ["Artifact:AudioProducer.GeneratedAudio[0]"])
 * @param manifest - The current manifest containing artifact entries
 * @param producerGraph - The producer graph with all job nodes
 * @returns Array of ArtifactRegenerationConfig with target artifacts and source jobs
 * @throws ARTIFACT_NOT_IN_MANIFEST if any artifact not found in manifest
 * @throws ARTIFACT_JOB_NOT_FOUND if any producing job not found in graph
 */
export function resolveArtifactsToJobs(
  artifactIds: string[],
  manifest: Manifest,
  producerGraph: { nodes: Array<{ jobId: string }> },
): ArtifactRegenerationConfig[] {
  return artifactIds.map((id) => resolveArtifactToJob(id, manifest, producerGraph));
}

/**
 * Resolve an artifact ID to the job that produces it.
 * Used for surgical artifact regeneration.
 *
 * @param artifactId - The canonical artifact ID (e.g., "Artifact:AudioProducer.GeneratedAudio[0]")
 * @param manifest - The current manifest containing artifact entries
 * @param producerGraph - The producer graph with all job nodes
 * @returns ArtifactRegenerationConfig with target artifact and source job
 * @throws ARTIFACT_NOT_IN_MANIFEST if artifact not found in manifest
 * @throws ARTIFACT_JOB_NOT_FOUND if producing job not found in graph
 */
export function resolveArtifactToJob(
  artifactId: string,
  manifest: Manifest,
  producerGraph: { nodes: Array<{ jobId: string }> },
): ArtifactRegenerationConfig {
  const entry = manifest.artefacts[artifactId];
  if (!entry) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_NOT_IN_MANIFEST,
      `Artifact "${artifactId}" not found in manifest. ` +
        `The artifact may not have been generated yet, or the ID may be incorrect.`,
      { context: `artifactId=${artifactId}` },
    );
  }

  const sourceJobId = entry.producedBy;

  // Verify the job exists in the producer graph
  const jobExists = producerGraph.nodes.some((node) => node.jobId === sourceJobId);
  if (!jobExists) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_JOB_NOT_FOUND,
      `Job "${sourceJobId}" that produced artifact "${artifactId}" not found in producer graph. ` +
        `The blueprint structure may have changed since the artifact was generated.`,
      { context: `artifactId=${artifactId}, sourceJobId=${sourceJobId}` },
    );
  }

  return {
    targetArtifactId: artifactId,
    sourceJobId,
  };
}
