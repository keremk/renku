# Extensibility Requirements
We want to be able to easily add new providers as new models and providers become available. So it is very important to have a clean interface to implement a (provider, model, environment) - Producer implementation.

- A provider usually offers many different models. And those models are released on a weekly basis, so it should be very easy to add support for a model. There are broadly 2 types of models: Prompt and Media Generators. We use prompt generators (LLMs) for generating prompts which then get fed into the Media Generators to ultimately generate the multimodal content (movies with narration audio, images, videos, music...). 
    - Prompt Generators: These are LLMs that expect a system prompt, and various other inputs to configure. They can generator either single text based outputs or a structure output(JSON Object) that is mainly there to facilitate more than a single prompt artefact (named or collections)
    - Media Generators: These are mostly Diffusion based models or sometimes LLMs but that distinction is not important at this abstraction layer. They generate various types of media (either single or a collection) as artefacts (BLOBs like png, mp3 etc.)
    - A single provider can offer models for both prompt and media generators.
    - Each model can accept a custom set of attributes or can be consuming the existing General attributes. These are provided by the user through the CLI commands and then passed on through the provider APIs down to the actual implementations.
        - Each model should be responsible from its own mapping of these custom or general properties to what their provider model API expects. For example, in the `AI-SDKs/replicate.md` document, we gave a list of all the properties that a model needs from the provider API side by providing their JSON based schema.

- As seen in the `provider-architecture.md` there are a lot of system level boilerplate to make the provider calls work that is common to all (provider, model, environment) combinations. These should be common functions that either a producer author can call or be provided with.

- We will be building the most common producers ourselves but use the same architecture/SDK as the future producer authors.

## What is expected from the producer author:
- Code that maps inputs to what the specific API call needs. This is highly dependent on the (provider, model, environment)
- Implement the API calls
    - However since for example all models in Replicate SDK use the same boilerplate to call the API, adding a new model should not require duplicating that code but instead should be as simple as channeling the mapped inputs. 
- Code that handles the errors but mostly by bubbling it up
    - Different providers may have different error messages/codes. The provider needs to accurately log these and also if possible map to known ones and bubble up. Known errors are mentioned in the next section. 
- Unit and integration tests that covers the usage of the model.

## What is not expected from the producer author:
- Code that handles rate limiting (429) errors
    - We will have 2 clients using this code: 1) CLI and 2)Cloud based. They have very different mechanisms of handling and limiting concurrency. 
- Code that handles or creates concurrent requests
    - We will have 2 clients using this code: 1) CLI and 2)Cloud based. They have very different mechanisms of handling and limiting concurrency. 
- Retry logic and policy for 5xx type errors mostly.
    - This again needs to be handled at the client level.
- Create a mock version of the producer. This should be generally handled and not required for each producer
- Handling 4xx errors that may result in safety blocks, malformed output etc.
    - These are mostly because of bad prompts and the prompts need to be modified, so they need to be bubbled up. Most times a user intervention will be needed. (In the future, we may automate generating a new prompt but that is not currently planned)
    - But the user has to have enough information to resolve it. Which producer, what was the actual error, and what prompt was used.

# Producer SDK

To make producer development predictable—and to keep (provider, model, environment) handlers thin—we will formalise a **Producer SDK** that layers on top of the existing registry contracts. The SDK focuses on repeatable scaffolding, strong typing, and shared utilities so authors only implement the provider-specific bits described above.

## Objectives
- Provide a single entry point for defining producers that captures metadata, configuration schema, and the invoke implementation.
- Ship batteries-included helpers for common plumbing: secret lookups, attachment parsing, artefact assembly, diagnostics, and error translation.
- Keep the public API compatible with the current `ProviderRegistry` so existing CLI/server code continues to work.
- Enable code reuse across different provider types (OpenAI, Replicate, future providers) via pluggable client adapters.
- Make testing straightforward with fixtures and mock utilities that mirror the live invocation contract.

## Core Concepts
- **ProducerDefinition** – derived directly from CLI inputs (`LoadedProducerOption` in `cli/src/lib/producer-options.ts`) that already capture provider, model, environment, config payload, attachments, and custom attributes. The SDK will not introduce a new metadata layer; instead it formalises helpers that consume the existing descriptor/context objects emitted by the CLI and registry.
- **ProducerRuntime** – the object handed to the author inside `invoke`. It exposes resolved secrets, provider-specific SDK client(s), attachment readers, logging hooks, and cancellation signals.
- **ProducerHandlerFactory** – helper that converts an `invoke` implementation into a `HandlerFactory` tied to the descriptor provided by the registry. Provider/model/environment always come from the registry descriptor so we avoid duplicating selection logic.
- **ArtefactBuilder** – utilities that materialise inline/blobs, enforce mime-type expectations, and annotate diagnostics consistently.
- **ErrorAdapter** – helper to wrap provider-specific errors into a common `ProviderError` shape (`type`, `retryable`, `statusCode`, `message`, `raw`). This keeps upper layers from reverse-engineering error semantics.

## Proposed API Surface

