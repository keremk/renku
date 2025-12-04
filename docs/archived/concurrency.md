# Concurrency Support

Yes—the current architecture still supports pushing concurrency, rate limiting, and retry policies up into the CLI and upcoming cloud worker layers without modifying core. The abstractions haven't drifted away from that goal, even though the features aren't implemented yet.

## Core Architecture

### Core runner stays sequential by design
- `createRunner().execute` walks each layer serially (`core/src/runner.ts:52-104`), but the module also exposes `runner.executeJob(job, ctx)` (`core/src/runner.ts:107-127`). Clients can orchestrate their own job scheduling (e.g., wrap executeJob with p-limit or a step function). The runner doesn't hold a global mutex beyond its own loop, so alternative schedulers can sit one level up at once or retry a job independently.

### Event log & storage tolerate parallel writes
- `createStorageContext` serialises appends per file via an internal queue (`core/src/storage.ts:22-84`), so concurrent `executeJob` calls from p-limit or cloud steps won't corrupt `events/*.log`. Manifest rebuilds simply replay the logs (`core/src/manifest.ts:52-109`).

### Registry/handlers are concurrency-agnostic
- `createProviderRegistry` just caches handlers keyed by descriptor (`providers/src/registry.ts:16-61`). The handlers themselves (e.g., OpenAI) are stateless—warm start caches SDK clients, but invocation contains no global locks (`providers/src/producers/llm/openai.ts:30-201`). You can invoke them from multiple workers/steps as long as you provide the same descriptor.

### CLI already sits above the runner
- The CLI now schedules jobs per layer through `executePlanWithConcurrency` (`cli/src/lib/plan-runner.ts`), which wraps `runner.executeJob` in a `p-limit` pool. The `--concurrency` flag (persisted to `cli-config.json`, default `1`) feeds that pool so users can raise or lower parallelism without changing core.

### Cloud workflow fits the same mold
- A cloud worker can initialize storage + registry, call `runner.executeJob` in each Vercel Workflow step, and rely on durable storage for the event log. Because every job is identified by `(movieId, revision, jobId)`, repeated or retried steps won't break invariants; at worst you'll append duplicate artefact events, which manifest building overwrites by latest revision.

## What You'll Need To Add (When You Get There)

- The CLI/cloud runners must bring their own scheduling (p-limit, queues, step orchestration) and wrap `runner.executeJob`.
- Rate limiting/retry logic should live in decorators around handler invoke calls (e.g., CLI-specific wrapper or server step middleware).
- Manifest/event-log aggregation already supports convergent updates, so no extra core changes are required.

## Summary

Even though concurrency/rate limiting/retries aren't in place yet, the current layering still lets you implement them in the CLI and cloud clients without fighting the core abstractions.
