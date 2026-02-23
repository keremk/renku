# Video Model Selection Guide

This guide helps you choose the right video generation model based on your specific requirements.

## Table of Contents

- [Quick Comparison Table](#quick-comparison-table)
- [Derived Video Artifacts](#derived-video-artifacts)
- [Model Deep Dives](#model-deep-dives)
- [Model by Producer](#model-by-producer)

---

## Quick Comparison Table

| Model | Provider | Audio | Duration | End Image | Resolution | Best For |
|-------|----------|-------|----------|-----------|------------|----------|
| **Veo 3.1** | fal-ai | Yes | 4-8s | Yes (fast) | 720p, 1080p | Cinematic with dialogue |
| **Sora 2** | fal-ai | No | Variable | No | Variable | Photorealistic scenes |
| **Seedance 1.5 Pro** | fal-ai/replicate | Yes | Variable | Yes | 720p, 1080p | Animation, stylized motion |
| **Seedance 1 Pro Fast** | fal-ai/replicate | No | Variable | No | 720p, 1080p | Quick animation |
| **Seedance 1 Lite** | replicate | No | Variable | No | 720p | Budget animation |
| **Kling o1** | fal-ai | No | Variable | Yes | Variable | Transitions, morphing |
| **Kling v2.6 Pro** | fal-ai | Yes | Variable | No | Variable | Quality with voice |
| **Hailuo 02/2.3** | replicate | No | Variable | Yes | Variable | Smooth interpolation |
| **WAN v2.6** | fal-ai | No | Variable | No | Variable | Multi-shot, references |

---

## Derived Video Artifacts

All video-generating producers automatically support **derived artifacts** that are extracted from the generated video using ffmpeg. These artifacts enable powerful workflows like video-to-video chaining.

### Available Derived Artifacts

| Artifact | Type | Description | Use Cases |
|----------|------|-------------|-----------|
| `FirstFrame` | image (PNG) | First frame of the video | Visual preview, thumbnails |
| `LastFrame` | image (PNG) | Last frame of the video | Seamless video transitions, end-frame matching |
| `AudioTrack` | audio (WAV) | Audio track from video | Audio post-processing, mixing |

### How It Works

1. **Declare** derived artifacts in your producer YAML (already included in catalog producers)
2. **Connect** them to downstream producers in your blueprint
3. **Automatic extraction** happens when the video is downloaded - only connected artifacts are extracted
4. **Graceful fallback** if ffmpeg is not installed, a warning is shown but the blueprint runs

### Example: Seamless Video Transitions

Chain videos together using the last frame of one video as the start image for the next:

```yaml
loops:
  - name: segment
    countInput: NumOfSegments

producers:
  - name: TextToVideoProducer
    producer: asset/text-to-video
  - name: ImageToVideoProducer
    producer: asset/image-to-video
    loop: segment

connections:
  # First segment: text-to-video
  - from: Prompt
    to: TextToVideoProducer.Prompt

  # Use LastFrame from first video as StartImage for transitions
  - from: TextToVideoProducer.LastFrame
    to: ImageToVideoProducer[0].StartImage

  # Chain subsequent segments using previous segment's LastFrame
  - from: ImageToVideoProducer[segment].LastFrame
    to: ImageToVideoProducer[segment+1].StartImage
```

### Requirements

- **ffmpeg** must be installed on the system for extraction to work
- If ffmpeg is missing, derived artifacts will be skipped (status: "skipped")
- The primary video artifact is always produced regardless of ffmpeg availability
- Install ffmpeg: https://ffmpeg.org/download.html

---

## Model Deep Dives

### Veo 3.1 (Google)

**Provider:** fal-ai
**ID:** `veo3.1`, `veo3.1/image-to-video`, `veo3.1/fast/image-to-video`, `veo3.1/reference-to-video`, `veo3.1/first-last-frame-to-video`, `veo3.1/fast/first-last-frame-to-video`, `veo3.1/extend-video`, `veo3.1/fast/extend-video`

**Strengths:**
- Native audio generation (dialogue, ambient sounds)
- High visual quality
- Good prompt adherence
- Auto-fix for content policy issues

**Limitations:**
- Duration: 4s, 6s, or 8s only
- Resolution: 720p or 1080p

**Best for:**
- Cinematic scenes with dialogue
- Videos that need synchronized sound
- High-quality short clips

**Key inputs:**
- `GenerateAudio: true` - Enable audio generation
- `EnhancePrompt` (maps to `auto_fix`) - Fix content policy issues
- `Duration` - Must be "4s", "6s", or "8s"

---

### Seedance (ByteDance)

**Provider:** fal-ai, replicate
**Versions:**
- `bytedance/seedance/v1.5/pro` - Full quality with audio
- `bytedance/seedance/v1/pro/fast` - Faster, no audio
- `bytedance/seedance-1-lite` (replicate only) - Budget option

**Strengths:**
- Animation and stylized motion
- Good for character movement
- End image support (v1.5)
- Audio generation (v1.5 Pro)
- Camera control

**Limitations:**
- Style tends toward animation
- Less photorealistic than Veo

**Best for:**
- Animated content
- Stylized motion sequences
- Cut scene generation
- Character animations

**Key inputs:**
- `CameraFixed: true` - Lock camera position
- `GenerateAudio: true` - Enable audio (v1.5 Pro only)
- `EndImage` - Target frame for interpolation

---

### Kling (Kuaishou)

**Provider:** fal-ai, replicate
**Versions:**
- `kling-video/v3/standard` and `kling-video/v3/pro` - Latest, multi-shot capable
- `kling-video/o3/standard` and `kling-video/o3/pro` - Elements system, references
- `kling-video/o1/image-to-video` - Supports end image (kling-multishot only)
- `kling-video/v2.6/pro/image-to-video` - Audio generation
- `kling-video/v2.5-turbo/pro/image-to-video` - End image support
- Replicate: `kwaivgi/kling-v3-video`, `kwaivgi/kling-v3-omni-video`, `kwaivgi/kling-o1`, `kwaivgi/kling-v2-6`, `kwaivgi/kling-v2-5-turbo-pro`, `kwaivgi/kling-avatar-v2`

**Strengths:**
- Excellent motion quality
- Multi-shot with per-shot prompts (V3, O3)
- Elements system for structured character references (O3)
- Voice ID support for speech in video
- End image interpolation

**Best for:**
- Multi-shot narratives with per-shot control
- Consistent character references via elements
- Voice-integrated video generation
- Smooth transitions between frames

**Key inputs:**
- `MultiPrompt` - Per-shot prompts (kling-multishot)
- `Elements` - Structured character references (kling-multishot)
- `VoiceIds` - Speech in video (kling-multishot)
- `EndImage` - For interpolation

---

### Hailuo (MiniMax)

**Provider:** replicate
**Versions:**
- `minimax/hailuo-2.3` / `minimax/hailuo-2.3-fast` - Latest
- `minimax/hailuo-02` / `minimax/hailuo-02-fast` - With interpolation

**Strengths:**
- Good frame-to-frame interpolation
- Prompt optimizer for enhancement
- Multiple speed/quality tradeoffs

**Best for:**
- Smooth transitions between frames
- Interpolation tasks
- When end image is important

**Key inputs:**
- `EnhancePrompt` (maps to `prompt_optimizer`) - Enhance prompts
- `EndImage` - Target frame (hailuo-02 versions)

---

### WAN v2.6

**Provider:** fal-ai
**ID:** `wan/v2.6/text-to-video`, `wan/v2.6/image-to-video`, `wan/v2.6/reference-to-video`

**Strengths:**
- Multi-shot segmentation
- Reference video support
- Prompt expansion
- Background audio URL support

**Best for:**
- Consistent subject across multiple shots
- Using reference videos for style
- Complex multi-shot sequences

**Key inputs:**
- `MultiShots: true` - Enable multi-shot mode
- `EnhancePrompt` (maps to `enable_prompt_expansion`)
- `AudioUrl` - Background audio (text-to-video only)
- `ReferenceVideos` - For reference-to-video producer

---

### Sora 2 (OpenAI)

**Provider:** fal-ai, replicate
**ID:** `sora-2/text-to-video`, `sora-2/image-to-video`

**Strengths:**
- High photorealism
- Good physics understanding
- Coherent motion

**Best for:**
- Realistic scenes
- Real-world physics
- Photorealistic output

**Note:** Replicate version uses different field names (`seconds` instead of `duration`, aspect ratio transforms to `landscape`/`portrait`)

---

### Talking Head Models

#### Creatify Aurora
**Provider:** fal-ai
**Producer:** talking-head.yaml

**Strengths:**
- Full guidance control
- Audio and text guidance scales

**Key inputs:**
- `GuidanceScale` - Text guidance strength
- `AudioGuidanceScale` - Audio adherence

#### VEED Fabric 1.0
**Provider:** fal-ai
**Versions:** `veed/fabric-1.0/fast` (audio), `veed/fabric-1.0/text` (text)

**Strengths:**
- Simple API
- Text-to-talking-head integration
- Voice description support

#### InfiniTalk
**Provider:** fal-ai
**ID:** `infinitalk`, `infinitalk/single-text`

**Strengths:**
- Voice ID support
- Duration control via frames
- Acceleration options

**Key inputs:**
- `Acceleration` - "none", "regular", "high"
- `Duration` - Converted to frames at 24fps

---

## Model by Producer

### text-to-video.yaml

| Model | Provider | Audio |
|-------|----------|-------|
| `wan/v2.6/text-to-video` | fal-ai | Via URL |
| `wan-25-preview/text-to-video` | fal-ai | No |
| `veo3.1` | fal-ai | Yes |
| `veo3.1/fast` | fal-ai | Yes |
| `sora-2/text-to-video` | fal-ai | No |
| `bytedance/seedance/v1.5/pro/text-to-video` | fal-ai | Yes |
| `bytedance/seedance/v1/pro/fast/text-to-video` | fal-ai | No |
| `xai/grok-imagine-video/text-to-video` | fal-ai | No |
| `ltx-2-19b/distilled/text-to-video` | fal-ai | Yes |
| `kling-video/v3/standard/text-to-video` | fal-ai | Yes |
| `kling-video/v3/pro/text-to-video` | fal-ai | Yes |
| `bytedance/seedance-1.5-pro` | replicate | Yes |
| `bytedance/seedance-1-pro-fast` | replicate | No |
| `bytedance/seedance-1-lite` | replicate | No |
| `google/veo-3.1-fast` | replicate | Yes |
| `minimax/hailuo-2.3` | replicate | No |
| `openai/sora-2` | replicate | No |
| `pixverse/pixverse-v5-6` | replicate | Yes |
| `runwayml/gen-4-5` | replicate | No |
| `xai/grok-imagine-video` | replicate | No |
| `kwaivgi/kling-v3-video` | replicate | Yes |
| `kwaivgi/kling-v2-6` | replicate | Yes |

### image-to-video.yaml

| Model | Provider | End Image | Audio |
|-------|----------|-----------|-------|
| `veo3.1/image-to-video` | fal-ai | No | Yes |
| `veo3.1/fast/image-to-video` | fal-ai | No | Yes |
| `sora-2/image-to-video` | fal-ai | No | No |
| `sora-2/image-to-video/pro` | fal-ai | No | No |
| `wan/v2.6/image-to-video` | fal-ai | No | No |
| `wan/v2.6/image-to-video/flash` | fal-ai | No | No |
| `wan-25-preview/image-to-video` | fal-ai | No | No |
| `bytedance/seedance/v1/pro/fast/image-to-video` | fal-ai | No | No |
| `bytedance/seedance/v1.5/pro/image-to-video` | fal-ai | Yes | Yes |
| `xai/grok-imagine-video/image-to-video` | fal-ai | No | No |
| `ltx-2-19b/distilled/image-to-video` | fal-ai | No | Yes |
| `kling-video/v2.5-turbo/pro/image-to-video` | fal-ai | Yes | No |
| `kling-video/v2.6/pro/image-to-video` | fal-ai | No | Yes |
| `kling-video/v3/standard/image-to-video` | fal-ai | No | No |
| `kling-video/v3/pro/image-to-video` | fal-ai | No | No |
| `google/veo-3.1-fast` | replicate | Yes | Yes |
| `minimax/hailuo-02` | replicate | Yes | No |
| `minimax/hailuo-02-fast` | replicate | Yes | No |
| `minimax/hailuo-2.3` | replicate | No | No |
| `minimax/hailuo-2.3-fast` | replicate | No | No |
| `bytedance/seedance-1.5-pro` | replicate | Yes | Yes |
| `bytedance/seedance-1-pro-fast` | replicate | No | No |
| `pixverse/pixverse-v5-6` | replicate | Yes | Yes |
| `runwayml/gen-4-5` | replicate | No | No |
| `xai/grok-imagine-video` | replicate | No | No |
| `kwaivgi/kling-v2-5-turbo-pro` | replicate | Yes | No |
| `kwaivgi/kling-v2-6` | replicate | No | Yes |
| `kwaivgi/kling-v3-video` | replicate | Yes | Yes |

### start-end-frame-to-video.yaml

| Model | Provider | Notes |
|-------|----------|-------|
| `veo3.1/first-last-frame-to-video` | fal-ai | Audio, both frames required |
| `veo3.1/fast/first-last-frame-to-video` | fal-ai | Audio, both frames required |
| `bytedance/seedance/v1.5/pro/image-to-video` | fal-ai | Audio, end_image_url |
| `ltx-2-19b/distilled/image-to-video` | fal-ai | Audio, end_image_url |
| `kling-video/v2.5-turbo/pro/image-to-video` | fal-ai | tail_image_url |
| `google/veo-3.1-fast` | replicate | Audio, last_frame |
| `minimax/hailuo-02` | replicate | last_frame_image |
| `minimax/hailuo-02-fast` | replicate | last_frame_image |
| `bytedance/seedance-1.5-pro` | replicate | Audio, last_frame_image |
| `pixverse/pixverse-v5-6` | replicate | Audio, last_frame_image |
| `kwaivgi/kling-v2-5-turbo-pro` | replicate | end_image |
| `kwaivgi/kling-v3-video` | replicate | Audio, end_image |

### talking-head.yaml

| Model | Provider | Notes |
|-------|----------|-------|
| `creatify/aurora` | fal-ai | Full guidance control |
| `veed/fabric-1.0/fast` | fal-ai | Simple, fast |
| `infinitalk` | fal-ai | Duration in frames (24fps) |
| `bytedance/omnihuman/v1.5` | fal-ai | High quality |
| `kling-video/ai-avatar/v2/standard` | fal-ai | Kling avatar |
| `kling-video/ai-avatar/v2/pro` | fal-ai | Kling avatar pro |
| `ltx-2-19b/audio-to-video` | fal-ai | Audio + optional image |
| `ltx-2-19b/distilled/audio-to-video` | fal-ai | Audio + optional image |
| `kwaivgi/kling-avatar-v2` | replicate | Kling avatar |
| `wavespeed-ai/infinitetalk` | wavespeed-ai | InfiniTalk |

### text-to-talking-head.yaml

| Model | Provider | Notes |
|-------|----------|-------|
| `veed/fabric-1.0/text` | fal-ai | Voice description |
| `infinitalk/single-text` | fal-ai | Voice ID, acceleration |

### kling-multishot.yaml

| Model | Provider | Mode | Notes |
|-------|----------|------|-------|
| `kling-video/v3/standard/text-to-video` | fal-ai | t2v | Multi-prompt, voice IDs |
| `kling-video/v3/pro/text-to-video` | fal-ai | t2v | Multi-prompt, voice IDs |
| `kling-video/o3/standard/text-to-video` | fal-ai | t2v | Multi-prompt, voice IDs |
| `kling-video/v3/standard/image-to-video` | fal-ai | i2v | Element-based |
| `kling-video/v3/pro/image-to-video` | fal-ai | i2v | Element-based |
| `kling-video/o1/image-to-video` | fal-ai | i2v | Start + end image |
| `kling-video/o3/standard/image-to-video` | fal-ai | i2v | Multi-prompt |
| `kling-video/o3/pro/image-to-video` | fal-ai | i2v | Multi-prompt |
| `kling-video/o1/reference-to-video` | fal-ai | ref | Reference images |
| `kling-video/o1/standard/reference-to-video` | fal-ai | ref | Reference images |
| `kling-video/o3/standard/reference-to-video` | fal-ai | ref | Elements, multi-prompt |
| `kling-video/o3/pro/reference-to-video` | fal-ai | ref | Elements, multi-prompt |
| `kling-video/o3/standard/video-to-video-reference` | fal-ai | v2v | Elements, keep audio |
| `kling-video/o3/pro/video-to-video-reference` | fal-ai | v2v | Elements, keep audio |
| `kwaivgi/kling-o1` | replicate | multi | Reference images/video |
| `kwaivgi/kling-v3-video` | replicate | multi | Multi-prompt, end image |
| `kwaivgi/kling-v3-omni-video` | replicate | multi | Full: multi-prompt, refs, end image |

### video-to-video.yaml

| Model | Provider | Notes |
|-------|----------|-------|
| `xai/grok-imagine-video/edit-video` | fal-ai | Video editing |
| `ltx-2-19b/distilled/extend-video` | fal-ai | Extend video |
| `ltx-2-19b/distilled/video-to-video` | fal-ai | Transform video |
| `veo3.1/extend-video` | fal-ai | Extend, audio |
| `veo3.1/fast/extend-video` | fal-ai | Fast extend, audio |
| `xai/grok-imagine-video` | replicate | Video editing |

### ref-image-to-video.yaml

| Model | Provider | Notes |
|-------|----------|-------|
| `veo3.1/reference-to-video` | fal-ai | Image references, audio |
| `bytedance/seedance-1-lite` | replicate | Reference images |

### ref-video-to-video.yaml

| Model | Provider | Notes |
|-------|----------|-------|
| `wan/v2.6/reference-to-video` | fal-ai | Video references |
| `wan/v2.6/reference-to-video/flash` | fal-ai | Video references, fast |

### video-lipsync.yaml

| Model | Provider | Notes |
|-------|----------|-------|
| `pixverse/lipsync` | fal-ai | Audio or text input |

### video-upscale.yaml

| Model | Provider | Notes |
|-------|----------|-------|
| `wavespeed-ai/video-upscaler-pro` | wavespeed-ai | Resolution upscaling |

### motion-transfer.yaml

| Model | Provider | Notes |
|-------|----------|-------|
| `bytedance/dreamactor/v2` | fal-ai | Motion from driving video |
