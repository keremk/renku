# Timeline Composer Configuration Reference

The Timeline Composer assembles media tracks (video, audio, images, music, text) into an OrderedTimeline JSON manifest that the VideoExporter renders into a final video file. It is declared as a producer using `composition/timeline-composer` from the catalog and configured entirely through the model config in the input template.

---

## Declaring the Timeline Composer

In the blueprint `producers:` section:

```yaml
producers:
  - name: TimelineComposer
    producer: composition/timeline-composer
```

The composer runs once (no `loop:`) and receives all segment media via fan-in inputs.

In the input template `models:` section:

```yaml
- model: timeline/ordered
  provider: renku
  producerId: TimelineComposer
  config:
    timeline:
      tracks: [...]
      masterTracks: [...]
      videoClip: { ... }
      audioClip: { ... }
      # ... additional clip configs
```

All timeline configuration lives under `config.timeline`.

---

## Track Types

The `tracks` array lists the track names the timeline will contain. Each name maps to a clip config block that tells the composer which fan-in artifact to pull from and how to configure clips on that track.

| Track Kind     | Clip Config Key      | Fan-In Input        | Dimensions       | Description                                  |
| -------------- | -------------------- | ------------------- | ---------------- | -------------------------------------------- |
| Video          | `videoClip`          | `VideoSegments`     | `segment`        | Video clips sequenced per segment            |
| Audio          | `audioClip`          | `AudioSegments`     | `segment`        | Narration/speech audio per segment           |
| Image          | `imageClip`          | `ImageSegments`     | `segment.image`  | Images displayed per segment (Ken Burns etc) |
| Music          | `musicClip`          | `Music`             | scalar           | Background music looped/trimmed to duration  |
| Text           | `textClip`           | `TextSegments`      | `segment`        | Text overlays per segment                    |
| Transcription  | `transcriptionClip`  | `TranscriptionAudio`| `segment`        | Audio for speech-to-text alignment           |

Only include track names for media your blueprint actually produces. Listing a track that has no corresponding fan-in connection causes the composer to receive empty data for that track.

---

## masterTracks Configuration

`masterTracks` controls which tracks determine segment timing. The composer uses these tracks to set clip durations and align other tracks.

```yaml
masterTracks: ["Audio"]          # Audio-driven timing (narration paces the video)
masterTracks: ["Video"]          # Video-driven timing (video clip durations rule)
masterTracks: ["Audio", "Video"] # Both contribute to segment timing
```

Common patterns:
- **Narrated documentary**: `masterTracks: ["Audio"]` -- narration audio sets the pace; video clips stretch or trim to match.
- **Music video / ads**: `masterTracks: ["Video"]` -- video clip durations rule; audio is layered on top.
- **Video + narration sync**: `masterTracks: ["Audio", "Video"]` -- both constrain timing.

---

## Clip Configuration

Each clip config block maps a fan-in artifact to a track and optionally sets track-level properties.

### videoClip

```yaml
videoClip:
  artifact: VideoSegments    # Must match the fan-in input name
```

The artifact value refers to the TimelineComposer input name that receives the video fan-in.

### audioClip

```yaml
audioClip:
  artifact: AudioSegments
  volume: 0.9               # Optional, 0.0-1.0 (default 1.0)
```

### imageClip

```yaml
imageClip:
  artifact: "ImageSegments[Image]"   # Bracket suffix names the track
```

For 2D fan-in (segment.image), the bracket suffix `[Image]` becomes the track display name. The images are grouped by segment and ordered by the image dimension within each segment.

### musicClip

```yaml
musicClip:
  artifact: Music
  volume: 0.3               # Typically lower for background music
```

Music is a scalar fan-in (single audio file). The composer loops or trims it to match the total duration.

### textClip

```yaml
textClip:
  artifact: TextSegments
  effect: "fade-in-out"      # Optional text animation effect
```

### transcriptionClip

```yaml
transcriptionClip:
  artifact: TranscriptionAudio
```

The transcription track carries audio clips that the TranscriptionProducer later uses for word-level speech-to-text alignment. See the Transcription/Karaoke section below.

---

## Fan-In Connections

The TimelineComposer's inputs are all marked `fanIn: true` in the producer YAML. You wire looped artifacts into them via blueprint connections. The planner infers fan-in descriptors automatically.

### Single-dimension fan-in (video, audio, text)

```yaml
connections:
  - from: VideoProducer[segment].SegmentVideo
    to: TimelineComposer.VideoSegments
  - from: AudioProducer[segment].SegmentAudio
    to: TimelineComposer.AudioSegments
```

The segment dimension groups clips in order. The composer receives an array of artifacts sorted by segment index.

### Two-dimension fan-in (images)

```yaml
connections:
  - from: ImageProducer[segment][image].GeneratedImage
    to: TimelineComposer.ImageSegments
```

Two dimensions produce a nested array: groups of images per segment, ordered by the image index within each group. The `ImageSegments` input declares `dimensions: segment.image`.

### Scalar fan-in (music)

```yaml
connections:
  - from: MusicProducer.GeneratedMusic
    to: TimelineComposer.Music
```

A single artifact is collected into a singleton fan-in group.

### Duration wiring

Always wire the Duration system input:

```yaml
connections:
  - from: Duration
    to: TimelineComposer.Duration
```

---

