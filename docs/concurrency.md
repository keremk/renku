# Concurrency Architecture

This document describes how Renku handles concurrent operations, the storage model, and known limitations.

## Overview

Renku uses a single-process concurrency model where multiple jobs can execute in parallel within a single CLI invocation. The architecture is designed to maximize throughput when calling AI providers while maintaining data consistency.

## Storage Abstraction: FlyStorage

Renku uses [FlyStorage](https://flystorage.dev/) as the storage abstraction layer, supporting:

- **Local filesystem** (`local`)
- **In-memory** (`memory`) - for testing
- **S3-compatible** (`s3`) - including AWS S3, Cloudflare R2

FlyStorage provides a unified API for file operations but does not offer atomic compare-and-swap (CAS) operations. This influences how we handle concurrent writes.

## Event Log: Append-Only JSONL

Each movie maintains an append-only event log (`events.jsonl`) that records all artifact generation events. This design provides several benefits:

### Format

Events are stored as newline-delimited JSON (JSONL):

```jsonl
{"type":"artifact","artifactId":"Producer:Script.Title","value":"My Movie","timestamp":"2024-01-01T00:00:00Z"}
{"type":"artifact","artifactId":"Producer:Script.Segments[0].Text","value":"...","timestamp":"2024-01-01T00:00:01Z"}
```

### Append Queue Serialization

Within a single process, event log appends are serialized using an in-memory queue (`appendQueues` in `storage.ts`):

```typescript
// Simplified from core/src/storage.ts
const appendQueues = new Map<string, Promise<void>>();

async function enqueueAppend(key: string, task: () => Promise<void>): Promise<void> {
  const previous = appendQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  appendQueues.set(key, next);
  await next;
}
```

This ensures that concurrent jobs within the same process write their events sequentially to the log, preventing interleaved writes.

### Atomic File Writes

Individual file writes use an atomic pattern (write to temp file, then rename):

```typescript
// From core/src/storage.ts
const tempKey = `${key}.${randomBytes(8).toString('hex')}.tmp`;
await storage.write(tempKey, contents);
await storage.moveFile(tempKey, key);
```

On POSIX-compliant systems, `rename()` is atomic within the same filesystem.

## Concurrent Job Execution

### CLI Concurrency with p-limit

The CLI uses `p-limit` to control concurrent job execution within a single run:

```typescript
// From cli/src/lib/plan-runner.ts
const limit = pLimit(concurrency); // Default: 5 concurrent jobs

// Jobs in the same layer can run concurrently
const layerPromises = layer.map((job) =>
  limit(() => runJob(job))
);
await Promise.all(layerPromises);
```

### What Runs Concurrently

1. **Producer jobs** - Multiple AI provider calls can execute in parallel
2. **Event log appends** - Serialized within process (see above)
3. **Artifact storage writes** - Can occur concurrently for different artifacts

### What Is Serialized

1. **Manifest saves** - Only ONE `saveManifest()` call occurs per run, after all jobs complete
2. **Event appends to the same file** - Queued and executed sequentially
3. **Plan layers** - Each layer completes before the next begins

## Manifest Lifecycle

The manifest tracks the current state of all artifacts for a movie. Its lifecycle within a single run:

```
1. Load existing manifest (or create new)
   ↓
2. Build plan from blueprint + manifest
   ↓
3. Execute jobs concurrently (write to event log)
   ↓
4. ALL jobs complete
   ↓
5. Build new manifest from events (single operation)
   ↓
6. Save manifest with hash verification
```

### Hash-Based Conflict Detection

When saving the manifest, we verify the previous hash hasn't changed:

```typescript
// From core/src/manifest.ts
async saveManifest(manifest, { previousHash }) {
  const pointer = await readPointer(storage, movieId);
  if ((pointer.hash ?? null) !== (previousHash ?? null)) {
    throw new ManifestConflictError(movieId, previousHash, pointer.hash);
  }
  // ... write new manifest
}
```

This detects if another process modified the manifest between when we read it and when we write.

## Limitations

### Concurrent CLI Invocations Not Supported

Running multiple CLI invocations on the same movie simultaneously is **not supported**. While the system will detect conflicts and throw `ManifestConflictError`, this scenario should be avoided.

**What happens if you try:**

1. Process A reads manifest (hash: `abc123`)
2. Process B reads manifest (hash: `abc123`)
3. Process A completes jobs, saves manifest (hash: `def456`)
4. Process B completes jobs, tries to save → `ManifestConflictError`

**Why this limitation exists:**

- FlyStorage doesn't provide atomic CAS operations
- Implementing distributed locking across local/S3 storage is complex
- The single-process model covers all current use cases

### Recommendations

1. **Use job-level concurrency** - Let p-limit handle parallelism within a single run
2. **Avoid concurrent runs** - Don't start multiple `renku execute` commands for the same movie
3. **Retry on conflict** - If `ManifestConflictError` occurs, the operation can be safely retried

## Future Considerations

If multi-process support becomes necessary, options include:

1. **Advisory file locking** - Works for local storage only
2. **S3 conditional writes** - Would require bypassing FlyStorage
3. **External coordination** - Redis, DynamoDB, or similar
4. **Optimistic concurrency with merge** - More complex but enables true concurrent editing

For now, the single-process model provides sufficient throughput by parallelizing AI provider calls, which are typically the bottleneck.
