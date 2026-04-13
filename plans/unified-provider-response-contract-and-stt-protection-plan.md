# Unified Provider Response Contract Refactor Plan

## Summary

This plan fixes the `fal-ai` JSON/STT artifact-shape regression at the correct architectural boundary while protecting the existing transcription flow end-to-end.

The current bug is:

- `fal` returns a provider response shaped like `{ data, requestId }`
- the real model result is inside `data`
- the unified handler validates `data`
- but for JSON outputs it saves the full `{ data, requestId }` object as the artifact

That means the code currently validates one shape and saves another shape.

The correct fix is:

- adapters must convert provider-specific responses into a standard internal result shape
- the unified handler must only work with the actual model result
- provider metadata like `requestId` must stay separate from saved JSON artifacts

This refactor must preserve the existing design goal:

- live and simulated should use the same codepath
- the only difference should be at the provider boundary where live calls the real API and simulated returns a mock but realistic result

This plan also treats the Renku transcription flow as a protected compatibility path, because it is a two-layer flow:

- outer producer: `renku / speech/transcription`
- inner delegated STT model: usually `fal-ai / elevenlabs/speech-to-text`

That outer producer currently depends on details of the inner handler response shape, so the refactor must explicitly update and test that contract.

## Current System Picture

### Provider and handler split today

There is one adapter per provider, not one adapter per model.

Current provider families:

- `fal-ai`
  - uses the unified handler path
  - catalog currently includes `image`, `audio`, `video`, and `stt`
  - has provider-specific transport envelope behavior: `{ data, requestId }`
- `replicate`
  - uses the unified handler path
  - catalog currently includes `image`, `audio`, and `video`
- `wavespeed-ai`
  - uses the unified handler path
  - catalog currently includes `image`, `audio`, and `video`
- `elevenlabs`
  - does not use the unified artifact-building path
  - uses a custom stream-based handler
- `openai`
  - uses a separate LLM/text handler
- `vercel`
  - uses a separate LLM/text handler
- `renku`
  - uses internal handlers such as timeline, exporter, transcription

So this refactor should focus on the unified provider path:

- `fal-ai`
- `replicate`
- `wavespeed-ai`

### Important current behavior by provider

`fal-ai`

- live mode currently returns `{ data, requestId }`
- simulated mode also returns `{ data, requestId }`
- media URL extraction already knows how to unwrap `data`
- JSON artifact saving currently does not unwrap `data`

`replicate`

- returns its result directly
- URL extraction handles plain strings / arrays / file objects
- no equivalent JSON envelope issue is currently known

`wavespeed-ai`

- returns its result directly
- URL extraction reads `data.outputs`
- no equivalent JSON envelope issue is currently known

### The terminology this plan uses

To avoid ambiguity, this plan uses only these terms:

- **provider response**: the full raw thing returned by the provider SDK/API
- **result**: the actual model output that should be validated and saved
- **saved artifact**: what Renku stores and what downstream consumers read later
- **providerRequestId**: metadata used for recovery/tracing, not part of the saved artifact

## Current STT Flow End-to-End

This section is intentionally explicit because the transcription path is special and must not be broken.

### 1. Outer selection

The user selects the outer Renku transcription producer:

- provider: `renku`
- model: `speech/transcription`

Inside its config, the nested STT backend is selected:

- `stt.provider = fal-ai`
- `stt.model = elevenlabs/speech-to-text`

This nested structure is declared in the Renku transcription schema via `x-renku-nested-models`.

### 2. Nested model selection is merged into parent config

The input loader has explicit support for nested model selection entries and merges them into the parent producer config.

This is already tested and must keep working exactly as it does now.

### 3. The outer job is a normal TranscriptionProducer job

Planning does not directly schedule a `fal` STT job.
It schedules a `TranscriptionProducer` job that:

- consumes the timeline artifact
- consumes language input
- later delegates internally to the configured STT backend

### 4. The timeline is the source of truth

The outer transcription producer:

- loads `Artifact:TimelineComposer.Timeline`
- finds the `Transcription` track
- sorts the clips by time
- uses those clips as the source of truth for what must be transcribed

It does not bypass the timeline and directly read arbitrary audio fan-in anymore.

### 5. Runner injects blob paths

Before the outer producer runs, the runner:

- resolves upstream artifact blob paths from storage/event log
- injects them into `job.context.extras.assetBlobPaths`

This is how the transcription handler finds the real audio files for the timeline clips.

### 6. Outer transcription producer loads audio segments from storage

The outer transcription producer:

- reads `assetBlobPaths`
- reads `Input:StorageRoot`
- loads each referenced audio file
- preserves clip timing information

If any referenced audio file is missing, it fails fast.

