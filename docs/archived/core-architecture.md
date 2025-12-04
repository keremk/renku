## Manifest-Centric, Content-Addressed Storage

### Overview
Adopt a manifest-first design where each revision is defined by a single immutable manifest document. Binary assets are stored in a shared content-addressable blob store so we never duplicate bytes across revisions. Consumers read the latest manifest to resolve assets; history is preserved through immutable manifests and event logs.

### Directory Layout
```
builds/movie_civilwar_001/
├── manifests/
│   ├── rev-0001.json      # Immutable manifest (timeline, artefact mapping, config snapshot)
│   └── rev-0002.json
├── current.json           # Lightweight pointer {revision: "rev-0002", manifest: "manifests/rev-0002.json"}
├── blobs/                 # Content-addressed store (shared across revisions)
│   └── 7f/7f3c...         # Hash-named files (images, audio, prompts as gzipped text)
├── events/
│   ├── inputs.log         # Append-only JSONL of user/config edits
│   └── artefacts.log      # Append-only JSONL of producer executions
├── runs/
│   ├── rev-0003-plan.json     # Planner output with dependency layers and assumed manifest hash
│   └── rev-0003-progress.json # Optional per-layer completion checkpoints
├── prompts/
│   └── segment/
│       ├── segment-0001/image.txt
│       ├── segment-0001/video.txt
│       └── segment-0001/music.txt
└── metrics/               # Optional aggregates (job cost, retries)
```

### Metadata Flow
- A regeneration appends events describing the config change and producer results.  
- The planner consumes the latest manifest, figures out dirty artefacts, and captures the next revision’s execution plan under `runs/<revision>-plan.json`. Once the plan succeeds, a new manifest (`rev-000{n}`) points logical artefact IDs to blob hashes plus derived metadata (timeline, duration, etc.).  
- `current.json` updates atomically to point to the new manifest (use temp file + rename locally, or a DynamoDB/S3 metadata entry in the cloud). Consumers only need this pointer to load the full state.

### Asset Handling
- **Binary artefacts** (audio, video, images) are written under the content-addressed `blobs/` tree. The manifest stores their hash and metadata, so deduplication falls out naturally.  
- **Readable prompts & scripts** live alongside the artefact tree in dedicated folders (e.g. `prompts/segment/segment-0003/image.txt`). Each file is hashed individually when we append artefact events, preserving formatting while still enabling dirty detection.  
- **Derived text artefacts** (scripts, summaries) remain inline in the manifest unless they grow large—in that case we mirror the prompt pattern and drop the content into `artifacts/text/<id>.txt` while the manifest references it by hash.  
- Garbage collection removes blob files and prompt/script files that are no longer referenced by any manifest (mark-and-sweep after new manifests are committed).
- The blobs/ layout is a classic content-addressed scheme: every artefact gets hashed (SHA-256), and we store the payload under
  <blobs>/<first-two-hex-digits>/<full-hash>. So:

  - The subfolders (34, ec, 7d, …) are just the first two characters of the hash.
  - This keeps each directory from getting huge when many blobs share the same prefix.
  - The filename is the full hash; that lets us deduplicate identical artefacts across runs because we never rewrite the same hash
    twice.
  - When the runner writes an artefact, it records the hash in the manifest/event log alongside the metadata so downstream consumers
    can fetch it from blobs/ using the hash.

### Benefits Over Current Plan
- No path rewriting logic: every consumer dereferences artefact IDs via the manifest, so historical snapshots remain valid even after pruning.  
- Consistent lookups: manifests give O(1) access to the latest state, while append-only event logs preserve auditability without forcing every client to replay the log.  
- Content-addressable blobs dramatically reduce storage when users tweak the same artefact repeatedly (e.g. narration take 5 that matches take 4 is just another manifest entry pointing to the same hash).  
- Backend-agnostic: the blob layer can sit on local FS, S3, or any object store, while metadata could move to SQLite/PlanetScale without changing the consumer contract.

