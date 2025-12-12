## Renku Blueprint Authoring Guide

This guide explains how to write Renku blueprints: the YAML metadata, how producer blueprints compose, and the rules the planner and runner enforce (canonical IDs, fan-in, collectors, loops/dimensions).

### Vocabulary
- **Blueprint**: Top-level YAML that stitches inputs, artefacts, producer imports, connections, and collectors.
- **Producer Import**: A reusable blueprint imported via `producers:` (legacy: `modules:`). Imports are aliased and referenced in connections.
- **Input**: User-provided value. Mark `required: true` unless a sensible `default` exists. Optional inputs must declare a default—avoid speculative fallbacks.
- **Artefact**: Output produced by a producer. Arrays declare `countInput` (and optional `countInputOffset`) for sizing.
- **Producer**: A job definition (provider + model) that maps blueprint inputs to provider inputs (`inputs`) and declares output artefacts (`outputs`).
- **Loop**: A named dimension used for wiring and collectors (`groupBy`). Dimensions align across producer imports and collectors.
- **Collector**: Gathers artefacts into a `fanIn` collection for downstream aggregation.
- **Canonical ID**: Fully qualified node name used end-to-end (e.g., `Input:TimelineComposer.Music`, `Artifact:AudioGenerator.SegmentAudio[0]`). Canonical IDs must flow without aliases or heuristics.

### Core Sections (top-level blueprint YAML)
```yaml
meta: { name, description, id, version, author, license }

inputs:
  - name: InquiryPrompt
    type: string
    required: true
  - name: SegmentDuration
    type: int
    required: false
    default: 10   # Optional inputs must provide a default

artifacts:
  - name: SegmentVideo
    type: array
    itemType: video
    countInput: NumOfSegments
  - name: SegmentImages
    type: array
    itemType: image
    countInput: NumOfSegments
    countInputOffset: 1  # NumOfSegments + 1 (e.g., Image[0]..Image[n])

loops:
  - name: segment
    countInput: NumOfSegments
  - name: image
    countInput: NumOfSegments
    countInputOffset: 1

producers: # imports other blueprints (legacy: `modules:`)
  - name: VideoPromptGenerator
    path: ./modules/video-prompt-generator.yaml
    loop: segment

connections: []   # edges wire inputs/artefacts into producer inputs
collectors: []    # define fan-in collections (see below)
```

### Inputs and Artefacts
- Inputs/artefacts inside producer imports are scoped; external connections use `Namespace.Node` syntax (e.g., `ScriptGenerator.NarrationScript[segment]`).
- Arrays: use `countInput` to size artefacts; use `countInputOffset` to add extra items (size = `countInput + countInputOffset`). `countInputOffset` must be a non-negative integer and requires `countInput`.
- Do not add default fallbacks “just in case.” If an input is truly optional, supply a real default; otherwise fail fast.

### Loops and Dimensions
- `loops[]` declare named dimensions (e.g., `segment`, `image`) that are valid in `[...]` selectors inside `connections`/`collectors`.
- Edges automatically align dimensions by position. `VideoGenerator[segment]` connects to `VideoPromptGenerator[segment]` because they share the `segment` dimension.
- When multiple dimensions exist (`segment.image`), align each positionally in connections and collectors.

### Connections (Edges)
- `connections` wire values/artefacts to producer inputs across producer imports.
- Syntax: `from:` source, `to:` target input.
  - Sources/targets can be top-level inputs, module inputs, or artefacts (`Artifact:` prefix is implicit in YAML; planner adds it).
- Example (per-segment video prompt):
```yaml
connections:
  - from: ScriptGenerator.NarrationScript[segment]
    to: VideoPromptGenerator[segment].NarrativeText
  - from: VideoPromptGenerator.VideoPrompt[segment]
    to: VideoGenerator[segment].Prompt
```

#### Dimension selectors (loop, offset, ordinal)
Dimension selectors inside `[...]` support:
- Loop selectors: `[segment]`
- Offset selectors: `[segment+1]`, `[segment-1]` (integer offsets)
- Hardcoded ordinals: `[0]`, `[1]` (constant indices)

Sliding window example (start/end images for each segment):
```yaml
connections:
  - from: ImageProducer[image].SegmentImage
    to: ImageToVideoProducer[segment].InputImage1
  - from: ImageProducer[image+1].SegmentImage
    to: ImageToVideoProducer[segment].InputImage2
```
This wires `segment=0` → `Image[0]`/`Image[1]`, `segment=1` → `Image[1]`/`Image[2]`, … so the upstream `image` dimension must be sized to `NumOfSegments + 1` (use `countInputOffset: 1` on the artefact that defines the `image` array size).

Ordinal example (connect fixed elements of an array into distinct inputs on a non-looped node):
```yaml
connections:
  - from: ImageProducer.SegmentImage[0]
    to: IntroVideoProducer.StartImage
  - from: ImageProducer.SegmentImage[1]
    to: IntroVideoProducer.EndImage
```

### Collectors and Fan-In
Collectors create `fanIn` collections that aggregators consume. Without `fanIn: true`, the canonical input collapses to an artefact and **no fan-in metadata exists**.

