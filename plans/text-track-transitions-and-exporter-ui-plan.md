# Text Track Transitions + VideoExporter Text Card Plan

## Goal

Add first-class `Text` track support end-to-end with:

- Timeline-level text snippet timing and transition assignment.
- FFmpeg rendering of text overlays using timeline timing.
- Viewer configuration UX for text styling in `VideoExporter` (new card).
- Consistent, simple UX between Subtitles and Text configuration.

## Product Decisions (Proposed)

1. **Text transition set (v1)**
   - `none`
   - `fade-in`
   - `fade-out`
   - `fade-in-out` (default)

2. **Source contract for text**
   `TimelineComposer.TextSegments` fan-in groups contain canonical **artifact IDs**, and each artifact resolves to a **string snippet**.

3. **Responsibility split**
   - `TimelineProducer` computes snippet timing and transition metadata.
   - `VideoExporter` renders exactly what timeline defines.

4. **Exporter config**
   Add a new `config.text` object (parallel to subtitles, simpler).

5. **Remotion scope**
   No Remotion text rendering in this change set. `remotion/docker-render` behavior remains unchanged for now.

## Proposed Configuration Shape

### TimelineComposer (`timeline/ordered`)

```yaml
timeline:
  tracks: ['Image', 'Audio', 'Text']
  masterTracks: ['Audio']
  imageClip:
    artifact: ImageSegments
    effect: KennBurns
  textClip:
    artifact: TextSegments
    effect: fade-in-out
```

### VideoExporter (`ffmpeg/native-render`)

```yaml
text:
  font: 'Arial'
  fontSize: 56
  fontBaseColor: '#FFFFFF'
  backgroundColor: '#000000'
  backgroundOpacity: 0.35
  bottomMarginPercent: 14
```

Notes:

- `maxWordsPerLine` is **subtitle-only**.
- Keep field naming consistent with subtitles (`font`, `fontSize`, `fontBaseColor`, etc.).
- No extra complexity in v1 (no advanced motion presets in exporter config).

## Implementation Plan

## 1) Extend Contracts and Schemas

- Update timeline track/type unions to include `Text`:
  - `compositions/src/types/timeline.ts`
  - re-exports in:
    - `compositions/src/index.ts`
    - `compositions/src/browser.ts`
- Add text clip shape with explicit per-snippet timing metadata (e.g. `snippets[]` with `text`, `startTime`, `duration`, `transition`).
- Extend timeline model schema:
  - `catalog/models/renku/json/timeline-ordered.json`
  - Add `Text` to `timeline.tracks` enum.
  - Add `textClip` shorthand config with `artifact` + `effect`.
- Extend producer contract:
  - `catalog/producers/composition/timeline-composer.yaml`
  - Add `TextSegments` input (`collection`, `itemType: text`, `fanIn: true`).
  - Add mapping for `timeline/ordered`.
- Extend FFmpeg model schema:
  - `catalog/models/renku/video/ffmpeg-native-render.json`
  - Add `text` config object.

## 2) TimelineProducer: Build Text Track and Timings

- File: `providers/src/producers/timeline/ordered-timeline.ts`
- Add `Text` to `ClipKind`.
- Parse `textClip` shorthand in `buildClipsFromShorthand`.
- Support explicit clip entries with `kind: "Text"` and `effect`.
- Add `buildTextTrack(...)`:
  - Normalize fan-in groups by segment.
  - Resolve each text artifact ID to string value.
  - Missing artifact due conditional skip: skip that snippet.
  - Present but non-string/empty payload: throw descriptive error (fail fast).
  - Allocate snippet timings across segment duration deterministically.
  - Emit timeline clip properties with snippet text + timing + transition.
- Wire into `buildTrack` switch for `clip.kind === "Text"`.

## 3) FFmpeg Rendering: Text Overlay Pipeline

- Files:
  - `providers/src/producers/export/ffmpeg/command-builder.ts`
  - (new helper) `providers/src/producers/export/ffmpeg/text-renderer.ts` (recommended)
  - `providers/src/producers/export/ffmpeg/types.ts`
  - `providers/src/producers/export/ffmpeg-exporter.ts`