### Trade-offs & Open Questions
- Requires a manifest writer that can build the full state from dirty artefacts, so we need an in-memory model during planning; this is already implicit in the current design but needs to be formalized.  
- Garbage collection of blobs must be reliable—either reference count via SQLite or run a periodic sweep that loads manifests and marks live hashes.  
- Migration from the current revision-folder approach would need a script that emits manifests for existing revisions and rewrites timeline asset URLs; worth prototyping early.

### Planner Dirty-Detection Flow
The planner’s job is to decide which parts of the graph actually need fresh work before it spins up expensive model calls. It uses the manifest as a frozen picture of the last successful revision and compares it with everything that has changed since then.

1. **Gather the baseline**. Load the latest manifest (`rev-n`) and hydrate it into an in-memory view that maps every artefact ID to its stored hash, dependencies, and producing node. At the same time, cache the hashes for each input source that were current when the manifest was cut.  
2. **Replay recent edits**. Read the tail of `inputs.log` starting from the manifest’s revision marker. Every log line says “this input now hashes to XYZ”. Whenever the new hash differs from what the manifest recorded, the planner tags that input ID as dirty. This includes user edits, automatic retries, or any server-triggered adjustments.  
3. **Fold in live edits**. If the regeneration request includes new config that has not yet been written to disk, the planner stages those edits as if they were extra log lines so the plan reflects the state we are about to commit, not yesterday’s snapshot.  
4. **Propagate dirtiness through the DAG**. Starting from the dirty inputs, walk the producer graph in topological order. Any artefact that depends on a dirty upstream node becomes dirty itself. If an artefact already has a matching entry in `artefacts.log` with the same dependency hashes, we can mark it clean and stop propagation there—nothing upstream changed, so we can reuse the previous result.  
5. **Produce the execution plan**. Collect all producers that must rerun and arrange them into layers that respect dependencies (e.g., scripts before narration). The planner persists the plan as `runs/rev-0003-plan.json` (or the next rev ID) alongside a `manifest_base_hash` field that records the hash of `manifests/rev-0002.json` it was built from. The runner reads this file before starting work and aborts if `current.json` no longer points to that same base hash, which prevents two planners from trampling each other.

### Execution & Manifest Commit
Execution treats the plan as ground truth, runs jobs in parallel where possible, and records every result in append-only logs. At the end, a new manifest is assembled from those logs so there is a single authoritative snapshot.

1. **Run jobs and log results**. Workers dequeue jobs layer by layer. When a job finishes, it appends a JSON line to `artefacts.log` containing the provisional revision ID, artefact ID, dependency hashes, output hash, blob reference, status, and metadata such as provider cost. Appending is the only write pattern; no existing log line is ever mutated.  
2. **Handle retries safely**. Before firing a producer, the worker checks whether `artefacts.log` already holds a successful result for the same job signature (same plan ID and dependency hashes). If it does, the worker skips the API call and reuses the stored blob—this keeps reruns idempotent and cheap.  
3. **Keep the revision provisional**. While the plan is running we treat the new revision as “pending” (e.g., `rev-0003-pending`). If any job fails and the user cancels, we simply abandon those provisional log lines; the published manifest still points to `rev-0002` and consumers remain unaffected.  
4. **Assemble the manifest**. When every job succeeds, the manifest writer streams the relevant entries from `inputs.log` and `artefacts.log`, merges them with the previous manifest state, and emits a brand-new manifest file (`manifests/rev-0003.json`). This document includes updated input hashes, the resolved timeline, and a map of artefact IDs to blob hashes.  
5. **Publish atomically**. Write the manifest to a temporary filename, flush it, and rename it into place. Afterwards, update `current.json` to point at the new revision using the same temp+rename pattern (or an atomic compare-and-swap in a remote metadata store). Only after these steps succeed do we consider the revision live.  
6. **Maintain the logs**. The raw append-only logs stay intact for auditing. Optionally, a maintenance task can checkpoint them (e.g., materialise `inputs.checkpoint.rev-0003.json`) so future planner runs do not need to replay thousands of lines. Retention policies can later delete old raw logs once we are confident the checkpoints and manifests cover our history requirements.

## API

