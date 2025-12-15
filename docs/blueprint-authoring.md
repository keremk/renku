# Renku Blueprint Authoring Guide

This comprehensive guide explains how to write Renku blueprints: the YAML metadata, how producer blueprints compose, and the rules the planner and runner enforce (canonical IDs, fan-in, collectors, loops/dimensions).

---

## Core Concepts

### Vocabulary

- **Blueprint**: Top-level YAML that stitches inputs, artifacts, producer imports, connections, and collectors.
- **Producer Import**: A reusable blueprint imported via `producers:`. Imports are aliased and referenced in connections.
- **Input**: User-provided value. Mark `required: true` unless a sensible `default` exists. Optional inputs must declare a default—avoid speculative fallbacks.
- **Artifact**: Output produced by a producer. Arrays declare `countInput` (and optional `countInputOffset`) for sizing.
- **Producer**: A job definition (provider + model) that maps blueprint inputs to provider inputs (`inputs`) and declares output artifacts (`outputs`).
- **Loop**: A named dimension used for wiring and collectors (`groupBy`). Dimensions align across producer imports and collectors.
- **Collector**: Gathers artifacts into a `fanIn` collection for downstream aggregation.
- **Canonical ID**: Fully qualified node name used end-to-end (e.g., `Input:TimelineComposer.Music`, `Artifact:AudioGenerator.SegmentAudio[0]`). Canonical IDs must flow without aliases or heuristics.

### Blueprint Scope

Blueprints define complete generation workflows that orchestrate multiple AI providers (OpenAI, Replicate, ElevenLabs) and Renku services to create narrated video content. They specify:

- **Inputs**: Required and optional parameters
- **Artifacts**: Output types produced by the workflow
- **Loops**: Iteration dimensions for scaling operations
- **Producers**: References to reusable sub-blueprints
- **Connections**: Data flow between nodes
- **Collectors**: Optional fan-in operations for aggregating array outputs

---

## Blueprint YAML Structure

### Complete Schema

```yaml
meta:
  name: <string>
  description: <string>
  id: <string>
  version: <semver>
  author: <string>
  license: <string>

inputs:
  - name: <string>
    description: <string>
    type: <string|int|array|collection>
    required: <boolean>
    default: <any>

artifacts:
  - name: <string>
    description: <string>
    type: <string|json|image|audio|video|array|multiDimArray>
    itemType: <string>  # For array types
    countInput: <inputName>  # For sized arrays
    countInputOffset: <number>  # Optional offset for array sizing

loops:
  - name: <string>
    description: <string>
    countInput: <inputName>
    countInputOffset: <number>  # Optional offset
    parent: <loopName>  # For nested loops

producers:
  - name: <string>
    path: <relativePath>
    loop: <loopName|loopName.childLoop>

connections:
  - from: <source>
    to: <target>

collectors:
  - name: <string>
    from: <source>
    into: <target>
    groupBy: <loopName>
    orderBy: <loopName>  # Optional
```

### Field Descriptions

#### `meta`
Metadata about the blueprint.

- `name`: Human-readable name
- `description`: Purpose and behavior
- `id`: Unique identifier (PascalCase)
- `version`: Semantic version
- `author`: Creator name
- `license`: License type (e.g., MIT)

#### `inputs`
Parameters accepted by the blueprint.

- `name`: Input identifier (PascalCase)
- `description`: Purpose and usage
- `type`: Data type (`string`, `int`, `array`, `collection`)
- `required`: Whether the input is mandatory
- `default`: Default value if not provided

**Important:** Optional inputs must declare a default—avoid speculative fallbacks. If an input is truly optional, supply a real default; otherwise fail fast.

**Example:**
```yaml
inputs:
  - name: Duration
    description: Desired movie duration in seconds
    type: int
    required: true
  - name: ImageStyle
    description: Visual style for images
    type: string
    required: false
    default: Photorealistic
```

#### `artifacts`
Outputs produced by the workflow.

- `name`: Artifact identifier (PascalCase)
- `description`: Purpose and content
- `type`: Output type
  - `string`, `json`, `image`, `audio`, `video`: Scalar types
  - `array`: Single-dimensional array
  - `multiDimArray`: Multi-dimensional array
- `itemType`: For array types, specifies the item type
- `countInput`: Input parameter that determines array size
- `countInputOffset`: Non-negative integer offset added to array size (optional, requires `countInput`)

