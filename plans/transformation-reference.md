# Producer Mapping Transformation Reference

This document outlines all transformation types used in the producer YAML files for image and video generation.

## Overview

The mapping system transforms **producer inputs** (canonical abstractions like `Prompt`, `AspectRatio`, `Resolution`) into **model-specific API fields**.

```
Producer YAML inputs (interface)
    │
    │ mappings section applies transforms
    ↓
Model input JSON schema (provider API)
```

**Default behavior:** If a user doesn't provide a value for an input, that field is not sent to the provider. The provider uses its defaults from the model JSON schema.

---

## Transforms Used (8 total)

| # | Transform | Description | Used In |
|---|-----------|-------------|---------|
| 1 | **simple** | Direct field rename | All producers |
| 2 | **transform** | Value lookup table | text-to-image, image-to-image, image-hybrid, text-to-video |
| 3 | **combine** | Multiple inputs → one field | text-to-image |
| 4 | **conditional** | Include field when condition met | text-to-image, image-hybrid |
| 5 | **firstOf** | Array → single element | image-to-image, image-hybrid |
| 6 | **invert** | Boolean inversion | image-to-image, image-hybrid |
| 7 | **intToString** | Integer to string coercion | text-to-video, image-to-video, reference-to-video |
| 8 | **durationToFrames** | Seconds to frame count | audio-to-video, text-to-talking-head |

---

## Transform Details

### 1. simple - Direct Field Rename

Maps producer input name directly to provider field name. Supports dot notation for nested object paths.

**Syntax:**
```yaml
# Flat field
ProducerInput: provider_field

# Nested field using dot notation
ProducerInput: parent.child.field
```

**Examples from YAML files:**

```yaml
# text-to-image.yaml - flux-pro/kontext/text-to-image
Prompt: prompt
NumImages: num_images
Seed: seed
GuidanceScale: guidance_scale
AspectRatio: aspect_ratio

# image-to-video.yaml - sora-2/image-to-video
Prompt: prompt
StartImage: image_url
Duration: duration
AspectRatio: aspect_ratio
Resolution: resolution

# audio-to-video.yaml - creatify-aurora
Prompt: prompt
CharacterImage: image_url
AudioUrl: audio_url
Resolution: resolution
GuidanceScale: guidance_scale
AudioGuidanceScale: audio_guidance_scale

# text-to-speech.yaml - minimax/speech-02-hd (nested objects)
VoiceId: voice_setting.voice_id
Speed: voice_setting.speed
Pitch: voice_setting.pitch
OutputFormat: audio_setting.format
SampleRate: audio_setting.sample_rate
```

**Nested path behavior:**
- `voice_setting.voice_id` → `{ voice_setting: { voice_id: value } }`
- `audio_setting.format` → `{ audio_setting: { format: value } }`
- Multiple inputs targeting same parent are merged into one object

**Usage:** Most common transform - used when producer and provider use different field names but same value type. Dot notation extends this for providers with nested API structures.

---

### 2. transform - Value Lookup Table

Maps producer values to provider-specific values using a lookup table.

**Syntax:**
```yaml
ProducerInput:
  field: provider_field
  transform:
    "producer_value1": provider_value1
    "producer_value2": provider_value2
```

**Examples from YAML files:**

```yaml
# text-to-image.yaml - bytedance/seedream/v4/text-to-image
# AspectRatio string → image_size preset
AspectRatio:
  field: image_size
  transform:
    "16:9": landscape_16_9
    "9:16": portrait_16_9
    "4:3": landscape_4_3
    "3:4": portrait_4_3
    "1:1": square_hd
    "3:2": landscape_4_3
    "2:3": portrait_4_3

# text-to-image.yaml - bytedance/seedream/v4/text-to-image
# Boolean → enum
EnhancePrompt:
  field: enhance_prompt_mode
  transform:
    true: standard
    false: fast

# text-to-image.yaml - gpt-image-1-5
# AspectRatio → fixed dimension string
AspectRatio:
  field: image_size
  transform:
    "1:1": "1024x1024"
    "16:9": "1536x1024"
    "9:16": "1024x1536"

# image-hybrid.yaml - bytedance/seedream-4-5
# Resolution → size enum
Resolution:
  field: size
  transform:
    "1K": "2K"  # 1K not supported, upgrade to 2K
    "2K": "2K"
    "4K": "4K"
    "custom": "custom"

# image-hybrid.yaml - qwen/qwen-image
# Resolution → quality mode
Resolution:
  field: image_size
  transform:
    "1K": optimize_for_speed
    "2K": optimize_for_quality
    "4K": optimize_for_quality

# text-to-video.yaml - openai/sora-2
# AspectRatio → orientation
AspectRatio:
  field: aspect_ratio
  transform:
    "16:9": "landscape"
    "9:16": "portrait"
```

**Usage:** Used when provider expects different value format or enum values than producer's canonical values.

---

### 3. combine - Multiple Inputs to One Field

Merges multiple producer inputs into one provider field using a lookup table with composite keys.

