# Subtitles Composite Pipeline Implementation Plan

## Summary

This plan replaces the current one-off nested transcription producer flow with a canonical imported-blueprint composition that can be reused from catalog blueprints.

The target result is:

- `catalog/producers/composition/subtitles.yaml` becomes the new reusable subtitles pipeline
- it is mostly a drop-in replacement for the current transcription producer in the graph position between `TimelineComposer` and `VideoExporter`
- `VideoExporter` keeps consuming the same final `Transcription` JSON shape it already expects today
- raw STT model calls stay normal model-backed producers
- model-specific normalization is explicit code we own, not inferred from arbitrary JSON schemas
- sparse transcription segments are handled intentionally and fail fast when the graph metadata does not line up

This plan intentionally keeps the old `catalog/producers/json/transcription.yaml` path working during migration. The new subtitles composite is added first, validated, then existing blueprints can migrate to it one by one.

## Goals

- Introduce a canonical, composable subtitles pipeline built from imported producers/blueprints.
- Keep the external exporter contract stable.
- Keep STT model invocation on the standard provider/model path, including dry-run behavior.
- Support sparse transcription tracks where some narrative segments have transcription audio and others do not.
- Make support for each STT model explicit and reviewable.
- Add comprehensive coverage across core, providers, CLI, and CLI end-to-end fixtures.

## Non-Goals

- Do not auto-normalize arbitrary STT JSON based only on JSON Schema structure.
- Do not silently concatenate multiple transcription-audio clips inside one segment group in v1.
- Do not remove the old transcription producer in the same change.
- Do not change the final JSON shape that `VideoExporter` consumes.

## Final User-Facing Shape

### Drop-in graph position

The new composite should sit in the same high-level graph position as the current transcription producer:

- `TimelineComposer.Timeline -> SubtitlesProducer.Timeline`
- `SubtitlesProducer.Transcription -> VideoExporter.Transcription`

Additional upstream wiring is allowed and required for correctness:

- the same upstream source bound to `TimelineComposer.TranscriptionAudio` must also be bound to `SubtitlesProducer.TranscriptionAudio`
- `Duration` must be bound explicitly
- `LanguageCode` should remain an explicit input/config surface for the subtitles flow

This keeps the mental model the same:

- timeline is still composed first
- subtitles are still produced after the timeline exists
- exporter still receives one final transcription artifact

### Recommended external contract for `subtitles.yaml`

`catalog/producers/composition/subtitles.yaml`

Inputs:

- `Timeline`
- `TranscriptionAudio`
  - `fanIn: true`
  - grouped by `segment`
- `Duration`
- `LanguageCode`
- `NumOfSegments`

Outputs:

- `Transcription`

The output name should stay `Transcription` so parent blueprints can replace the old producer with minimal rewiring.

## Target Architecture

The new flow should be split into three low-level stages plus the outer composition wrapper.

### 1. Raw STT stage

Producer file:

- `catalog/producers/json/stt-timestamps.yaml`

Notes:

- This is the current `catalog/producers/composition/stt-timestamps.yaml`, moved out of `composition/`.
- It must remain a normal model-backed producer so STT model selection works like other model producers.
- It takes one audio input and returns the raw provider/model STT JSON.
- It does not normalize provider-specific output into Renku's internal subtitle shape.

Reason for moving it out of `composition/`:

- imported `composition/*` leaves are treated as fixed composition producers in current CLI/viewer paths
- STT needs to stay model-selectable

### 2. STT normalization stage

Producer file:

- `catalog/producers/composition/stt-normalizer.yaml`

Internal Renku model:

- recommended name: `speech/stt-normalizer`

Responsibilities:

- consume one raw STT JSON artifact
- look up the exact upstream STT model provenance from explicit planner-provided metadata
- choose the exact adapter declared for that upstream model
- convert raw provider/model JSON into a single internal normalized format
- fail fast if the upstream model is not supported for subtitles

This stage is where provider/model-specific parsing lives.

### 2a. First required adapter implementation

This work must explicitly include the first real normalizer implementation for the currently supported STT model:

- provider: `fal-ai`
- model: `elevenlabs/speech-to-text`
- adapter id: `elevenlabs-word-timestamps-v1`