**Example:**
```yaml
artifacts:
  - name: SegmentImage
    description: Images for each segment
    type: multiDimArray
    itemType: image
  - name: SegmentImages
    description: Array of images sized by input
    type: array
    itemType: image
    countInput: NumOfSegments
    countInputOffset: 1  # Total size = NumOfSegments + 1
  - name: Timeline
    description: Composition manifest
    type: json
```

#### `loops`
Iteration dimensions for scaling operations.

- `name`: Loop identifier (lowercase)
- `description`: Purpose and behavior
- `countInput`: Input parameter that determines iteration count
- `countInputOffset`: Non-negative integer offset for loop size (optional)
- `parent`: Parent loop for nested iteration (optional)

**Important:** Loops can be nested using the `parent` property, creating multi-dimensional iteration spaces. When multiple dimensions exist, align each positionally in connections and collectors.

**Example:**
```yaml
loops:
  - name: segment
    description: Iterate over narration segments
    countInput: NumOfSegments
  - name: image
    description: Iterate over images per segment
    parent: segment
    countInput: NumOfImagesPerNarrative
```

#### `producers`
References to reusable sub-blueprints (producer imports).

- `name`: Module instance name (PascalCase)
- `path`: Relative path to module YAML file
- `loop`: Loop context (optional)
  - Single loop: `segment`
  - Nested loop: `segment.image`

**Example:**
```yaml
producers:
  - name: ScriptGenerator
    path: ./modules/script-generator.yaml
  - name: AudioGenerator
    path: ./modules/audio-generator.yaml
    loop: segment
  - name: ImageGenerator
    path: ./modules/image-generator.yaml
    loop: segment.image
```

#### `connections`
Data flow between nodes (edges).

- `from`: Source node output
  - Blueprint input: `InputName`
  - Producer output: `ProducerName.OutputName`
  - Array output: `ProducerName.OutputName[loop]`
  - Multi-dim array: `ProducerName.OutputName[loop1][loop2]`
  - With offsets: `ProducerName.OutputName[segment+1]`
  - Hardcoded ordinals: `ProducerName.OutputName[0]`
- `to`: Target node input
  - Blueprint artifact: `ArtifactName[loop]`
  - Producer input: `ProducerName.InputName`
  - Looped producer input: `ProducerName[loop].InputName`

**Example:**
```yaml
connections:
  - from: InquiryPrompt
    to: ScriptGenerator.InquiryPrompt
  - from: ScriptGenerator.NarrationScript[segment]
    to: AudioGenerator[segment].TextInput
  - from: ImageGenerator[segment][image].SegmentImage
    to: SegmentImage[segment][image]
```

#### `collectors`
Fan-in operations for aggregating array outputs.

- `name`: Collector identifier
- `from`: Source node output (with indices)
- `into`: Target node input
- `groupBy`: Loop dimension for grouping
- `orderBy`: Loop dimension for ordering (optional)

**Example:**
```yaml
collectors:
  - name: TimelineImages
    from: ImageGenerator[segment][image].SegmentImage
    into: TimelineComposer.ImageSegments
    groupBy: segment
    orderBy: image
```

This collects all images, groups them by segment, orders by image index, and passes to `TimelineComposer`.

---

## Dimension Selectors in Connections

Dimension selectors inside `[...]` support:
- **Loop selectors**: `[segment]`
- **Offset selectors**: `[segment+1]`, `[segment-1]` (integer offsets)
- **Hardcoded ordinals**: `[0]`, `[1]` (constant indices)

### Sliding Window Example

Start/end images for each segment:
```yaml
connections:
  - from: ImageProducer[image].SegmentImage
    to: ImageToVideoProducer[segment].InputImage1
  - from: ImageProducer[image+1].SegmentImage
    to: ImageToVideoProducer[segment].InputImage2
```

This wires `segment=0` → `Image[0]`/`Image[1]`, `segment=1` → `Image[1]`/`Image[2]`, etc. The upstream `image` dimension must be sized to `NumOfSegments + 1` (use `countInputOffset: 1` on the artifact that defines the `image` array size).

### Ordinal Example

Connect fixed elements of an array into distinct inputs on a non-looped node:
```yaml
connections:
  - from: ImageProducer.SegmentImage[0]
    to: IntroVideoProducer.StartImage
  - from: ImageProducer.SegmentImage[1]
    to: IntroVideoProducer.EndImage
```