**Syntax:**
```yaml
OutputField:
  combine:
    inputs: [Input1, Input2]
    table:
      "value1+value2": result_value
      "value1+": result_when_only_first
      "+value2": result_when_only_second
```

**Examples from YAML files:**

```yaml
# text-to-image.yaml - bytedance/seedream/v4.5/text-to-image
# AspectRatio + Resolution → image_size preset
ImageSize:
  combine:
    inputs: [AspectRatio, Resolution]
    table:
      # Resolution only (aspect determined by resolution)
      "+2K": auto_2K
      "+4K": auto_4K
      # AspectRatio only (default resolution)
      "16:9+": landscape_16_9
      "9:16+": portrait_16_9
      "4:3+": landscape_4_3
      "3:4+": portrait_4_3
      "1:1+": square_hd
      # Both specified - prefer resolution auto modes
      "16:9+2K": auto_2K
      "16:9+4K": auto_4K
      "1:1+2K": auto_2K
      "1:1+4K": auto_4K

# text-to-image.yaml - prunaai/z-image-turbo (inside conditional)
# AspectRatio + Resolution → width/height object
ImageSize:
  conditional:
    when:
      input: Width
      empty: true
    then:
      combine:
        inputs: [AspectRatio, Resolution]
        table:
          "16:9+1K": { width: 1024, height: 576 }
          "9:16+1K": { width: 576, height: 1024 }
          "1:1+1K": { width: 1024, height: 1024 }
          "16:9+": { width: 1024, height: 576 }
          "1:1+": { width: 1024, height: 1024 }
```

**Key format:** `"{Input1Value}+{Input2Value}"` - empty values are allowed (e.g., `"+2K"` means only Resolution provided).

**Usage:** Used when provider expects a single field derived from multiple producer inputs.

---

### 4. conditional - Include Field When Condition Met

Includes field only when specific condition is satisfied.

**Syntax:**
```yaml
ProducerInput:
  conditional:
    when:
      input: OtherInput
      equals: value        # OR
      notEmpty: true       # OR
      empty: true
    then:
      field: provider_field
      # OR nested transform like combine
```

**Examples from YAML files:**

```yaml
# text-to-image.yaml - qwen-image-2512
# Only use ImageSize combine when Resolution is provided
ImageSize:
  conditional:
    when:
      input: Resolution
      notEmpty: true
    then:
      combine:
        inputs: [AspectRatio, Resolution]
        table:
          "16:9+1K": { width: 1920, height: 1080 }
          "16:9+2K": { width: 2560, height: 1440 }
          "1:1+1K": { width: 1024, height: 1024 }
          "1:1+2K": { width: 2048, height: 2048 }

# text-to-image.yaml - prunaai/z-image-turbo
# Only use computed dimensions when Width is not provided
ImageSize:
  conditional:
    when:
      input: Width
      empty: true
    then:
      combine:
        inputs: [AspectRatio, Resolution]
        table:
          "16:9+1K": { width: 1024, height: 576 }
          "1:1+1K": { width: 1024, height: 1024 }

# image-hybrid.yaml - bytedance/seedream-4-5
# Only include width when Resolution is "custom"
Width:
  conditional:
    when:
      input: Resolution
      equals: custom
    then:
      field: width

Height:
  conditional:
    when:
      input: Resolution
      equals: custom
    then:
      field: height
```

**Condition types:**
- `equals: value` - Input equals specific value
- `notEmpty: true` - Input is provided (not null/undefined/empty)
- `empty: true` - Input is not provided

**Usage:** Used when certain fields should only be sent based on other input values.

---

### 5. firstOf - Array to Single Element

Takes first element from an array input when provider expects single value.

**Syntax:**
```yaml
ProducerInput:
  field: provider_field
  firstOf: true
```

**Examples from YAML files:**

```yaml
# image-to-image.yaml - flux-pro/kontext
# SourceImages array → single image_url
SourceImages:
  field: image_url
  firstOf: true

# image-hybrid.yaml - qwen/qwen-image
# ReferenceImages array → single image
ReferenceImages:
  field: image
  firstOf: true
```

**Usage:** Used when producer accepts collection but provider expects single item.

---

### 6. invert - Boolean Inversion

Flips boolean value for providers that use inverted logic.

**Syntax:**
```yaml
ProducerInput:
  field: provider_field
  invert: true
```

**Examples from YAML files:**

```yaml
# image-to-image.yaml - qwen/qwen-image-edit-2511 (replicate)
# EnableSafetyChecker (true=safe) → disable_safety_checker (true=unsafe)
EnableSafetyChecker:
  field: disable_safety_checker
  invert: true

# image-hybrid.yaml - qwen/qwen-image (replicate)
EnableSafetyChecker:
  field: disable_safety_checker
  invert: true
```

**Usage:** Used when Replicate models use `disable_safety_checker` instead of `enable_safety_checker`.

---

### 7. intToString - Integer to String Coercion

Converts integer to string for providers expecting string enum.

**Syntax:**
```yaml
ProducerInput:
  field: provider_field
  intToString: true
```

