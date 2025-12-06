## Tutopanda Blueprint Authoring Guide

This guide explains how to write Tutopanda blueprints: the YAML metadata, how modules compose, and the rules the planner and runner enforce (canonical IDs, fan-in, collectors, loops).

### Vocabulary
- **Blueprint**: Top-level YAML that stitches inputs, artefacts, modules, connections, and collectors.
- **Module**: A reusable sub-blueprint (in `catalog/blueprints/<name>`) that declares its own inputs, artefacts, and producers.
- **Input**: User-provided value. Mark `required: true` unless a sensible `default` exists. Optional inputs must declare a default—avoid speculative fallbacks.
- **Artefact**: Output produced by a producer. Arrays declare `countInput` for sizing.
- **Producer**: A job definition (provider + model) that maps inputs to outputs via `sdkMapping`/`outputs`.
- **Loop**: Repeats modules across a dimension (`groupBy`). Dimensions align across modules and collectors.
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

loops:
  - name: segment
    countInput: NumOfSegments

modules:
  - name: VideoPromptGenerator
    path: ./modules/video-prompt-generator.yaml
    loop: segment

connections: []   # edges wire inputs/artefacts into module inputs
collectors: []    # define fan-in collections (see below)
```

### Inputs and Artefacts
- Inputs/artefacts inside modules are scoped; external connections use `Namespace.Node` syntax (e.g., `ScriptGenerator.NarrationScript[segment]`).
- Arrays and collections: use `countInput` to size artefacts; loops must align dimensions (segment/image/etc.).
- Do not add default fallbacks “just in case.” If an input is truly optional, supply a real default; otherwise fail fast.

### Loops and Dimensions
- `loops[]` declare named dimensions (e.g., `segment`). Use `loop: segment` on a module to instantiate it per segment.
- Edges automatically align dimensions by position. `VideoGenerator[segment]` connects to `VideoPromptGenerator[segment]` because they share the `segment` dimension.
- When multiple dimensions exist (`segment.image`), align each positionally in connections and collectors.

### Connections (Edges)
- `connections` wire values/artefacts to producer inputs across modules.
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

### Module Authoring Quick Reference
```yaml
meta: { name, id, version, author, license }

inputs:
  - name: Prompt
    type: string
    required: true

artifacts:
  - name: Music
    type: audio

connections:
  - from: Prompt
    to: MusicProducer
producers:
  - name: MusicProducer
    provider: replicate
    model: stability-ai/stable-audio-2.5
    config:
      steps: 8
      cfg_scale: 1
    sdkMapping:
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
modules:
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
- Optional input without a default → loader error.
- Generated artefacts placed in `src` (don’t do this; use `dist/` per package builds).

### Testing Your Blueprint
- Validate YAML: `pnpm --filter tutopanda-cli run blueprints:validate <path>`
- Dry-run from repo root (honor sandbox root): `TUTOPANDA_CLI_CONFIG=/path/to/cli-config.json node cli/dist/cli.js generate --inputs=<inputs.yaml> --blueprint=<blueprint.yaml> --dry-run`
- Inspect the plan in `<builds>/<movie>/runs/rev-0001-plan.json` to confirm inputs/fan-in are present (`Input:TimelineComposer.*` with `fanIn` entries).