---

## Collectors and Fan-In

Collectors create `fanIn` collections that aggregators consume. Without `fanIn: true`, the canonical input collapses to an artifact and **no fan-in metadata exists**.

```yaml
collectors:
  - name: TimelineVideo
    from: VideoGenerator[segment].SegmentVideo   # artifacts to collect
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
- Aggregators (like TimelineProducer) rely on this `FanInValue` to align clips. If `fanIn: true` is omitted, the input collapses to the artifact and the aggregator cannot resolve it.

### Aggregators (TimelineProducer) vs. Direct Producers

- **Direct producers** (e.g., MusicProducer) can consume inputs that collapse to artifacts; they don't require grouping.
- **Aggregators** (TimelineProducer) require fan-in inputs to get grouping/order info. Always:
  - Declare relevant inputs with `fanIn: true` (VideoSegments, AudioSegments, Music, Captions, etc.).
  - Add collectors from the producing artifacts into those inputs.
  - Keep `groupBy` consistent with loop dimensions.
- Single-asset tracks (e.g., one music bed) still need fan-in so the canonical input and `FanInValue` exist: `groups: [[Artifact:MusicGenerator.Music]]`.

---

## Producer Blueprint (Module) Reference

Producer blueprints are reusable sub-blueprints that define individual generation tasks. They are imported into parent blueprints via `producers:`.

### Complete Schema

```yaml
meta:
  name: <string>
  id: <string>
  version: <semver>
  author: <string>
  license: <string>

inputs:
  - name: <string>
    type: <string|int>
    required: <boolean>
    description: <string>

artifacts:
  - name: <string>
    description: <string>
    type: <string|json|image|audio|video>

models:
  - provider: <openai|replicate|renku>
    model: <string>
    inputs:
      <InputName>:
        field: <sdkFieldName>
        type: <string|number|boolean>
        required: <boolean>
    outputs:
      <ArtifactName>:
        type: <artifact_type>
        mimeType: <mime/type>  # Optional for Replicate
```

### Producer Example

```yaml
meta:
  name: Music Generator
  id: MusicGenerator
  version: 0.1.0
  author: Renku
  license: MIT

inputs:
  - name: Prompt
    type: string
    required: true
    description: Music style and description
  - name: Duration
    type: int
    required: true
    description: Music duration in seconds

artifacts:
  - name: Music
    description: Generated music file
    type: audio

models:
  - provider: replicate
    model: stability-ai/stable-audio-2.5
    inputs:
      Prompt:
        field: prompt
        type: string
        required: true
      Duration:
        field: duration
        type: number
        required: true
    outputs:
      Music:
        type: audio
        mimeType: audio/mp3
```

---

## Input YAML Reference

### Structure

Input files use YAML with a single `inputs` mapping:

```yaml
inputs:
  <InputName>: <value>
```

### Data Types

- **String**: Quoted text
- **Integer**: Numeric value (no quotes)
- **Array**: YAML array syntax

**Example:**
```yaml
inputs:
  InquiryPrompt: "Explain photosynthesis"
  Duration: 45
  NumOfSegments: 4
  VoiceId: "Wise_Woman"
  ImageStyle: "Scientific diagram"
  Size: "2K"
  AspectRatio: "16:9"
  Audience: "High school students"
