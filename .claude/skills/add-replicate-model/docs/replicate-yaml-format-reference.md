# replicate.yaml Format Reference

The pricing catalog lives at `catalog/models/replicate/replicate.yaml`.

## Entry Structure

Every model entry has this structure:

```yaml
- name: <owner/model-name>       # Required: Replicate model path (e.g., "openai/sora-2")
  type: <type>                   # Required: "video", "image", "audio"
  mime:                          # Required: list of output MIME types
    - <mime-type>
  price:                         # Required: pricing configuration
    function: <cost-function>    # Required: one of the CostFunctionName values
    inputs: [<field1>, ...]      # Required for most functions (not costByRun)
    <price-fields>               # Function-specific price data
```

Note: Replicate entries do NOT use `subProvider` — all models are identified by their `owner/model-name` path.

## Standard MIME Types

| Type | MIME Types |
|------|-----------|
| Video | `video/mp4` |
| Image | `image/png`, `image/jpeg`, `image/webp` |
| Audio | `audio/mp3`, `audio/wav`, `audio/flac`, `audio/pcm` |

## Section Map in replicate.yaml

Insert new entries in the correct section. Current section order:

```
# Image Models          (~line 2)
# Audio Models (Speech) (~line 77)
  # Music Models        (~line 131)
# Video Models          (~line 151)
  # Kling Video Models  (~line 292)
```

### Insertion Rules

- **Image models**: Insert alphabetically by owner within Image Models section
- **Audio/Speech models**: Insert within Audio Models section
- **Music models**: Insert within Music Models subsection
- **Video models**: Insert within Video Models section, grouped by owner/family
- **New provider families**: Add entries in logical grouping order

## Template Examples

### Video - Simple Duration

```yaml
  - name: owner/model-name
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
  - name: owner/model-name
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
  - name: owner/model-name
    type: video
    mime:
      - video/mp4
    price:
      function: costByVideoDurationAndResolution
      inputs: [duration, resolution]
      prices:
        - resolution: 480p
          pricePerSecond: 0.018
        - resolution: 720p
          pricePerSecond: 0.036
        - resolution: 1080p
          pricePerSecond: 0.072
```

### Video - Duration + Mode (standard/pro)

```yaml
  - name: owner/model-name
    type: video
    mime:
      - video/mp4
    price:
      function: costByVideoDurationAndMode
      inputs: [duration, mode]
      prices:
        - mode: std
          pricePerSecond: 0.056
        - mode: pro
          pricePerSecond: 0.11
```

### Video - Duration + Mode + Audio Toggle

```yaml
  - name: owner/model-name
    type: video
    mime:
      - video/mp4
    price:
      function: costByVideoDurationModeAndAudio
      inputs: [duration, mode, generate_audio]
      prices:
        - mode: standard
          generate_audio: false
          pricePerSecond: 0.168
        - mode: standard
          generate_audio: true
          pricePerSecond: 0.252
        - mode: pro
          generate_audio: false
          pricePerSecond: 0.224
        - mode: pro
          generate_audio: true
          pricePerSecond: 0.336
```

### Audio - Per Character

```yaml
  - name: owner/tts-model
    type: audio
    mime:
      - audio/mp3
      - audio/wav
      - audio/flac
      - audio/pcm
    price:
      function: costByCharacters
      inputs: [text]
      pricePerCharacter: 0.0001
```

### Audio/Music - Flat Per Run

```yaml
  - name: owner/music-model
    type: audio
    mime:
      - audio/mp3
      - audio/wav
      - audio/pcm
    price:
      function: costByRun
      price: 0.20
```

### Image - Flat Per Run

```yaml
  - name: owner/model-name
    type: image
    mime:
      - image/png
    price:
      function: costByRun
      price: 0.03
```

### Image - Resolution Tiers

```yaml
  - name: owner/model-name
    type: image
    price:
      function: costByImageAndResolution
      inputs: [resolution]
      prices:
        - resolution: 1K
          pricePerImage: 0.15
        - resolution: 2K
          pricePerImage: 0.15
        - resolution: 4K
          pricePerImage: 0.30
```

### Image - Dimension-Based

```yaml
  - name: owner/model-name
    type: image
    mime:
      - image/png
      - image/jpg
      - image/webp
    price:
      function: costByResolution
      inputs: [width, height]
      prices:
        - resolution: 0.5K
          pricePerImage: 0.0025
        - resolution: 1K
          pricePerImage: 0.005
        - resolution: 2K
          pricePerImage: 0.01
```

## Verification

After adding entries, verify with:

```bash
node scripts/update-replicate-catalog.mjs catalog/models/replicate/replicate.yaml --dry-run
```

New models with existing JSON schemas should show "SKIP" (schema already exists).
New models without schemas should show they would be created.
