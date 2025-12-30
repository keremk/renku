---
name: create-blueprint
description: Create Renku blueprints for video generation workflows. Use when users want to define custom video generation pipelines, compose producers into workflows, or create new blueprint YAML files.
---

# Blueprint Creation Skill

This skill helps you create Renku blueprints - YAML files that define video generation workflows. Blueprints compose multiple producers (AI models) into a dependency graph that generates media files and assembles them into final videos.

## Prerequisites

Before creating blueprints, ensure Renku is initialized:

1. Check if `~/.config/renku/cli-config.json` exists
2. If not, run `renku init --root=~/renku-workspace` (or user's preferred path)
3. The config file contains the `catalog` path where blueprints and producers are installed

## Discovery Phase

Before creating a blueprint, gather the following information from the user:

### Essential Questions

1. **What type of video?**
   - Documentary/educational
   - Story/narrative
   - Advertisement/promotional
   - Tutorial/how-to
   - Music video
   - Other

2. **What media types are needed?**
   - Audio narration only
   - Images (with Ken Burns effects)
   - Video clips (AI-generated)
   - Music/background audio
   - Combination of above

3. **Duration and structure?**
   - Total video length in seconds
   - Number of segments
   - Images per segment (if applicable)

4. **Visual style?**
   - Cinematic, anime, photorealistic, etc.
   - Aspect ratio (16:9, 9:16, 1:1)
   - Resolution (480p, 720p, 1080p)

### Example Narratives

See [narrative-examples.md](./narrative-examples.md) for example user inquiries and how they map to video workflows.

See [story-arclines.md](./story-arclines.md) for narrative structure patterns.

## Pattern Selection

Based on user requirements, select the appropriate blueprint pattern:

| User Wants | Pattern | Producers |
|------------|---------|-----------|
| Audio narration only | `audio-only` | Script, Audio |
| Image slideshow | `image-only` | Script, ImagePrompt, Image |
| Documentary with images + audio | `kenn-burns` | Script, ImagePrompt, Image, Audio, Timeline |
| Full production with export | `cut-scene-video` | All + VideoExporter |
| Flowing video from images | `image-to-video` | FlowVideoPrompt, Image, ImageToVideo |
| Background music only | `music-only` | Script, MusicPrompt, Music |

See [blueprint-patterns.md](./docs/blueprint-patterns.md) for detailed pattern information.

## Blueprint Creation Workflow

### Step 1: Find the Catalog

Read `~/.config/renku/cli-config.json` to find the catalog path:

```bash
cat ~/.config/renku/cli-config.json
```

The `catalog` field contains the path to blueprints and producers.

### Step 2: Start from Template

Copy the closest existing blueprint as a starting point:
- `<catalog>/blueprints/audio-only/audio-only.yaml`
- `<catalog>/blueprints/video-only/video-only.yaml`
- `<catalog>/blueprints/kenn-burns/image-audio.yaml`
- `<catalog>/blueprints/image-to-video/image-to-video.yaml`

### Step 3: Define the Blueprint Structure

A blueprint has these sections:

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

### Step 4: Wire Connections

Connection patterns:

**Direct (scalar to scalar)**:
```yaml
- from: InquiryPrompt
  to: ScriptProducer.InquiryPrompt
```

**Looped (array element to looped producer)**:
```yaml
- from: ScriptProducer.NarrationScript[segment]
  to: AudioProducer[segment].TextInput
```

**Broadcast (scalar to all loop instances)**:
```yaml
- from: VoiceId
  to: AudioProducer[segment].VoiceId
```

**Multi-dimensional**:
```yaml
- from: ImageProducer[segment][image].SegmentImage
  to: SegmentImage[segment][image]
```

**Offset (sliding window)**:
```yaml
- from: ImageProducer[image].SegmentImage
  to: ImageToVideoProducer[segment].InputImage1
- from: ImageProducer[image+1].SegmentImage
  to: ImageToVideoProducer[segment].InputImage2
```

### Step 5: Add Collectors (for Fan-In)

When multiple outputs need to be aggregated:

```yaml
collectors:
  - name: TimelineImages
    from: ImageProducer[segment][image].SegmentImage
    into: TimelineComposer.ImageSegments
    groupBy: segment
    orderBy: image
```

See [producers-catalog.md](./docs/producers-catalog.md) for producer inputs/outputs.

## Validation & Testing

### Validate Blueprint Structure

```bash
renku blueprints:validate <path-to-blueprint.yaml>
```

Expected output:
- `valid: true` - Blueprint structure is correct
- Node and edge counts
- Error messages if invalid

### Test with Dry Run

Create a minimal inputs file:

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

Run dry-run:

```bash
renku generate --blueprint=<path> --inputs=<path> --dry-run
```

### List Available Models

```bash
renku producers:list --blueprint=<path>
```

Shows available models for each producer with pricing.

## Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Missing size for dimension "X"` | Loop not sized | Add `countInput` to loop definition |
| `Unknown loop symbol "X"` | Typo in connection | Check loop names in `loops:` section |
| `inconsistent dimension counts` | Mismatched indices | Ensure source/target dimensions align |
| `Producer graph contains a cycle` | Circular dependency | Check connections for loops |
| `Missing producer catalog entry` | Wrong producer path | Verify `path:` in producers section |

## Reference Documentation

For comprehensive information:
- [comprehensive-blueprint-guide.md](./docs/comprehensive-blueprint-guide.md) - Full YAML schema and examples
- [blueprint-patterns.md](./docs/blueprint-patterns.md) - Available patterns and when to use them
- [producers-catalog.md](./docs/producers-catalog.md) - All 14 producers with inputs/outputs

For live examples, find the catalog path in `~/.config/renku/cli-config.json` and explore:
- `<catalog>/blueprints/` - Blueprint examples
- `<catalog>/producers/` - Producer definitions

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