This should not remain an abstract registry design with no actual adapter shipped.

The first implementation should:

- parse the current ElevenLabs raw output shape exactly
- normalize all time values to seconds
- emit only spoken-word entries into the normalized `words[]` array
- filter out spacing-only tokens, punctuation-only tokens, and audio-event markers if the raw payload includes them
- preserve the raw transcript text at the top level when available
- emit language when the upstream payload provides it

This first adapter is part of the definition of done for the subtitles composite pipeline, because the new pipeline is not useful without support for the currently available STT backend.

### 3. Subtitle composition stage

Producer file:

- `catalog/producers/composition/subtitles-composer.yaml`

Internal Renku model:

- recommended name: `speech/subtitles-composer`

Responsibilities:

- consume `Timeline`
- consume normalized per-segment transcripts
- align normalized timestamps into final movie time using the timeline transcription track
- emit the existing final `Transcription` artifact shape used by `VideoExporter`

### 4. Outer composite wrapper

Blueprint file:

- `catalog/producers/composition/subtitles.yaml`

Responsibilities:

- expose the reusable public contract
- loop over narrative segments
- run raw STT only where transcription audio exists for that segment
- run STT normalization for the same active segments
- fan in normalized transcripts into the final composer

## Internal Data Contracts

### Final exporter contract stays unchanged

The final output of `SubtitlesProducer.Transcription` must stay compatible with the current `speech-transcription` artifact contract used by:

- `providers/src/producers/export/ffmpeg-exporter.ts`
- `providers/src/producers/export/ffmpeg/ass-renderer.ts`

That means the composed flow still emits the current final shape with the same semantics:

- `text`
- `words[]`
- `segments[]`
- `language`
- `totalDuration`

### New internal normalized transcript contract

Add a new internal schema for the contract between `stt-normalizer` and `subtitles-composer`.

Recommended file:

- `catalog/models/renku/json/timestamped-transcript.json`

Recommended normalized shape:

- `text: string`
- `language?: string`
- `sourceDuration?: number`
- `words: Array<{ text: string; startTime: number; endTime: number }>`

V1 rules:

- only spoken words should reach this normalized format
- punctuation-only tokens, spacing tokens, and provider-specific event markers should be filtered in the adapter
- all times must be normalized into seconds

This contract should be intentionally small so the composer only solves timeline alignment, not provider interpretation.

## How `stt-normalizer` Knows the Upstream Model

It must not infer anything from canonical IDs or by parsing artifact ID strings.

Instead, the planner should pass explicit per-input artifact provenance into the downstream job context.

Recommended job-context shape:

```ts
job.context.extras.inputArtifactSources[artifactId] = {
  producerId: "Producer:...opaque...",
  producerAlias: "STTTimestamps",
  provider: "fal-ai",
  model: "elevenlabs/speech-to-text",
  sttNormalizer: "elevenlabs-word-timestamps-v1"
};
```

`stt-normalizer` should:

1. read the bound raw STT artifact ID from its inputs
2. look up that artifact in `extras.inputArtifactSources`
3. require `provider`, `model`, and `sttNormalizer` to be present
4. load the adapter by `sttNormalizer`

If any of those values are missing, it should fail fast with a numbered Renku error.

## How New STT Models Plug In

Model support should be explicit in the model catalog, not hidden in a large provider/model switch.

### Model catalog change

Add one new optional field to STT model definitions:

- `sttNormalizer`

Example:

```yaml
- name: elevenlabs/speech-to-text
  type: stt
  sttNormalizer: elevenlabs-word-timestamps-v1
```

Important:

- do not introduce a new `schema` field just for this work
- keep current schema path resolution behavior as-is

### Adapter registration flow

To support a new STT model:

1. add the raw STT model to the normal catalog as usual
2. set `sttNormalizer` on that model if subtitles should support it
3. implement the adapter in the `stt-normalizer` registry
4. add raw fixture payload tests for that adapter

Reuse rule:

- multiple STT models may point to the same `sttNormalizer` if they share the same raw output semantics

Unsupported rule:

- if a model exists without `sttNormalizer`, the subtitles pipeline must fail clearly and say that subtitles do not yet support that STT model

