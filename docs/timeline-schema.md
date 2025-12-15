# TimelineProducer
- TimelineProducer generates timelines that are used by ReMotion to compose movies from individual tracks and clips within those tracks.
- There can be any number of tracks. Each track has number and unique-id. Tracks contain clips of the same kind and never contain clips of different kinds.
- There are some built-in clip kinds. These are implemented as ReMotion components. As more different clip types are implemented, these will be available to be used in the timeline
    - Image - backed by PNG or JPG assets.
    - Video - backed by MP4 assets.
    - Audio - backed by MP3 assets.
    - Music - backed by MP3 assets.
    - Captions - backed by text.

## Configuration
TimelineProducer is configured using the YAML blueprint surface defined in `core/docs/yaml-blueprint-spec.md`. See `catalog/producers/timeline-composer/timeline-composer.yaml` for the canonical module.

## Composition
- Timeline uses an *extensible* list of algorithms to automatically compose a timeline from tracks and clips using inputs (artifacts/assets, inputs). Currently the only composition algorithm is OrderedTimeline.

### OrderedTimeline
Simple composition. Essentially starts all clips in time=0 in their configured tracks and then stitches all of them one after the other in their indexed order. 
- Each artifact kind is laid out on its own track. 
- They follow a simple sequential order matching each others indices on the lineup unless specified otherwise.
- One or more clips can specify that they span the full duration of the movie. 
- One track declares its clips as the master for setting durations for all the other clips and all other clips in other tracks aligned to that duration, unless they explicitly said their duration should span the whole video.

In the YAML module configuration, the `model` is set to OrderedTimeline. See example:
```yaml
producers:
  - name: TimelineProducer
    provider: Renku
    model: OrderedTimeline
```

*Example 1*
ImageClip[0] has Image[0][0] and Image[0][1] as assets (Clip is configured to have all Images under Image[0]) ImageClip has no inherent duration, it should always match others.
ImageClip[1] has Image[1][0] and Image[1][1] as assets (Clip is configured to have all Images under Image[1]) 
AudioClip[0] has Audio[0] as asset. Audio[0] has an inherent duration0 as it is an audio clip
AudioClip[1] has Audio[1] as asset. Audio[1] has an inherent duration1 as it is an audio clip
MusicClip[0] has Music[0] as asset. Music[0] has an inherent duration, and MusicClip[0] declares that it should span the whole movie duration.
Track[0] -> ImageClip
Track[1] -> AudioClip -> Marked as master
Track[2] -> MusicClip
So in this case:
- ImageClip[0] assumes the duration of AudioClip[0], and ImageClip[1] assumes the duration of AudioClip[1]. Depending on the effect, ImageClip decides in what duration and timing to display its asset images
    - In KennBurns case, it will split the duration into the # of images to be displayed and apply KennBurns effect to each image for the divided duration.
- AudioClip[0] and AudioClip[1] are in master track so their durations are preserved, and ImageClip[0] and ImageClip[1] matches their durations.
- MusicClip[0] spans the full duration, and will clip if it exceeds that duration.

*Example 2*
VideoClip[0] has Video[0]. Video[0] duration is 10s (+/- 20% less than AudioClip audios)
AudioClip[0] has Audio[0]. Audio[0] duration is 11.5s
Track[0] -> VideoClip  
Track[1] -> AudioClip -> Marked as master
So in this case: VideoClip[0] duration will be adjusted by slowing down frames etc. to match AudioClip[0]. 

The rules are:
#### Rule 1:
- If there is an artifact with longer duration than the sum of the artifacts in the master track, they will get clipped at the sum of the master track.
> Note this only applies to artifacts with a duration: video, audio, music. The Image artifact does not have an explicit duration. The Image clips may be doing animations with duration but that is not implicit and that should be set based on the max limits as mentioned in Rule1. 
*Example 1* Audio => Master Track
Audio Artifacts: Audio[0], Audio[1] with Audio[0]+Audio[1] duration 30s
Music Artifact: Music with Music duration 60s. 
> BTW if there is no index specified it is a single. 
- Music will be clipped at 30s
- If Music duration is shorter than 30s, then it will stop or replay (depending on the configuration)

#### Rule 2:
- For duration-implicit artifacts (video, audio, music), the play speed (i.e. framerate, audio speed etc.) can be slightly adjusted if they are within the +/-20 percent window (unless configured otherwise)
*Example 1*
Audio Artifacts: Audio[0], Audio[1] with Audio[0]+Audio[1] duration 24s (each 12s) - Master Track
Video Artifacts: Video[0], Video[1] with each video 10s
- In this case the difference is within +/- 20%, so:
    - Video will be slowed down (frames/sec adjustment) to match the audio artefacts making it seamless (almost)
- If it is more than, we will use a fade-out transition. 
- This can be overridden in the configuration
- If the videos are longer they are always clipped out. 