```yaml
collectors:
  - name: TimelineVideo
    from: VideoGenerator[segment].SegmentVideo   # artefacts to collect
    into: TimelineComposer.VideoSegments         # target input (must have fanIn: true)
    groupBy: segment
    orderBy: segment  # optional; used for ordering within a group

inputs (in module):
  - name: VideoSegments
    type: collection
    itemType: video
    dimensions: segment
    fanIn: true
```

What this produces:
- A canonical input `Input:TimelineComposer.VideoSegments`.
- A `FanInValue` with `groups: [[Artifact:VideoGenerator.SegmentVideo[0]], [Artifact:...]]`.
- Aggregators (like TimelineProducer) rely on this `FanInValue` to align clips. If `fanIn: true` is omitted, the input collapses to the artefact and the aggregator cannot resolve it.

### Aggregators (TimelineProducer) vs. Direct Producers
- **Direct producers** (e.g., MusicProducer) can consume inputs that collapse to artefacts; they don’t require grouping.
- **Aggregators** (TimelineProducer) require fan-in inputs to get grouping/order info. Always:
  - Declare relevant inputs with `fanIn: true` (VideoSegments, AudioSegments, Music, Captions, etc.).
  - Add collectors from the producing artefacts into those inputs.
  - Keep `groupBy` consistent with loop dimensions.
- Single-asset tracks (e.g., one music bed) still need fan-in so the canonical input and `FanInValue` exist: `groups: [[Artifact:MusicGenerator.Music]]`.

### Producer Blueprint Quick Reference
```yaml
meta: { name, id, version, author, license }

inputs:
  - name: Prompt
    type: string
    required: true

artifacts:
  - name: Music
    type: audio

models:
  - provider: replicate
    model: stability-ai/stable-audio-2.5
    inputs:
      Prompt: { field: prompt, type: string, required: true }
    outputs:
      Music: { type: audio, mimeType: audio/mp3 }
```

### Putting It Together (Video+Audio+Music Timeline)
Key wiring steps:
1) Script → VideoPromptGenerator/AudioGenerator per `segment`.
2) Collect `SegmentVideo` and `SegmentAudio` into TimelineComposer via collectors (`fanIn: true` inputs).
3) Generate one Music artefact, collect into `TimelineComposer.Music` (also `fanIn: true`).
4) TimelineProducer composes tracks; master track usually Audio; music track loops/fits per config.

Skeleton:
```yaml
producers:
  - name: MusicGenerator
    path: ./modules/music-generator.yaml
  - name: TimelineComposer
    path: ./modules/timeline-composer-video-audio-music.yaml

connections:
  - from: MusicPromptGenerator.MusicPrompt
    to: MusicGenerator.Prompt
  - from: Duration
    to: MusicGenerator.Duration
  - from: MusicGenerator.Music
    to: Music
  - from: Duration
    to: TimelineComposer.Duration

collectors:
  - name: TimelineVideo
    from: VideoGenerator[segment].SegmentVideo
    into: TimelineComposer.VideoSegments
    groupBy: segment
  - name: TimelineAudio
    from: AudioGenerator[segment].SegmentAudio
    into: TimelineComposer.AudioSegments
    groupBy: segment
  - name: MusicTrack
    from: MusicGenerator.Music
    into: TimelineComposer.Music
    groupBy: segment   # single group still needed for fan-in
```

### Canonical ID Rules
- Planner emits a single canonical ID per node (e.g., `Artifact:MusicGenerator.Music`). Runner copies this into `job.context.inputs`, `inputBindings`, `fanIn`, `resolvedInputs`.
- Providers must read only canonical IDs (via `runtime.inputs.getByNodeId` or `buildPayload`).
- If a canonical ID is missing, fail fast; never guess or alias.

### Common Pitfalls
- Missing `fanIn: true` on aggregator inputs → no canonical `Input:*` → TimelineProducer cannot resolve.
- Forgetting `collectors` for a fan-in input → fan-in descriptor is empty → missing groups.
- Mismatched dimensions (`segment` vs `image`) → planner errors about dimension counts.
- `countInputOffset` without `countInput` → blueprint validation error.
- Invalid selector syntax (e.g., `[segment+foo]`) or unknown loop symbol (e.g., `[segmnt]`) → blueprint validation error.
- Optional input without a default → loader error.
- Generated artefacts placed in `src` (don’t do this; use `dist/` per package builds).

### Testing Your Blueprint
- Validate YAML: `renku blueprints:validate <path-to-blueprint.yaml>`
- Expect clear errors for invalid dimension selectors, unknown loops, or invalid `countInputOffset` usage.
- Dry-run: `RENKU_CLI_CONFIG=/path/to/cli-config.json renku generate --inputs=<inputs.yaml> --blueprint=<blueprint.yaml> --dry-run`
- Inspect the plan in `<builds>/<movie>/runs/rev-0001-plan.json` to confirm inputs/fan-in are present (`Input:TimelineComposer.*` with `fanIn` entries).
