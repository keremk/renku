# Producers Catalog

This document lists all available Renku producers and explains how to create custom ones. For installed producer YAML files, check the catalog location in `~/.config/renku/cli-config.json`.

---

## Producer Categories

Renku has two fundamentally different types of producers:

### Reusable Media Producers

These are **generic and reusable** across different blueprints:
- Take simple inputs (prompt text, aspect ratio, duration, etc.)
- Produce media files (images, audio, video)
- Map inputs to specific AI model parameters
- Support multiple model variants from different providers

**Examples**: `ImageProducer`, `VideoProducer`, `AudioProducer`, `MusicProducer`, `ImageToVideoProducer`

### Context-Specific LLM Producers

These are **NOT meant to be reusable**. They are highly context-specific and must be created for each new video type:
- Generate prompts, scripts, and structured data for downstream media producers
- Define the creative logic for how content should be generated
- May include runtime selectors (like `NarrationType`) that determine which media producers run
- Consist of three files: producer YAML, prompt TOML, and output JSON schema

**Examples**: `DocumentaryPromptProducer`, `FlowVideoPromptProducer`, `ScriptProducer`

When creating a new blueprint for a different video type, you typically need to **create new LLM producers** tailored to that specific use case.

---

## Quick Reference

| Producer | Category | Reusable? | Purpose |
|----------|----------|-----------|---------|
| `ImageProducer` | Media | **Yes** | Text-to-image generation |
| `VideoProducer` | Media | **Yes** | Text-to-video generation |
| `AudioProducer` | Media | **Yes** | Text-to-speech |
| `MusicProducer` | Media | **Yes** | Music generation |
| `ImageToVideoProducer` | Media | **Yes** | Image-to-video with start and end frame images generation |
| `ReferenceToVideoProducer` | Media | **Yes** | Video with reference images |
| `TimelineComposer` | Composition | **Yes** | Timeline JSON manifest |
| `VideoExporter` | Composition | **Yes** | Final MP4 rendering |
| `ScriptProducer` | LLM | No | Basic narration scripts |
| `DocumentaryPromptProducer` | LLM | No | Complex documentary with conditional segments |
| `FlowVideoPromptProducer` | LLM | No | Flowing video prompts |
| `ImagePromptProducer` | LLM | No | Image prompts from narrative |
| `VideoPromptProducer` | LLM | No | Video prompts from narrative |
| `MusicPromptProducer` | LLM | No | Music prompts from summary |

---

## Creating Custom LLM Producers

When creating a new blueprint for a different video type (fairy tale, advertisement, interview, etc.), you need to create custom LLM producers. Each LLM producer consists of **three files**:

### File Structure

```
producers/my-custom-prompt/
├── my-custom-prompt.yaml      # Producer definition
├── my-custom-prompt.toml      # Prompt templates
└── my-custom-prompt-output.json  # JSON Schema for structured output
```

### 1. Output Schema (JSON)

Define the structured output the LLM should produce using JSON Schemas. This determines what data flows to downstream producers.

**Example** Read `catalog/producers/documentary-prompt/documentary-prompt-output.json` as one example, there are many more examples in the `catalog/producers/` folder.

**Key Design Decisions**:
- Include **selector fields** (like `NarrationType`) if downstream processing varies by segment type and conditional branching based on some values are needed.
- Include **prompts for downstream media producers** (ImagePrompts, VideoPrompt, MusicPrompt)
- Use **nested arrays** for per-segment data (Segments.ImagePrompts)

### 2. Prompt Template (TOML)

Define system and user prompts with variable interpolation.

**Example** (`catalog/producers/documentary-prompt/documentary-prompt.toml`):

**Key Elements**:
- `variables` - List of inputs that can be interpolated
- `systemPrompt` - Instructions for the LLM on what to generate
- `userPrompt` - Per-request template with `{{variable}}` placeholders

### 3. Producer YAML

