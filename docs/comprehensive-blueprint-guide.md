# Renku Blueprint Authoring Guide

This comprehensive guide explains how to author Renku blueprints: the YAML schema, how producers compose into workflows, and the rules the planner and runner enforce (canonical IDs, loops, collectors, fan-in).

---

## Table of Contents

1. [Introduction & Overview](#introduction--overview)
2. [Core Concepts](#core-concepts)
3. [Blueprint YAML Reference](#blueprint-yaml-reference)
4. [Producer YAML Reference](#producer-yaml-reference)
5. [Connections](#connections)
6. [Loops and Dimensions](#loops-and-dimensions)
7. [Collectors and Fan-In](#collectors-and-fan-in)
8. [Canonical IDs](#canonical-ids)
9. [Planner and Runner Internals](#planner-and-runner-internals)
10. [Input Files Reference](#input-files-reference)
11. [Validation Rules & Error Messages](#validation-rules--error-messages)
12. [Common Patterns](#common-patterns)
13. [Debugging and Testing](#debugging-and-testing)
14. [Directory Structure & File Naming](#directory-structure--file-naming)

---

## Introduction & Overview

### What is Renku?

Renku is a workflow orchestration system for generating long-form video content using AI. It coordinates multiple AI providers (OpenAI, Replicate, fal.ai, etc.) to produce narrated documentaries, educational videos, and other multimedia content from simple text prompts.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Blueprint YAML                             │
│  (Defines workflow: inputs, producers, connections, collectors)      │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                              Planner                                 │
│  • Loads blueprint tree (blueprints + producers)                    │
│  • Resolves dimensions and expands loops                            │
│  • Builds execution graph with canonical IDs                        │
│  • Creates layered execution plan                                   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                              Runner                                  │
│  • Executes jobs layer by layer                                     │
│  • Resolves inputs from upstream artifacts                          │
│  • Materializes fan-in collections                                  │
│  • Invokes AI providers via producer implementations                │
│  • Stores artifacts and logs events                                 │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                            Providers                                 │
│  • OpenAI (text generation, structured output)                      │
│  • Replicate (video, audio, image models)                          │
│  • fal.ai (video, audio, image models)                             │
│  • Renku (timeline composition, video export)                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Typical Video Generation Workflow

1. **Script Generation**: LLM generates narration script divided into segments
2. **Prompt Generation**: LLM creates prompts for video/image generation per segment
3. **Media Generation**: AI models generate video clips, images, or audio per segment
4. **Timeline Composition**: Renku assembles segments into a playable timeline
5. **Video Export**: Remotion renders the final video file

---

## Core Concepts

### Vocabulary

| Term | Definition |
|------|------------|
| **Blueprint** | Top-level YAML that orchestrates a complete workflow. Defines inputs, artifacts, loops, producer imports, connections, and collectors. |
| **Producer** | A reusable module that invokes one or more AI models. Producers are referenced by blueprints via the `producers:` section. |
| **Input** | A user-provided value. Mark `required: true` unless a sensible `default` exists. For producers, required and defaults are read from the input JSON schemas. |
| **Artifact** | An output produced by a producer. Can be scalar (single value) or array (indexed by loops). |
| **Loop** | A named iteration dimension that defines how many times a producer executes. Loops enable parallel processing of segments. |
| **Connection** | A data flow edge that wires outputs to inputs across the workflow graph. |
| **Collector** | Gathers multiple artifacts into a single collection for downstream aggregation (fan-in). |
| **Canonical ID** | Fully qualified node identifier used throughout the system. Format: `Type:path.to.name[index]` |

### Blueprint vs Producer

**Blueprints** are workflow definitions that:
- Define user-facing inputs and final artifacts
- Import and connect multiple producers
- Define loops for parallel execution
- Specify collectors for fan-in aggregation

**Producers** are execution units that:
- Accept inputs and produce artifacts
- Map inputs to specific AI model parameters
- Support multiple model variants (e.g., different video providers)
- Can be reused across multiple blueprints

### Data Flow

Data flows through the system via **connections**:

```
Blueprint Input ──► Producer Input ──► Producer ──► Artifact ──► Next Producer Input
                                                          │
                                                          └──► Blueprint Artifact
```

For looped producers, data flows through indexed connections:

```
ScriptProducer.NarrationScript[0] ──► AudioProducer[0].TextInput
ScriptProducer.NarrationScript[1] ──► AudioProducer[1].TextInput
ScriptProducer.NarrationScript[2] ──► AudioProducer[2].TextInput
```

---

## Blueprint YAML Reference

### Complete Schema

```yaml
meta:
  name: <string>           # Human-readable name (required)
  description: <string>    # Purpose and behavior
  id: <string>             # Unique identifier in PascalCase (required)
  version: <semver>        # Semantic version (e.g., 0.1.0)
  author: <string>         # Creator name
  license: <string>        # License type (e.g., MIT)

inputs:
  - name: <string>         # Input identifier in PascalCase (required)
    description: <string>  # Purpose and usage
    type: <string>         # Data type (required)
    required: <boolean>    # Whether mandatory (default: true)

artifacts:
  - name: <string>         # Artifact identifier in PascalCase (required)
    description: <string>  # Purpose and content
    type: <string>         # Output type (required)
    itemType: <string>     # Element type for arrays
    countInput: <string>   # Input that determines array size
    countInputOffset: <int> # Offset added to countInput value

loops:
  - name: <string>         # Loop identifier in lowercase (required)
    description: <string>  # Purpose and behavior
    countInput: <string>   # Input that determines iteration count (required)
    countInputOffset: <int> # Offset added to count
    parent: <string>       # Parent loop for nesting

producers:
  - name: <string>         # Producer instance name in PascalCase (required)
    path: <string>         # Relative path to producer YAML (required)
    loop: <string>         # Loop dimension(s) (e.g., "segment" or "segment.image")

connections:
  - from: <string>         # Source reference (required)
    to: <string>           # Target reference (required)
    note: <string>         # Optional documentation

collectors:
  - name: <string>         # Collector identifier (required)
    from: <string>         # Source artifact reference (required)
    into: <string>         # Target input reference (required)
    groupBy: <string>      # Loop dimension for grouping (required)
    orderBy: <string>      # Loop dimension for ordering within groups
```

### Field Details

#### `inputs`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Identifier in PascalCase |
| `type` | string | Yes | `string`, `int`, `image`, `audio`, `video`, `json`, `collection` |
| `required` | boolean | No | Default: `true` |
| `description` | string | No | Documentation |

**Types:**
- `string`: Text value
- `int`: Integer number
- `image`, `audio`, `video`: Media file reference
- `json`: Structured JSON data
- `collection`: Array of items (used with `fanIn: true` in producers)

#### `artifacts`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Identifier in PascalCase |
| `type` | string | Yes | `string`, `json`, `image`, `audio`, `video`, `array`, `multiDimArray` |
| `itemType` | string | Conditional | Required for `array` and `multiDimArray` |
| `countInput` | string | Conditional | Input name for array sizing |
| `countInputOffset` | int | No | Non-negative offset added to size |

**Array sizing:** The final size is `countInput + countInputOffset`.

#### `loops`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Lowercase identifier (e.g., `segment`) |
| `countInput` | string | Yes | Input that provides iteration count |
| `countInputOffset` | int | No | Offset added to count |
| `parent` | string | No | Parent loop for nesting |

#### `producers`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Instance alias in PascalCase |
| `path` | string | Yes | Relative path to producer YAML |
| `loop` | string | No | Loop assignment (e.g., `segment`, `segment.image`) |

### Real Example: Video-Only Blueprint

```yaml
meta:
  name: Video Only Narration
  description: Generate video segments from a textual inquiry.
  id: Video
  version: 0.1.0
  author: Renku
  license: MIT

inputs:
  - name: InquiryPrompt
    description: The prompt describing the movie script to be generated.
    type: string
    required: true
  - name: Duration
    description: The desired duration of the movie in seconds.
    type: int
    required: true
  - name: NumOfSegments
    description: Number of narration segments.
    type: int
    required: true
  - name: SegmentDuration
    description: Duration of each video segment in seconds.
    type: int
    required: false
    default: 10
  - name: Style
    description: Desired movie style to feed into prompt.
    type: string
    required: true
  - name: Resolution
    description: The video resolution in 480p, 720p, 1080p
    type: string
    required: true
  - name: AspectRatio
    description: Aspect ratio such as 16:9 or 3:2.
    type: string
    required: true

artifacts:
  - name: SegmentVideo
    description: Generated video for each narration segment.
    type: array
    itemType: video
    countInput: NumOfSegments

loops:
  - name: segment
    description: Iterates over narration segments.
    countInput: NumOfSegments

producers:
  - name: ScriptProducer
    path: ../../producers/script/script.yaml
  - name: VideoPromptProducer
    path: ../../producers/video-prompt/video-prompt.yaml
  - name: VideoProducer
    path: ../../producers/video/video.yaml
    loop: segment

connections:
  # Wire blueprint inputs to ScriptProducer
  - from: InquiryPrompt
    to: ScriptProducer.InquiryPrompt
  - from: Duration
    to: ScriptProducer.Duration
  - from: NumOfSegments
    to: ScriptProducer.NumOfSegments

  # Wire script outputs to VideoPromptProducer (looped)
  - from: ScriptProducer.NarrationScript[segment]
    to: VideoPromptProducer[segment].NarrativeText
  - from: ScriptProducer.MovieSummary
    to: VideoPromptProducer[segment].MovieSummary
  - from: Style
    to: VideoPromptProducer[segment].Style
  - from: SegmentDuration
    to: VideoPromptProducer[segment].SegmentDuration

  # Wire prompts to VideoProducer (looped)
  - from: VideoPromptProducer.VideoPrompt[segment]
    to: VideoProducer[segment].Prompt
  - from: Resolution
    to: VideoProducer[segment].Resolution
  - from: AspectRatio
    to: VideoProducer[segment].AspectRatio
  - from: SegmentDuration
    to: VideoProducer[segment].SegmentDuration

  # Wire video output to blueprint artifact
  - from: VideoProducer[segment].SegmentVideo
    to: SegmentVideo[segment]
```

---

## Producer YAML Reference

### Complete Schema

```yaml
meta:
  name: <string>           # Human-readable name (required)
  description: <string>    # Purpose and behavior
  id: <string>             # Unique identifier in PascalCase (required)
  version: <semver>        # Semantic version
  author: <string>         # Creator name
  license: <string>        # License type

inputs:
  - name: <string>         # Input identifier (required)
    description: <string>  # Purpose and usage
    type: <string>         # Data type (required)
    fanIn: <boolean>       # Whether this is a fan-in collection input
    dimensions: <string>   # Dimension labels for collections (e.g., "segment")

artifacts:
  - name: <string>         # Artifact identifier (required)
    description: <string>  # Purpose and content
    type: <string>         # Output type (required)
    itemType: <string>     # Element type for arrays
    countInput: <string>   # Input that determines array size

loops:
  - name: <string>         # Loop identifier
    description: <string>  # Purpose
    countInput: <string>   # Input for iteration count

models:
  - provider: <string>     # Provider name (required): openai, replicate, fal-ai, renku
    model: <string>        # Model identifier (required)
    inputs:                # Input field mappings
      <ProducerInput>: <providerField>
    promptFile: <string>   # Path to TOML prompt configuration
    outputSchema: <string> # Path to JSON schema for structured output
    config: <object>       # Provider-specific configuration
```

### Model Input Mapping

The `inputs` field in `models` maps producer input names to provider-specific parameter names:

```yaml
models:
  - provider: replicate
    model: bytedance/seedance-1-pro-fast
    inputs:
      Prompt: prompt              # Producer's "Prompt" → Replicate's "prompt"
      AspectRatio: aspect_ratio   # Producer's "AspectRatio" → Replicate's "aspect_ratio"
      Resolution: resolution
      SegmentDuration: duration
```

**Important:** The `models` section defines `inputs:` mapping only. Outputs are defined in the `artifacts` section, not in `models`.

### Real Example: Script Producer (OpenAI)

```yaml
meta:
  name: Script Generation
  description: Generate documentary scripts tailored to the user inquiry.
  id: ScriptProducer
  version: 0.1.0
  author: Renku
  license: MIT

inputs:
  - name: InquiryPrompt
    description: The topic describing the desired movie script.
    type: string
  - name: Duration
    description: Desired narration duration in seconds.
    type: int
  - name: NumOfSegments
    description: Number of narration segments to produce.
    type: int
  - name: Audience
    description: Target audience for tone and vocabulary.
    type: string
    default: Adult
  - name: Language
    description: Narration language.
    type: string

artifacts:
  - name: MovieTitle
    description: The generated title for the documentary.
    type: string
  - name: MovieSummary
    description: Narrative summary for supplemental reading.
    type: string
  - name: NarrationScript
    description: Array of narration paragraphs per segment.
    type: array
    itemType: string
    countInput: NumOfSegments

loops:
  - name: segment
    description: Iterates over narration segments.
    countInput: NumOfSegments

models:
  - provider: openai
    model: gpt-5-mini
    promptFile: ./script.toml
    outputSchema: ./script-output.json
    config:
      text_format: json_schema
```

### Real Example: Video Producer (Replicate)

```yaml
meta:
  name: Video Generation
  description: Generate a video that best reflects the given narrative script.
  id: VideoProducer
  version: 0.1.0
  author: Renku
  license: MIT

inputs:
  - name: Prompt
    description: The prompt to generate the video.
    type: string
  - name: AspectRatio
    description: Aspect ratio such as 16:9 or 3:2.
    type: string
  - name: Resolution
    description: The video resolution in 480p, 720p, 1080p
    type: string
    default: 480p
  - name: SegmentDuration
    description: The video segment's duration in seconds.
    type: int

artifacts:
  - name: SegmentVideo
    description: Video file for the segment.
    type: video

models:
  - model: bytedance/seedance-1-pro-fast
    provider: replicate
    inputs:
      Prompt: prompt
      AspectRatio: aspect_ratio
      Resolution: resolution
      SegmentDuration: duration
  - model: google/veo-3.1-fast
    provider: replicate
    inputs:
      Prompt: prompt
      AspectRatio: aspect_ratio
      Resolution: resolution
      SegmentDuration: duration
  - model: veo3-1
    provider: fal-ai
    inputs:
      Prompt: prompt
      AspectRatio: aspect_ratio
      Resolution: resolution
      SegmentDuration: duration
```

### Real Example: Audio Producer (Multiple Providers)

```yaml
meta:
  name: Audio Producer
  description: Convert narration text into voiced audio segments.
  id: AudioProducer
  version: 0.1.0
  author: Renku
  license: MIT

inputs:
  - name: TextInput
    description: Text to synthesize.
    type: string
  - name: VoiceId
    description: Voice preset identifier for the provider.
    type: string
  - name: Emotion
    description: Optional emotion hint.
    type: string

artifacts:
  - name: SegmentAudio
    description: Narrated audio file for the segment.
    type: audio

models:
  - model: minimax/speech-2.6-hd
    provider: replicate
    inputs:
      TextInput: text
      Emotion: emotion
      VoiceId: voice_id
  - provider: fal-ai
    model: elevenlabs/tts/eleven-v3
    inputs:
      TextInput: prompt
      VoiceId: voice
```

### Real Example: Timeline Composer (Fan-In Inputs)

```yaml
meta:
  name: Timeline Composer
  description: Compose assets into a ReMotion timeline.
  id: TimelineComposer
  version: 0.1.0
  author: Renku
  license: MIT

inputs:
  - name: ImageSegments
    description: Collected image assets grouped per segment.
    type: collection
    itemType: image
    dimensions: segment.image
    fanIn: true
  - name: VideoSegments
    description: Collected video assets grouped per narration segment.
    type: collection
    itemType: video
    dimensions: segment
    fanIn: true
  - name: AudioSegments
    description: Narration audio clips grouped per segment (master track).
    type: collection
    itemType: audio
    dimensions: segment
    fanIn: true
  - name: Music
    description: Background music clips that score the movie.
    type: audio
    fanIn: true
  - name: Duration
    description: Total duration of the movie in seconds.
    type: int

artifacts:
  - name: Timeline
    description: OrderedTimeline JSON manifest.
    type: json

models:
  - model: timeline/ordered
    provider: renku
    config:
      imageClip:
        artifact: ImageSegments[Image]
      videoClip:
        artifact: VideoSegments
      audioClip:
        artifact: AudioSegments
      musicClip:
        artifact: Music
```

---

## Connections

Connections define data flow between nodes in the workflow graph.

### Syntax Patterns

#### Direct Connections (Scalar to Scalar)

```yaml
connections:
  - from: InquiryPrompt
    to: ScriptProducer.InquiryPrompt
```

This wires the blueprint's `InquiryPrompt` input directly to the `ScriptProducer`'s `InquiryPrompt` input.

#### Array Indexing

```yaml
connections:
  - from: ScriptProducer.NarrationScript[segment]
    to: AudioProducer[segment].TextInput
```

This wires each element of `NarrationScript` to the corresponding `AudioProducer` instance:
- `NarrationScript[0]` → `AudioProducer[0].TextInput`
- `NarrationScript[1]` → `AudioProducer[1].TextInput`
- etc.

#### Multi-Dimensional Indexing

```yaml
connections:
  - from: ImageGenerator[segment][image].SegmentImage
    to: SegmentImage[segment][image]
```

For nested loops, use multiple indices. Both source and target must have matching dimension structure.

#### Offset Selectors

```yaml
connections:
  - from: ImageProducer[image].SegmentImage
    to: ImageToVideoProducer[segment].InputImage1
  - from: ImageProducer[image+1].SegmentImage
    to: ImageToVideoProducer[segment].InputImage2
```

Offset selectors (`[image+1]`, `[segment-1]`) create sliding window patterns. This example creates image-to-video transitions where each video uses adjacent images as start/end frames.

**Important:** When using offsets, ensure the source array is sized appropriately. For the example above, if you have `N` segments, you need `N+1` images. Use `countInputOffset: 1` on the `image` loop.

#### Constant Indices

```yaml
connections:
  - from: ImageProducer.SegmentImage[0]
    to: IntroVideoProducer.StartImage
  - from: ImageProducer.SegmentImage[1]
    to: IntroVideoProducer.EndImage
```

Hardcoded indices (`[0]`, `[1]`) select specific array elements.

### Broadcast Connections

A scalar input can be broadcast to all instances of a looped producer:

```yaml
connections:
  - from: Style
    to: VideoPromptProducer[segment].Style
```

The same `Style` value is sent to every instance of `VideoPromptProducer`.

### Connection Resolution

When the planner resolves connections:

1. Parses source and target references
2. Extracts namespace path (e.g., `ScriptProducer`)
3. Extracts node name and dimension selectors
4. Aligns dimensions between source and target
5. Expands to concrete instances based on loop sizes

---

## Loops and Dimensions

Loops define iteration dimensions that enable parallel producer execution.

### Basic Loop

```yaml
loops:
  - name: segment
    description: Iterates over narration segments.
    countInput: NumOfSegments
```

This creates a `segment` dimension sized by the `NumOfSegments` input. If `NumOfSegments = 3`, producers assigned to this loop run 3 times.

### Loop with Offset

```yaml
loops:
  - name: image
    description: Iterates over images, one more than segments.
    countInput: NumOfSegments
    countInputOffset: 1
```

The iteration count is `NumOfSegments + 1`. Use this for sliding window patterns where you need one extra element.

### Nested Loops

```yaml
loops:
  - name: segment
    countInput: NumOfSegments
  - name: image
    parent: segment
    countInput: NumOfImagesPerSegment
```

This creates a two-dimensional iteration space. If `NumOfSegments = 3` and `NumOfImagesPerSegment = 2`, you get 6 instances:
- `[0][0]`, `[0][1]`
- `[1][0]`, `[1][1]`
- `[2][0]`, `[2][1]`

### Assigning Producers to Loops

```yaml
producers:
  - name: ScriptProducer
    path: ./script.yaml
    # No loop - runs once
  - name: AudioProducer
    path: ./audio.yaml
    loop: segment
    # Runs once per segment
  - name: ImageProducer
    path: ./image.yaml
    loop: segment.image
    # Runs for each segment × image combination
```

### Dimension Alignment

Dimensions align automatically by position in connections:

```yaml
connections:
  - from: VideoGenerator[segment].SegmentVideo
    to: TimelineComposer.VideoSegments
```

The planner matches the `segment` dimension on both sides. If dimensions don't align, the planner reports an error.

---

## Collectors and Fan-In

Collectors aggregate multiple artifacts into a single collection for downstream processing.

### Why Use Collectors?

Without collectors, connections are point-to-point. Collectors enable:
- Gathering all segment videos into a timeline
- Grouping images by segment for batch processing
- Ordering items within groups

### Basic Collector

```yaml
collectors:
  - name: TimelineVideo
    from: VideoProducer[segment].SegmentVideo
    into: TimelineComposer.VideoSegments
    groupBy: segment
```

This collects all `SegmentVideo` artifacts from `VideoProducer` instances and groups them by segment index.

### Collector with Ordering

```yaml
collectors:
  - name: TimelineImages
    from: ImageProducer[segment][image].SegmentImage
    into: TimelineComposer.ImageSegments
    groupBy: segment
    orderBy: image
```

This groups images by segment and orders them by image index within each group.

### Fan-In Inputs

The target input must be marked as `fanIn: true` in the producer:

```yaml
# In timeline-composer.yaml
inputs:
  - name: VideoSegments
    description: Collected video assets grouped per narration segment.
    type: collection
    itemType: video
    dimensions: segment
    fanIn: true
```

**Critical:** Without `fanIn: true`, the collector has no target and the aggregator cannot resolve the collection.

### What Collectors Produce

A collector creates a `FanInDescriptor` with:

```typescript
{
  groupBy: "segment",
  orderBy: "image",  // optional
  groups: [
    ["Artifact:ImageProducer.SegmentImage[0][0]", "Artifact:ImageProducer.SegmentImage[0][1]"],
    ["Artifact:ImageProducer.SegmentImage[1][0]", "Artifact:ImageProducer.SegmentImage[1][1]"],
    ["Artifact:ImageProducer.SegmentImage[2][0]", "Artifact:ImageProducer.SegmentImage[2][1]"]
  ]
}
```

### Real Example: Image-to-Video with Collectors

```yaml
# From image-to-video.yaml
loops:
  - name: segment
    countInput: NumOfSegments
  - name: image
    countInput: NumOfSegments
    countInputOffset: 1  # N+1 images for N segments

producers:
  - name: ImageProducer
    path: ../../producers/image/image.yaml
    loop: segment
  - name: ImageToVideoProducer
    path: ../../producers/image-to-video/image-to-video.yaml
    loop: segment
  - name: AudioProducer
    path: ../../producers/audio/audio.yaml
    loop: segment
  - name: TimelineComposer
    path: ../../producers/timeline-composer/timeline-composer.yaml

connections:
  # Sliding window for image-to-video transitions
  - from: ImageProducer[image].SegmentImage
    to: ImageToVideoProducer[segment].InputImage1
  - from: ImageProducer[image+1].SegmentImage
    to: ImageToVideoProducer[segment].InputImage2

  # Direct connection also goes to timeline
  - from: ImageToVideoProducer[segment].SegmentVideo
    to: TimelineComposer.VideoSegments
  - from: AudioProducer[segment].SegmentAudio
    to: TimelineComposer.AudioSegments

collectors:
  - name: TimelineVideo
    from: ImageToVideoProducer[segment].SegmentVideo
    into: TimelineComposer.VideoSegments
    groupBy: segment
  - name: TimelineAudio
    from: AudioProducer[segment].SegmentAudio
    into: TimelineComposer.AudioSegments
    groupBy: segment
```

---

## Canonical IDs

Canonical IDs are fully qualified identifiers used throughout the planner and runner.

### ID Format

```
Type:path.to.name[index0][index1]...
```

**Components:**
- **Type**: `Input:`, `Artifact:`, or `Producer:`
- **Path**: Dot-separated namespace path
- **Name**: Node name
- **Indices**: Dimension indices (0-based)

### Examples

| ID | Description |
|----|-------------|
| `Input:InquiryPrompt` | Blueprint-level input |
| `Input:ScriptProducer.Duration` | Input to ScriptProducer |
| `Artifact:VideoProducer.SegmentVideo[0]` | First video artifact |
| `Artifact:ImageProducer.SegmentImage[2][1]` | Image at segment 2, image 1 |
| `Producer:AudioProducer[0]` | First AudioProducer instance |

### How Canonical IDs are Generated

1. **Graph Building**: The planner creates nodes for all inputs, artifacts, and producers
2. **Dimension Collection**: Extracts dimension symbols from connections
3. **Expansion**: Creates concrete instances for each dimension combination
4. **ID Assignment**: Assigns canonical IDs with indices

### How Canonical IDs are Used

- **Planner**: Emits canonical IDs in the execution plan
- **Runner**: Resolves upstream artifacts using canonical IDs
- **Providers**: Access inputs via `runtime.inputs.getByNodeId(canonicalId)`

### Validation Functions

```typescript
isCanonicalInputId(value)     // Returns true if valid Input ID
isCanonicalArtifactId(value)  // Returns true if valid Artifact ID
isCanonicalProducerId(value)  // Returns true if valid Producer ID

parseCanonicalInputId(id)     // Returns { type, path, name }
parseCanonicalArtifactId(id)  // Returns { type, path, name, indices }
```

### Error Messages

- `"Expected canonical Input ID (Input:...), got \"${value}\"."`
- `"Invalid canonical Artifact ID: \"${value}\" has empty body."`

---

## Planner and Runner Internals

### Planner Process

#### 1. Blueprint Tree Loading

The planner loads the blueprint and all producer imports recursively:

```typescript
loadYamlBlueprintTree(blueprintPath)
// Returns: BlueprintTree with root blueprint and all imported producers
```

Circular references are detected and rejected.

#### 2. Graph Building

Creates nodes for all inputs, artifacts, and producers:

```typescript
buildCanonicalGraph(blueprintTree)
// Returns: { nodes, edges, collectors }
```

#### 3. Dimension Resolution

**Phase 1 - Explicit sizing:**
- Reads `countInput` values from input file
- Applies `countInputOffset` if present
- Assigns sizes to dimension symbols

**Phase 2 - Transitive derivation:**
- Propagates sizes through edges
- If edge has loop selector, target inherits source dimension size

**Error:**
```
Missing size for dimension "segment" on node "AudioProducer".
Ensure the upstream artefact declares countInput or can derive this dimension from a loop.
```

#### 4. Instance Expansion

Expands nodes to concrete instances using Cartesian product:

```typescript
// Node with dimensions [segment, image] where segment=2, image=3
// Creates 6 instances: [0,0], [0,1], [0,2], [1,0], [1,1], [1,2]
```

#### 5. Edge Alignment

For each dimension position, checks if instances align:

- Loop selectors: `[segment]` matches same index
- Offset selectors: `[segment+1]` matches with offset applied
- Constant selectors: `[0]` only matches index 0

#### 6. Input Node Collapsing

Merges aliased inputs and builds `inputBindings`:

```typescript
{
  "Producer:ScriptProducer": {
    "InquiryPrompt": "Input:InquiryPrompt"  // Alias → Canonical ID
  }
}
```

#### 7. Execution Layer Building

Uses topological sort (Kahn's algorithm):

1. Calculate in-degrees for all jobs
2. Jobs with in-degree 0 go to layer 0
3. Remove layer 0 jobs, decrement in-degrees
4. Repeat until all jobs assigned

**Error:**
```
Producer graph contains a cycle. Unable to create execution plan.
```

### Runner Process

#### 1. Layer-by-Layer Execution

```typescript
for (const layer of plan.layers) {
  for (const job of layer) {
    await executeJob(job, context);
  }
}
```

Jobs in the same layer can theoretically run in parallel.

#### 2. Artifact Resolution

Before executing a job, the runner:
1. Finds inbound edges from the plan
2. Loads upstream artifact data from event log
3. Adds to `job.context.extras.resolvedInputs`

#### 3. Fan-In Materialization

For fan-in inputs:
1. Groups members by `groupBy` dimension
2. Sorts each group by `orderBy` dimension (if present)
3. Returns nested array structure

```typescript
{
  groupBy: "segment",
  orderBy: "image",
  groups: [
    ["Artifact:Image[0][0]", "Artifact:Image[0][1]"],
    ["Artifact:Image[1][0]", "Artifact:Image[1][1]"]
  ]
}
```

#### 4. Provider Invocation

Calls the producer's `produce()` function with resolved context.

#### 5. Artifact Materialization

Persists produced artifacts to storage and logs events.

### Dirty Tracking (Incremental Runs)

The planner supports incremental execution:

1. **Determine dirty inputs**: Compare input hashes against manifest
2. **Determine dirty artifacts**: Find changed or missing artifacts
3. **Initial dirty jobs**: Jobs producing missing artifacts or touching dirty inputs
4. **Propagate**: BFS through dependency graph marks downstream jobs dirty

---

## Input Files Reference

### Structure

Input files use YAML with two main sections:

```yaml
inputs:
  <InputName>: <value>

models:
  - model: <modelId>
    provider: <providerId>
    producerId: <ProducerName>
    config: <object>
```

### Input Values

```yaml
inputs:
  InquiryPrompt: "Tell me about Darwin and Galapagos islands"
  Duration: 30
  NumOfSegments: 3
  VoiceId: Wise_Woman
  Emotion: neutral
  AspectRatio: "16:9"
  Resolution: "480p"
  SegmentDuration: 10
  Style: "Ghibli"
```

### Model Selection

Override default models per producer:

```yaml
models:
  - model: minimax/speech-2.6-hd
    provider: replicate
    producerId: AudioProducer
  - model: bytedance/seedance-1-pro-fast
    provider: replicate
    producerId: VideoProducer
  - model: timeline/ordered
    provider: renku
    producerId: TimelineComposer
    config:
      masterTrack: Audio
      musicClip:
        volume: 0.4
      tracks: ["Video", "Audio", "Music"]
```

### Data Types

| Type | YAML Syntax | Example |
|------|-------------|---------|
| `string` | Quoted text | `"Hello world"` |
| `int` | Numeric | `42` |
| `array` | YAML array | `["a", "b", "c"]` |

### Validation Rules

1. All required inputs must be present
2. Optional inputs use blueprint defaults if omitted
3. Input names are case-sensitive
4. Type mismatches cause validation errors

---

## Validation Rules & Error Messages

### Blueprint Validation

| Rule | Error Message |
|------|---------------|
| Meta section required | `Blueprint must have a meta section` |
| Meta.id required | `Blueprint meta must have an id` |
| Meta.name required | `Blueprint meta must have a name` |
| At least one artifact | `Blueprint must declare at least one artifact` |
| Producer blueprints need models | `Producer blueprint must have a models array` |
| Composite blueprints need producers | `Composite blueprint must have producer imports` |
| Cannot mix models and producers | `Cannot define both models and producer imports` |

### Input Validation

| Rule | Error Message |
|------|---------------|
| Optional inputs need defaults | `Optional input "${name}" must declare a default value` |
| Input name required | `Input must have a name` |
| Input type required | `Input must have a type` |

### Loop Validation

| Rule | Error Message |
|------|---------------|
| countInput required | `Loop "${name}" must declare countInput` |
| countInputOffset requires countInput | `countInputOffset requires countInput` |
| countInputOffset must be non-negative | `countInputOffset must be a non-negative integer` |

### Connection Validation

| Rule | Error Message |
|------|---------------|
| References cannot be empty | `Connection reference cannot be empty` |
| Valid dimension syntax | `Invalid dimension selector "${raw}". Expected "<loop>", "<loop>+<int>", "<loop>-<int>", or "<int>".` |
| Unknown dimension | `Unknown loop symbol "${symbol}"` |
| Dimension count mismatch | `Node "${id}" referenced with inconsistent dimension counts` |

### Collector Validation

| Rule | Error Message |
|------|---------------|
| groupBy references valid loop | `Collector groupBy "${dim}" is not a declared loop` |
| orderBy references valid loop | `Collector orderBy "${dim}" is not a declared loop` |

### Graph Validation

| Rule | Error Message |
|------|---------------|
| No cycles | `Producer graph contains a cycle. Unable to create execution plan.` |
| Producer found | `Missing producer catalog entry for ${producerAlias}` |
| Namespace exists | `Unknown sub-blueprint namespace "${path}"` |

### Dimension Resolution

| Rule | Error Message |
|------|---------------|
| Size resolved | `Missing size for dimension "${label}" on node "${nodeId}". Ensure the upstream artefact declares countInput or can derive this dimension from a loop.` |
| Consistent sizes | `Dimension "${symbol}" has conflicting sizes (${existing} vs ${size})` |

---

## Common Patterns

### Audio-Only Narration

Generate spoken narration from text:

```yaml
loops:
  - name: segment
    countInput: NumOfSegments

producers:
  - name: ScriptProducer
    path: ./script.yaml
  - name: AudioProducer
    path: ./audio.yaml
    loop: segment

connections:
  - from: InquiryPrompt
    to: ScriptProducer.InquiryPrompt
  - from: ScriptProducer.NarrationScript[segment]
    to: AudioProducer[segment].TextInput
  - from: VoiceId
    to: AudioProducer[segment].VoiceId
  - from: AudioProducer[segment].SegmentAudio
    to: SegmentAudio[segment]
```

**Outputs:** `SegmentAudio[0..N].mp3`

### Video-Only

Generate video clips from prompts:

```yaml
loops:
  - name: segment
    countInput: NumOfSegments

producers:
  - name: ScriptProducer
    path: ./script.yaml
  - name: VideoPromptProducer
    path: ./video-prompt.yaml
  - name: VideoProducer
    path: ./video.yaml
    loop: segment

connections:
  - from: ScriptProducer.NarrationScript[segment]
    to: VideoPromptProducer[segment].NarrativeText
  - from: VideoPromptProducer.VideoPrompt[segment]
    to: VideoProducer[segment].Prompt
  - from: VideoProducer[segment].SegmentVideo
    to: SegmentVideo[segment]
```

**Outputs:** `SegmentVideo[0..N].mp4`

### Image-to-Video Flow (Sliding Window)

Generate transitions between images:

```yaml
loops:
  - name: segment
    countInput: NumOfSegments
  - name: image
    countInput: NumOfSegments
    countInputOffset: 1  # N+1 images for N segments

producers:
  - name: ImageProducer
    path: ./image.yaml
    loop: image
  - name: ImageToVideoProducer
    path: ./image-to-video.yaml
    loop: segment

connections:
  # Each video uses two adjacent images
  - from: ImageProducer[image].SegmentImage
    to: ImageToVideoProducer[segment].InputImage1
  - from: ImageProducer[image+1].SegmentImage
    to: ImageToVideoProducer[segment].InputImage2
```

**Result:**
- Segment 0: Image[0] → Image[1]
- Segment 1: Image[1] → Image[2]
- Segment 2: Image[2] → Image[3]

### Full Timeline (Video + Audio + Music)

Complete workflow with timeline composition:

```yaml
producers:
  - name: ScriptProducer
    path: ./script.yaml
  - name: VideoProducer
    path: ./video.yaml
    loop: segment
  - name: AudioProducer
    path: ./audio.yaml
    loop: segment
  - name: MusicProducer
    path: ./music.yaml
  - name: TimelineComposer
    path: ./timeline-composer.yaml

connections:
  # ... (script to video/audio connections)

  - from: Duration
    to: MusicProducer.Duration
  - from: VideoProducer[segment].SegmentVideo
    to: TimelineComposer.VideoSegments
  - from: AudioProducer[segment].SegmentAudio
    to: TimelineComposer.AudioSegments
  - from: MusicProducer.Music
    to: TimelineComposer.Music
  - from: TimelineComposer.Timeline
    to: Timeline

collectors:
  - name: TimelineVideo
    from: VideoProducer[segment].SegmentVideo
    into: TimelineComposer.VideoSegments
    groupBy: segment
  - name: TimelineAudio
    from: AudioProducer[segment].SegmentAudio
    into: TimelineComposer.AudioSegments
    groupBy: segment
  - name: MusicTrack
    from: MusicProducer.Music
    into: TimelineComposer.Music
    groupBy: segment  # Single group still needed for fan-in
```

---

## Debugging and Testing

### Validate Blueprint Structure

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

Test without calling AI providers:

```bash
RENKU_CLI_CONFIG=/path/to/cli-config.json \
renku generate \
  --inputs=<inputs.yaml> \
  --blueprint=<blueprint.yaml> \
  --dry-run
```

### Inspect Execution Plan

After generation, examine the plan:

```bash
cat <builds>/<movie>/runs/rev-0001-plan.json
```

Confirm:
- Inputs are present with canonical IDs
- Fan-in entries are populated for collectors
- Loop dimensions align correctly
- All connections are resolved

### Common Pitfalls

| Problem | Cause | Solution |
|---------|-------|----------|
| TimelineProducer cannot resolve inputs | Missing `fanIn: true` on input | Add `fanIn: true` to collection inputs |
| Fan-in descriptor is empty | No collector defined | Add collector from source to target |
| Planner dimension error | Mismatched dimensions in connection | Verify dimensions match between source/target |
| Blueprint validation error | `countInputOffset` without `countInput` | Add `countInput` to loop/artifact |
| Invalid selector syntax | Typo in loop name | Check loop names in `loops:` section |
| Missing artifacts | Generated files in wrong location | Use `dist/` per package builds |

### Debugging Steps

1. **Validate blueprint structure:**
   ```bash
   renku blueprints:validate my-blueprint.yaml
   ```

2. **Check producer paths:**
   - Ensure all `producers[].path` values point to valid YAML files
   - Paths are relative to the blueprint file location

3. **Verify connections:**
   - Ensure all sources and targets reference valid names
   - Check loop dimensions match between source and target

4. **Test with dry-run:**
   - Use `--dry-run` to validate without calling providers
   - Review plan structure in `plan.json`

5. **Inspect artifacts:**
   - After generation, verify artifact types and locations match expectations
   - Use `renku inspect --movie-id=<id>` to view metadata

---

## Directory Structure & File Naming

### Catalog Organization

```
catalog/
├── blueprints/
│   ├── audio-only/
│   │   ├── audio-only.yaml
│   │   └── input-template.yaml
│   ├── video-only/
│   │   ├── video-only.yaml
│   │   └── input-template.yaml
│   └── image-to-video/
│       ├── image-to-video.yaml
│       └── input-template.yaml
├── producers/
│   ├── script/
│   │   ├── script.yaml
│   │   ├── script.toml
│   │   └── script-output.json
│   ├── audio/
│   │   └── audio.yaml
│   ├── video/
│   │   └── video.yaml
│   ├── image/
│   │   └── image.yaml
│   └── timeline-composer/
│       └── timeline-composer.yaml
└── models/
    ├── openai/
    │   └── openai.yaml
    ├── replicate/
    │   └── replicate.yaml
    └── fal-ai/
        └── fal-ai.yaml
```

### File Naming Conventions

| Item | Convention | Example |
|------|------------|---------|
| Blueprint files | kebab-case | `image-to-video.yaml` |
| Producer files | kebab-case | `script.yaml` |
| Blueprint/Producer IDs | PascalCase | `id: ImageToVideo` |
| Loop names | lowercase | `name: segment` |
| Input/Artifact names | PascalCase | `name: InquiryPrompt` |

### Relative Paths

Producer paths are relative to the blueprint file:

```yaml
# In blueprints/video-only/video-only.yaml
producers:
  - name: ScriptProducer
    path: ../../producers/script/script.yaml
```

---

## Related Resources

- **CLI Commands**: `renku --help`
- **Blueprint Examples**: `catalog/blueprints/`
- **Producer Examples**: `catalog/producers/`
- **Model Configurations**: `catalog/models/`

For feature requests and bug reports, please open an issue in the Renku repository.
