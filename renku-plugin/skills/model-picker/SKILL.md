---
name: model-picker
description: Select Renku producers and AI models based on use case, budget, and capabilities. Use when users say "which model should I use", "help me pick a video model", "what producers do I need", "compare video models", "best model for talking head", or when deciding which asset producers and models to use.
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Model Picker

Select the right Renku producers and AI models for a video generation blueprint based on use case requirements and constraints.

## Critical Rules

1. **User-specified models take priority.** If the user names a specific model (e.g., "use Kling Video 3.1"), use that model and find the producer(s) that support it via their `mappings` section. Never override a user's explicit model choice.
2. **User-specified providers take priority.** If the user names a provider (e.g., "use fal-ai" or "use replicate"), only select models available from that provider. Check `catalog/models/{provider}/{provider}.yaml` for available models.
3. **Always read actual catalog files.** Never rely on memorized model names or prices. Read the producer YAML `mappings` section and the provider model YAML `price` section for ground truth.
4. **Models go in `input-template.yaml`, not the blueprint.** The blueprint defines producers and connections. The `input-template.yaml` specifies which model+provider to use for each producer.

## Catalog Structure

### Providers
Model definitions with pricing live at:
```
catalog/models/{provider}/{provider}.yaml
```
Available providers: `fal-ai`, `replicate`, `openai`, `vercel`, `elevenlabs`, `wavespeed-ai`, `renku` (internal handlers).

Each model entry has: `name`, `type` (image/video/audio/text/json/stt), `mime`, and `price` (with a pricing function and rates).

### Producers
Producer definitions with model mappings live at:
```
catalog/producers/{type}/{name}.yaml
```
Types: `video/`, `image/`, `audio/`, `composition/`, `json/`.

Each producer YAML has: `inputs` (what the producer accepts), `artifacts` (what it outputs), and `mappings` (which models from which providers are compatible, with field-level input translations).

### How Models Map to Producers

A producer's `mappings` section is organized by provider, then by model name:
```yaml
mappings:
  fal-ai:
    kling-video/v3/pro/image-to-video:
      Prompt: prompt
      SourceImage: image_url
      Duration:
        field: duration
        intToSecondsString: true
  replicate:
    bytedance/seedream-4.5:
      Prompt: prompt
      AspectRatio: aspect_ratio
```

A model is compatible with a producer **only if it appears in that producer's `mappings`** section.

## Decision Process

### Step 1: Check for User-Specified Model

If the user named a specific model:
1. Find which producer(s) have that model in their `mappings` — use `Grep` to search across `catalog/producers/**/*.yaml`
2. Identify the provider from the mapping (the parent key above the model name)
3. Read the provider YAML (`catalog/models/{provider}/{provider}.yaml`) to get pricing
4. Use that producer + model + provider combination — done

If the user named a specific provider but not a model:
1. Read `catalog/models/{provider}/{provider}.yaml` to see available models
2. For each required producer, check its `mappings` section for models from that provider only
3. Select from those models based on use case fit

### Step 2: Identify Required Media Types

From the use case requirements, identify which media types are needed:
- **Images** — Static visuals (KenBurns, character portraits, product shots, storyboard panels)
- **Videos** — Dynamic clips (text-to-video, image-to-video, start/end frame interpolation)
- **Talking Head** — Character speaking with lip sync
- **Audio/Speech** — TTS narration
- **Music** — Background music generation

### Step 3: Select Producers for Each Media Type

#### Video Producers

| Producer | Use Case | Key Inputs |
|----------|----------|------------|
| `video/text-to-video` | Video from text description only | Prompt |
| `video/image-to-video` | Video starting from a single image | Prompt, SourceImage |
| `video/start-end-frame-to-video` | Video interpolating between two images | Prompt, StartImage, EndImage |
| `video/talking-head` | Character speaking with lip sync | SourceImage, AudioInput |
| `video/text-to-talking-head` | Talking head from text description | Prompt, AudioInput |
| `video/kling-multishot` | Multi-shot video with character consistency | Prompt, ReferenceImages[] |
| `video/ref-image-to-video` | Video using reference image for style/character | Prompt, SourceImage, ReferenceImage |
| `video/video-to-video` | Transform existing video | SourceVideo, Prompt |
| `video/video-lipsync` | Add lip sync to existing video | SourceVideo, AudioInput |
| `video/video-upscale` | Upscale video resolution | SourceVideo |
| `video/motion-transfer` | Transfer motion from reference video | SourceVideo, SourceImage |