```ts
import {
  createProducerHandlerFactory,
  artefactBuilder,
  errors,
} from 'tutopanda-producers-sdk';

export const createOpenAiHandler = createProducerHandlerFactory({
  domain: 'prompt',
  configSchema: openAiPromptSchema, // optional JSON schema to validate CLI-provided config
  warmStart: async ({ clients }) => {
    await clients.openai.ensure();
  },
  invoke: async ({ request, context, runtime }) => {
    const inputs = runtime.inputs.resolve(context.extras?.resolvedInputs);
    const config = runtime.config.parse(context.providerConfig);
    const artefactId = runtime.artefacts.expectInline('Artifact:Prompt[0]');
    const response = await runtime.clients.openai.generate({
      model: request.model,
      prompt: runtime.templates.render(config.prompts, inputs),
    });

    return artefactBuilder.inline({
      artefactId,
      text: response.text,
      diagnostics: { usage: response.usage },
    });
  },
});
```

The concrete helper names can evolve, but the pattern illustrates how authors focus on the provider call while the SDK supplies everything else.

## Runtime Building Blocks
- **Client adapters** – thin wrappers around vendor SDKs (`OpenAIClient`, `ReplicateClient`, etc.) that expose normalised methods (e.g. `responses.generate`, `predictions.create`). Adapters live in `/sdk/clients` and handle authentication via the shared `SecretResolver`.
- **Template utilities** – shared prompt templating and variable substitution helpers (currently inside the OpenAI handler) moved into `/sdk/templates`.
- **Schema helpers** – optional validation tooling with sensible defaults. Authors can opt-in to strict schema validation or accept raw config.
- **Attachment helpers** – parse `ProviderAttachment` arrays (JSON/TOML/text) into typed objects, including size limits and redaction utilities for diagnostics.
- **Diagnostics logger** – centralise how we emit `provider.invoke.*` logs and the shape of the diagnostics object returned in `ProviderResult`.

## Error & Telemetry Strategy
- Standardise on a `ProviderError` interface with `code`, `reason`, `retryable`, `causedByUser`, and `raw` fields. Provide adapters for OpenAI and Replicate out of the box.
- Emit structured telemetry events via the supplied `ProviderLogger`. The SDK will prefix messages (`providers.sdk.invoke.start`, `providers.sdk.invoke.error`) so aggregators can filter by domain.
- Ensure any 4xx/5xx surfaced to callers include provider/model identifiers, request attempt, and deep-linked documentation hints when available.

## Testing Utilities
- `createMockProviderJobContext` – constructs a realistic `ProviderJobContext` with overridable fields.
- `assertArtefact` – small helper that verifies artefact shape (inline text vs blob) and common diagnostics.
- `setupRecorder` – optional VCR-style recorder to capture live responses for integration tests (supporting both CLI and CI runs).
- `fakeSecretResolver` – simplifies testing code paths that expect secrets.

## Migration Plan
1. **Scaffold SDK package structure** – create `providers/src/sdk/` with definition, runtime, client, artefact, and error modules. Re-export through `src/index.ts`.
2. **Port OpenAI handler** – refactor `producers/llm/openai.ts` to use `createProducerHandlerFactory`, extracting shared utilities into the SDK while continuing to rely on CLI-provided descriptors/config.
3. **Introduce Replicate adapter** – implement a reusable handler for image models, backed by the Replicate SDK, and share input/diagnostic helpers through the SDK.
4. **Update `mappings.ts`** – register producers via the SDK factories, keeping registry integration untouched.
5. **Document author workflow** – expand this file and `provider-api.md` with a “How to build a producer” walkthrough referencing the SDK primitives.
6. **Backfill tests** – add unit coverage for the SDK helpers and update existing producer tests to use the new fixture utilities.

## Phase Progress
- **Phase 1 (SDK scaffolding)** – Completed. The SDK exports runtime helpers, artefact builders, error adapters, and a generic `createProducerHandlerFactory`.
- **Phase 2 (OpenAI refactor)** – Completed. The LLM handler now relies on the SDK runtime/config plumbing and the accompanying unit suite has been updated.
- **Phase 3 (Replicate adapters)** – First milestone landed: `TextToImageProducer` is implemented via `createReplicateTextToImageHandler`, covering `bytedance/seedream-4`, `google/imagen-4`, `google/nano-banana`, and `tencent/hunyuan-image-3`. The handler normalises prompts from planner context, merges CLI-supplied defaults, downloads binary artefacts, and records deterministic diagnostics. Unit coverage uses mocked Replicate + fetch, and an opt-in integration test exercises the live API when `REPLICATE_API_TOKEN` is present. Future milestones will extend the same adapter pattern to audio/video producers.

## Future Enhancements
- Code generation from model schemas (e.g. Replicate’s OpenAPI JSON) to reduce manual property mapping.
- Optional middleware hooks (retry decorators, tracing) applied via `createProducerHandlerFactory`.
- Capability discovery APIs that surface `ProducerDefinition` metadata to the CLI UI for model selection.

This SDK keeps the fast path for new producers focused on the essentials—mapping inputs and calling the provider—while centralising the ceremony needed to operate reliably across different runtimes.
