# Requirement Gathering Examples

This reference provides detailed examples of how to analyze user requirements for different video types and translate them into blueprint structures.

## Example 1: Documentary with Talking Head

**User Prompt:**
> I want to build short documentary style videos. The video will optionally contain KenBurns style image transitions, video clips for richer presentation, optional video clips where an expert talks about some facts, a background audio narrative for the images and videos and a background music.

### Analysis

**Video Type:** Documentary with mixed media segments

**Artifact Types Identified:**
- Image generations (possibly multiple per segment) — for KenBurns style animation
- Video generations — for richer video depiction where KenBurns is insufficient
- Video generations with audio (Talking Head) — expert character giving facts/statements
- Background audio narrative — TTS-generated narration for image/video segments
- Background music — ambient music for the full video

**Timeline Composition:**
| Track | Type | Content |
|-------|------|---------|
| Track 1 | Audio | Background narration (plays only during image/video segments, not during talking head) |
| Track 2 | Video | Video clips and talking head videos |
| Track 3 | Image | Images with KenBurns effects |
| Track 4 | Music | Background music (full duration) |

**Director Role:**
The director prompt producer determines:
- The overall script and narrative arc
- Segment types (ImageNarration, VideoNarration, TalkingHead, MapNarration)
- Prompts for each media type in each segment
- Narration scripts for TTS generation
- A talking head character description
- Background music direction

**Required Inputs:**
- `InquiryPrompt` — The topic to research and create a documentary about
- `Duration` — Total video length (system input)
- `NumOfSegments` — Number of segments (system input)
- `NumOfImagesPerSegment` — Images per segment for KenBurns
- `Style` — Visual style (cinematic, photorealistic, etc.)

**Catalog Reference:** `catalog/blueprints/documentary-talkinghead`

---

## Example 2: Ad Video

**User Prompt:**
> I want to create Ad videos. We will have a character in various video clips using a product. The character and product shot should be generated. The ad should also have a background music. The video clips will have audio, so we want to be able to provide a written script to each one.

### Analysis

**Video Type:** Product advertisement with character-driven narrative

**Artifact Types Identified:**
- Character image generation — hero character used consistently across clips
- Product image generation — product shots for standalone display and reference
- Video clips with audio — character interacting with product (lipsync/scripted)
- Background music — tone-setting ambient music

**Timeline Composition:**
| Track | Type | Content |
|-------|------|---------|
| Track 1 | Video | Generated video clips (character + product) |
| Track 2 | Audio | Narration/voiceover |
| Track 3 | Music | Background music |

**Director Role:**
The director creates:
- Character image prompt (consistent appearance for all clips)
- Product image prompt (appealing product photography)
- Per-clip video prompts with action and camera work
- Per-clip narration scripts (optional per clip)
- Music direction

**Required Inputs:**
- `ProductDescription` — What the product is
- `CharacterDescription` — Who the spokesperson/character is
- `AdConcept` — The creative concept/angle
- `NumOfClips` — Number of video clips
- `Duration` — Total video length (system input)
- `Audience` — Target audience
- `Style` — Visual style

**Catalog Reference:** `catalog/blueprints/ads`

---

## Example 3: Flow Video (Continuous Sequence)

**User Prompt:**
> I want to create a video that flows from one scene to the next seamlessly. Each segment should continue from where the previous one ended. I want narration over the video and background music.

### Analysis

**Video Type:** Continuous-flow video with seamless transitions

**Artifact Types Identified:**
- Initial image — opening frame/scene
- Video segments — each starts from the last frame of the previous segment
- Narration audio — TTS for each segment
- Background music — single track for full duration

**Timeline Composition:**
| Track | Type | Content |
|-------|------|---------|
| Track 1 | Video | Continuous video segments (end-frame → start-frame chaining) |
| Track 2 | Audio | Per-segment narration |
| Track 3 | Music | Background music |

**Key Design Decision:** The system automatically uses the last frame of each video as the starting frame for the next, creating visual continuity. The director must design prompts so each segment naturally flows into the next.

**Required Inputs:**
- `InquiryPrompt` — The scenario/story
- `CameraStyle` — Camera movement preference (tracking, aerial, handheld)
- `VisualStyle` — Visual aesthetic
- `Duration` — Total video length (system input)
- `NumOfSegments` — Number of segments (system input)

**Catalog Reference:** `catalog/blueprints/flow-video`

---

## Example 4: Ken Burns Documentary

**User Prompt:**
> Create a historical documentary using static images with Ken Burns pan-and-zoom effects, narrated audio, and background music. Include text overlays for dates and locations.

### Analysis

**Video Type:** Image-based documentary with narration

**Artifact Types Identified:**
- Multiple images per segment — static images animated with KenBurns effects
- Narration audio — TTS-generated historical narration
- Text overlays — dates, locations, historical figure names
- Background music — era-appropriate instrumental

**Key Design Decision:** Pure image-based (no video generation), which is faster and cheaper. Text overlays add context without cluttering images.

**Required Inputs:**
- `InquiryPrompt` — The historical topic
- `Style` — Visual style (e.g., "oil painting", "vintage photograph")
- `Audience` — Target audience (affects vocabulary and depth)
- `Language` — Narration language
- `Duration`, `NumOfSegments`, `NumOfImagesPerSegment` — Structure controls

**Catalog Reference:** `catalog/blueprints/ken-burns-documentary`

---

## Example 5: Short Video Documentary with Cut Scenes

**User Prompt:**
> I want a short historical video with multiple camera angles and scene changes within each segment, like a proper film with cuts between shots.

### Analysis

**Video Type:** Cinematic documentary with internal cut-scenes

**Key Difference from Ken Burns:** Uses video generation with [cut] markers for dynamic multi-scene segments instead of static images.

**Artifact Types Identified:**
- Initial image — opening frame
- Video segments with [cut] scenes — each segment contains multiple camera angles/scenes
- Narration audio — per-segment TTS narration
- Background music — thematic instrumental

**Required Inputs:**
- `Topic` — The historical subject
- `CutScenesPerSegment` — Number of internal scenes per video segment
- `VisualStyle` — Cinematic style
- `NarratorTone` — Narration voice style (authoritative, conversational, etc.)
- `Duration`, `NumOfSegments` — Structure controls

**Catalog Reference:** `catalog/blueprints/short-video-documentary`

---

## Implicit Requirements Checklist

Every blueprint should include inputs for these user-configurable properties, even if the user doesn't explicitly mention them:

### Always Include
- **Duration** — Total video length in seconds (system input, don't declare)
- **NumOfSegments** — Segment count (system input, don't declare)
- **Style/VisualStyle** — Visual aesthetic (user input, always declare)
- **InquiryPrompt/Topic** — The core content direction (user input)

### Include When Applicable
- **Audience** — Target demographic (affects tone, vocabulary, content depth)
- **Language** — For multilingual narration support
- **CameraStyle** — When video generation is involved
- **NumOfImagesPerSegment** — When using KenBurns or image-based segments
- **AspectRatio** — When the user needs control (16:9, 9:16 for social media, 1:1)

### Never Declare as Inputs
These are system inputs — automatically available, never in the `inputs:` section:
- `Duration`
- `NumOfSegments`
- `SegmentDuration`
- `MovieId`
- `StorageRoot`
- `StorageBasePath`

They must still be wired in `connections:` where producers need them.