## Export Configuration

The VideoExporter renders the timeline into a final MP4. Its model config controls video output settings:

```yaml
- model: ffmpeg/native-render
  provider: renku
  producerId: VideoExporter
  config:
    subtitles:       # Optional, only if transcription is wired
      font: "Arial"
      fontSize: 48
      fontBaseColor: "#FFFFFF"
      fontHighlightColor: "#FFD700"
      backgroundColor: "#000000"
      backgroundOpacity: 0.5
      maxWordsPerLine: 4
      highlightEffect: true
```

The video dimensions (width, height) and fps can also be specified in a separate export config YAML passed to `renku export --inputs=./export-config.yaml`. See the transcription-karaoke-guide for the full options table.

---

## Transcription and Karaoke Integration

To add karaoke-style subtitles to a video workflow:

1. **Add "Transcription" to `tracks`** in the TimelineComposer config.
2. **Add `transcriptionClip`** pointing to the `TranscriptionAudio` fan-in input.
3. **Wire audio into `TranscriptionAudio`** -- connect the same (or appropriate) audio artifacts that carry speech.
4. **Add TranscriptionProducer and VideoExporter** to the blueprint producers.
5. **Wire the chain**: `TimelineComposer.Timeline -> TranscriptionProducer.Timeline`, `TranscriptionProducer.Transcription -> VideoExporter.Transcription`.

```yaml
# Blueprint connections for transcription
- from: AudioProducer[segment].SegmentAudio
  to: TimelineComposer.TranscriptionAudio
- from: TimelineComposer.Timeline
  to: TranscriptionProducer.Timeline
- from: TranscriptionProducer.Transcription
  to: VideoExporter.Transcription
```

For lipsync/talking-head workflows, use the video producer's derived `AudioTrack` artifact instead of the original narration audio:

```yaml
- from: LipsyncVideoProducer[segment].AudioTrack
  to: TimelineComposer.TranscriptionAudio
```

This ensures transcription timing matches the actual video, not the original narration audio which may differ in duration.

---

## Common Patterns

### Audio-only timeline (narration + music)

```yaml
config:
  timeline:
    tracks: ["Audio", "Music"]
    masterTracks: ["Audio"]
    audioClip:
      artifact: AudioSegments
    musicClip:
      artifact: Music
      volume: 0.3
```

### Video + narration (documentary)

```yaml
config:
  timeline:
    tracks: ["Video", "Audio", "Music", "Transcription"]
    masterTracks: ["Audio", "Video"]
    videoClip:
      artifact: VideoSegments
    audioClip:
      artifact: AudioSegments
    musicClip:
      artifact: Music
      volume: 0.25
    transcriptionClip:
      artifact: TranscriptionAudio
```

### Image slideshow (Ken Burns)

```yaml
config:
  timeline:
    tracks: ["Image", "Audio", "Text", "Transcription", "Music"]
    masterTracks: ["Audio"]
    imageClip:
      artifact: "ImageSegments[Image]"
    audioClip:
      artifact: AudioSegments
      volume: 0.9
    textClip:
      artifact: TextSegments
      effect: "fade-in-out"
    transcriptionClip:
      artifact: TranscriptionAudio
    musicClip:
      artifact: Music
      volume: 0.3
```

### Video-driven ads (no narration master)

```yaml
config:
  timeline:
    tracks: ["Video", "Audio", "Music"]
    masterTracks: ["Video"]
    videoClip:
      artifact: VideoSegments
    audioClip:
      artifact: AudioSegments
    musicClip:
      artifact: Music
      volume: 0.3
```

### Talking-head with transcription (video as master)

```yaml
config:
  timeline:
    tracks: ["Video", "Transcription"]
    masterTracks: ["Video"]
    videoClip:
      artifact: VideoSegments
    transcriptionClip:
      artifact: TranscriptionAudio
```

---

## Common Mistakes

### 1. Routing audio as a separate track when it is embedded in video

When using talking-head or lipsync video producers, the audio is baked into the video. Do NOT add a separate Audio track for the same narration audio -- it will play twice. Instead, rely on the video track for audio and only use the Transcription track for subtitle alignment.

### 2. Wrong fan-in dimensions

The `ImageSegments` input expects `dimensions: segment.image` (2D). Connecting a single-dimension source like `ImageProducer[segment].GeneratedImage` works for 1D image collections but won't fill a 2D layout. Match the producer loop assignment to the input's declared dimensions.

### 3. Missing Duration connection

The TimelineComposer needs `Duration` to calculate total timeline length. Always wire it:

```yaml
- from: Duration
  to: TimelineComposer.Duration
```

### 4. Listing a track without a clip config

If you put `"Music"` in `tracks` but omit `musicClip`, the track will be empty. Every entry in `tracks` should have a corresponding clip config block and a fan-in connection.

### 5. Forgetting transcriptionClip when using Transcription track

Adding `"Transcription"` to `tracks` is not enough. You must also add `transcriptionClip: { artifact: TranscriptionAudio }` and wire audio into `TimelineComposer.TranscriptionAudio` in the blueprint connections.

### 6. Using original narration audio for lipsync transcription

In lipsync workflows, the video producer may alter audio timing. Always use the derived `AudioTrack` artifact from the video producer for `TranscriptionAudio`, not the original narration audio. See the Transcription section above.
