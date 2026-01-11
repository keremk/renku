---
name: create-blueprint
description: Create Renku blueprints for video generation workflows. Use when users want to define custom video generation pipeline using prompt producers, asset producers and compose them into a video.
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Blueprint Creation Skill

This skill helps you create Renku blueprints - YAML files that define video generation workflows. Blueprints compose multiple asset generators and prompt generators using AI models into a dependency graph that generates media files and assembles them into final videos.

## Prerequisites

Before creating blueprints, ensure Renku is initialized:

1. Check if `~/.config/renku/cli-config.json` exists
2. If not, run `renku init --root=~/renku-workspace` 
3. The config file contains the `catalog` path where blueprints and producers are installed

Read `~/.config/renku/cli-config.json` to find the **catalog** path, you will be using this to locate the producers and models for the blueprint.

```bash
cat ~/.config/renku/cli-config.json
```

## Where to Create Blueprints

Each user create blueprint should be within a project folder. Project folders are under the root folder. 
> **IMPORTANT** Do not create new blueprints or prompt producer files under the catalog

Root
├── catalog     (this is where example blueprints, producer asset YAML files, models, and example prompt producer files are located)
| 
├── <project-name>
      | 
      ├── <new-blueprint.yaml>
      ├── <new-inputs.yaml>
      ├── <new-prompt-producer>
            ├── <new-output-schema.json>
            ├── <new-producer.yaml>
            ├── <new-prompts.toml>

- Create a concise (2-3 words max) project name (based on the user prompt) in kebab case and make a folder
- Inside the project you will be creating all the necessary files and folders as you proceed the task. 
- **IMPORTANT** Do not use hardcoded paths but use the relative ones. In blueprint producer import declarations, you should be using "producer" keyword so that you don't need to provide a specific path. For the prompt producers, create a folder and use relative paths within that folder to import the JSON schema and TOML prompts file.

## How to Create Blueprints

### Step 1: Essential Questions for Requirements

The workflow and type of video needs to be clearly stated in natural language. It includes what the expected type of output video is, the types of artifacts (different types of media) that will be used in creating it and how they are supposed to come together in the final video.

Below are some examples and what you can deduce:
> **IMPORTANT** If you cannot deduce or have doubts, always use the **AskUserQuestion** tool to clarify.

**Example 1**
User Prompt: I want to build short documentary style videos. The video will optionally contain KenBurns style image transitions, video clips for richer presentation, optional video clips where an expert talks about some facts, a background audio narrative for the images and videos and a background music.

With the above user provided summary, you know:
- The end video is a documentary style video, which will help in generating the necessary prompts.
- What kind of artifacts you will need to be producing to put together the final video. This includes:
  - Image generations (possibly multiple per segment),
  - Video generations for richer video depiction where Ken Burns style images are not sufficient,
  - Video generations with audio, where a person is talking and giving information,
  - Background audio narrative, which means some text script and text-to-speech audio generation for segments,
  - Background music to give a relevant ambience to the overall narrative 
- Your final composition will be composed of 4 tracks and a user configurable number of segments. 
  - Track 1: Audio for narrative 
  - Track 2: Video for video clips and talking head videos
  - Track 3: Image for images to be used with KenBurns style effects.
  - Track 4: Music for background music
- The initial prompt producer (director of the video), will determine the script, what type of segments to generate, what type of media to include for the best results in each segment and prompts for each of those generation and text for the narrative scripts.

In catalog, we have an example of this blueprint: `catalog/blueprints/documentary-talking-head`

**Example 2**
User Prompt: I want to create Ad videos. We will have a character in various video clips using a product. The character and product shot should be generated. The ad should also
have a background music. The video clips will have audio, so we want to be able to provide a written script to each one.

With the above user provided summary, you know:
- The end video is a commercial that depicts a character using a product and a narrative that sells the product.
- What kind of artifacts you will need to be producing to put together the final video. This includes:
  - Image generation to generate a character image which will be used in the videos as the hero character using the product
  - Image generation to generate the product image which will be advertised and the character will use it in different situations
  - An audio narrative that sells the product, a text-to-speech generated audio
  - Background music that fits the tone and style of the commercial
- Your final composition will be composed of 3 tracks and a user configurable number of clips.
  - Track 1: Video (the generated video clips)
  - Track 2: Audio (narration)
  - Track 3: Music (background music)
