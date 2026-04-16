# Simulated Mode Boundary Audit

Date: 2026-04-12

## Goal

Audit the current `simulated` mode against the intended contract:

- `simulated` should follow the same Renku-owned code path as `live`
- all local validation should remain identical
- the only swap should happen at the provider client invocation boundary
- we should not mock HTTP or reach into third-party SDK internals

In practice, that means:

- build the same payload
- validate the same config and required inputs
- check that required provider secrets exist
- resolve the same file inputs
- build the same client-side request shape
- avoid the final real provider call
- continue through the same downstream parsing and artifact path where possible

## Executive Summary

The current codebase is mixed.

Some parts already fit the desired model reasonably well:

- OpenAI/Vercel prompt/config preparation runs before the simulated branch.
- Unified media handlers still do schema loading, payload construction, file-field walking, and input validation before branching.
- Simulated media artifacts are now valid media with real durations, which is good for timeline correctness.

But there are still several important divergences from the intended contract.

The biggest ones are:

1. Secret existence checks are skipped in several simulated paths.
2. The unified media handler branches too early and replaces the entire provider invocation/output path with schema-generated output.
3. Simulated file inputs bypass provider upload logic and invent deterministic fake URLs.
4. Several downstream helpers and internal producers still have fully separate simulated implementations.

The net effect is that current `simulated` mode is not yet “live minus the final provider call.” It is closer to “live setup up to a point, then alternate dry-run logic.”

## What Already Aligns Well

### 1. OpenAI/Vercel still do most Renku-owned setup before the final call

OpenAI:

- `parseOpenAiConfig`
- output schema / response format derivation
- prompt variable resolution
- prompt rendering

All of that still happens before the final `callOpenAi(...)` boundary.

Reference:

- `providers/src/producers/llm/openai.ts:58-115`

Vercel AI Gateway:

- config parsing
- output schema / response format derivation
- prompt rendering
- provider-specific option assembly

Reference:

- `providers/src/producers/llm/vercel-ai-gateway.ts:64-130`

### 2. Unified media handlers still do a meaningful amount of shared pre-call work

Before branching, `createUnifiedHandler(...)` still does:

- schema loading / `$ref` resolution
- `runtime.sdk.buildPayload(...)`
- file-field traversal / resolution
- input validation
- model identifier formatting

Reference:

- `providers/src/sdk/unified/schema-first-handler.ts:90-126`

This is good and should be preserved.

### 3. Simulated artifact generation now uses real media buffers

This is a strong improvement for timeline correctness.

`buildArtifactsFromUrls(...)` now generates:

- PNGs for images
- WAVs for audio
- MP4s for video

Reference:

- `providers/src/sdk/unified/artifacts.ts:105-178`

This means the timeline composer sees real duration-bearing media instead of placeholder text blobs.

## Findings: Divergences From The Intended Boundary

### Finding 1: OpenAI and Vercel skip secret existence checks in simulated mode

This is the clearest mismatch with the intended contract.

OpenAI:

- `warmStart` returns early in simulated mode
- `invoke` also skips `clientManager.ensure()`

Reference:

- `providers/src/producers/llm/openai.ts:30-35`
- `providers/src/producers/llm/openai.ts:97-105`

Vercel:

- `warmStart` returns early in simulated mode
- `invoke` skips `clientManager.ensure(apiKeyName)`

Reference:

- `providers/src/producers/llm/vercel-ai-gateway.ts:36-42`
- `providers/src/producers/llm/vercel-ai-gateway.ts:107-114`

Impact:

- dry-run can succeed without required environment variables
- simulated no longer exercises the same initialization path as live
- test coverage is weakened for real production setup failures

Current test that encodes this looser behavior:

- `providers/src/producers/llm/openai.test.ts:1165-1184`

### Finding 2: Unified media handlers branch too early and replace the whole provider call path

`createUnifiedHandler(...)` currently does not just replace the final client invocation.

In simulated mode it:

- does not create a real client path in `invoke`
- does not call `adapter.invoke(...)`
- does not use provider retry wrappers
- does not receive provider-shaped raw output from the adapter
- instead calls `generateOutputFromSchema(...)` directly

Reference:

- `providers/src/sdk/unified/schema-first-handler.ts:77-88`
- `providers/src/sdk/unified/schema-first-handler.ts:146-180`

Why this matters:

- provider-specific invocation logic is skipped entirely
- retry / recovery behavior is not exercised
- provider-specific request/response quirks that live mode would hit are not exercised
- simulated behavior depends on our schema generator rather than the provider adapter boundary

This is the biggest architectural gap in the current media-provider simulation design.

Current tests that explicitly lock in this alternate path:

- `providers/src/sdk/unified/schema-first-handler.test.ts:288-297`

That test currently asserts:

- `createClient` should not be called
- `invoke` should not be called

Under the desired contract, that is backwards. `createClient` should still happen, and `invoke` is exactly where the simulated boundary should live.

### Finding 3: Secret existence checks are skipped across several media providers

Several media adapters create simulated stubs before resolving their required API key.

Fal:

- `providers/src/sdk/fal/adapter.ts:45-57`

Replicate:

- `providers/src/sdk/replicate/adapter.ts:23-34`

Wavespeed:

- `providers/src/sdk/wavespeed/adapter.ts:31-47`

ElevenLabs:

- `providers/src/sdk/elevenlabs/client.ts:57-67`

Impact:

- simulated mode currently does not validate the existence of:
  - `FAL_KEY`
  - `REPLICATE_API_TOKEN`
  - `WAVESPEED_API_KEY`
  - `ELEVENLABS_API_KEY`

That violates the intended principle that simulated should still fail if the live setup contract is incomplete.

### Finding 4: File uploads are bypassed in simulated mode

Blob/file inputs currently do not go through provider upload hooks in simulated mode.

Instead, `resolveProviderFileInputs(...)` returns a deterministic synthetic `.invalid` URL:

- `providers/src/sdk/unified/file-input-resolution.ts:243-289`

Impact:

- `adapter.uploadInputFile(...)` is never exercised in simulated mode
- upload-specific validation / transformation / provider requirements are skipped
- the path is no longer “same as live until final provider invocation”

Current test that locks this in:

- `providers/src/sdk/unified/schema-first-handler.test.ts:636-660`

That test explicitly expects simulated mode to use fake URLs without calling provider upload.

This is a meaningful divergence from the intended boundary.

### Finding 5: ElevenLabs uses a separate simulated output path instead of a simulated client-call boundary

The ElevenLabs handler is structurally similar to the unified media handler problem, but implemented separately.

In simulated mode it:

- does schema/payload validation
- then directly generates WAV bytes via `generateWavWithDuration(...)`
- skips the actual adapter invocation path entirely

Reference:

- `providers/src/sdk/elevenlabs/handler.ts:69-150`

Impact:

- stream-collection behavior is not exercised
- adapter invocation shape is not exercised
- retry wrapper behavior is skipped

This is understandable as a dry-run implementation, but it is not the same as “live minus final provider call.”

### Finding 6: Derived artifact helpers still have separate simulated implementations

Even when simulated mode now creates valid media, some downstream helpers still branch and avoid using the real processing path.

FFmpeg extraction:

- `providers/src/sdk/unified/ffmpeg-extractor.ts:145-153`

Panel extraction:

- `providers/src/sdk/unified/ffmpeg-image-splitter.ts:170-173`

Impact:

- simulated mode does not test whether the generated media actually passes through FFmpeg extraction correctly
- first-frame / last-frame / audio-track extraction behavior differs between live and simulated
- panel extraction from real simulated images is not exercised

This is not a provider-SDK issue, but it is still a live/simulated divergence inside Renku-owned code.

### Finding 7: Internal exporters still short-circuit simulated mode with placeholder buffers

