# CLI Provider Interaction Architecture

This document describes how the Tutopanda CLI resolves providers, orchestrates builds with the core runner, and feeds artefacts back into storage. The goal is to make provider selection, fallback, and execution behaviour entirely predictable from CLI inputs.

## Overview

```
tutopanda generate (new run or --movie-id/--last)
    ↓
load CLI config (default-settings.json + overrides)
    ↓
derive provider variants per producer (primary + fallbacks)
    ↓
resolve handlers through tutopanda-providers registry
    ↓
construct ProduceFn wrapper
    ↓
invoke core runner with plan + manifest
    ↓
provider handlers run jobs, artefacts persisted by core/storage
```

The CLI never talks to provider SDKs directly. All interactions flow through the provider registry described in `providers/docs/provider-api.md`, keeping the CLI focused on configuration, orchestration, and user interaction.

## Inputs & Data Sources

- **CLI settings** (`~/.tutopanda/default-settings.json` + per-run overrides) declare producer → provider priorities and custom attributes. This file may include fallbacks and per-provider config files; the CLI determines the execution environment itself.
- **Execution plan** (`ExecutionPlan` from `tutopanda-core`) lists jobs by producer kind, including the `provider` and `providerModel` selected during planning.
- **Manifest & event log** ensure the runner can detect incremental changes and persist artefacts.
- **Secrets** come from the CLI runtime (typically environment variables) and are passed to the provider registry via a `secretResolver`.

## Lifecycle Hooks

1. **Initialisation**
   - `tutopanda init` creates storage directories and base config.
   - Subsequent commands read settings, prompt the user for overrides if needed, and prepare runtime context (logger, telemetry ids, etc.).

2. **Plan Loading**
   - Whenever the user runs `tutopanda generate` (new run with inputs/blueprint or continuation via `--movie-id`/`--last`), the CLI invokes `generatePlan` from `tutopanda-core` to produce the fresh `ExecutionPlan` + manifest snapshot that will seed the run.
  - The CLI reads the active settings JSON, merges overrides, and eagerly loads every referenced provider config file (TOML/JSON/text) so each producer has a concrete `(provider, model, config)` tuple available at runtime. The CLI tags every variant with `environment: 'local'` today (cloud runs will reuse the same mechanism later). These selections are written to `providers.json` alongside the movie manifest for subsequent edits.
   - New runs create a brand-new movie directory, apply shortcut overrides, and store the computed plan as the initial state before any providers run.
   - Continuation runs reload the stored `config.json` / `providers.json`, apply additional overrides (including edited TOML), and regenerate the plan so revisions start from the current manifest.

3. **Provider Resolution**
  - CLI maps each producer in the plan to the concrete `(provider, model)` entry defined in settings (primary + fallbacks), stamps `environment: 'local'`, and attaches the parsed configuration payload plus raw attachment contents.
   - It deduplicates those triples and calls `registry.resolveMany` once up front; this populates the handler cache and allows warm start to surface missing secrets before execution begins.

4. **Runner Execution**
  - CLI composes a `ProduceFn` via `createProviderProduce(registry, providerOptions, resolvedInputs, resolutionCache, logger)` and injects it into `createRunner`.
   - During execution, the runner invokes the produce function per job; artefact persistence and manifest updates happen inside core.

5. **Wrap-up**
   - CLI outputs run summaries, writes manifests to disk, and surfaces diagnostics (provider latencies, fallback usage) to the user.

## Provider Resolution Workflow

```mermaid
sequenceDiagram
    participant CLI as CLI Runtime
    participant Registry as Provider Registry
    participant Handler as Provider Handler
    CLI->>Registry: resolveMany([{ producer, variant, fallbacks }])
    Registry-->>CLI: bindings (lazy handlers)
    CLI->>Registry: warmStart(binding.handlers)
    CLI->>Runner: execute(plan, { produce })
    Runner->>CLI: request.job (ProduceRequest)
    CLI->>Handler: invoke(jobContext + resolved inputs)
    Handler-->>CLI: ProviderResult
    CLI-->>Runner: ProduceResult
```

- `warmStart` is optional; when supported the CLI runs it in parallel prior to starting the runner to surface secret/config issues early.
- Resolution errors (missing provider variant or unresolvable fallback) are thrown before the runner starts, failing fast.

## Data Structures

```ts
type ProviderOptionsMap = Map<ProducerKind, ProviderOption[]>;

interface ProviderOption {
  priority: 'main' | 'fallback';
  provider: ProviderName;
  model: string;
  environment: 'local' | 'cloud';    // currently always 'local' when emitted by the CLI
  config?: unknown;                  // parsed TOML/JSON payload
  attachments: ProviderAttachment[]; // raw file contents passed through verbatim
  customAttributes?: Record<string, unknown>;
}
```