- The initial prompt producer (director of the video), will determine the script, what type of segments to generate, what type of media to include for the best results in each segment and prompts for each of those generation and text for the narrative scripts.

In catalog, we have an example of this blueprint: `catalog/blueprints/ad-video`

### Step 2: Implicit Requirements 

These are requirements that the user does not specify everytime, but you should always include as inputs to the blueprint. The end users using the blueprint to generate videos will always want to configure these: 

**Duration and structure?**
  - Total video length in seconds
  - Number of segments
  - Images per segment (if applicable)

**Visual style?**
  - Cinematic, anime, photorealistic, etc.
  - Aspect ratio (16:9, 9:16, 1:1)
  - Resolution (480p, 720p, 1080p)

### Step 3: Define the Blueprint Structure

A blueprint has these sections, you will need to be filling these as you go along the process. This will serve as your planning to make sure you correctly created a blueprint that uses this structure

```yaml
meta:
  name: <Human-readable name>
  description: <Purpose and behavior>
  id: <PascalCase identifier>
  version: 0.1.0

inputs:
  - name: <PascalCase>
    description: <Purpose>
    type: <string|int|image|audio|video|json>
    required: <true|false>

artifacts:
  - name: <PascalCase>
    description: <Output description>
    type: <string|array|image|audio|video|json>
    itemType: <for arrays>
    countInput: <input name for array size>

loops:
  - name: <lowercase>
    countInput: <input providing count>
    parent: <optional parent loop>

producers:
  - name: <PascalCase alias>
    path: <relative path to producer.yaml>
    loop: <loop name or nested like segment.image>

connections:
  - from: <source>
    to: <target>
    if: <optional condition name>

# Connection patterns:
# - Direct: InquiryPrompt → ScriptProducer.InquiryPrompt
# - Looped: Script[segment] → AudioProducer[segment].TextInput
# - Broadcast: Style → VideoProducer[segment].Style
# - Offset: Image[i] → Video[segment].Start, Image[i+1] → Video[segment].End
# - Indexed collection: CharacterImage → VideoProducer[clip].ReferenceImages[0]
#                       ProductImage → VideoProducer[clip].ReferenceImages[1]
# - Multi-index (nested loops): ImagePrompt[segment][image] → ImageProducer[segment][image].Prompt
# - Fan-in (REQUIRES BOTH connection AND collector):
#     Connection: ImageProducer[segment][image].GeneratedImage → TimelineComposer.ImageSegments
#     Collector:  from: ImageProducer[segment][image].GeneratedImage
#                 into: TimelineComposer.ImageSegments
#                 groupBy: segment, orderBy: image

conditions:
  <conditionName>:
    when: <artifact path>
    is: <value>

collectors:
  - name: <collector name>
    from: <source with loop indices>
    into: <target fan-in input>
    groupBy: <loop dimension>
    orderBy: <optional ordering dimension>
```

### Step 4: Determine the Inputs and Artifacts

Based on the requirements gathering and the selected producers, determine what inputs will be needed from the user to do the full video generation.
> **IMPORTANT** Minimal set of required inputs, various producers and models have default values that are already good enough. Do not overwhelm the user to specify all of those inputs and rely on the defaults when they make sense.

### Step 5: Determine which Asset Producers to Use

You can use the `docs\models-guide.md` document to decide which asset producers you will need to generate the types of assets. This document gives the necessary background to decide on what asset producers to pick for media generation. 

### Step 6: Create the Initial Prompt Producer (aka the Director)

You can use the `docs\prompt-producer-guide.md` to understand what files are needed and how to generate the prompt producers. The output of this file will be a JSON structured output, which you will be using to connect to various media producers in the blueprint.

### Step 7: Create the Connection Graph

Use `docs/comprehensive-blueprint-guide.md` for a comprehensive explanation of the blueprints and how to connect nodes based on the prompt producer you created and the asset producers you identified. You can also always use some examples from the catalog.

### Step 8: Add Transcription and Karaoke Subtitles (Optional)

If the video includes narration or speech that should be displayed as subtitles, add transcription support using the TranscriptionProducer. This enables karaoke-style animated subtitles similar to Instagram and TikTok.

For detailed guidance on:
- TranscriptionProducer setup and configuration
- VideoExporter integration for karaoke rendering
- Blueprint wiring patterns for transcription
- Karaoke configuration options (fonts, colors, animations)
- Animation effects (pop, spring, pulse)