## Persistence
The timeline is persisted as a JSON file with unique asset IDs. The actual links are never stored in the timeline, as the assets can be at a local disk or a cloud S3-compatible storage. They need to be resolved at runtime base on the IDs. These are the IDs we used throughout the core package when the assets (artifacts) were generated. The IDs are only unique within a movie project that is created.  

This JSON file will be used by the React app, that uses Remotion.

Here is what the shape looks like
```json
{
    "id": "timeline-06ce5533-ad9c-4210-8bdc-ae4887286ea8",
    "movieId": "movie-023412",
    "movieTitle": "Battle of Waterloo",
    "assetFolder": {
        "source": "local",
        "rootPath": "~/renku/"
    },
    "duration": 32.0399,
    "tracks": [
        {
            "id": "track-e12d4",
            "clips": [
                {
                    "id": "clip-d1234",
                    "kind": "Music",
                    "startTime": 0,
                    "duration": 32.03999,
                    "properties": {
                        "assetId": "Artifact:BackgroundMusic[0]",
                        "volume": 0.3,
                    }
                },
            ]
        },

}
```
The timeline output starts with section that describes the overall Timeline properties:
- *id*: uniquely defines the timeline
- *movieId*: this is the id of the movie that is created, CLI passes this in to the timeline producer. This will later be used to locate the assets in the builds and workspaces folders 
- *movieTitle*: optional string fed by the upstream script generator when it connects the title artefact into the timeline module.

As seen above, *tracks* is an array of clips and each clip has:
- *id*: uniquely defines the clip within the movie timeline
- *kind*: One of the available Clip types: Image, Audio, Music, Video, Captions. There will be more kinds of clips added over time, so this is an extensible list.
- *startTime*: In seconds. All timelines initially start from 0 seconds. The algorithm will calculate this as it places clips in the timeline.
- *duration*: In seconds. As the timeline is composed, the timeline tool will use MediaBunny to extract the duration of assets from their respective files.
- *properties*: These are the custom properties per clip type. They are defined below.

### Image Clip
Clips can expect multiple assets. Image Clips accept multiple image assets. 
In the below example:

```yaml
inputs:
  - name: ImageSegments
    description: The images to be used in the timeline
    type: collection
    dimensions: segment.image
    itemType: image
    fanIn: true
    required: true
  - name: AudioSegments
    description: The audio segments to be used in the timeline
    type: collection
    itemType: audio
    dimensions: segment
    fanIn: true
    required: true
  - name: Duration
    description: Total duration of the movie in seconds
    type: int
    required: true

producers:
  - name: TimelineProducer
    provider: Renku
    model: OrderedTimeline
    config:
      rootFolder: ~/renku
      source: local
      numTracks: 2
      masterTrack:
        kind: Audio
      clips:
        - kind: Image
          inputs: ImageSegments[segment]
          effect: KennBurns
        - kind: Audio
          inputs: AudioSegments
```

- There are 2 tracks, and the track with Audio clips is marked as the master track. 
- The Image Clips will each contain images identified as ImageSegments[segment]. ImageSegments is a 2-dimensional collection. The notation ImageSegments[segment] indicates that each clip will contain all images in the second dimension that corresponds to the current segment index.
    - Example: 
        - Given ImageSegment[0][0], ImageSegment[0][1], the Image Clip will get those two images as inputs. 

In the timeline given those inputs, the images will use `KennBurns` as the effect. The duration is going to match the duration of the corresponding AudioSegment durations from the second track. So if AudioSegment = 10 seconds, then below is a 
```json
{
    "id": "clip-a2342",
    "kind": "Image",
    "startTime": 0,
    "duration": 10,
    "properties": {
        "effects" = [
            {
                "name": "KennBurns",
                "assetId": "Artifact:Image[0][0]",
                "style":  "portraitZoomIn",
                "startX": 0,
                "startY": 0,
                "endX": 0,
                "endY": 0,
                "startScale": 1,
                "endScale": 1.2,
            },
            {
                "name": "KennBurns",
                "assetId": "Artifact:Image[0][1]",
                "style":  "diagonalZoomInDownLeft",
                "startX": -30,
                "startY": 30,
                "endX": 40,
                "endY": -40,
                "startScale": 1,
                "endScale": 1.3,
            }
        ]        
    }

}
```

- *assetId*: Generally this is the unique id of the Artifact generated in the prior stages. It is fully qualified name (not an alias) that can be located from the build manifests and resolved into an actual blob with a hash.

### Audio Clip
Audio Clips expect volume as a special property, to set a volume. Audio Clips normally have the volume highest.

They are configured in YAML:
```yaml
inputs:
  - name: AudioSegments
    description: The audio segments to be used in the timeline
    type: collection
    itemType: audio
    dimensions: segment
    fanIn: true
    required: true

producers:
  - name: TimelineProducer
    provider: Renku
    model: OrderedTimeline
    config:
      rootFolder: ~/renku
      source: local
      numTracks: 2
      masterTrack:
        kind: Audio
      clips:
        - kind: Image
          inputs: ImageSegments[segment]
          effect: KennBurns
        - kind: Audio
          inputs: AudioSegments
```
- The AudioSegments input is grouped by segment via fan-in and each clip gets one audio artefact from its corresponding segment group.

