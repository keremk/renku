Naming Rules
- Use feature-first, behavior-second naming.
- Keep everything kebab-case.
- Standardize:
  - Blueprint file: <feature>.yaml
  - Input fixture: <feature>--<scenario>.inputs.yaml
  - E2E test: <feature>--<assertion-focus>.e2e.test.ts
- Organize by feature category so the path itself explains intent.
Target CLI Fixture Organization
- cli/tests/fixtures/blueprints/pipeline-orchestration/...
- cli/tests/fixtures/blueprints/conditional-logic/...
- cli/tests/fixtures/blueprints/input-binding-dimensions/...
- cli/tests/fixtures/blueprints/artifacts-and-derivations/...
- cli/tests/fixtures/blueprints/transcription-and-paths/...
- cli/tests/fixtures/blueprints/producer-mode/...
- Matching structure under cli/tests/fixtures/inputs/... for discoverability.
- Keep cli/tests/fixtures/media and cli/tests/fixtures/schemas, but rename files to feature-based names where useful.
Aggressive Dedupe Plan
- Merge condition-example + transcription-timeline into one canonical blueprint:
  - conditional-narration-routing/conditional-narration-routing.yaml
  - Use multiple input fixtures for scenarios:
    - conditional-narration-routing--baseline.inputs.yaml
    - conditional-narration-routing--transcription-track.inputs.yaml
- Merge scene-character-presence + scene-character-presence-typed into one canonical blueprint:
  - scene-character-reference-routing/scene-character-reference-routing.yaml
  - Keep typed fields needed for dry-run profile tests in this single canonical version.