### Design Goals
- The core package exposes storage and planning primitives behind interfaces so the CLI and the cloud runner can inject their own filesystem, credentials, and concurrency policies.  
- All file I/O goes through FlyStorage adaptors so the same code can read/write to local disk, S3, or any compatible backend.  
- The API avoids leaking environment-specific concepts such as “Vercel workflow runs” or “local temp dirs”; callers pass abstract capabilities (e.g., `BlobStore`, `Clock`, `Logger`) instead.

### Core Data Types (pseudo-code)
```ts
type RevisionId = `rev-${string}`; // e.g., "rev-0003"

interface BlobRef {
  hash: string;           // sha256
  size: number;
  mimeType: string;
}

interface InputEvent {
  id: string;             // e.g., "narration_config"
  revision: RevisionId;
  hash: string;
  payload: unknown;       // JSON-serialisable config snapshot
  editedBy: "user" | "system";
  createdAt: string;
}

interface ArtefactEvent {
  artefactId: string;     // e.g., "segment_script_0"
  revision: RevisionId;
  inputsHash: string;     // combined hash of dependencies
  output: BlobRef | { inline: string };
  status: "succeeded" | "failed" | "skipped";
  producedBy: string;     // producer id
  diagnostics?: Record<string, unknown>;
  createdAt: string;
}

interface Manifest {
  revision: RevisionId;
  baseRevision: RevisionId | null;
  inputs: Record<string, { hash: string; payloadDigest: string }>;
  artefacts: Record<string, { hash: string; blob?: BlobRef; inline?: string }>;
  timeline: TimelineDocument;
  createdAt: string;
}

interface ExecutionPlan {
  revision: RevisionId;
  manifestBaseHash: string;          // hash of manifest used for planning
  layers: Array<Array<JobDescriptor>>;
  createdAt: string;
}

interface JobDescriptor {
  jobId: string;
  producer: string;
  inputs: string[];                  // artefact/input IDs required
  context: Record<string, unknown>;  // segment index, voice settings, etc.
}

interface JobResult {
  jobId: string;
  artefacts: ArtefactEvent[];
  status: "succeeded" | "failed" | "skipped";
}

interface RunResult {
  status: "succeeded" | "failed";
  jobs: JobResult[];
  buildManifest(): Promise<Manifest>;
}
```

### Storage Context (FlyStorage)
FlyStorage already abstracts the backing store (local disk, S3-compatible, in-memory). The core package therefore owns the FlyStorage client and hands collaborators a thin context object. Callers only pass a configuration that selects the plugin—no raw file operations leak out.

```ts
type StorageDriver = "local" | "s3" | "memory" | string;

interface StorageConfig {
  driver: StorageDriver;
  options: Record<string, unknown>;   // e.g., bucket, region, basePath
}

interface StorageContext {
  driver: StorageDriver;
  basePath: string;                   // e.g., "builds/"
  fly: FlyStorageInstance;            // internal handle; never exposed outside core
  resolve(movieId: string, relative: string): string; // e.g., resolve("movie123", "manifests/rev-0003.json")
}
```

Core modules such as the planner, manifest service, or event log helpers receive a `StorageContext` and perform all reads/writes through the embedded FlyStorage instance. The CLI passes `{ driver: "local", options: { rootDir: "./builds" } }`; the cloud runner passes `{ driver: "s3", options: { bucket: "...", prefix: "videos/" } }`.

```ts
interface Clock { now(): string; }
interface Logger { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void; }
```

### Event Log Helpers
Core-owned helpers wrap FlyStorage access so consumers never touch paths directly.

```ts
interface EventLog {
  streamInputs(movieId: string, sinceRevision?: RevisionId): AsyncIterable<InputEvent>;
  streamArtefacts(movieId: string, sinceRevision?: RevisionId): AsyncIterable<ArtefactEvent>;
  appendInput(movieId: string, event: InputEvent): Promise<void>;
  appendArtefact(movieId: string, event: ArtefactEvent): Promise<void>;
}
```

Executors obtain an `EventLog` by calling `createEventLog(storageContext)`; the implementation stays inside the core package.

#### Event Log Backends
The high-level API stays the same across environments, but the storage mechanism differs so we get safe appends without losing portability.