See: **[Transcription and Karaoke Subtitles Guide](./docs/transcription-karaoke-guide.md)**

### Step 9: Validate Blueprint Structure
This validates that the blueprint can be parsed and structurally connect, but it does not validate that it will be sending the right inputs to the producers, the producer input routing is validated by doing a dry-run.

```bash
renku blueprints:validate <path-to-blueprint.yaml>
```

Expected output:
- `valid: true` - Blueprint structure is correct
- Node and edge counts
- Error messages if invalid

If you receive errors, address them here before moving on by carefully reading the error and if necessary consulting the `./docs/comprehensive-blueprint-guide.md`

### Step 10: Test with Dry Run

Create a minimal inputs file (based on the requirements and also what the producers expect). At this stage you will also need to pick some models for the dry-run. These models should be selected from each of the producer YAML file's mappings section (which identifies which models are compatible with that producer)

For detailed model information:
- [video-models.md](./docs/video-models.md) - Video model comparisons (Veo, Seedance, Kling, etc.)
- [image-models.md](./docs/image-models.md) - Image model comparisons (SeedDream, Flux, Qwen, etc.)
- [audio-models.md](./docs/audio-models.md) - Audio/speech/music model comparisons

> **IMPORTANT** Producers specify a lot of possible inputs for completeness, but most of them have default values. DO NOT PROVIDE VALUES for those defaults. 
> **IMPORTANT** Models will be picked by end user when generating a video, in the dry-run just pick one of the models in the list of supported models for that producer (in the YAML file). 

```yaml
inputs:
  InquiryPrompt: "Test prompt"
  Duration: 30
  NumOfSegments: 2
  # ... other required inputs

models:
  - model: gpt-5-mini
    provider: openai
    producerId: ScriptProducer
  # ... other model selections
```

Save this again in the root folder of the workspace.

Run dry-run:
> **IMPORTANT** Always use --dry-run, running them full will cost money as they will be calling the providers and the user will be charged and very UPSET!

```bash
renku generate --blueprint=<path> --inputs=<path> --dry-run
```

## Common Errors and Fixes

For a comprehensive guide to all validation errors, runtime errors, and their fixes, see:
- **[Common Errors Guide](./docs/common-errors-guide.md)** - Full error reference with examples and solutions

### Quick Reference

| Error Code | Description | Quick Fix |
|------------|-------------|-----------|
| E003 | Producer not found | Add producer to `producers[]` section |
| E004 | Input not found | Declare in `inputs[]` or use system input |
| E006 | Unknown loop dimension | Check loop names in `loops[]` section |
| E007 | Dimension mismatch | Add collector for fan-in or match dimensions |
| E010 | Producer input mismatch | Check producer's available inputs |
| E021 | Producer cycle detected | Remove circular dependency |
| E042 | Collector missing connection | Add BOTH connection AND collector |

### Critical: Fan-In Pattern

**Most common mistake:** TimelineComposer (and other fan-in consumers) require BOTH a connection AND a collector:

```yaml
# CORRECT - Both connection AND collector
connections:
  - from: ImageProducer[segment][image].GeneratedImage
    to: TimelineComposer.ImageSegments  # Creates data flow edge

collectors:
  - name: TimelineImages
    from: ImageProducer[segment][image].GeneratedImage
    into: TimelineComposer.ImageSegments
    groupBy: segment
    orderBy: image
```

See the [Common Errors Guide](./docs/common-errors-guide.md#e042-collector-missing-connection-critical) for details.

## Examples

For examples, find the catalog path in `~/.config/renku/cli-config.json` and explore:
- `<catalog>/blueprints/` - Blueprint examples
- `<catalog>/producers/` - Producer definitions
- `<catalog>/models/` - Model definitions together with their input JSON schemas

## CLI Commands Reference

```bash
# Initialize Renku workspace
renku init --root=<path>

# Validate blueprint structure
renku blueprints:validate <blueprint.yaml>

# Describe blueprint details
renku blueprints:describe <blueprint.yaml>

# List available blueprints
renku blueprints:list

# List available models for producers
renku producers:list --blueprint=<path>

# Test with dry run (no API calls)
renku generate --blueprint=<path> --inputs=<path> --dry-run

# Estimate costs
renku generate --blueprint=<path> --inputs=<path> --costs-only

# Full generation (costs money)
renku generate --blueprint=<path> --inputs=<path> --non-interactive
```
