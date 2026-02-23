# Video Producer Selection Guide

This guide helps you choose the right video producer based on your input materials and desired output. There are 12 video producers, each designed for a specific input/output contract.

## Decision Tree

```
What is your starting material?

├── TEXT ONLY (no images, no audio, no video)
│   └── text-to-video
│       Simple text-to-video generation with full creative freedom.
│
├── IMAGE(S)
│   ├── One image + want to animate it into video?
│   │   ├── Do you REQUIRE a specific end frame?
│   │   │   ├── YES → start-end-frame-to-video
│   │   │   │         Both start and end frames are required and guaranteed.
│   │   │   └── NO  → image-to-video
│   │   │             EndImage is optional; some models support it, some don't.
│   │   │
│   │   └── Need Kling multi-shot, elements, or per-shot prompts?
│   │       └── kling-multishot
│   │
│   ├── Reference images for subject consistency (NOT first frame)?
│   │   └── ref-image-to-video
│   │       Reference images guide appearance without constraining camera/composition.
│   │
│   └── Character image + audio for lip-sync?
│       ├── Have audio file → talking-head
│       └── Have text only  → text-to-talking-head
│
├── VIDEO
│   ├── Transform, edit, or extend existing video?
│   │   └── video-to-video
│   │
│   ├── Apply lip-sync to existing video?
│   │   └── video-lipsync
│   │
│   ├── Transfer motion from driving video to character image?
│   │   └── motion-transfer
│   │
│   ├── Reference videos for subject consistency?
│   │   └── ref-video-to-video
│   │
│   └── Upscale video resolution?
│       └── video-upscale
│
└── KLING ADVANCED (multi-shot, elements, voice IDs)
    └── kling-multishot
        Per-shot prompts, structured character elements, voice control.
```

## Quick Reference Table

| Producer | ID | Required Inputs | Optional Inputs | Best For |
|----------|-----|-----------------|-----------------|----------|
| **text-to-video** | `TextToVideoProducer` | Prompt | Duration, AspectRatio, Resolution, GenerateAudio, AudioUrl | Full creative freedom, no visual source |
| **image-to-video** | `ImageToVideoProducer` | Prompt, StartImage | NegativePrompt, EndImage, Duration, AspectRatio, Resolution, GenerateAudio | Animating a starting image |
| **start-end-frame-to-video** | `StartEndFrameToVideoProducer` | Prompt, StartImage, EndImage | Duration, AspectRatio, Resolution, GenerateAudio | Guaranteed interpolation between two frames |
| **talking-head** | `TalkingHeadProducer` | CharacterImage, AudioUrl | Prompt, Duration, Resolution, AspectRatio | Lip-synced avatar from audio |
| **text-to-talking-head** | `TextToTalkingHeadProducer` | CharacterImage, NarrativeText | Prompt, VoiceId, VoiceDescription, Duration, Resolution | Talking head with built-in TTS |
| **kling-multishot** | `KlingMultishotProducer` | Prompt | MultiPrompt, StartImage, EndImage, Elements, ReferenceImages, ReferenceVideo, Duration, AspectRatio, GenerateAudio, VoiceIds, ShotType, KeepAudio | Multi-shot, elements, voice control |
| **video-to-video** | `VideoToVideoProducer` | Prompt, SourceVideo | Duration, AspectRatio, Resolution, GenerateAudio | Transform/edit/extend existing video |
| **ref-image-to-video** | `ReferenceToVideoProducer` | Prompt, ReferenceImages | Duration, AspectRatio, Resolution, GenerateAudio | Consistent subjects across clips |
| **ref-video-to-video** | `RefVideoToVideoProducer` | Prompt, ReferenceVideos | Duration, AspectRatio, Resolution, GenerateAudio | Subject consistency via video references |
| **video-lipsync** | `VideoLipsyncProducer` | SourceVideo | AudioUrl, Text, VoiceId | Change speech in existing video |
| **video-upscale** | `VideoUpscaleProducer` | SourceVideo | TargetResolution | Post-processing resolution enhancement |
| **motion-transfer** | `MotionTransferProducer` | CharacterImage, DrivingVideo | TrimFirstSecond | Transfer motion from video to image |

## Key Differentiation Rules

### image-to-video vs start-end-frame-to-video

- **image-to-video**: EndImage is *optional*. Some models support it, some silently ignore it. Use when you have a start image and *might* want an end image.
- **start-end-frame-to-video**: EndImage is *required*. Every listed model genuinely supports both frames. Use when you *need guaranteed* interpolation between two specific images.

### talking-head vs text-to-talking-head vs video-lipsync

- **talking-head**: Input is *image + audio file*. The model generates video of the character speaking in sync with the audio.
- **text-to-talking-head**: Input is *image + text*. The model handles TTS internally and generates the talking-head video in one step.
- **video-lipsync**: Input is *existing video + audio/text*. The model modifies an existing video to sync lips to new audio. No new video generation — just lip modification.

### kling-multishot vs generic producers

- **kling-multishot**: Use when you need Kling-specific advanced features: multi_prompt (per-shot control), elements (structured character references), voice_ids, shot_type. Only Kling O1/O3/V3 family.
- **text-to-video / image-to-video**: Use for simple single-prompt generation. Kling V3 models appear in both — use the generic producer for simple use cases, kling-multishot for advanced control.
- Kling O1 and O3 models appear *only* in kling-multishot (not in generic producers).

### ref-image-to-video vs image-to-video

- **ref-image-to-video**: Reference images guide *subject appearance* across clips. The image is NOT the first frame — it's a reference for what subjects should look like.
- **image-to-video**: The StartImage IS the first frame of the video. It constrains the starting visual directly.

### video-to-video vs video-lipsync vs motion-transfer

- **video-to-video**: Transform, edit, or extend a video clip. General-purpose video modification.
- **video-lipsync**: Specifically for changing speech/lip movements in an existing video.
- **motion-transfer**: Transfer motion/expressions from a driving video onto a character image. Output is a new video of the character performing the motions.