- **CLI / local development (append-only files)**  
  - We extend the FlyStorage local adapter with a true append primitive (effectively `fs.appendFile` guarded by a per-path mutex).  
  - Each log (`events/inputs.log`, `events/artefacts.log`) is only ever appended to; the CLI never rewrites the whole file when it emits events.  
  - Concurrency inside the CLI is funneled through the append helper so `Promise.all` job execution can push events as soon as they finish without clobbering earlier lines.  
  - After a successful manifest build, the CLI rotates the live logs: copy the JSONL contents to an archival file (`events/rev-0005.inputs.jsonl`, etc.), then truncate the live logs so the next run starts from a clean slate. This keeps local storage bounded while still leaving a per-revision audit trail on disk.

- **Server / cloud deployments (Redis + S3 archive)**  
  - Live events land in a Redis-compatible stream (Upstash / Vercel KV / self-hosted Redis all work). `XADD` gives us atomic appends and ordered IDs without implementing our own locking.  
  - Planners and runners read from the stream with a cursor so they only consume entries created after the last manifest. That keeps dirty-detection efficient even when multiple workers are active.  
  - When the runner commits a new manifest:  
    1. Stream the Redis entries for the just-completed revision in order.  
    2. Persist the new manifest.  
    3. Serialize the event batch to JSONL (`events/rev-0005.inputs.jsonl`, `events/rev-0005.artefacts.jsonl`) and upload it to S3 for long-term audit.  
    4. Trim the Redis stream (or delete the key) so only post-manifest edits remain buffered.  
  - On failure we simply leave the stream untouched; retries see the existing events and can skip clean artefacts. We only purge after both the manifest write and the archival upload succeed.

This split lets us ship the Milestone 2 CLI work immediately (filesystem append-only implementation) while deferring the cloud driver to a follow-up milestone. The core surface area (`EventLog`) does not change—each environment chooses the backend driver it wires into `createEventLog`.

### Plan Store Helpers
Plans live under `runs/<revision>-plan.json`. A built-in helper encapsulates the persistence contract so callers never juggle paths.

```ts
declare const planStore: {
  save(plan: ExecutionPlan, ctx: { movieId: string; storage: StorageContext }): Promise<void>;
  load(movieId: string, revision: RevisionId, ctx: { storage: StorageContext }): Promise<ExecutionPlan | null>;
};
```

Workflow deployments call the same helper through the storage proxies.

### Environment Adapters
The core package stops at these pure interfaces. Each execution environment is responsible for wiring them up:
- **CLI / long-running servers** can instantiate a `StorageContext` directly because they have local or S3 credentials at hand.  
- **Vercel Workflow orchestration** cannot call Node APIs inside the `"use workflow"` function, so the server package defines tiny adapters that delegate to `"use step"` functions. Those step functions import the core helpers (`createStorageContext`, `createManifestService`, etc.) and perform the actual work in the step runtime. The workflow then calls the adapters, not the core directly.

This keeps the core layer unaware of steps while still using the same API surface everywhere.

### Planner API
```ts
interface Planner {
  computePlan(args: {
    movieId: string;
    manifest: Manifest;
    eventLog: EventLog;
    blueprint: ProducerGraph;
    targetRevision: RevisionId;
    pendingEdits?: InputEvent[];
  }): Promise<ExecutionPlan>;
}
```
- The planner reads log streams through the supplied `eventLog`, so callers never touch file paths.  
- The planner returns an `ExecutionPlan`; the caller can hand it straight to the runner. Persistence under `runs/<revision>-plan.json` is handled by helper utilities such as `planStore.save(plan, storageContext)` that live in core.

### Topological Layering (Kahn’s Algorithm)
The planner emits producer jobs in dependency-respecting “layers” so the runner can fan out work within a layer while guaranteeing upstream data is ready. We compute those layers using Kahn’s algorithm:

1. **Build indegree counts**. Walk the expanded blueprint and manifest to build a graph of producer → producer dependencies (inputs that are themselves produced artefacts). Track how many incoming edges (`indegree`) each producer has once dirty detection marks it for execution.
2. **Seed the ready queue**. Any dirty producer whose indegree is zero can run immediately because all of its inputs are either raw user inputs or already satisfied artefacts. We enqueue these in a FIFO (or priority) queue.
3. **Drain layer by layer**. Repeatedly drain the queue: every pop becomes part of the current execution layer. For each popped producer, decrement the indegree of its dependants; when a dependant’s indegree reaches zero, push it into the queue for the next layer.
4. **Emit execution layers**. Each pass over the queue forms an ordered array of producers. We append that array to the `ExecutionPlan.layers` list and continue until the queue is empty.
5. **Detect cycles or stale graphs**. If the queue empties before we schedule all dirty producers, we report a cycle (or missing dependency) instead of generating a partial plan. This guards against blueprint drift or bugs that introduce cyclical dependencies.

Because Kahn’s algorithm runs in `O(|V| + |E|)` time with straightforward data structures, it scales with the size of the producer DAG and naturally produces the layered structure the runner expects. It also makes it easy to sprinkle in heuristics (e.g., provider-specific prioritisation) later by adjusting queue ordering without rewriting the core planner.

### Runner Hooks
```ts
interface Runner {
  execute(plan: ExecutionPlan, deps: {
    movieId: string;
    storage: StorageContext;
    eventLog: EventLog;
    produce: ProduceFn; // provided by CLI or server; runs the actual model call
    logger: Logger;
    clock: Clock;
  }): Promise<RunResult>;
  executeJob(job: JobDescriptor, deps: {
    movieId: string;
    storage: StorageContext;
    eventLog: EventLog;
    produce: ProduceFn;
    logger: Logger;
    clock: Clock;
  }): Promise<JobResult>;
}
```
- `produce` encapsulates how to contact OpenAI, ElevenLabs, etc. The core runner orchestrates dependency ordering and logging, while the environment supplies rate limits, retries, and credentials.  
- The runner appends artefact/input events via `eventLog` and stores blobs/manifests via the `StorageContext`; executors perform no raw file I/O.
- `RunResult` exposes the aggregated status plus helpers like `buildManifest()` so callers can persist the final manifest without re-reading the logs manually.

### Manifest Service
```ts
interface ManifestService {
  loadCurrent(movieId: string, deps: { storage: StorageContext }): Promise<{ manifest: Manifest; hash: string }>;
  saveManifest(manifest: Manifest, deps: {
    storage: StorageContext;
    previousHash: string;
    clock: Clock;
  }): Promise<void>;
  buildFromEvents(args: {
    movieId: string;
    targetRevision: RevisionId;
    eventLog: EventLog;
  }): Promise<Manifest>;
}
```
- `saveManifest` writes `manifests/<revision>.json` through the FlyStorage client on the `StorageContext` and updates `current.json`. FlyStorage plugins handle atomic writes (local temp file + rename; S3 multipart upload + `CopyObject`).  
- If the backend cannot guarantee atomicity, we can add optional `Lock` interface so cloud environments plug in DynamoDB/Redis locks without leaking those concepts into function signatures.

### Environment Leak Check
- **Concurrency limits**: none of the interfaces mention threads or async pools; the environment can choose how many workers to spawn when calling `Runner.execute`.  
- **Credentials/Secrets**: the core calls a `produce` function supplied by the caller, so the core never reads env vars directly.  
- **Filesystem paths**: the core resolves paths relative to the movie root via `StorageContext`; executors never manipulate paths manually.  
- **Persistence guarantees**: FlyStorage adaptors already implement “atomic write” and “append” semantics. If a backend cannot provide true atomicity, the adaptor must emulate it (e.g., write to temp key then rename). This requirement should be documented so cloud runners can pick a compatible plugin.  
- **Time/Clock**: the only time dependency is the injected `Clock`, ensuring deterministic tests and easy mocking.

### Example CLI Workflow (pseudo-code)
Below is a CLI-oriented regeneration flow that wires the core services together while using `p-limit` to cap concurrent producer calls.