And the algorithm generates these per audio clip calculating their start time and durations (using MediaBunny from the audio asset)
```json
{
    "id": "clip-da122",
    "kind": "Audio",
    "duration": 14.904,
    "startTime": 0,
    "properties": {
        "volume": 1,
        "assetId": "Artifact:Audio[0]"
    }

}
```

###  Music Clip
Music Clips expect volume as a special property, to set a volume. 

They are configured in YAML:
```yaml
inputs:
  - name: MusicSegment
    description: The music segments to be used in the timeline
    type: audio
    required: true

producers:
  - name: TimelineProducer
    provider: Renku
    model: OrderedTimeline
    config:
      rootFolder: ~/renku
      source: local
      numTracks: 3
      masterTrack:
        kind: Audio
      clips:
        - kind: Image
          inputs: ImageSegments[segment]
          effect: KennBurns
        - kind: Audio
          inputs: AudioSegments
        - kind: Music
          inputs: MusicSegment
          duration: full
          play: loop
```
In this case:
- *duration* `full` indicates that it should try to span the full movie and not be clipped by Audio duration. This is the default. 
    - `match` indicates that it should match the master clip (in this case Audio). If there is only one Music clip, then it would match and then follow the setting in the below *play*.
- *play* `loop` indicates that if the movie duration is longer than the total duration of the music than it should start from the beginning and play again and clip at the end. Default is this.
    - `no-loop` indicates that if the duration is shorter, it should not loop and just stop playing until the end of the movie. 

The algorithm generates the following for the music clip.
```json
{
    "id": "clip-da122",
    "kind": "Music",
    "duration": 14.904,
    "startTime": 0,
    "properties": {
        "volume": 0.2,
        "assetId": "Artifact:Music[0]"
    }
}
```

### Video Clip
They are configured in YAML:
```yaml
inputs:
  - name: VideoSegment
    description: The video segments to be used in the timeline
    type: audio
    required: true

producers:
  - name: TimelineProducer
    provider: Renku
    model: OrderedTimeline
    config:
      rootFolder: ~/renku
      source: local
      numTracks: 2
      masterTrack:
        kind: Audio
      clips:
        - kind: Video
          inputs: VideoSegments
          fitStrategy: stretch
        - kind: Audio
          inputs: AudioSegments
```
In this case:
- *fitStrategy*: `stretch` indicates that the video should be stretched to meet the master track clip. 
    - `freeze-fade`: indicates that the video should be frozen at the last frame and fade out to black in the remaining duration (In the above case that would be 1.23s)
    - `auto`: indicates the algorithm should decide on the strategy based on the original duration of the Video asset. If the difference between that and the AudioSegments[0] duration is less than %20, then it should use `stretch`, otherwise `freeze-fade` 

The algorithm generates the following for the video clip:

```json
{
    "id": "clip-da122",
    "kind": "Video",
    "duration": 11.23,
    "startTime": 0,
    "properties": {
        "volume": 0.0,
        "assetId": "Artifact:Video[0]",
        "originalDuration": 10,
        "fitStrategy": "stretch",
    }
}
```

- *originalDuration*: The original duration of the video asset. This is read using MediaBunny from the video mp4 file.
- *fitStrategy*: This is populated either by what is specified in the YAML or if `auto`, set by the algorithm based on the originalDuration

### Captions
They are configured in YAML:
```yaml
inputs:
  - name: Captions
    description: The music segments to be used in the timeline
    type: array
    itemType: string
    required: true

producers:
  - name: TimelineProducer
    provider: Renku
    model: OrderedTimeline
    config:
      rootFolder: ~/renku
      source: local
      numTracks: 2
      masterTrack:
        kind: Audio
      clips:
        - kind: Captions
          inputs: Captions
          partitionBy: 3
          captionAlgorithm: basic
        - kind: Audio
          inputs: AudioSegments
```

In this case:
- *captionAlgorithm* `basic` is currently the only algorithm. It naively partitions the words in the captions' string into an array of strings and displays them in the partitioned duration. (In this case the masterTrack is Audio, so it is distributed to the narration audio segment)
    - E.g: "Quick brown fox jumps over the fence", partition by 2, AudioSegment[0] duration 10s -> Display "Quick brown fox" for 5s, "jumps over the fence" for 5s
- *partitionBy* # of partitions to partition the incoming text by.

The algorithm generates the following for the video clip:

```json
{
    "id": "clip-da122",
    "kind": "Captions",
    "duration": 11.0,
    "startTime": 0,
    "properties": {
        "volume": 0.0,
        "assetId": "Artifact:Captions[0]",
        "captionAlgorithm": "basic",
        "partitionBy": 3,
    }
}
```