### 7. Outer transcription producer concatenates audio

It concatenates the segment audio with silence gaps as needed so the STT backend sees one continuous audio file.

### 8. Outer transcription producer manually creates an inner STT job

This is the main special-case delegation behavior.

The transcription producer manually constructs a `ProviderJobContext` for the inner STT call with:

- `resolvedInputs`
- `inputBindings`
- `sdkMapping`
- optional extra STT config fields
- the delegated model schema

Important delegated inputs:

- `audio_url` is initially a blob payload containing the concatenated WAV audio
- `language_code` is passed through
- any additional STT config fields are forwarded as direct fields

### 9. The inner handler uses the normal provider runtime

Once that inner job is created, the STT provider handler runs through the normal provider runtime:

- `runtime.sdk.buildPayload(...)`
- blob upload/file resolution
- schema validation
- adapter invocation
- output validation
- artifact generation

This is important because it means the STT delegation path already relies on the normal provider stack, not on some private one-off path.

### 10. The outer transcription producer currently depends on inner handler output details

After the inner STT handler returns, the outer transcription producer currently extracts the STT output by:

- first checking `firstArtifact.diagnostics.rawOutput`
- otherwise falling back to parsing the artifact blob
- then manually unwrapping `data` if present

That means the current transcription flow does not only depend on the saved artifact.
It also depends on inner-handler diagnostics behavior.

This is a critical compatibility detail and must be addressed directly in the refactor.

### 11. Outer transcription producer aligns timestamps and writes the final transcription artifact

Once it has a valid STT result, the outer transcription producer:

- validates non-empty live transcription output
- aligns word timestamps back to clip-local timeline positions
- produces the final outer transcription artifact

That final artifact is what the rest of the system uses.

## Root Cause

The current architectural problem is that the unified handler is handling provider transport details that belong inside adapters.

Today:

- adapter returns a provider-specific provider response
- unified handler partially understands provider-specific wrapper shape
- validation is performed on the result
- artifact saving is performed on the provider response

That split is what caused the bug.

The unified handler should never need to know whether a provider wraps its result in:

- `data`
- `outputs`
- custom metadata objects
- request IDs

Those are adapter concerns.

## Target Architecture

### Core boundary rule

Adapters must return a standard internal object to the unified handler:

- `result`
- `providerRequestId?`
- optionally `providerResponse?` only if explicitly needed for debugging

The unified handler must only use:

- `result` for validation
- `result` for JSON artifact saving
- `result` for media URL extraction
- `providerRequestId` for diagnostics/recovery metadata

### What this means in practice

For `fal-ai`:

- live provider response: `{ data, requestId }`
- adapter converts it to:
  - `result = data`
  - `providerRequestId = requestId`

- simulated provider response currently also behaves like `fal`
- simulated adapter branch must also convert it to:
  - `result = generatedResult`
  - `providerRequestId = simulatedRequestId`

For `replicate`:

- whatever its current returned value is becomes `result`
- normally no `providerRequestId`

For `wavespeed-ai`:

- whatever its current returned value is becomes `result`
- if request ID is available and useful, expose it separately as metadata

### Equal live/simulated path rule

This refactor must preserve the current design principle:

1. build payload
2. resolve uploads
3. validate input
4. call `adapter.invoke(...)`
5. receive `{ result, providerRequestId? }`
6. validate `result`
7. save/extract from `result`

The only difference between modes must remain inside the adapter implementation:

- live mode calls the real provider
- simulated mode synthesizes a realistic result locally

Everything after the adapter boundary must be identical across live and simulated.

## Implementation Plan

### Phase 1. Introduce the unified adapter result contract

Add a typed result object for the unified path.

Recommended shape:

```ts
interface UnifiedInvokeResult {
  result: unknown;
  providerRequestId?: string;
}
```

Optional extension only if debugging truly requires it:

```ts
interface UnifiedInvokeResult {
  result: unknown;
  providerRequestId?: string;
  providerResponse?: unknown;
}
```

Guidance:

- do not use vague names like `rawOutput`
- `result` must always mean the actual model output
- `providerRequestId` must always mean metadata only

### Phase 2. Update unified adapters

Update all unified-path adapters to return `UnifiedInvokeResult`.

#### `fal-ai`

- simulated branch:
  - generate the normal mock result from schema
  - return `result` plus simulated `providerRequestId`
- live branch:
  - call `falSubscribe(...)`
  - unwrap `{ data, requestId }`
  - return `result` plus `providerRequestId`

#### `replicate`

- wrap current return value into `{ result }`

#### `wavespeed-ai`

- wrap current return value into `{ result }`
- include request ID metadata separately only if needed and already available

### Phase 3. Simplify the unified handler

