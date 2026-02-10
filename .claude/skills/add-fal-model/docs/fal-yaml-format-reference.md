# fal-ai.yaml Format Reference

The pricing catalog lives at `catalog/models/fal-ai/fal-ai.yaml`.

## Entry Structure

Every model entry has this structure:

```yaml
- name: <model-name>            # Required: fal.ai model path (e.g., "kling-video/v3/pro/text-to-video")
  subProvider: <sub-provider>    # Optional: only for non-fal-native models (e.g., "wan", "xai")
  type: <type>                   # Required: "video", "image", "audio", "stt", "json"
  mime:                          # Required: list of output MIME types
    - <mime-type>
  price:                         # Required: pricing configuration
    function: <cost-function>    # Required: one of the CostFunctionName values
    inputs: [<field1>, ...]      # Required for most functions (not costByRun)
    <price-fields>               # Function-specific price data
```

## Standard MIME Types

| Type | MIME Types |
|------|-----------|
| Video | `video/mp4` |
| Image | `image/png`, `image/jpeg`, `image/webp` |
| Audio | `audio/mp3` |
| STT | `application/json` |
| JSON | `application/json` |

## Section Map in fal-ai.yaml

Insert new entries in the correct section. Current section order:

```
# Image Models          (~line 2)
# Audio Models          (~line 194)
# Video Models          (~line 236)
  # Kling Video Models  (~line 297)
  # Sora 2 Models       (~line 342)
  (Wan models)
  (Seedance models)
  (Other video models)
  # LTX-2-19b Distilled (~line 533)
  # XAI Video Models    (~line 575)
# STT Models            (~line 604)
```

### Insertion Rules

- **Kling models**: Insert after the last Kling entry, before `# Sora 2 Models`
- **LTX models (non-distilled)**: Insert before `# LTX-2-19b Distilled` section
- **LTX models (distilled)**: Insert within the `# LTX-2-19b Distilled` section
- **Wan models**: Insert after the Wan video section
- **XAI models**: Insert within the `# XAI Video Models` section
- **New provider families**: Add a new comment section in logical order

## Template Examples

### Video - Simple Duration

```yaml
  - name: model-name/variant
    type: video
    mime:
      - video/mp4
    price:
      function: costByVideoDuration
      inputs: [duration]
      pricePerSecond: 0.10
```

### Video - Duration + Audio Toggle

```yaml
  - name: model-name/variant
    type: video
    mime:
      - video/mp4
    price:
      function: costByVideoDurationAndWithAudio
      inputs: [duration, generate_audio]
      prices:
        - generate_audio: true
          pricePerSecond: 0.14
        - generate_audio: false
          pricePerSecond: 0.07
```

### Video - Duration + Resolution Tiers

```yaml
  - name: model-name/variant
    subProvider: wan
    type: video
    mime:
      - video/mp4
    price:
      function: costByVideoDurationAndResolution
      inputs: [duration, resolution]
      prices:
        - resolution: 720p
          pricePerSecond: 0.10
        - resolution: 1080p
          pricePerSecond: 0.15
```

### Video - Megapixel-Based (LTX)

```yaml
  - name: ltx-2-19b/variant
    type: video
    mime:
      - video/mp4
    price:
      function: costByVideoMegapixels
      inputs: [num_frames, video_size]
      pricePerMegapixel: 0.0008
```

### Video - Token-Based (Seedance)

```yaml
  - name: bytedance/seedance/variant
    type: video
    mime:
      - video/mp4
    price:
      function: costByVideoPerMillionTokens
      inputs: [duration, resolution, aspect_ratio]
      price:
        - pricePerMillionTokens: 1
```

### Audio - Per Character

```yaml
  - name: provider/tts-model
    type: audio
    mime:
      - audio/mp3
    price:
      function: costByCharacters
      inputs: [text]
      pricePerCharacter: 0.0001
```

### Image - Flat Per Run

```yaml
  - name: model-name
    type: image
    mime:
      - image/png
    price:
      function: costByRun
      price: 0.03
```

### Image - Per Megapixel

```yaml
  - name: model-name/variant
    type: image
    mime:
      - image/png
      - image/jpeg
    price:
      function: costByImageMegapixels
      inputs: [num_images, image_size]
      pricePerMegapixel: 0.09
```

## subProvider Field

Used when the model is not native to fal.ai but hosted through them:

| subProvider | Models |
|-------------|--------|
| `wan` | Wan video/image models |
| `xai` | Grok Imagine models |

Only add `subProvider` when the model vendor is different from fal.ai.

## Verification

After adding entries, verify with:

```bash
node scripts/update-fal-catalog.mjs catalog/models/fal-ai/fal-ai.yaml --dry-run
```

New models with existing JSON schemas should show "SKIP" (schema already exists).
New models without schemas should show they would be created.