- Remove duplicated fixture trees after tests are switched.
Blueprint Fixture Rename Map (CLI-local)
- audio-only/audio-only.yaml -> pipeline-orchestration/audio-narration-loop/audio-narration-loop.yaml
- ken-burns/image-audio.yaml -> pipeline-orchestration/image-narration-timeline/image-narration-timeline.yaml
- cut-scene-video/video-audio-music.yaml -> pipeline-orchestration/video-audio-music-timeline/video-audio-music-timeline.yaml
- continuous-video/continuous-video.yaml -> pipeline-orchestration/video-continuity-sliding-images/video-continuity-sliding-images.yaml
- condition-example/condition-example.yaml + transcription-timeline/transcription-timeline.yaml -> conditional-logic/conditional-narration-routing/conditional-narration-routing.yaml
- scene-character-presence/scene-character-presence.yaml + scene-character-presence-typed/scene-character-presence-typed.yaml -> conditional-logic/scene-character-reference-routing/scene-character-reference-routing.yaml
- celebrity-then-now-lite/celebrity-then-now-lite.yaml -> conditional-logic/conditional-multi-source-fanin/conditional-multi-source-fanin.yaml
- array-input-looped-producer.yaml -> input-binding-dimensions/array-element-to-looped-slot/array-element-to-looped-slot.yaml
- multi-looped-inputs.yaml -> input-binding-dimensions/sibling-dimension-unification/sibling-dimension-unification.yaml
- indexed-collection-binding.yaml -> input-binding-dimensions/constant-indexed-collection/constant-indexed-collection.yaml
- json-blueprints/json-blueprints.yaml -> artifacts-and-derivations/virtual-json-artifacts/virtual-json-artifacts.yaml
- derived-video-artifacts.yaml -> artifacts-and-derivations/derived-video-frames-audio/derived-video-frames-audio.yaml
- derived-panel-images.yaml -> artifacts-and-derivations/derived-storyboard-panels/derived-storyboard-panels.yaml
- transcription-path-resolution/transcription-path-resolution.yaml -> transcription-and-paths/transcription-audio-blob-path-resolution/transcription-audio-blob-path-resolution.yaml
- producers/text-to-video-producer.yaml -> blueprints/producer-mode/text-to-video-producer-kind/text-to-video-producer-kind.yaml
E2E Test Rename Plan (all end-to-end tests)
- video-audio-music.e2e.test.ts -> pipeline-orchestration/video-audio-music-timeline--canonical-bindings.e2e.test.ts
- image-audio.e2e.test.ts -> pipeline-orchestration/image-narration-timeline--nested-image-loop.e2e.test.ts
- image-to-video.e2e.test.ts -> pipeline-orchestration/video-continuity-sliding-images--sliding-image-window.e2e.test.ts
- conditional-edges.e2e.test.ts -> conditional-logic/conditional-narration-routing--branch-execution.e2e.test.ts
- boolean-artifact-dryrun.e2e.test.ts -> conditional-logic/conditional-narration-routing--condition-artifact-simulation.e2e.test.ts
- timeline-composer.e2e.test.ts -> conditional-logic/conditional-narration-routing--sparse-fanin-timeline.e2e.test.ts
- transcription-timeline.e2e.test.ts -> conditional-logic/conditional-narration-routing--transcription-track.e2e.test.ts
- scene-character-presence.e2e.test.ts -> conditional-logic/scene-character-reference-routing--presence-mask-bindings.e2e.test.ts
- conditional-fanin-inference.e2e.test.ts -> conditional-logic/conditional-multi-source-fanin--fanin-inference.e2e.test.ts
- array-input-looped-producer.e2e.test.ts -> input-binding-dimensions/array-element-to-looped-slot--binding.e2e.test.ts
- multi-looped-inputs.e2e.test.ts -> input-binding-dimensions/sibling-dimension-unification--looped-producer-inputs.e2e.test.ts
- indexed-collection-binding.e2e.test.ts -> input-binding-dimensions/constant-indexed-collection--broadcast-binding.e2e.test.ts
- json-blueprints.e2e.test.ts -> artifacts-and-derivations/virtual-json-artifacts--targeted-rerun.e2e.test.ts
- derived-video-artifacts.e2e.test.ts -> artifacts-and-derivations/derived-video-frames-audio--ffmpeg-extraction.e2e.test.ts
- derived-panel-images.e2e.test.ts -> artifacts-and-derivations/derived-storyboard-panels--grid-extraction.e2e.test.ts
- ffmpeg-exporter-fresh-artifacts.e2e.test.ts -> artifacts-and-derivations/exporter-asset-path-resolution--fresh-event-artifacts.e2e.test.ts
- transcription-audio-path-resolution.e2e.test.ts -> transcription-and-paths/transcription-audio-blob-path-resolution--storage-resolution.e2e.test.ts
- transcription.e2e.test.ts -> transcription-and-paths/transcription-karaoke-pipeline--alignment-and-filters.e2e.test.ts
- blob-input.e2e.test.ts -> input-ingestion/blob-inputs-file-prefix--planning-resolution.e2e.test.ts
- image-to-video-blob.e2e.test.ts -> input-ingestion/blob-image-inputs--persisted-storage.e2e.test.ts
- config-dirty-tracking.e2e.test.ts -> execution-recovery/config-dirty-tracking--prompt-model-input-changes.e2e.test.ts
- partial-rerun-dirty-tracking.e2e.test.ts -> execution-recovery/partial-rerun-dirty-tracking--upstream-hash-change.e2e.test.ts
- surgical-regeneration.e2e.test.ts -> execution-recovery/surgical-artifact-regeneration--targeted-aid.e2e.test.ts
- artifact-override.e2e.test.ts -> execution-recovery/artifact-override-inputs--downstream-rerun.e2e.test.ts
- audio-failure-recovery.e2e.test.ts -> execution-recovery/failed-artifact-recovery--retry-failed-job.e2e.test.ts
- producer-dry-run.e2e.test.ts -> producer-mode/producer-kind-dry-run--minimal-required-inputs.e2e.test.ts
- explain-up-to-layer.e2e.test.ts -> execution-recovery/up-to-layer-planning--layer-boundary.e2e.test.ts
Execution Sequence (safe rollout)
1. Pass 1: Rename/organize only (no behavioral changes, no dedupe yet).
2. Pass 2: Aggressive dedupe (merge the two blueprint pairs and remove old duplicates).
3. Pass 3: Cleanup (dead paths/constants, old fixture references, core fixture path updates that currently point into cli/tests/fixtures).
Validation Strategy
- First run all renamed E2E files (targeted by new category folders).
- Then run impacted CLI integration tests and cli/src/**/*.test.ts that reference fixture paths.
- Then run core tests that still consume CLI fixture modules to ensure path changes are fully propagated.