# Blueprint Patterns

This document provides some examples for what kind of blueprints can be created based on desired types of outputs. This is not a comprehensive list, as the users may have many different needs.

## Pattern Overview

| Pattern               | Use Case                        | Key Producers                                                     | Loop Structure                   |
| --------------------- | ------------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| **audio-only**        | Podcast, narration, audiobook   | Script, Audio                                                     | `segment`                        |
| **video-only**        | Video clips from prompts        | Script, VideoPrompt, Video                                        | `segment`                        |
| **image-only**        | Slideshow, image gallery        | Script, ImagePrompt, Image                                        | `segment.image`                  |
| **kenn-burns**        | Documentary with images + audio | Script, ImagePrompt, Image, Audio, Timeline                       | `segment.image`                  |
| **cut-scene-video**   | Full production with export     | Script, VideoPrompt, Video, Audio, Music, Timeline, VideoExporter | `segment`                        |
| **image-to-video**    | Flowing video from images       | FlowVideoPrompt, Image, ImageToVideo                              | `segment`, `image` (with offset) |
| **music-only**        | Background music generation     | Script, MusicPrompt, Music                                        | none                             |
| **condition-example** | Conditional branching           | Various with conditions                                           | `segment`                        |

---

## 1. Audio Only Generation

**Use when**: You need spoken audio without visuals (podcasts, audiobooks, voice-overs).

**Workflow**:

```
Narrative Producer → Narration Script (per segment) → AudioProducer[segment] → SegmentAudio
```

**Key inputs**: `InquiryPrompt`, `Duration`, `NumOfSegments`, `VoiceId`

**Outputs**: `SegmentAudio[]` - Array of audio files

**Example Blueprint location**: `catalog/blueprints/audio-only/audio-only.yaml`

---

### 2. Video Only Generation

**Use when**: You need AI-generated video clips without a secondary audio track, usually your video has audio in it and you don't necessarily need continuity between segments. Also demonstrates using a specialized video prompt generator per segment.

> IMPORTANT: You don't always need a specialized video prompt producers and it costs time and money.

**Workflow**:

```
Narrative Producer → NarrationScript[segment] → VideoPromptProducer[segment]
              → VideoPrompt[segment] → VideoProducer[segment] → SegmentVideo
```

**Key inputs**: `InquiryPrompt`, `Duration`, `NumOfSegments`, `Style`, `Resolution`, `AspectRatio`

**Outputs**: `SegmentVideo[]` - Array of video files

**Blueprint location**: `catalog/blueprints/video-only/video-only.yaml`

---

### 3. Image Only Generation

**Use when**: You need a series of images without audio (slide decks). Demonstrates using specialized image prompt producers.

> IMPORTANT: Having your narrative producer produce image prompts in one shot is cost effective, only use specialized image prompt producers if the image require very detailed prompts.

**Workflow**:

```
Narrative Producer → NarrationScript[segment] → ImagePromptProducer[segment]
              → ImagePrompt[segment][image] → ImageProducer[segment][image] → SegmentImage
```

**Loop structure**: Nested loops - `segment` contains `image`

**Key inputs**: `InquiryPrompt`, `Duration`, `NumOfSegments`, `NumOfImagesPerNarrative`, `Style`

**Outputs**: `SegmentImage[][]` - 2D array of images (segment × image)

**Blueprint location**: `catalog/blueprints/image-only/image-only.yaml`

---

### 4. Kenn Burns style (image-audio)

**Use when**: Documentary-style videos with Ken Burns effect on images plus audio narration. Great for slide shows and narrative-only documentaries. The audio narrative drives the presentation and you can select how many images to use per narrative segment.

**Workflow**:

```
Narrative Producer → NarrationScript[segment]
                                  ├→ ImagePromptProducer[segment] → ImageProducer[segment][image]
                                  └→ AudioProducer[segment]
                                      ↓
                              TimelineComposer (fan-in via connections) → Timeline
```

**Loop structure**: Nested loops - `segment` contains `image`

**Key inputs**: `InquiryPrompt`, `Duration`, `NumOfSegments`, `NumOfImagesPerNarrative`, `Style`, `VoiceId`

**Outputs**: `SegmentImage[][]`, `SegmentAudio[]`, `Timeline`

**Fan-in**: Grouping/ordering inferred from connection dimensions (or explicit edge metadata)

**Blueprint location**: `catalog/blueprints/kenn-burns/image-audio.yaml`

---

### 5. Video with Cut Scenes(video-audio-music)

**Use when**: Uses the movie cut scene techniques to produce video from video clips (with individual cut scenes), audio narration, music. Best for animated movies.

**Workflow**:

```
Narrative Producer → NarrationScript[segment]
                                  ├→ VideoPromptProducer[segment] → VideoProducer[segment]
                                  ├→ AudioProducer[segment]
                                  └→ MusicPromptProducer → MusicProducer
                                      ↓
                              TimelineComposer → Timeline → VideoExporter → FinalVideo
```

**Key inputs**: All video, audio, and music parameters

**Outputs**: `SegmentVideo[]`, `SegmentAudio[]`, `Music`, `Timeline`, `FinalVideo` (MP4)

**Blueprint location**: `catalog/blueprints/cut-scene-video/video-audio-music.yaml`

---

### 6. Video that flows from segment to segment.

**Use when**: Best for creating videos with seamless transitions between the clips, single shot movies where the full movie flows as if it is continuous shot.

**Workflow**:

```
Narrative Producer → ImagePrompts[], VideoPrompts[]
                                           ↓
                            ImageProducer[image] (N+1 images)
                                           ↓
                    ImageToVideoProducer[segment] (uses image[i] and image[i+1])
                                           ↓
                                     SegmentVideo
```

**Key feature**: Demonstrate the use `countInputOffset: 1` to generate N+1 images for N video segments. First image is the starting image of the full movie, and then the second image of first segment becomes the first image of the next segment to create an effect of continuity between segments.

**Offset connection pattern**:

```yaml
- from: ImageProducer[image].SegmentImage
  to: ImageToVideoProducer[segment].InputImage1
- from: ImageProducer[image+1].SegmentImage
  to: ImageToVideoProducer[segment].InputImage2
```

**Blueprint location**: `catalog/blueprints/image-to-video/image-to-video.yaml`

---

### 7. Video that has a mix of KennBurns effects and Video using Conditional Routing

**Use when** : Best for creating documentaries which has a mixture of image/audio narrative segments and video segments with people (experts etc.) providing important information mostly as a talking head.

**Key Feature**: Uses the conditional routing feature. The Narrative Generator creates (see `catalog/producers/documentary-talkinghead-prompt` as example) outputs that can be used as conditions on what producers to use depending on the condition

**Blueprint location**: `catalog/blueprints/documentary-talking-head/documentary-talking-head.yaml`

## Choosing a Pattern

The above examples demonstrates different types of movie generation based on needs. Those are just examples to demonstrate usage. You can create movies that are mix of those techniques or just adopt the technique most suitable for the user's desired output. The narrative producer and potential subsequent prompt generators need to be figured out based on the context of the movie to be produced, the examples are there just for illustrative purposes.

---
