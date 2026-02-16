# FFmpeg Video-Only Input Audio Mix Fix Plan

## Context

Build `/Users/keremk/videos/celebrity-then-now/builds/movie-s0panx` fails at `ffmpeg/native-render` with:

- `Stream specifier ':a' ... matches no streams`

The generated timeline contains three video clips and one music clip. The three Kling MP4 clips are video-only (no audio stream), but the FFmpeg command builder currently assumes video clips have audio by default and injects `[n:a]` tracks into `amix`.

## Root Cause

In `providers/src/producers/export/ffmpeg/command-builder.ts`, video clips are added to `audioInfos` when `volume ?? 1 > 0`, without checking whether the input file actually has an audio stream.

## Goal

Allow `ffmpeg/native-render` to successfully render timelines where some or all video clips are video-only, while still mixing audio from tracks that do exist (e.g., Music track).

## Non-Goals

- No schema fallback behavior changes.
- No changes to planner/timeline canonical IDs.
- No broad exporter refactor outside video-audio inclusion logic.

## Implementation Plan

1. Add stream-aware audio eligibility for video clips.
- In FFmpeg command building, probe each video input once and detect whether it has an audio stream.
- Only append a video clip to `audioInfos` when:
  - clip volume is enabled, and
  - the source input has an audio stream.

2. Keep behavior explicit and deterministic.
- If probing fails for a referenced video asset, throw a descriptive provider error (fail fast).
- Do not silently synthesize fake per-clip audio streams.

3. Preserve existing music/audio mixing path.
- Ensure music track inclusion (`Music` clips) remains unchanged.
- Ensure `buildAudioMixFilter` still generates:
  - mixed output when any real audio tracks exist,
  - silence only when there are no audio tracks at all.

4. Add tests to prevent regression.
- Update/add tests in:
  - `providers/src/producers/export/ffmpeg/command-builder.test.ts`
  - (if needed) `providers/src/producers/export/ffmpeg-exporter.test.ts`
- Test cases:
  - video-only clips + music track => command does not reference `[0:a]` for video-only inputs and render path succeeds.
  - mixed inputs (some video with audio, some without) => only valid audio streams are mixed.
  - all video clips audio-capable => existing behavior preserved.

5. Validate with package tests.
- Run provider tests with required thread pool configuration:
  - `pnpm --filter renku-providers test`

## Acceptance Criteria

- `ffmpeg/native-render` no longer fails with `matches no streams` for video-only MP4 segments.
- Generated FFmpeg filtergraph includes audio references only for inputs that actually expose audio.
- Existing exporter tests pass, plus new regression coverage for video-only clips.