```

### Validation Rules

1. All required inputs from the blueprint must be present
2. Optional inputs use blueprint defaults if omitted
3. Input names are case-sensitive and must match blueprint exactly
4. Type mismatches cause validation errors

### Special Inputs

#### `InquiryPrompt`
Stored in the input events log (`events/inputs.log`) and as a standalone prompt file (`prompts/inquiry.txt`). This allows providers to reference it as both a config value and a prompt file.

---

## Connections and Wiring

### Scope and Namespacing

- Inputs/artifacts inside producer imports are scoped; external connections use `Namespace.Node` syntax (e.g., `ScriptGenerator.NarrationScript[segment]`).
- The planner implicitly adds the `Artifact:` prefix to artifact references.

### Loop Alignment

- Edges automatically align dimensions by position.
- `VideoGenerator[segment]` connects to `VideoPromptGenerator[segment]` because they share the `segment` dimension.
- When multiple dimensions exist (`segment.image`), align each positionally in connections and collectors.

---

## Advanced Topics

### Blueprint Module Composition

Modules enable blueprint composition and reuse.

**Creating a Module:**

1. **Define module YAML** (`modules/my-module.yaml`):
   ```yaml
   meta:
     name: My Module
     id: MyModule

   inputs:
     - name: InputText
       type: string
       required: true

   artifacts:
     - name: OutputData
       type: json

   models:
     - provider: openai
       model: gpt-4o
       inputs:
         InputText:
           field: text
           type: string
           required: true
       outputs:
         OutputData:
           type: json
   ```

2. **Reference in parent blueprint:**
   ```yaml
   producers:
     - name: MyModuleInstance
       path: ./modules/my-module.yaml

   connections:
     - from: ParentInput
       to: MyModuleInstance.InputText
     - from: MyModuleInstance.OutputData
       to: ParentArtifact
   ```

**Benefits:**
- Reuse common patterns (script generation, image generation)
- Isolate provider configurations
- Simplify complex blueprints
- Enable testing of individual components

### Index Notation Deep Dive

Index notation specifies array cardinality in connections.

**Scalar Connections:**
```yaml
- from: InquiryPrompt
  to: ScriptGenerator.InquiryPrompt
```
Both source and target are scalars (single values).

**Array Connections:**
```yaml
- from: ScriptGenerator.NarrationScript[segment]
  to: AudioGenerator[segment].TextInput
```
- Source is an array (one narration per segment)
- Target is looped (one AudioGenerator instance per segment)
- Each instance receives the corresponding array element

**Multi-Dimensional Connections:**
```yaml
- from: ImageGenerator[segment][image].SegmentImage
  to: SegmentImage[segment][image]
```
- Source is a 2D array (segments × images)
- Target artifact is also 2D
- Preserves array structure

**Fan-In Connections:**
```yaml
- from: AudioGenerator[segment].SegmentAudio
  to: TimelineComposer.AudioSegments
```
- Source is an array
- Target expects the full array (via collector)
- Collector handles aggregation

---

## Canonical IDs

### ID Rules

- Planner emits a single canonical ID per node (e.g., `Artifact:MusicGenerator.Music`). Runner copies this into `job.context.inputs`, `inputBindings`, `fanIn`, `resolvedInputs`.
- Providers must read only canonical IDs (via `runtime.inputs.getByNodeId` or `buildPayload`).
- If a canonical ID is missing, fail fast; never guess or alias.

**Example canonical IDs:**
- Input: `Input:TimelineComposer.Music`
- Artifact: `Artifact:AudioGenerator.SegmentAudio[0]`
- Multi-dimensional: `Artifact:ImageGenerator.Image[2][1]`

---

## Complete Example: Video+Audio+Music Timeline

Key wiring steps:
1. Script → VideoPromptGenerator/AudioGenerator per `segment`.
2. Collect `SegmentVideo` and `SegmentAudio` into TimelineComposer via collectors (`fanIn: true` inputs).
3. Generate one Music artifact, collect into `TimelineComposer.Music` (also `fanIn: true`).
4. TimelineProducer composes tracks; master track usually Audio; music track loops/fits per config.

Skeleton:
```yaml
meta:
  name: Video + Audio + Music Timeline
  id: VideoAudioMusicTimeline
  version: 1.0.0

inputs:
  - name: InquiryPrompt
    type: string
    required: true
  - name: Duration
    type: int
    required: true
  - name: NumOfSegments
    type: int
    required: true

artifacts:
  - name: FinalTimeline
    type: json

loops:
  - name: segment
    countInput: NumOfSegments

producers:
  - name: ScriptGenerator
    path: ./modules/script-generator.yaml
  - name: VideoGenerator
    path: ./modules/video-generator.yaml
    loop: segment
  - name: AudioGenerator
    path: ./modules/audio-generator.yaml
    loop: segment
  - name: MusicGenerator
    path: ./modules/music-generator.yaml
  - name: TimelineComposer
    path: ./modules/timeline-composer-video-audio-music.yaml

connections:
  - from: InquiryPrompt
    to: ScriptGenerator.Prompt
  - from: Duration
    to: MusicGenerator.Duration
  - from: Duration
    to: TimelineComposer.Duration
  - from: ScriptGenerator.VideoPrompt[segment]
    to: VideoGenerator[segment].Prompt
  - from: ScriptGenerator.AudioPrompt[segment]
    to: AudioGenerator[segment].TextInput

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

---

## Common Patterns

### Audio-Only Narration