For the first rollout, the plan must explicitly land the `elevenlabs-word-timestamps-v1` adapter and wire the existing `fal-ai / elevenlabs/speech-to-text` catalog entry to it.

## Sparse and Skipped Segment Handling

This is the most important orchestration rule in the whole plan.

### Source of truth split

- `Timeline` is the source of truth for final clip timing
- `TranscriptionAudio` fan-in is the source of truth for which segment groups actually have audio to transcribe

### Desired behavior

If a segment has no `TranscriptionAudio[group]`:

- do not run `stt-timestamps` for that group
- do not run `stt-normalizer` for that group
- do not emit fake empty transcript artifacts
- do not shift other groups to fill the gap

Later groups must keep their real final timeline offsets.

Example:

- segment 0 has transcription audio
- segment 1 has none
- segment 2 has transcription audio

The final subtitles must preserve the true start time of segment 2 from the timeline. Segment 2 must not become "the second transcript clip starting immediately after segment 0".

### Required graph behavior

`subtitles.yaml` should:

- loop over `segment` using `NumOfSegments`
- bind `TranscriptionAudio[segment] -> STTTimestamps[segment].TranscriptionAudio`
- bind `STTTimestamps[segment].TranscriptionWithTimestamps -> STTNormalizer[segment].RawTranscription`
- gate both segment-local stages behind an `exists` condition on `TranscriptionAudio[segment]`

### Planner/runtime support required

Current planner behavior must be tightened so input-existence conditions can deactivate jobs based on resolved input/fan-in state, not only resolved artifacts.

This is required so empty transcription groups never schedule raw STT/normalizer jobs.

### Timeline metadata required

The timeline transcription clip metadata must carry stable group identity.

Recommended change:

- extend `TranscriptionClip.properties` to include `groupIndex`

Composer matching rule:

- `subtitles-composer` matches normalized transcript inputs to timeline transcription clips by `groupIndex`
- it must not rely on filtered array order

### Failure conditions

The composer must fail if:

- a normalized transcript exists for a `groupIndex` that has no matching timeline transcription clip
- a timeline transcription clip exists for a `groupIndex` that should have produced a normalized transcript but none is present
- a transcription group contains more than one audio artifact in v1

That is preferable to silently guessing.

## File-Level Implementation Changes

### Catalog

Update or add:

- `catalog/producers/composition/subtitles.yaml`
- `catalog/producers/json/stt-timestamps.yaml`
- `catalog/producers/composition/stt-normalizer.yaml`
- `catalog/producers/composition/subtitles-composer.yaml`
- `catalog/models/renku/renku.yaml`
- `catalog/models/renku/json/timestamped-transcript.json`

Update the current STT catalog model entry to declare:

- `sttNormalizer: elevenlabs-word-timestamps-v1`

Recommended internal Renku models to add:

- `speech/stt-normalizer`
- `speech/subtitles-composer`

For the internal Renku model schema files:

- keep config minimal
- do not invent unused user-facing config just to satisfy schema defaults
- if config is empty, use an explicit empty-object schema rather than fake fallback values

### Core

Expected changes:

- planner support for input-existence-driven conditional inactivity
- job-context extras support for `inputArtifactSources`
- preserve the exact upstream provider/model/adapter metadata for downstream composition jobs

Likely files:

- `core/src/planning/planner.ts`
- `core/src/condition-evaluator.ts`
- `core/src/types.ts`
- related runner/context plumbing where extras are prepared and consumed

### Providers

Expected changes:

- add `sttNormalizer?: string` to model catalog loading/types
- add Renku handler for `speech/stt-normalizer`
- add Renku handler for `speech/subtitles-composer`
- add adapter registry for STT normalizers
- add or move shared subtitle/transcription artifact types if needed so both old and new paths can reuse them cleanly

Likely files:

- `providers/src/model-catalog.ts`
- `providers/src/registry-generator.ts`
- new handler files under `providers/src/producers/`
- `providers/src/producers/timeline/ordered-timeline.ts`
- related type exports used by exporter and subtitle pipeline

### CLI and viewer

Expected changes:

- register the new fixed composition producers in the CLI composition-model map
- ensure the viewer/models-pane path treats them as fixed internal composition stages with no fake user config

Likely files:

- `cli/src/interactive/interactive-inputs.ts`
- `viewer/server/blueprints/producer-models.ts`
- `viewer/server/blueprints/config-schemas-handler.ts`

## Migration Plan

Phase 1:

- add the new subtitles composite pipeline
- keep the old transcription producer untouched
- add tests and fixtures
- add the first concrete ElevenLabs normalizer adapter
- add a manual-verification catalog blueprint copy

Phase 2:

- migrate one representative catalog blueprint to the new composite
- verify exporter behavior and sparse transcript behavior on a real blueprint path

The representative verification blueprint should be a copied Ken Burns catalog blueprint, not a fresh handcrafted example.

Phase 3:

- migrate remaining blueprints that currently use the old transcription producer
- remove old transcription producer only after the new path has fully replaced it and coverage is in place

## Test Coverage Plan

## 1. Core tests

Add or update tests that prove:

- input-based `exists` conditions can deactivate looped jobs based on sparse fan-in inputs
- downstream jobs receive exact `inputArtifactSources` metadata
- no producer/model inference is done from canonical ID strings

Recommended focus:

- sparse `TranscriptionAudio` groups at indices like `0, 2, 5`
- planner layers include STT and normalizer jobs only for active groups
- final composer still schedules once with the correct fan-in

## 2. Timeline tests

Add tests for:

- transcription clips carry `groupIndex`
- sparse transcription groups preserve true final `startTime` values
- multi-item transcription groups fail in v1

Recommended location:

- `providers/src/producers/timeline/ordered-timeline.test.ts`

## 3. STT normalizer tests

Add a dedicated test suite per adapter using real-looking raw payload fixtures.

Minimum coverage:

- happy path normalization for the currently supported ElevenLabs raw output
- punctuation/event filtering
- time-unit normalization
- unsupported adapter ID
- missing planner-provided `sttNormalizer`
- malformed raw payload for a supported adapter

Recommended fixture naming:

- `cli/tests/fixtures/schemas/subtitles-composition--elevenlabs-raw.fixture.json`
- or equivalent provider fixture path if the adapter tests live in `providers/`

The important convention is:

- kebab-case feature prefix
- double-dash before the scenario name
- `.fixture.json` suffix

## 4. Subtitles composer tests

Add tests for:

- aligning normalized word timestamps to final timeline clip offsets
- sparse segments where transcript groups are non-contiguous
- missing normalized transcript for a clip group
- extra normalized transcript with no timeline clip
- preserving final `totalDuration`
- emitting the same final artifact shape as the current exporter contract

## 5. Legacy regression tests

Keep or add coverage showing:

- the old transcription producer still plans and executes unchanged
- exporter still accepts the same final transcription shape from both old and new paths

## 6. CLI end-to-end fixture and test plan

Add a dedicated fixture family under the existing `transcription-and-paths` namespace.

Recommended blueprint fixture folder:

- `cli/tests/fixtures/blueprints/transcription-and-paths/subtitles-composition-drop-in-replacement`

Recommended blueprint file:

- `cli/tests/fixtures/blueprints/transcription-and-paths/subtitles-composition-drop-in-replacement/subtitles-composition-drop-in-replacement.yaml`

Recommended default inputs file:

- `cli/tests/fixtures/blueprints/transcription-and-paths/subtitles-composition-drop-in-replacement/input-template.yaml`

If a second input variant is needed for sparse coverage, follow the existing naming style:

- `input-template-sparse-segments.yaml`

Recommended CLI e2e test files:

- `cli/tests/end-to-end/transcription-and-paths/subtitles-composition-drop-in-replacement--plan-shape.e2e.test.ts`
- `cli/tests/end-to-end/transcription-and-paths/subtitles-composition-drop-in-replacement--sparse-segments.e2e.test.ts`
- `cli/tests/end-to-end/transcription-and-paths/subtitles-composition-drop-in-replacement--exporter-contract.e2e.test.ts`

### What the CLI e2e tests should assert

Plan-shape test:

