# Bundled Catalog Reference

This folder contains the canonical catalog that ships with the Renku CLI. When you run `renku init`, the entire `catalog/` directory is copied into your local Renku root. We highly recommend you to use git as a version control system in your Renku root folder, this way you can track changes in the catalog as you use `renku update` to update the catalog.

## Directory Structure

```
catalog/
├── models/           # Model JSON schemas + provider pricing
├── producers/        # Asset and composition producer definitions
└── blueprints/       # Example workflows (see individual blueprint READMEs)
```

## Blueprints

The included blueprints are examples of different ways of creating workflows for producing videos. You can use them as is. When you use Claude Code Skills to create new blueprints, Claude Code also uses them as examples to create new blueprints.

If you want to modify them, we recommend you to first copy them over to your working folder under the root folder even when you are using a version control system. There will be many updates, additions/removals to the catalog over time.

## Models

Model definitions are organized by provider. Each provider directory contains:

- **Subdirectories by media type**: `video/`, `image/`, `audio/`, `json/`
- **JSON schema files**: Define model input/output parameters
- **Provider YAML file**: Contains model metadata and pricing information

### Available Providers

| Provider     | Directory       | Description                              |
| ------------ | --------------- | ---------------------------------------- |
| FAL AI       | `fal-ai/`       | Extensive video, image, and audio models |
| Replicate    | `replicate/`    | Wide variety of open-source models       |
| OpenAI       | `openai/`       | GPT and DALL-E models                    |
| Vercel       | `vercel/`       | Vercel AI SDK models                     |
| Wavespeed AI | `wavespeed-ai/` | Fast inference models                    |
| Renku        | `renku/`        | Native Renku models                      |

### Provider YAML Structure

Each provider has a `<provider>.yaml` file defining available models and their pricing:

```yaml
models:
  - name: bytedance/seedream-4
    type: image
    mime:
      - image/png
    price:
      function: costByRun
      price: 0.03

  - name: bytedance/seedance-1.5-pro
    type: video
    mime:
      - video/mp4
    price:
      function: costByVideoDurationAndWithAudio
      inputs: [duration, generate_audio]
      prices:
        - generate_audio: true
          pricePerSecond: 0.052
        - generate_audio: false
          pricePerSecond: 0.045
```

**Pricing functions**: `costByRun`, `costByVideoDuration`, `costByVideoDurationAndWithAudio`, `costByResolution`, `costByImageAndResolution`, `costByCharacters`

## Producers

Producers are reusable execution units that accept inputs and produce artifacts. They abstract AI models by mapping user-facing inputs to model-specific API parameters.

### Asset Producers

Located in `producers/asset/`. Generate media assets from AI models.

| Producer             | File                        | Description                           |
| -------------------- | --------------------------- | ------------------------------------- |
| Text-to-Image        | `text-to-image.yaml`        | Generate images from text prompts     |
| Image-to-Image       | `image-to-image.yaml`       | Transform existing images             |
| Image-Hybrid         | `image-hybrid.yaml`         | Combine reference images with prompts |
| Text-to-Video        | `text-to-video.yaml`        | Generate video from text              |
| Image-to-Video       | `image-to-video.yaml`       | Animate images into video             |
| Audio-to-Video       | `audio-to-video.yaml`       | Generate video synchronized to audio  |
| Reference-to-Video   | `reference-to-video.yaml`   | Generate video using reference images |
| Text-to-Talking-Head | `text-to-talking-head.yaml` | Generate talking head videos          |
| Text-to-Speech       | `text-to-speech.yaml`       | Convert text to speech audio          |
| Text-to-Music        | `text-to-music.yaml`        | Generate music from prompts           |
| Transcription        | `transcription.yaml`        | Transcribe audio to text              |

### Composition Producers

Located in `producers/composition/`. Combine and export generated assets.

| Producer          | File                     | Description                       |
| ----------------- | ------------------------ | --------------------------------- |
| Timeline Composer | `timeline-composer.yaml` | Compose video segments with audio |
| Video Exporter    | `video-exporter.yaml`    | Export final video output         |

### Mappings

Each producer defines mappings that transform user-facing inputs (like `AspectRatio`, `Duration`) to provider-specific API fields. Mappings support various transforms for value conversion, conditional inclusion, and type coercion.

For comprehensive documentation on the mapping system and available transforms, see:
**[Asset Producers Reference](https://gorenku.com/docs/asset-producers)**