**Blueprint Structure:**
```yaml
loops:
  - name: segment
    countInput: NumOfSegments

producers:
  - name: ScriptGenerator
    path: ./modules/script-generator.yaml
  - name: AudioGenerator
    path: ./modules/audio-generator.yaml
    loop: segment
```

**Inputs:**
```yaml
inputs:
  InquiryPrompt: "Explain the history of the Roman Empire"
  Duration: 60
  NumOfSegments: 4
  VoiceId: "Wise_Man"
```

**Output Artifacts:**
- MovieTitle.txt
- MovieSummary.txt
- NarrationScript[0..3].txt
- SegmentAudio[0..3].mp3

### Images with Audio

**Blueprint Structure:**
```yaml
loops:
  - name: segment
    countInput: NumOfSegments
  - name: image
    parent: segment
    countInput: NumOfImagesPerNarrative

producers:
  - name: ScriptGenerator
    path: ./modules/script-generator.yaml
  - name: ImagePromptGenerator
    path: ./modules/image-prompt-generator.yaml
    loop: segment
  - name: ImageGenerator
    path: ./modules/image-generator.yaml
    loop: segment.image
  - name: AudioGenerator
    path: ./modules/audio-generator.yaml
    loop: segment
```

**Inputs:**
```yaml
inputs:
  InquiryPrompt: "Tell me about the Solar System"
  Duration: 90
  NumOfSegments: 6
  NumOfImagesPerNarrative: 2
  ImageStyle: "Space photography"
  VoiceId: "Wise_Woman"
```

**Output Artifacts:**
- Script artifacts (title, summary, narration)
- Audio artifacts (6 segments)
- Image artifacts (6 segments × 2 images = 12 images)

---

## Testing Your Blueprint

### Validation

Validate YAML:
```bash
renku blueprints:validate <path-to-blueprint.yaml>
```

Expect clear errors for:
- Invalid dimension selectors
- Unknown loops
- Invalid `countInputOffset` usage
- Missing required fields
- Invalid references

### Dry Run

Test the blueprint structure and plan generation:
```bash
RENKU_CLI_CONFIG=/path/to/cli-config.json renku generate --inputs=<inputs.yaml> --blueprint=<blueprint.yaml> --dry-run
```

### Plan Inspection

Inspect the execution plan:
```bash
cat <builds>/<movie>/runs/rev-0001-plan.json
```

Confirm:
- Inputs are present with canonical IDs (e.g., `Input:TimelineComposer.*`)
- Fan-in entries are populated for collectors
- Loop dimensions align correctly
- All connections are resolved

### Debugging Steps

1. **Validate blueprint structure:**
   ```bash
   renku blueprints:validate my-blueprint.yaml
   ```

2. **Check module paths:**
   - Ensure all `producers[].path` values point to valid YAML files
   - Paths are relative to the blueprint file location

3. **Verify connections:**
   - Ensure all sources (from) and targets (to) reference valid names
   - Check loop dimensions match between source and target

4. **Test with dry-run:**
   - Use `--dry-run` to validate without calling providers
   - Review plan structure in `plan.json`

5. **Inspect artifacts:**
   - After generation, verify artifact types and locations match expectations
   - Use `renku inspect --movie-id=<id>` to view metadata

---

## Common Pitfalls