- `SubtitlesProducer` appears after `TimelineComposer` and before `VideoExporter`
- `VideoExporter.Transcription` is bound to `Artifact:SubtitlesProducer.Transcription`
- `SubtitlesProducer.Timeline` is bound to `Artifact:TimelineComposer.Timeline`
- `SubtitlesProducer.TranscriptionAudio` is wired from the same upstream source used by `TimelineComposer.TranscriptionAudio`

Sparse-segments test:

- a fixture with non-contiguous transcription groups schedules STT jobs only for those groups
- no STT/normalizer jobs are scheduled for empty groups
- the final plan still includes the composer and exporter

Exporter-contract test:

- the final `Transcription` artifact produced by the new composite is accepted by exporter planning/execution without any exporter schema change

### Deterministic execution strategy for CLI e2e

CLI end-to-end execution must not depend on live network calls or brittle provider simulation semantics.

Recommended strategy:

- keep plan-shape e2e tests using normal catalog producers
- for execution-style e2e, use deterministic raw STT fixtures or a test-specific local producer fixture if needed
- do not make the end-to-end suite depend on generic simulated STT payloads unless they are guaranteed to match the exact supported adapter shape

If a local fixture producer is required, place it under the existing fixture producers namespace with standard naming:

- `cli/tests/fixtures/producers/stt-fixture-generator/stt-fixture-generator.yaml`

This should only be used to make execution deterministic. It should not replace provider-level adapter coverage.

## 7. Catalog manual-verification blueprint

Add a new catalog blueprint by verbatim copying the current Ken Burns blueprint and renaming it with a `-v2` suffix.

Source blueprint folder:

- `catalog/blueprints/ken-burns-documentary`

New blueprint folder:

- `catalog/blueprints/ken-burns-documentary-v2`

Recommended copied files:

- `catalog/blueprints/ken-burns-documentary-v2/historical-documentary-v2.yaml`
- `catalog/blueprints/ken-burns-documentary-v2/input-template.yaml`
- copy the `historical-script/` subfolder as-is for now

Migration rule for this copied blueprint:

- keep the blueprint otherwise verbatim
- replace the old transcription producer wiring with the new `composition/subtitles` composite
- keep the rest of the graph unchanged unless minimal extra connections are needed for `TranscriptionAudio`, `Duration`, or `LanguageCode`

Purpose of this blueprint:

- it is the concrete manual verification surface for the first rollout
- it gives a real catalog blueprint that uses the new composed subtitles pipeline before broader migration
- it keeps later cleanup separate from the first functional migration

This copied `ken-burns-documentary-v2` blueprint is part of the implementation plan, not optional follow-up work.

## Implementation Order

1. Finalize external `subtitles.yaml` contract and keep output name `Transcription`.
2. Move `stt-timestamps` out of `composition/` and keep it as the raw STT stage.
3. Add model catalog support for `sttNormalizer`.
4. Add planner/runtime provenance metadata for downstream artifact inputs.
5. Add the `stt-normalizer` Renku handler and the first adapter registry entry.
6. Add `groupIndex` support on timeline transcription clips.
7. Add the `subtitles-composer` Renku handler.
8. Wire the outer `subtitles.yaml` loop and sparse conditions.
9. Add core/providers tests.
10. Add CLI fixture blueprint and CLI e2e coverage.
11. Add `catalog/blueprints/ken-burns-documentary-v2` as the manual verification blueprint using the new subtitles composite.
12. Verify old transcription producer still passes regression coverage.

## Acceptance Criteria

The work is done when all of the following are true:

- the new subtitles composite can replace the old transcription producer in blueprint graphs with only minimal extra wiring
- sparse transcription segments skip raw STT and normalization jobs cleanly
- final subtitle timestamps match timeline clip timing, not compacted transcript order
- the exporter consumes the new final `Transcription` artifact with no contract change
- the first real `elevenlabs-word-timestamps-v1` normalizer adapter is implemented and wired to the current ElevenLabs STT catalog model
- adding a new STT model requires only catalog declaration plus a new adapter implementation
- unsupported STT models fail with a clear explicit error
- `catalog/blueprints/ken-burns-documentary-v2` exists as a copied manual-verification blueprint using the new subtitles composite
- the old transcription path still works until migration is completed