Define inputs, outputs, and link to the prompt/schema files.

**Example** (`catalog/producers/documentary-prompt/documentary-prompt.yaml`):

**Key Elements**:
- `artifacts.arrays` - Declare nested arrays with their count inputs
- `promptFile` - Path to TOML prompt template
- `outputSchema` - Path to JSON schema
- `config.text_format: json_schema` - Enable structured output

### Reference Example

The most comprehensive example is `documentary-prompt` in the catalog:
```
<catalog>/producers/documentary-prompt/
├── documentary-prompt.yaml
├── documentary-prompt.toml
└── documentary-prompt-output.json
```

This demonstrates:
- Complex nested output with arrays
- Runtime selectors (NarrationType) for conditional producer execution
- Prompts for multiple downstream media types
- Variable interpolation in prompts

---

You can peruse the catalog/producers for other LLM producer examples.

## Media Producers

### ImageProducer

**Purpose**: Generate images from text prompts.

**ID**: `ImageProducer`

**Inputs**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `Prompt` | string | Yes | Image generation prompt |
| `Size` | string | No | Image resolution (1K, 2K, 4K, custom) |
| `AspectRatio` | string | No | Aspect ratio (16:9, 3:2, etc.) |
| `Width` | integer | No | Explicit width (model-dependent) |
| `Height` | integer | No | Explicit height (model-dependent) |

**Outputs**:
| Name | Type | Description |
|------|------|-------------|
| `SegmentImage` | image | Generated still image |

**Models**:
- `replicate/bytedance/seedream-4`
- `replicate/google/nano-banana`
- `replicate/google/nano-banana-pro`
- `replicate/qwen/qwen-image`
- `replicate/prunaai-z-image-turbo`
- `fal-ai/bytedance/seedream/v4.5/text-to-image`
- `wavespeed-ai/bytedance/seedream-v4.5`

---

### AudioProducer

**Purpose**: Convert text to speech.

**ID**: `AudioProducer`

**Inputs**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `TextInput` | string | Yes | Text to synthesize |
| `VoiceId` | string | Yes | Voice preset identifier |
| `Emotion` | string | No | Emotion hint for narration |

**Outputs**:
| Name | Type | Description |
|------|------|-------------|
| `SegmentAudio` | audio | Narrated audio file |

**Models**:
- `replicate/minimax/speech-2.6-hd`
- `replicate/minimax/speech-02-hd`
- `fal-ai/elevenlabs/tts/eleven-v3`

---

### VideoProducer

**Purpose**: Generate video from text prompts.

**ID**: `VideoProducer`

**Inputs**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `Prompt` | string | Yes | Video generation prompt |
| `AspectRatio` | string | Yes | Aspect ratio (16:9, 3:2, etc.) |
| `Resolution` | string | No | Video resolution (480p, 720p, 1080p) |
| `SegmentDuration` | int | No | Video duration in seconds |

**Outputs**:
| Name | Type | Description |
|------|------|-------------|
| `SegmentVideo` | video | Generated video file |

**Models**:
- `replicate/bytedance/seedance-1-pro-fast`
- `replicate/bytedance/seedance-1-lite`
- `replicate/google/veo-3.1-fast`
- `replicate/openai-sora-2`
- `fal-ai/veo3-1`

---

### MusicProducer

**Purpose**: Generate music from prompts.

**ID**: `MusicProducer`

**Inputs**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `Prompt` | string | Yes | Music generation prompt |
| `Duration` | int | Yes | Desired length in seconds/milliseconds |

**Outputs**:
| Name | Type | Description |
|------|------|-------------|
| `Music` | audio | Composed music audio |

**Models**:
- `replicate/stability-ai/stable-audio-2.5`

---

### ImageToVideoProducer

**Purpose**: Generate video from images (transitions/animations).

**ID**: `ImageToVideoProducer`

