# Provider API Overview

The providers package exposes a compact TypeScript surface so the CLI (and later the server runtime) can execute third-party AI services without embedding SDK logic everywhere else. This document describes the implemented contracts as of today.

## Registry Entry Point

```ts
import { createProviderRegistry } from '@tutopanda/providers';

const registry = createProviderRegistry({
  mode: 'mock',              // or 'live'
  logger,                    // optional ProviderLogger
  secretResolver,            // optional SecretResolver
});
```

`createProviderRegistry` wires the registry to the implementations declared in `src/mappings.ts` and returns:

```ts
interface ProviderRegistry {
  readonly mode: ProviderMode;
  resolve(descriptor: ProviderDescriptor): ProducerHandler;
  resolveMany(descriptors: ProviderDescriptor[]): ResolvedProviderHandler[];
  warmStart?(bindings: ResolvedProviderHandler[]): Promise<void>;
}
```

- `mode` is fixed at construction (`'mock' | 'live'`).
- `resolve` lazily instantiates and caches handlers for concrete descriptors.
- `resolveMany` pre-resolves a batch of descriptors (the CLI uses this during warm-up).
- `warmStart` runs each resolved handler’s optional `warmStart` hook.

### Provider descriptors

```ts
type ProviderMode = 'mock' | 'live';
type ProviderEnvironment = 'local' | 'cloud';

interface ProviderDescriptor {
  provider: ProviderName;
  model: string;
  environment: ProviderEnvironment;
}
```

Descriptors are provided by higher-level configuration (CLI `providers.json`, future server settings). The registry does not infer them.

## Implementation Registry

`src/mappings.ts` is the canonical list of implementations. Today it contains:

```ts
export const providerImplementations: ProviderImplementationRegistry = [
  {
    match: { provider: '*', model: '*', environment: '*' },
    mode: 'mock',
    factory: createMockProducerHandler(),
  },
  {
    match: { provider: 'openai', model: '*', environment: '*' },
    mode: 'live',
    factory: createOpenAiLlmHandler(),
  },
];
```

Key types:

```ts
interface ProviderImplementation {
  match: ProviderVariantMatch;
  mode: ProviderMode;
  factory: HandlerFactory;
}

interface ProviderVariantMatch {
  provider: ProviderName | '*';
  model: string | '*';
  environment: ProviderEnvironment | '*';
}

interface HandlerFactoryInit {
  descriptor: ProviderDescriptor;
  mode: ProviderMode;
  secretResolver: SecretResolver;
  logger?: ProviderLogger;
}

type HandlerFactory = (init: HandlerFactoryInit) => ProducerHandler;
```

The registry picks the first implementation whose matcher covers the descriptor and whose `mode` matches the registry mode.

## Handler Contract

```ts
interface ProducerHandler {
  readonly provider: ProviderName;
  readonly model: string;
  readonly environment: ProviderEnvironment;
  readonly mode: ProviderMode;
  warmStart?(context: WarmStartContext): Promise<void>;
  invoke(request: ProviderJobContext): Promise<ProviderResult>;
}
```

Supporting types (see `src/types.ts`):

```ts
interface ProviderJobContext {
  jobId: string;
  provider: ProviderName;
  model: string;
  revision: RevisionId;
  layerIndex: number;
  attempt: number;
  inputs: string[];
  produces: string[];
  context: ProviderContextPayload;
}

interface ProviderContextPayload {
  providerConfig?: unknown;
  rawAttachments?: ProviderAttachment[];
  environment?: ProviderEnvironment;
  observability?: Record<string, unknown>;
  extras?: Record<string, unknown>;
}

interface ProviderAttachment {
  name: string;
  contents: string;
  format: 'json' | 'toml' | 'text';
}

interface ProviderResult {
  status?: ArtefactEventStatus;
  artefacts: ProducedArtefact[];
  diagnostics?: Record<string, unknown>;
}
```

- `providerConfig` is passed through verbatim from the CLI; handlers are free to interpret it.
- `rawAttachments` contains any inline files (e.g. prompt templates) specified by the user.
- `extras` currently carries resolved inputs from the planner and the original planner context; this will grow as more metadata is needed.
- If `status` is omitted the runner treats the job as succeeded.

`WarmStartContext` currently exposes an optional `logger`. The OpenAI handler uses warm start to fetch the API key before the first invocation.

## Secrets and Logging

```ts
interface SecretResolver {
  getSecret(key: string): Promise<string | null>;
}

interface ProviderLogger {
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
  debug?(message: string, meta?: Record<string, unknown>): void;
}
```

- Without a custom resolver the registry falls back to `process.env`.
- Loggers are optional; when provided, handlers should prefix messages with a structured key (see the OpenAI implementation).

## Mock Mode

Instantiating the registry with `mode: 'mock'` activates the wildcard mock implementation:

- `mock-producers.ts` returns handlers that generate deterministic artefacts using `mock-output.ts`.
- Artefacts include inline summaries for text-based outputs and text blobs describing binary placeholders for media artefacts (audio, video, images, etc.).
- Diagnostics capture the request metadata so downstream components can tell that the artefact originated from mock mode.

This allows end-to-end CLI runs and tests without network calls or billing.

## CLI Integration Snapshot

`cli/src/lib/build.ts` demonstrates the intended call flow:

1. Instantiate the registry (`createProviderRegistry`).
2. Gather unique descriptors from the execution plan and call `registry.resolveMany`.
3. Optionally run `registry.warmStart` on the resolved bindings.
4. Build the `ProduceFn` via `createProviderProduce` which:
   - Looks up the appropriate handler (preferring the pre-resolved cache).
   - Normalises the provider context (config + attachments + resolved inputs).
   - Invokes the handler and writes provider metadata into the job diagnostics.

The runner in `tutopanda-core` consumes the resulting `ProduceResult` without knowing about any provider SDK details.

## Current Coverage and Roadmap

- **Live implementations:** `producers/llm/openai.ts` (OpenAI Responses).
- **Mock implementation:** wildcard handler covers every descriptor in mock mode.
- **Upcoming work:** audio, music, video, and start-image producers will reuse the same SDK surface; subsequent milestones will add Replicate handlers for those domains (see `providers/docs/AI-SDKs/replicate.md`).
- **Future enhancements:** richer observability hooks, retry helpers, and mixed-mode execution can be added when required. Update this document whenever those features ship so downstream users have an accurate reference.

Treat this file as the canonical description of the provider API; keep snippets and type definitions in sync with `src/` as we expand support.