```ts
import pLimit from "p-limit";
import {
  createStorageContext,
  createEventLog,
  createPlanner,
  createRunner,
  createManifestService,
  blueprintForConfig,
  nextRevisionId,
  planStore,
  type Logger,
  type Clock,
} from "@tutopanda/core";

const limit = pLimit(4); // CLI decides desired parallelism

const produce: ProduceFn = (job) =>
  limit(async () => {
    if (job.producer === "script_producer") {
      return callOpenAI(job);
    }
    if (job.producer === "audio_producer") {
      return callElevenLabs(job);
    }
    return callGenericProvider(job);
  });

async function regenerateMovie(movieId: string, pendingEdits: InputEvent[] = []) {
  const logger: Logger = {
    info: (msg, meta) => console.log(msg, meta ?? ""),
    error: (msg, meta) => console.error(msg, meta ?? ""),
  };
  const clock: Clock = {
    now: () => new Date().toISOString(),
  };
  const storage = createStorageContext({
    driver: "local",
    options: { rootDir: "./.tutopanda/builds" },
  });
  const eventLog = createEventLog(storage);
  const manifestSvc = createManifestService(storage);

  const { manifest, hash: baseHash } = await manifestSvc.loadCurrent(movieId, { storage });
  const blueprint = blueprintForConfig(manifest);
  const targetRevision = nextRevisionId(manifest.revision);

  const planner = createPlanner({ logger });
  const plan = await planner.computePlan({
    movieId,
    manifest,
    eventLog,
    blueprint,
    targetRevision,
    pendingEdits,
  });

  await planStore.save(plan, { movieId, storage }); // helper living in core

  const runner = createRunner({ logger, clock });
  const runResult = await runner.execute(plan, {
    movieId,
    storage,
    eventLog,
    produce,
    logger,
    clock,
  });

  if (runResult.status !== "succeeded") {
    throw new Error("Generation failed");
  }

  const newManifest = await runResult.buildManifest(); // core helper merges logs into manifest
  await manifestSvc.saveManifest(newManifest, {
    storage,
    previousHash: baseHash,
    clock,
  });
}
```

`p-limit` ensures no more than four producer jobs run simultaneously; increasing the limit scales concurrency without touching core internals. The CLI never performs raw file I/O—every disk or S3 operation flows through the injected `StorageContext` and the higher-level helpers exposed by the core package.

### Example Vercel Workflow Runner (pseudo-code)
In the cloud deployment, the `"use workflow"` function stays thin and defers all I/O to `"use step"` helpers that live in the server package. Those steps are the only place that instantiate `StorageContext` or talk to external providers, keeping the core layer step-free.

```ts
// app/workflows/regenerate-movie.ts
import { blueprintForConfig, nextRevisionId, type InputEvent, type StorageConfig } from "@tutopanda/core";
import {
  loadManifestStep,
  computePlanStep,
  persistPlanStep,
  executeLayerStep,
  buildManifestStep,
  saveManifestStep,
} from "@/server/workflow/regenerate-movie-steps";

const storageConfig: StorageConfig = {
  driver: "s3",
  options: {
    bucket: process.env.BUILD_BUCKET,
    prefix: "videos/",
  },
};

export async function regenerateMovieWorkflow(movieId: string, pendingEdits: InputEvent[] = []) {
  "use workflow";

  const { manifest, baseHash } = await loadManifestStep({ movieId, storageConfig });
  const blueprint = blueprintForConfig(manifest);
  const targetRevision = nextRevisionId(manifest.revision);

  const plan = await computePlanStep({
    movieId,
    storageConfig,
    manifest,
    blueprint,
    targetRevision,
    pendingEdits,
  });

  await persistPlanStep({ movieId, storageConfig, plan });

  for (const layer of plan.layers) {
    await executeLayerStep({
      movieId,
      storageConfig,
      layer,
      maxConcurrent: 3,
    });
  }

  const newManifest = await buildManifestStep({
    movieId,
    storageConfig,
    targetRevision,
  });

  await saveManifestStep({
    movieId,
    storageConfig,
    manifest: newManifest,
    previousHash: baseHash,
  });
}
```

The corresponding step module lives in the server package (or `tutopanda-server`). Each step imports only the core helpers it needs, instantiates real storage contexts, and uses `p-limit` to control concurrency while calling the shared runner.