Update the unified handler so it only works with `UnifiedInvokeResult`.

The handler should:

- call `adapter.invoke(...)`
- receive `{ result, providerRequestId? }`
- validate `result`
- save JSON artifacts from `result`
- extract media URLs from `result`
- attach `providerRequestId` separately in diagnostics

Remove provider-specific special-casing from the unified handler.

Specifically:

- remove `fal`-specific unwrap logic from validation
- remove any dependence on wrapped provider responses for JSON outputs

### Phase 4. Clean up success diagnostics

The current STT outer handler reads `diagnostics.rawOutput`.
That success-path contract is ambiguous and mixes concepts.

Refactor this into one of the following, and pick one path consistently:

Preferred:

- successful inner handlers do not expose the result via diagnostics at all
- the outer transcription producer reads the parsed artifact blob instead

Acceptable transitional option:

- if diagnostics expose the result, store it as `result`
- never as wrapped provider response
- never under a vague name like `rawOutput`

Recommendation:

- standardize on artifact blob as the source of truth for successful JSON outputs
- keep diagnostics for metadata only

That is cleaner and avoids duplicate success-path contracts.

### Phase 5. Update the outer transcription producer to the new inner contract

The outer transcription producer must be updated explicitly.

Required behavior:

- it must be able to consume the inner STT result after the refactor
- it must no longer rely on wrapped `fal` response shape
- it must no longer require `diagnostics.rawOutput` to recover the STT result

Preferred implementation:

- read and parse the first artifact blob as the STT result
- only use diagnostics for metadata or failure information

Compatibility rule:

- after the refactor, the outer producer should treat the inner STT result as already unwrapped
- there should be no need for a special `.data` unwrap in the outer transcription producer

### Phase 6. Keep all existing fail-fast behavior

The refactor must not weaken any current hard-failure behavior in the transcription flow.

These behaviors must remain:

- missing timeline input fails
- missing transcription track fails
- empty transcription track fails
- missing storage root fails
- missing asset blob paths fails
- missing referenced audio blob file fails
- live mode with zero STT words fails

### Phase 7. Optional structural cleanup

If the implementation remains easy to review, consider renaming the adapter interface used by the unified path to make the boundary more explicit, for example:

- `UnifiedProviderAdapter`

This is optional.
It should not be done if it creates unnecessary churn without improving clarity.

## Detailed Test Matrix

The test strategy must prove both correctness and compatibility.

### A. Adapter contract tests

Goal:

- prove each unified-path adapter returns `{ result, providerRequestId? }`
- prove live and simulated return the same shape

#### A1. `fal-ai` simulated result contract

Assert:

- adapter invoke returns object with `result`
- `result` matches the schema-generated structure
- `providerRequestId` exists
- no wrapped `{ data, requestId }` object leaks beyond the adapter

#### A2. `fal-ai` live result contract

Mock `falSubscribe(...)` to return `{ output, requestId }`

Assert:

- adapter invoke returns `{ result: output, providerRequestId: requestId }`

#### A3. `replicate` simulated result contract

Assert:

- adapter invoke returns `{ result }`

#### A4. `replicate` live result contract

Mock Replicate SDK output.

Assert:

- adapter invoke returns `{ result }`

#### A5. `wavespeed-ai` simulated result contract

Assert:

- adapter invoke returns `{ result }`

#### A6. `wavespeed-ai` live result contract

Mock API response.

Assert:

- adapter invoke returns `{ result }`

### B. Unified handler tests

Goal:

- prove the unified handler uses the same `result` object everywhere

#### B1. JSON validation and artifact saving use the same object

For a JSON-producing handler:

- validate `result`
- save JSON artifact from `result`
- assert saved artifact JSON exactly matches validated shape

#### B2. Media output extraction uses `result`

For media providers:

- pass `result` into URL normalization
- assert media artifacts still build successfully

#### B3. `providerRequestId` remains metadata only

Assert:

- `providerRequestId` appears in diagnostics/recovery metadata
- `providerRequestId` is not saved into JSON artifact blob data

#### B4. No provider-specific special-case in unified handler

This is partly a code review criterion, but also enforce with tests that the unified handler behaves correctly with the standard adapter contract and does not require a provider-specific branch.

### C. `fal-ai` regression tests

Goal:

- prove the original bug is fixed
- prove media outputs still behave

#### C1. `fal` STT saved artifact root shape

Using the actual STT schema:

Assert saved artifact root contains:

- `text`
- `language_code`
- `language_probability`
- `words`

Assert saved artifact root does not contain:

- `data.text`
- `data.language_code`
- `requestId`

#### C2. `fal` JSON model root shape

If a wired JSON model is available in the active catalog/registry during implementation, add the same shape test for it.

