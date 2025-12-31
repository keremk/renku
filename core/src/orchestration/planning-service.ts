import { buildBlueprintGraph } from '../resolution/canonical-graph.js';
import { decomposeJsonSchema } from '../resolution/schema-decomposition.js';
import { expandBlueprintGraph } from '../resolution/canonical-expander.js';
import { buildInputSourceMapFromCanonical, normalizeInputValues } from '../resolution/input-sources.js';
import { createProducerGraph } from '../resolution/producer-graph.js';
import { createPlanAdapter, type PlanAdapterOptions } from '../planning/adapter.js';
import { isCanonicalInputId, formatProducerAlias } from '../parsing/canonical-ids.js';
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
  BlueprintTreeNode,
  BlueprintProducerOutputDefinition,
  BlueprintProducerSdkMappingField,
  ExecutionPlan,
  InputEvent,
  InputEventSource,
  JsonSchemaDefinition,
  Manifest,
  ProducerCatalog,
  RevisionId,
} from '../types.js';

export type ProviderOptionEntry = {
  sdkMapping?: Record<string, BlueprintProducerSdkMappingField>;
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
}

export interface GeneratePlanResult {
  plan: ExecutionPlan;
  planPath: string;
  targetRevision: RevisionId;
  manifest: Manifest;
  manifestHash: string | null;
  inputEvents: InputEvent[];
  resolvedInputs: Record<string, unknown>;
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

      const inputEvents = createInputEvents(
        inputsWithBlobRefs,
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

      const plan = await adapter.compute({
        movieId: args.movieId,
        manifest,
        eventLog: args.eventLog,
        blueprint: producerGraph,
        targetRevision,
        pendingEdits: inputEvents,
      });

      await planStore.save(plan, { movieId: args.movieId, storage: args.storage });
      const planPath = args.storage.resolve(args.movieId, 'runs', `${targetRevision}-plan.json`);

      return {
        plan,
        planPath,
        targetRevision,
        manifest,
        manifestHash,
        inputEvents,
        resolvedInputs,
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
      throw new Error(`Input "${id}" is not a canonical input id. Expected to start with "Input:".`);
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
          // Only add edge if field has dimensions (virtual artifact)
          if (field.dimensions.length > 0) {
            // Check if edge already exists
            const edgeExists = node.document.edges.some(
              (e) => e.from === producer.name && e.to === field.path,
            );
            if (!edgeExists) {
              node.document.edges.push({ from: producer.name, to: field.path });
            }
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
    throw new Error(
      `Invalid schema JSON: ${schemaJson.slice(0, 100)}... ` +
        `Please provide valid JSON schema.`,
    );
  }
}