```ts
// server/workflow/regenerate-movie-steps.ts
import pLimit from "p-limit";
import {
  createStorageContext,
  createEventLog,
  createPlanner,
  createRunner,
  createManifestService,
  planStore,
  type StorageConfig,
  type Manifest,
  type ProducerGraph,
  type RevisionId,
  type InputEvent,
  type ExecutionPlan,
  type JobDescriptor,
  type Logger,
  type Clock,
  type ProduceFn,
} from "@tutopanda/core";

const logger: Logger = {
  info: (msg, meta) => console.log("[workflow]", msg, meta ?? ""),
  error: (msg, meta) => console.error("[workflow]", msg, meta ?? ""),
};

const clock: Clock = {
  now: () => new Date().toISOString(),
};

export async function loadManifestStep(args: { movieId: string; storageConfig: StorageConfig }) {
  "use step";

  const storage = createStorageContext(args.storageConfig);
  const manifestSvc = createManifestService(storage);
  const result = await manifestSvc.loadCurrent(args.movieId, { storage });
  return { manifest: result.manifest, baseHash: result.hash };
}

export async function computePlanStep(args: {
  movieId: string;
  storageConfig: StorageConfig;
  manifest: Manifest;
  blueprint: ProducerGraph;
  targetRevision: RevisionId;
  pendingEdits: InputEvent[];
}) {
  "use step";

  const storage = createStorageContext(args.storageConfig);
  const eventLog = createEventLog(storage);
  const planner = createPlanner({ logger });

  return planner.computePlan({
    movieId: args.movieId,
    manifest: args.manifest,
    eventLog,
    blueprint: args.blueprint,
    targetRevision: args.targetRevision,
    pendingEdits: args.pendingEdits,
  });
}

export async function persistPlanStep(args: { movieId: string; storageConfig: StorageConfig; plan: ExecutionPlan }) {
  "use step";

  const storage = createStorageContext(args.storageConfig);
  await planStore.save(args.plan, { movieId: args.movieId, storage });
}

export async function executeLayerStep(args: {
  movieId: string;
  storageConfig: StorageConfig;
  layer: JobDescriptor[];
  maxConcurrent: number;
}) {
  "use step";

  const storage = createStorageContext(args.storageConfig);
  const eventLog = createEventLog(storage);
  const runner = createRunner({ logger, clock, concurrency: args.maxConcurrent });
  const limit = pLimit(args.maxConcurrent);

  const produce: ProduceFn = (job) =>
    limit(async () => {
      if (job.producer === "script_producer") {
        return callOpenAI(job);
      }
      if (job.producer === "audio_producer") {
        return callElevenLabs(job);
      }
      return callGenericProvider(job);
    });

  await Promise.all(
    args.layer.map((job) =>
      runner.executeJob(job, {
        movieId: args.movieId,
        storage,
        eventLog,
        produce,
        logger,
        clock,
      }),
    ),
  );
}

export async function buildManifestStep(args: {
  movieId: string;
  storageConfig: StorageConfig;
  targetRevision: RevisionId;
}) {
  "use step";

  const storage = createStorageContext(args.storageConfig);
  const manifestSvc = createManifestService(storage);
  const eventLog = createEventLog(storage);
  return manifestSvc.buildFromEvents({
    movieId: args.movieId,
    targetRevision: args.targetRevision,
    eventLog,
  });
}

export async function saveManifestStep(args: {
  movieId: string;
  storageConfig: StorageConfig;
  manifest: Manifest;
  previousHash: string;
}) {
  "use step";

  const storage = createStorageContext(args.storageConfig);
  const manifestSvc = createManifestService(storage);
  await manifestSvc.saveManifest(args.manifest, {
    storage,
    previousHash: args.previousHash,
    clock,
  });
}
```

Key takeaways:
- **Core stays oblivious to Workflow mechanics**: Only the server package knows about steps. It instantiates `StorageContext`, planner, runner, and manifest service inside step functions, then returns plain data back to the workflow.  
- **`ProduceFn` remains environment-defined**: Each step constructs the `produce` callback on the fly, attaching rate limiting (`p-limit`) and provider-specific logic without changing the core runner contract.  
- **Concurrency is explicit**: The workflow chooses `maxConcurrent` per layer, and the step enforces it via both the runner’s `concurrency` option and `p-limit`, matching Vercel’s Promise-based control-flow guidance.