If not, add a contract-style test that simulates a generic `fal` JSON output and proves:

- root fields remain at the root
- wrapper fields are not saved

#### C3. `fal` image output still works

Assert:

- simulated image result still produces media artifacts
- URL extraction still succeeds after moving envelope handling into adapter

#### C4. `fal` video output still works

Assert:

- simulated video result still produces media artifacts
- derived media extraction behavior is unaffected

#### C5. `fal` audio output still works

Assert:

- simulated audio result still produces media artifacts

### D. Outer transcription producer compatibility tests

Goal:

- protect the special delegated STT flow

#### D1. Outer transcription producer still delegates correctly

Unit/integration test around the transcription handler:

Assert:

- inner STT job is built with expected `resolvedInputs`
- `audio_url` starts as blob input
- `language_code` is forwarded
- extra STT config fields are forwarded

#### D2. Outer transcription producer consumes unwrapped STT result

After refactor, assert:

- inner STT result is read successfully
- no `.data` unwrap is required in the outer producer
- timestamp alignment still operates on the expected STT shape

#### D3. Outer transcription producer still fails fast on empty live STT result

Assert:

- live mode with zero `word` entries still throws the expected error

#### D4. Storage-relative audio path resolution stays intact

Keep the existing e2e scenario and ensure it still passes:

- real audio artifact blob paths are injected
- transcription producer loads storage-relative paths correctly
- final transcription artifact is produced

#### D5. Missing referenced audio file still fails

Keep the existing fail-fast e2e scenario:

- delete one referenced audio blob before transcription
- assert the outer producer fails with the expected file-read error

### E. Planning and nested-model tests

Goal:

- protect the nested STT selection behavior that feeds the whole flow

#### E1. Nested model selection merge stays intact

Keep and, if useful, expand the parser test that merges:

- parent producer selection
- nested `.stt` selection

Assert final config still contains:

- outer config values
- nested provider/model
- nested extra config fields

#### E2. Nested model selection without parent still fails

Keep the existing parser failure test.

#### E3. Plan wiring remains correct

Keep the e2e planning tests that assert:

- `TranscriptionProducer` exists in the plan
- timeline is bound to it
- it is scheduled after `TimelineComposer`
- it is scheduled before `VideoExporter`

### F. Cross-provider matrix

Goal:

- prove the contract cleanup did not break the non-fal unified providers

Run/extend matrix tests across:

- `fal-ai`
- `replicate`
- `wavespeed-ai`

For each provider, cover:

- simulated mode still invokes adapter boundary
- required input validation still works
- artifact generation still works
- diagnostics still mark simulated mode correctly

## Acceptance Criteria

The implementation is done only when all of these are true:

- `sdk/unified` no longer contains `fal`-specific unwrapping logic
- unified adapters return a standard `{ result, providerRequestId? }` contract
- unified handler validates, saves, and extracts from the same `result`
- `fal` STT saved artifacts match the declared schema root exactly
- `providerRequestId` stays separate from saved JSON artifacts
- outer `TranscriptionProducer` still works end-to-end
- nested STT selection behavior remains intact
- existing transcription path-resolution e2e tests still pass
- non-fal unified providers still pass their matrix tests

## Suggested Implementation Order

1. Add the new unified adapter result type.
2. Update `replicate` and `wavespeed-ai` first because they are simpler.
3. Update `fal-ai` adapter to unwrap into `result`.
4. Update the unified handler to consume the new contract.
5. Update the outer transcription producer to consume the inner STT result without wrapper assumptions.
6. Add focused regression tests for `fal` JSON/STT root-shape behavior.
7. Run provider-level tests.
8. Run transcription-specific CLI e2e tests.
9. Run full repository `pnpm test` as final verification.

## Verification Commands

During implementation:

```bash
cd providers && pnpm vitest run --config vitest.config.ts --pool=threads
```

```bash
cd cli && pnpm vitest run -c vitest.e2e.config.ts tests/end-to-end/transcription-and-paths/transcription-audio-blob-path-resolution--storage-resolution.e2e.test.ts --pool=threads --poolOptions.threads.singleThread
```

Final verification:

```bash
pnpm test
```

## Notes For The Implementer

- Do not add fallback behavior.
- Do not let the unified handler infer provider response shapes.
- Do not preserve wrapped provider response objects in saved JSON artifacts “for convenience”.
- Treat the outer transcription producer as a compatibility-sensitive consumer of the inner STT result.
- If success-path diagnostics are kept, name fields explicitly and avoid ambiguous names like `rawOutput`.

The most important invariant to protect is:

> the object that passes schema validation must be the same object that gets saved as the JSON artifact and the same object that the outer transcription flow consumes as the STT result.