**Key Rules:**
- For **cut-scene videos**, use ONE video producer per segment with `[cut]` markers — NOT nested groups
- For **talking heads with pre-generated audio**, use `video/talking-head` (image + audio → video)
- For **talking heads from text description**, use `video/text-to-talking-head`
- For **continuous flow videos** (end frame → start frame chaining), use `video/image-to-video` with LastFrame artifact wiring

#### Image Producers

| Producer | Use Case | Key Inputs |
|----------|----------|------------|
| `image/text-to-image` | Generate image from text prompt | Prompt |
| `image/text-to-grid-images` | Generate storyboard grid | Prompt |
| `image/image-edit` | Edit a single source image | Prompt, SourceImages[0] |
| `image/image-compose` | Compose multiple source images | Prompt, SourceImages[0..N] |
| `image/text-to-vector` | Generate vector/SVG image | Prompt |

**Key Rules:**
- For **placing a person into a scene** (1 source image), use `image/image-edit`
- For **composing two people together** (2+ source images), use `image/image-compose`
- For **storyboard grids** (NxN panel layout), use `image/text-to-grid-images`

#### Audio Producers

| Producer | Use Case | Key Inputs |
|----------|----------|------------|
| `audio/text-to-speech` | TTS narration from text | TextInput, VoiceId |
| `audio/text-to-music` | Background music generation | Prompt |

#### Composition Producers

| Producer | Use Case |
|----------|----------|
| `composition/timeline-composer` | Assemble tracks into final video |
| `json/transcription` | Speech-to-text for karaoke subtitles |

### Step 4: Select Models for Each Producer

For each selected producer:
1. Read the producer YAML at `catalog/producers/{type}/{name}.yaml`
2. Look at the `mappings` section to see all compatible models grouped by provider
3. For each candidate model, read `catalog/models/{provider}/{provider}.yaml` to get its pricing
4. Select based on: user constraints (provider, budget), use case fit, and pricing

**When comparing models, report actual prices from the catalog.** Use the `price` section in the provider YAML. Common pricing functions:
- `costByRun` — flat price per generation
- `costByVideoDuration` / `costByVideoDurationAndResolution` — price per second of video
- `costByCharacters` — price per character of text (TTS)
- `costByImageMegapixels` — price per megapixel

### Step 5: Verify Compatibility

For each producer + model pair:
1. Confirm the model appears in that producer's `mappings` under the correct provider
2. Check what inputs the mapping requires — some models need additional inputs (e.g., `Resolution`, `AspectRatio`)
3. Note any special mapping behaviors (transforms, conditionals, combined fields)

## Output Format

Return the recommended selections as a list suitable for `input-template.yaml`:

```yaml
models:
  - model: <model-name>
    provider: <provider>
    producerId: <PascalCase producer ID from producer YAML meta.id>

  - model: <model-name>
    provider: <provider>
    producerId: <PascalCase producer ID>
    config:
      # any producer-specific config overrides
```

Always include:
- `timeline/ordered` with provider `renku` for `TimelineComposer`
- `ffmpeg/native-render` with provider `renku` for `VideoExporter`

## Common Patterns

**Documentary (images + narration + music):**
- `prompt/generic` → `image/text-to-image` + `audio/text-to-speech` + `audio/text-to-music` → `composition/timeline-composer`

**Documentary with talking head:**
- Add `video/talking-head` or `video/text-to-talking-head` for speaking segments

**Ad video (character + product + clips):**
- `prompt/generic` → `image/text-to-image` (character, product) → `video/ref-image-to-video` (clips) + `audio/text-to-speech` + `audio/text-to-music` → `composition/timeline-composer`

**Flow video (continuous sequence):**
- `prompt/generic` → `image/text-to-image` (initial frame) → `video/image-to-video` (segments, chained via LastFrame) + `audio/text-to-speech` + `audio/text-to-music` → `composition/timeline-composer`

**Storyboard grid:**
- `prompt/generic` → `image/text-to-grid-images` → `video/start-end-frame-to-video` (panel transitions) + `audio/text-to-music` → `composition/timeline-composer`

## Reference Documents

- [Models Guide](./references/models-guide.md) — Producer selection decision tree
- [Video Producer Guidance](./references/video-producer-guidance.md) — Detailed video producer decision tree
- [Image Producer Guidance](./references/image-producer-guidance.md) — Image producer decision tree
- [Video Models](./references/video-models.md) — Video model deep dives
- [Image Models](./references/image-models.md) — Image model deep dives
- [Audio Models](./references/audio-models.md) — Audio model comparisons
