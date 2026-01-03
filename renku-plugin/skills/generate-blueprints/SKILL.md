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

Read `~/.config/renku/cli-config.json` to find the catalog path:

```bash
cat ~/.config/renku/cli-config.json
```

## How to Create Blueprints

### Step 1: Essential Questions for Requirements

Before creating a blueprint, gather the following information from the user:

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

5. **Media Generators and LLM providers**
   - We have Replicate and Fal-ai as media generators. Users may only have accounts in one, so ask if they want to use one exclusively. 
   - We have OpenAI or Vercel AI Gateway for LLM (prompt) generators. Ask which one user have accounts.

### Step 2: Figure out a narrative

See [narrative-examples.md](./docs/narrative-examples.md) for example user inquiries and how they map to video workflows. Based on the information collected, first figure out the narrative you would need conceptually. 

### Step 3: Figure out the Blueprint Components

Once the type of narrative is understood, the example blueprints in [blueprint-patterns.md](./docs/blueprint-patterns.md) should be analyzed and determine if there is an existing blueprint that may fit the need or one that best resembles (where additional alterations can be made later). Based on this:

- Figure out which asset (media) producers will be needed. The complete set of asset producers are located in the catalog root, under the producers folder.
- For the prompt producers, you can use the `catalog/producers/prompt` as an example. If you find something that fully fits, then you can use that with small alterations but more likely you will need to create one from scratch: (Use the examples as a guidance)
  - Decide on the output schema: This creates a JSON schema for a structured output. These can be prompts, narrative text, or potential decision values for the conditional branching. 
  - Decide on the prompts that will produce output that fits that schema.
  - Finally generate a YAML file that identifies the inputs (which will be used in the prompts) and ties all of this together.

### Step 4: Determine the Inputs and Artifacts

Based on the requirements gathering and the selected producers, determine what inputs will be needed from the user to do the full video generation.
- Minimal set of required inputs, various producers and models have default values that are already good enough. Do not overwhelm the user to specify all of those inputs and rely on the defaults when they make sense.

### Step 5: Define the Blueprint Structure

A blueprint has these sections, you will need to be filling these as you go along the process.

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

### Step 3: Wire Connections

Most commonly used connection patterns:

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

See `docs/comprehensive-blueprint-guide.md` for a comprehensive explanation 

### Step 4: Add Collectors (for Fan-In)

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