These are not external provider integrations, but they are still part of dry-run behavior and currently diverge heavily from live execution.

FFmpeg exporter:

- `providers/src/producers/export/ffmpeg-exporter.ts:156-172`

MP4 exporter:

- `providers/src/producers/export/mp4-exporter.ts:108-124`

Impact:

- dry-run export does not exercise the real export stack
- placeholder bytes are returned instead of running the normal export pipeline

Because these are internal producers, they are somewhat outside the “provider client boundary” discussion. Still, from a system-level point of view they are alternate execution paths.

### Finding 8: Transcription relaxes one validation in simulated mode

The transcription handler skips the “STT produced zero words” check in simulated mode:

- `providers/src/producers/transcription/transcription-handler.ts:235-244`

Impact:

- simulated transcription can succeed in cases where live would fail validation

This is a smaller divergence, but it is still exactly the kind of validation mismatch the intended contract wants to avoid.

## Secondary / Legacy Simulation Code

There are older simulation-oriented client managers that are not on the current main provider path but still encode a looser simulation philosophy.

Examples:

- `providers/src/sdk/fal/client.ts`
- `providers/src/sdk/wavespeed/client.ts`

They return mock clients and fake API keys in simulated mode.

Search result:

- `createFalClientManager` is defined but not referenced by the current main provider handlers
- `createWavespeedClientManager` is defined but not referenced by the current main provider handlers

These are lower priority than the active handler paths, but they are worth cleaning up eventually to avoid confusion.

## Current Tests That Encode The Wrong Boundary

These tests currently encode behavior that conflicts with the intended simulation contract:

- `providers/src/producers/llm/openai.test.ts:1165-1184`
  - expects simulated warm start to work without `OPENAI_API_KEY`

- `providers/src/sdk/unified/schema-first-handler.test.ts:288-297`
  - expects simulated mode not to call `createClient` or `invoke`

- `providers/src/sdk/unified/schema-first-handler.test.ts:636-660`
  - expects simulated mode not to call upload logic

There are also several test names across providers that explicitly say “does NOT call API in simulated mode.” That phrasing is not necessarily wrong, but some of those tests currently blur two different ideas:

- correct: “does not make the final external provider call”
- incorrect: “does not go through provider-side setup / client-boundary logic”

## Prioritized Cleanup Order

### Priority 1: Restore secret existence checks everywhere

This is the lowest-risk, highest-value correction.

Applies to:

- OpenAI
- Vercel AI Gateway
- Fal
- Replicate
- Wavespeed
- ElevenLabs

Desired rule:

- simulated mode may use fake key values
- but the required secret must still exist and be resolved through the same path as live

### Priority 2: Move simulation boundary into provider adapters / client-call wrappers

For unified media handlers, the biggest structural fix is:

- keep `createUnifiedHandler(...)` identical between live and simulated
- still create the provider client
- still go through adapter invocation shape
- let the adapter/client-boundary layer return simulated provider-shaped results instead of making the real external call

This is the core architectural change needed to make simulated mode “live minus final provider call.”

### Priority 3: Stop bypassing file uploads

Simulated mode should still exercise provider upload hooks, or at least a simulated upload boundary owned by the adapter, rather than a generic fake-URL helper in shared code.

### Priority 4: Remove downstream Renku-owned simulated shortcuts where real simulated media is already available

Candidates:

- FFmpeg frame/audio extraction
- grid panel extraction
- internal exporters
- transcription validation parity

These should be re-evaluated after the provider-boundary cleanup.

## Bottom Line

The current system is partway to the intended model, but not there yet.

The biggest mismatches are not at the HTTP level. They are higher-level:

- skipping secret existence checks
- branching too early in handlers
- generating outputs directly from schema instead of simulating the provider-client boundary
- bypassing file upload paths

If the target is:

> `live == simulated` except the real provider API call never happens

then the current code still needs a focused cleanup to move simulated mode from an alternate dry-run execution model to a true boundary-level substitution model.