**Inputs**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `Prompt` | string | Yes | Video generation prompt |
| `InputImage1` | image | Yes | First input image |
| `InputImage2` | image | No | Second input image (for end frame) |
| `AspectRatio` | string | No | Aspect ratio |
| `Resolution` | string | No | Video resolution |
| `SegmentDuration` | int | No | Video duration in seconds |

**Outputs**:
| Name | Type | Description |
|------|------|-------------|
| `SegmentVideo` | video | Generated video file |

**Models**:
- `fal-ai/veo3.1/image-to-video`
- `fal-ai/kling-video/o1/image-to-video` (supports end frame)

---

### ReferenceToVideoProducer

**Purpose**: Generate video using reference images.

**ID**: `ReferenceToVideoProducer`

**Inputs**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `Prompt` | string | Yes | Video generation prompt |
| `ReferenceImages` | collection[image] | Yes | Reference images (fan-in input) |
| `AspectRatio` | string | No | Aspect ratio |
| `Resolution` | string | No | Video resolution |
| `SegmentDuration` | int | No | Video duration in seconds |
| `GenerateAudio` | boolean | No | Whether to generate audio |
| `AutoFixPrompt` | boolean | No | Auto-fix content policy issues |

**Outputs**:
| Name | Type | Description |
|------|------|-------------|
| `SegmentVideo` | video | Generated video file |

**Note**: `ReferenceImages` is a fan-in collection input.

**Models**:
- `fal-ai/veo3.1/reference-to-video`

---

## Composition Producers

### TimelineComposer

**Purpose**: Compose media assets into a Remotion timeline.

**ID**: `TimelineComposer`

**Inputs**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `ImageSegments` | collection[image] | No | Images grouped per segment (fan-in) |
| `VideoSegments` | collection[video] | No | Videos grouped per segment (fan-in) |
| `AudioSegments` | collection[audio] | No | Audio clips per segment (fan-in) |
| `Music` | audio | No | Background music (fan-in) |
| `Duration` | int | Yes | Total movie duration in seconds |

**Outputs**:
| Name | Type | Description |
|------|------|-------------|
| `Timeline` | json | OrderedTimeline JSON manifest |

**Note**: All collection inputs use `fanIn: true`. Configure with collectors.

**Models**:
- `renku/timeline/ordered`

---

### VideoExporter

**Purpose**: Render timeline to final MP4.

**ID**: `VideoExporter`

**Inputs**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `Timeline` | json | Yes | OrderedTimeline JSON manifest |

**Outputs**:
| Name | Type | Description |
|------|------|-------------|
| `FinalVideo` | video | Final rendered MP4 |

**Models**:
- `renku/remotion/docker-render`

---

## Type Reference

### Input Types
- `string` - Text value
- `int` / `integer` - Integer number
- `boolean` - True/false
- `image` - Image file reference
- `audio` - Audio file reference
- `video` - Video file reference
- `json` - Structured JSON data
- `collection` - Array of items (requires `fanIn: true` for aggregation)

### Output Types
- `string` - Text output
- `image` - Image file
- `audio` - Audio file
- `video` - Video file
- `json` - Structured JSON
- `array` - Array of items (use with `itemType` and `countInput`)

---

## Fan-In Inputs

Fan-in inputs aggregate outputs from multiple producer instances:

```yaml
inputs:
  - name: VideoSegments
    type: collection
    itemType: video
    dimensions: segment
    fanIn: true
```

Use collectors in blueprints to populate fan-in inputs:

```yaml
collectors:
  - name: TimelineVideo
    from: VideoProducer[segment].SegmentVideo
    into: TimelineComposer.VideoSegments
    groupBy: segment
```

---

## Next Steps

- See [blueprint-patterns.md](./blueprint-patterns.md) for how producers are composed
- See [comprehensive-blueprint-guide.md](./comprehensive-blueprint-guide.md) for full schema reference
- Find installed producers: Check `~/.config/renku/cli-config.json` for catalog path