- **Missing `fanIn: true` on aggregator inputs** → no canonical `Input:*` → TimelineProducer cannot resolve.
- **Forgetting `collectors` for a fan-in input** → fan-in descriptor is empty → missing groups.
- **Mismatched dimensions** (`segment` vs `image`) → planner errors about dimension counts.
- **`countInputOffset` without `countInput`** → blueprint validation error.
- **Invalid selector syntax** (e.g., `[segment+foo]`) or unknown loop symbol (e.g., `[segmnt]`) → blueprint validation error.
- **Optional input without a default** → loader error.
- **Generated artifacts placed in `src`** (don't do this; use `dist/` per package builds).
- **Circular dependencies in connections** → planner error.
- **Producer not found** → check module import path and YAML file exists.

---

## Examples

### Example 1: Audio-Only Narration

**Blueprint:** `audio-only.yaml`

**Inputs (`audio-inputs.yaml`):**
```yaml
inputs:
  InquiryPrompt: "Explain the history of the Roman Empire"
  Duration: 60
  NumOfSegments: 4
  VoiceId: "Wise_Man"
  Audience: "Adults"
```

**Command:**
```bash
renku generate \
  --inputs=audio-inputs.yaml \
  --blueprint=audio-only.yaml
```

**Outputs:**
- `MovieTitle.txt`
- `MovieSummary.txt`
- `NarrationScript-0.txt`, `NarrationScript-1.txt`, `NarrationScript-2.txt`, `NarrationScript-3.txt`
- `SegmentAudio-0.mp3`, `SegmentAudio-1.mp3`, `SegmentAudio-2.mp3`, `SegmentAudio-3.mp3`

---

### Example 2: Images with Audio

**Blueprint:** `image-audio.yaml`

**Inputs (`image-audio-inputs.yaml`):**
```yaml
inputs:
  InquiryPrompt: "Tell me about the Solar System"
  Duration: 90
  NumOfSegments: 6
  NumOfImagesPerNarrative: 2
  ImageStyle: "Space photography"
  Size: "2K"
  AspectRatio: "16:9"
  VoiceId: "Wise_Woman"
  Audience: "Children"
```

**Command:**
```bash
renku generate \
  --inputs=image-audio-inputs.yaml \
  --blueprint=image-audio.yaml
```

**Outputs:**
- Script artifacts (title, summary, narration)
- Audio artifacts (6 segments)
- Image artifacts (6 segments × 2 images = 12 images)
- Timeline JSON manifest

**View Result:**
```bash
renku viewer:view --movie-id=movie-{id}
```

---

### Example 3: Iterate on an Existing Movie

**Scenario:** Regenerate after updating inputs.

**Step 1: Generate movie**
```bash
renku generate --inputs=my-inputs.yaml --blueprint=image-audio.yaml
# Output: movie-a1b2c3d4
```

**Step 2: Update inputs**
```bash
# Edit your original inputs file (my-inputs.yaml) with new values
```

**Step 3: Re-run generation against the same movie**
```bash
renku generate --movie-id=movie-a1b2c3d4 --inputs=my-inputs.yaml
```

**Result:**
- Updated plan and outputs for the same movie ID
- Friendly view refreshed under `movies/movie-a1b2c3d4`

---

### Example 4: Custom Sentiment Analyzer Module

**Create a custom sentiment analyzer module.**

**File:** `modules/sentiment-analyzer.yaml`
```yaml
meta:
  name: Sentiment Analyzer
  id: SentimentAnalyzer
  version: 0.1.0

inputs:
  - name: TextInput
    description: Text to analyze
    type: string
    required: true

artifacts:
  - name: SentimentScore
    description: Sentiment score (-1 to 1)
    type: json

models:
  - provider: openai
    model: gpt-4o
    inputs:
      TextInput:
        field: text
        type: string
        required: true
    outputs:
      SentimentScore:
        type: json
```

**Use in Blueprint:**
```yaml
producers:
  - name: SegmentSentiment
    path: ./modules/sentiment-analyzer.yaml
    loop: segment

connections:
  - from: ScriptGenerator.NarrationScript[segment]
    to: SegmentSentiment[segment].TextInput
```

---

## Storage and Organization

### Directory Structure

Blueprints are typically organized as:
```
{rootFolder}/catalog/blueprints/
├── image-audio.yaml
├── audio-only.yaml
├── image-only.yaml
└── modules/
    ├── script-generator.yaml
    ├── image-prompt-generator.yaml
    ├── image-generator.yaml
    ├── audio-generator.yaml
    └── timeline-composer.yaml
```

### File Naming

- **Blueprints**: kebab-case (e.g., `image-audio.yaml`, `script-generator.yaml`)
- **Identifiers in YAML**: PascalCase for `id` fields (e.g., `ImageAudio`, `ScriptGenerator`)
- **Modules**: kebab-case for filenames

---

## Related Documentation

- **CLI Commands**: See [CLI Commands Reference](./cli-commands.md)
- **Input YAML**: See Input YAML Reference section above
- **Testing**: Use `renku blueprints:validate` and `renku generate --dry-run`
- **Examples**: Blueprint examples included in installation at `{rootFolder}/catalog/blueprints/`

---

## Additional Resources

- **Source Code:** `cli/catalog/blueprints/`
- **Blueprint Examples:** `~/.renku/blueprints/`
- **Authoring Patterns:** See complete examples section above

For feature requests and bug reports, please open an issue in the Renku repository.