**Examples from YAML files:**

```yaml
# text-to-video.yaml - wan-v2-6/text-to-video (fal-ai)
Duration:
  field: duration
  intToString: true

# text-to-video.yaml - veo3-1 (fal-ai)
Duration:
  field: duration
  intToString: true

# image-to-video.yaml - veo3-1/image-to-video (fal-ai)
Duration:
  field: duration
  intToString: true

# image-to-video.yaml - kling-video-o1/image-to-video (fal-ai)
Duration:
  field: duration
  intToString: true

# reference-to-video.yaml - wan-v2-6/reference-to-video (fal-ai)
Duration:
  field: duration
  intToString: true
```

**Usage:** Used for FAL-AI video models (Wan, Veo, Kling) that expect duration as string enum ("5", "10", "15") instead of integer.

---

### 8. durationToFrames - Seconds to Frame Count

Converts duration in seconds to frame count based on fps.

**Syntax:**
```yaml
ProducerInput:
  field: provider_field
  durationToFrames:
    fps: 24
```

**Examples from YAML files:**

```yaml
# audio-to-video.yaml - infinitalk (fal-ai)
# Duration in seconds → num_frames (at 24fps)
Duration:
  field: num_frames
  durationToFrames:
    fps: 24

# text-to-talking-head.yaml - infinitalk-single-text (fal-ai)
# Duration in seconds → num_frames (at 24fps)
Duration:
  field: num_frames
  durationToFrames:
    fps: 24
```

**Usage:** Used for InfiniTalk models that expect `num_frames` (41-721 at 24fps) instead of duration in seconds.

---

## Producer Summary

### Image Producers (3)

| Producer | File | Models |
|----------|------|--------|
| **text-to-image** | `text-to-image/text-to-image.yaml` | 7 FAL-AI, 2 Replicate |
| **image-to-image** | `image-to-image/image-to-image.yaml` | 5 FAL-AI, 1 Replicate |
| **image-hybrid** | `image-hybrid/image-hybrid.yaml` | 5 Replicate |

### Video Producers (5)

| Producer | File | Models |
|----------|------|--------|
| **text-to-video** | `text-to-video/text-to-video.yaml` | 6 FAL-AI, 6 Replicate |
| **image-to-video** | `image-to-video/image-to-video.yaml` | 8 FAL-AI, 5 Replicate |
| **reference-to-video** | `reference-to-video/reference-to-video.yaml` | 2 FAL-AI |
| **audio-to-video** | `audio-to-video/audio-to-video.yaml` | 3 FAL-AI |
| **text-to-talking-head** | `text-to-talking-head/text-to-talking-head.yaml` | 2 FAL-AI |

### Audio Producers (3)

| Producer | File | Models |
|----------|------|--------|
| **text-to-speech** | `text-to-speech/text-to-speech.yaml` | 4 FAL-AI, 5 Replicate |
| **text-to-music** | `text-to-music/text-to-music.yaml` | 2 Replicate |
| **text-to-audio** | `text-to-audio/text-to-audio.yaml` | 1 Replicate |

---

## Transform Usage by Producer

| Producer | simple | transform | combine | conditional | firstOf | invert | intToString | durationToFrames |
|----------|--------|-----------|---------|-------------|---------|--------|-------------|------------------|
| text-to-image | ✓ | ✓ | ✓ | ✓ | | | | |
| image-to-image | ✓ | ✓ | | | ✓ | ✓ | | |
| image-hybrid | ✓ | ✓ | | ✓ | ✓ | ✓ | | |
| text-to-video | ✓ | ✓ | | | | | ✓ | |
| image-to-video | ✓ | | | | | | ✓ | |
| reference-to-video | ✓ | | | | | | ✓ | |
| audio-to-video | ✓ | | | | | | | ✓ |
| text-to-talking-head | ✓ | | | | | | | ✓ |
| text-to-speech | ✓ | ✓ | | | | | | |
| text-to-music | ✓ | | | | | | | |
| text-to-audio | ✓ | | | | | | | |

---

## TypeScript Type Definition

```typescript
type Condition = {
  input: string;
  equals?: unknown;
  notEmpty?: boolean;
  empty?: boolean;
};

type MappingTransform = {
  // Target field name
  field?: string;

  // Value transform lookup table
  transform?: Record<string, unknown>;

  // Combine multiple inputs
  combine?: {
    inputs: string[];
    table: Record<string, unknown>;
  };

  // Conditional inclusion
  conditional?: {
    when: Condition;
    then: MappingTransform | { field: string };
  };

  // Array to single element
  firstOf?: boolean;

  // Boolean inversion
  invert?: boolean;

  // Type coercion
  intToString?: boolean;

  // Duration/frame conversion
  durationToFrames?: { fps: number };
};

// Simple mapping: string (field rename)
// Complex mapping: MappingTransform object
type Mapping = string | MappingTransform;

type ProducerMappings = {
  [provider: string]: {
    [model: string]: {
      [producerInput: string]: Mapping;
    };
  };
};
```