- Add `TextTrack` handling in command builder:
  - Build `drawtext` filter chains from timeline snippet timings.
  - Apply transition alpha expressions:
    - none: constant alpha.
    - fade-in / fade-out / fade-in-out: time-bounded alpha curves.
- Rendering order:
  1. base visual stream
  2. text overlay
  3. captions/karaoke overlays
- Output format detection:
  - Treat `Text` as visual in:
    - `providers/src/producers/export/ffmpeg/command-builder.ts`
    - `providers/src/producers/export/ffmpeg-exporter.ts`
- Ensure text-only timeline still renders video:
  - If no Image/Video track but Text exists, synthesize base black video stream and overlay text.

## 4) Viewer: Timeline Card Text Track + Effect Dropdown

- File: `viewer/src/components/blueprint/models/config-editors/timeline-card.tsx`
- Add `Text` track toggle.
- Add `textClip` config support.
- Add text effect dropdown with:
  - None
  - Fade In
  - Fade Out
  - Fade In + Out
- Keep master-track eligibility unchanged (Text is not native-duration).

## 5) Viewer: New VideoExporter Text Card

- Add new editor card:
  - `viewer/src/components/blueprint/models/config-editors/text-card.tsx`
  - `viewer/src/components/blueprint/models/config-editors/text-card.test.tsx`
- Register `text` property editor:
  - `viewer/src/components/blueprint/models/config-editors/index.ts`
- Card UX sections (simple + parallel to subtitles):
  - Font
  - Colors
  - Layout
- No `Max Words/Line` in text card.

## 6) Subtitles Consistency Update (UI-only)

- File: `viewer/src/components/blueprint/models/config-editors/subtitles-card.tsx`
- Keep schema fields unchanged.
- Align structure/labels with text card for consistency:
  - Font
  - Colors
  - Layout
  - Behavior (Karaoke + Max words/line)
- Keep existing subtitle capabilities intact.

## 7) CLI Export Config Parity (Optional but Recommended)

- File: `cli/src/commands/export.ts`
- Extend export config support with `text` block parallel to `subtitles`.
- Add parsing/validation for `text` keys.
- Merge from manifest + file config in the same precedence model used for subtitles.
- Add tests:
  - `cli/src/commands/export.test.ts`

## 8) Tests

### Timeline producer

- `providers/src/producers/timeline/ordered-timeline.test.ts`
- Add coverage for:
  - text track creation from grouped text artifacts,
  - per-segment snippet timing allocation,
  - transition propagation,
  - fail-fast behavior for malformed text payloads.

### FFmpeg command builder/exporter

- `providers/src/producers/export/ffmpeg/command-builder.test.ts`
- `providers/src/producers/export/ffmpeg-exporter.test.ts`
- Add coverage for:
  - text filter generation,
  - text-only visual output path,
  - detectOutputFormat includes text,
  - interaction with existing subtitles path.

### Viewer cards

- `viewer/src/components/blueprint/models/config-editors/timeline-card.test.tsx`
- `viewer/src/components/blueprint/models/config-editors/text-card.test.tsx`
- `viewer/src/components/blueprint/models/config-editors/subtitles-card.test.tsx` (consistency updates)

## Validation Commands

- Providers tests (threads pool rule):
  - `pnpm --filter renku-providers test`
- Viewer tests:
  - `pnpm --filter viewer test`
- Type checks:
  - `pnpm --filter @gorenku/compositions type-check`
  - `pnpm --filter @gorenku/providers type-check`
  - `pnpm --filter viewer test:typecheck`
  - `pnpm --filter @gorenku/core type-check`

## Acceptance Criteria

- Timeline can include `Text` track with one or more snippets per segment.
- Text transition is selectable in Timeline config and persists through timeline output.
- FFmpeg renders text according to timeline timing and transition.
- Text style is configurable through new VideoExporter Text card in Viewer.
- Subtitles and Text cards feel consistent and easy to understand.
- Existing subtitle behavior remains functional.
- No silent fallback behavior for malformed text payloads.

## Non-Goals

- Remotion text rendering implementation.
- New advanced animation families beyond the 4 transition options above.
- Broad refactors outside timeline/exporter/viewer config surfaces required for text track support.