- Generate persists this map to `providers.json` so subsequent runs reuse the exact same settings unless overrides are provided.
- When invoking handlers the CLI merges `config` + `customAttributes`, replays the raw attachment contents, forwards any planner metadata under `context.extras.plannerContext`, and provides a `resolvedInputs` dictionary containing the latest CLI input values (prompt, audience, duration, etc.).

## Execution Flow Example

### Script Generation with Fallback

1. `default-settings.json` declares:
   ```json
   {
     "producer": "ScriptProducer",
     "providers": [
       { "priority": "main", "provider": "openai", "model": "openai/gpt5" },
       { "priority": "fallback", "provider": "replicate", "model": "google/gemini-2.5-flash" }
     ]
   }
   ```
2. CLI resolves both variants. The registry prepares handlers:
   - Primary: OpenAI via Vercel AI SDK, warm start ensures API key present.
   - Fallback: Replicate call to Gemini.
3. Runner invokes job:
   - CLI builds `ProviderJobContext` that includes the job metadata plus parsed provider configuration objects (e.g. TOML → JSON) in `context.providerConfig`, along with any raw attachments if the provider needs to rehydrate original files. The CLI does not interpret the meaning of these fields—it simply forwards them exactly as defined in the settings.
   - Primary handler succeeds, returning artefacts for `MovieTitle`, `MovieSummary`, segment scripts. CLI adapts result into `ProduceResult`.
4. Manifest is updated with new artefacts; CLI logs `provider.invoke.end` with metadata for user visibility.

### Audio Producer Fallback Trigger

1. Primary ElevenLabs voice hits a 429; handler throws `ProviderFailure` flagged as retryable.
2. Produce wrapper catches the failure, records diagnostics, and invokes fallback variant (Replicate `minimax/speech-02-hd`).
3. Fallback succeeds. CLI surfaces in summary:
   ```
   AudioProducer used fallback replicate/minimax/speech-02-hd after 429 from elevenlabs/v3
   ```
4. Diagnostics include both attempts for auditing.

## Dry Runs

- The `--dry-run` flag on `tutopanda generate` executes the full planning/resolution pipeline but swaps the provider registry into mock mode so no external APIs are called.
- Dry runs still initialise the movie’s storage folder when invoked from the CLI so users can inspect the generated plan, manifest snapshot, and mock artefacts in `builds/movie-{id}`.
- Mock handlers produce deterministic, zero-cost artefacts that mimic provider outputs; the rest of the runner flow (event log, manifest building) remains unchanged.
- When `executeDryRun` is used from automated tests (no storage path supplied) the storage context is in-memory, preventing any file system writes while keeping the behaviour consistent.
- Omitting `--dryrun` triggers the live path that resolves real providers and persists artefacts/manifests to disk.

## Secrets & Configuration Files

- CLI collects secrets through:
  1. Environment variables (`OPENAI_API_KEY`, `REPLICATE_API_TOKEN`, `ELEVENLABS_API_KEY`, etc.).
  2. Optional `.env` files loaded during CLI bootstrap (honouring user consent).
  3. Prompted input when running interactively (values passed directly to registry, not persisted).
- Per-provider config files (e.g. TOML referenced in CLI settings) are parsed into plain data, merged into `ProviderVariant.overrides`, and forwarded to handlers via `job.context.providerConfig`.
- Missing secrets cause early resolution failures with friendly action items (`Set OPENAI_API_KEY or mark ScriptProducer as mock.`).

## Observability & Diagnostics

- CLI wraps registry hooks to surface progress:
  - `provider.invoke.start` → spinner/log entry with provider/model/environment (currently `environment` is always `'local'`).
  - `provider.invoke.retry` → warning with reason (rate limit, transient error).
  - `provider.invoke.fallback` → info entry citing the new variant.
  - `provider.invoke.error` → bubbled up as runner job failure; CLI suggests retry or configuration fix.
- Summary includes per-producer latency stats (collected via telemetry hooks) and indicates whether outputs came from mock or live paths.

## Cancellation

- On Ctrl+C the CLI:
  1. Signals the runner to stop accepting new jobs.
  2. Calls `abort` on in-flight handlers that support it (Replicate prediction cancellation, streaming LLM abort).
  3. Flushes event logs and writes a partial manifest reflecting completed jobs.

## Alignment with `core/src/runner.ts`

- The runner’s `produce` hook is the only integration point; CLI ensures it always receives a `ProduceFn` shaped result.
- Artefact persistence, event logging, and manifest materialisation remain inside core, so provider handlers return only in-memory artefacts.
- CLI derives `inputsHash` and file persistence indirectly through the runner; no provider handler writes to disk directly.

## Next Steps

1. Extend CLI configuration parsing to support additional fallback metadata and per-provider overrides.
2. Implement `resolveMany` usage in `cli/src/lib/build.ts`, including warm start and caching.
3. Add observability wiring to forward provider telemetry into the CLI logger for immediate feedback.
4. Document user-facing flags for selecting provider variants and running hybrid mock/live builds.
