# Subtitles Composite Pipeline Checklist

Locked implementation checklist for the new subtitles composite pipeline:

## Catalog and producer graph

- [x] Add a new reusable outer blueprint at `catalog/producers/composition/subtitles.yaml`.
- [x] Keep the outer output name as `Transcription`.
- [x] Keep the outer producer positioned between `TimelineComposer` and `VideoExporter`.
- [x] Add explicit outer inputs for `Timeline`, `TranscriptionAudio`, `Duration`, `LanguageCode`, and `NumOfSegments`.
- [x] Move `stt-timestamps` to `catalog/producers/json/stt-timestamps.yaml` so it remains a normal model-selectable STT producer.
- [x] Add `catalog/producers/composition/stt-normalizer.yaml`.
- [x] Update `catalog/producers/composition/subtitles-composer.yaml` to consume normalized transcripts, not raw STT JSON.

## Internal models and schemas

- [x] Add `speech/stt-normalizer` to `catalog/models/renku/renku.yaml`.
- [x] Add `speech/subtitles-composer` to `catalog/models/renku/renku.yaml`.
- [x] Add `catalog/models/renku/json/timestamped-transcript.json` for the normalized transcript contract.
- [x] Keep the final subtitles output compatible with the current `speech-transcription` contract.
- [x] Do not add a new `schema` field to model catalog entries just for this work.

## STT adapter support

- [x] Add optional `sttNormalizer` support to model catalog loading/types.
- [x] Declare `sttNormalizer` on supported STT models.
- [x] Implement an adapter registry keyed by `sttNormalizer`.
- [x] Implement the first adapter `elevenlabs-word-timestamps-v1` for the currently supported `fal-ai / elevenlabs/speech-to-text` raw output.
- [x] Wire the current ElevenLabs STT catalog entry to `sttNormalizer: elevenlabs-word-timestamps-v1`.
- [x] Verify the ElevenLabs adapter normalizes times to seconds and filters non-spoken tokens correctly.
- [x] Fail fast when an STT model has no supported `sttNormalizer`.

## Provenance and runtime metadata

- [x] Add explicit downstream `inputArtifactSources` metadata in job context extras.
- [x] Include exact upstream `producerId`, `producerAlias`, `provider`, and `model`, and resolve `sttNormalizer` from the upstream model catalog entry instead of guessing.
- [x] Ensure `stt-normalizer` reads explicit metadata instead of inferring from canonical IDs.

## Sparse and skipped segments

- [x] Gate per-segment STT jobs on `exists(TranscriptionAudio[segment])`.
- [x] Gate per-segment normalization jobs on the same active segment condition.
- [x] Ensure empty transcription groups schedule no raw STT job.
- [x] Ensure empty transcription groups schedule no normalizer job.
- [x] Preserve final timeline timing for later non-empty groups.
- [x] Add stable `groupIndex` metadata to timeline transcription clips.
- [x] Match normalized transcript artifacts to timeline clips by `groupIndex`, not by compacted array order.
- [x] Fail fast on v1 multi-audio transcription groups.

## Core and provider implementation

- [x] Update planner/runtime so input-existence conditions work for sparse fan-in deactivation.
- [x] Add Renku handler implementation for `speech/stt-normalizer`.
- [x] Add Renku handler implementation for `speech/subtitles-composer`.
- [x] Reuse or extract shared final transcription types so exporter compatibility stays exact.
- [x] Keep the old transcription producer path working during migration.

## CLI and viewer plumbing

- [x] Register the new fixed composition producers in CLI composition-model resolution.
- [x] Ensure viewer/config-schema paths tolerate empty or minimal internal config for these fixed composition producers.
- [x] Avoid invented defaults or fallback config just to keep the models pane happy.

## Tests

- [x] Add core tests covering the canonical condition/input graph changes behind sparse subtitle scheduling.
- [x] Add timeline tests for `groupIndex` on transcription clips.
- [x] Add timeline tests for sparse transcription clip timing preservation.
- [x] Add normalizer adapter tests with real raw payload fixtures.
- [x] Add composer tests for shifted timestamps and sparse group alignment.
- [x] Add regression tests proving the old transcription producer still works.
- [x] Add regression tests proving exporter still accepts the final `Transcription` artifact shape.

## CLI fixture and e2e coverage

- [x] Add a drop-in replacement fixture at `cli/tests/fixtures/blueprints/pipeline-orchestration/video-audio-music-timeline-subtitles-v2`.
- [x] Add fixture blueprint `video-audio-music-timeline-subtitles-v2.yaml`.
- [x] Add default fixture inputs `cli/tests/fixtures/inputs/video-audio-music-timeline-subtitles-v2--pipeline.inputs.yaml`.
- [x] Add a sparse-input fixture at `cli/tests/fixtures/blueprints/pipeline-orchestration/subtitles-input-driven-sparse/input-template.yaml`.
- [x] Add CLI e2e test `subtitles-composite-pipeline--plan-wiring.e2e.test.ts`.
- [x] Add CLI e2e test `subtitles-composite-pipeline--sparse-inputs.e2e.test.ts`.
- [x] Cover the exporter contract through the drop-in replacement plan-wiring e2e and existing exporter/transcription regression suite.
- [x] Keep CLI e2e execution deterministic and independent of live network calls.

## Catalog manual verification blueprint

- [x] Copy `catalog/blueprints/ken-burns-documentary` to `catalog/blueprints/ken-burns-documentary-v2`.
- [x] Rename the top-level blueprint file to `historical-documentary-v2.yaml`.
- [x] Keep the copied blueprint otherwise verbatim for the first rollout.
- [x] Replace the old transcription producer usage in the copied blueprint with the new `composition/subtitles` composite.
- [x] Add only the minimal extra connections needed for `TranscriptionAudio`, `Duration`, and `LanguageCode`.
- [x] Use `catalog/blueprints/ken-burns-documentary-v2` as the manual verification blueprint for this work.

## Final verification

- [x] `pnpm build` passes from the repository root.
- [x] `pnpm test` passes from the repository root.
- [x] New subtitles composite passes added package-level and CLI e2e coverage.
- [x] `catalog/blueprints/ken-burns-documentary-v2` is in place for manual verification.
- [x] Old transcription path still passes its regression coverage before merge.
