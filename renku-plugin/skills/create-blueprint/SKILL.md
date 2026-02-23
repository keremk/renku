---
name: create-blueprint
description: Create Renku blueprints for video generation workflows. Use when users say "create a video", "build a video pipeline", "make a documentary", "generate a video workflow", "design a blueprint", "create an ad video", "educational video", "talking head video", or want to define custom video generation pipelines composing prompt producers, asset producers, and timeline composers.
allowed-tools: Read, Grep, Glob, Bash, Write, Edit, AskUserQuestion
---

# Blueprint Creation Skill

Create Renku blueprints — YAML files that define video generation workflows by composing prompt producers, asset producers, and timeline composers into a dependency graph.

## Critical Rules

1. **Never modify catalog files.** Catalog is read-only reference. Always create new projects with `renku new:blueprint`.
2. **Never run `renku generate` without `--dry-run`.** Full runs cost money and the user will be charged.
3. **System inputs are NOT declared in `inputs:`.** `Duration`, `NumOfSegments`, `SegmentDuration`, `MovieId`, `StorageRoot`, `StorageBasePath` are automatic — but MUST be wired in `connections:` where needed.
4. **Kebab-case project names, PascalCase IDs.** Project: `history-video`. Blueprint ID: `HistoryVideo`.
5. **Use relative paths.** In producer imports use the `producer` keyword. For prompt producers use relative paths within the project folder.
6. **Minimal inputs.** Most producer inputs have sensible defaults. Only expose what the user needs to configure.
7. **No legacy `collectors:` blocks.** Fan-in is connection-driven. See [Common Errors Guide](./references/common-errors-guide.md).
8. **Quality over speed for the director prompt.** The director prompt producer is the highest-leverage file — it generates ALL downstream prompts. The director-prompt-engineer subagent has full guidance on this.
9. **Delegate specialized work.** Use the Task tool to spawn subagents for model selection (model-picker) and director prompt creation (director-prompt-engineer) at the appropriate steps.

## Prerequisites

1. Check if `~/.config/renku/cli-config.json` exists
2. If not, run `renku init --root=~/renku-workspace`
3. Read the config to find the **catalog** path for locating producers and models

## Blueprint Creation Workflow

### Step 0: Scaffold the Project

```bash
renku new:blueprint <project-name>
```

This creates:
```
<project-name>/
├── <project-name>.yaml          # Blueprint file (scaffold)
└── input-template.yaml          # Input template
```

When adding custom prompt producers, create subfolders:
```
<project-name>/
├── <project-name>.yaml
├── input-template.yaml
└── <prompt-producer-name>/
    ├── output-schema.json
    ├── producer.yaml
    └── prompts.toml
```

### Step 1: Gather Requirements

Understand from the user:
- What type of video (documentary, ad, educational, music video, storyboard, etc.)
- What media types are needed (images, videos, talking heads, narration, music)
- How they compose into the final timeline (which tracks, segment structure)

If anything is unclear, use **AskUserQuestion** to clarify.

See [Requirement Examples](./references/requirement-examples.md) for detailed analysis of common use cases.

### Step 2: Identify Implicit Requirements

Always include inputs for these even if the user doesn't mention them:
- **Style/VisualStyle** — Visual aesthetic (cinematic, anime, photorealistic)
- **Duration structure** — Duration, NumOfSegments (system inputs), NumOfImagesPerSegment (if applicable)
- **Audience** — Target demographic (when it affects tone/content)

### Step 3: Select Producers and Models

**Delegate to the model-picker subagent** using the Task tool. Provide:
- The use case type and required media types
- Any user preferences for specific models (e.g., "use Kling Video 3.1") or providers (e.g., "use fal-ai")
- Budget or quality/cost trade-offs

If the user specified a model, the subagent will find compatible producers for it. If the user specified a provider, the subagent will only select models from that provider. The subagent returns producer + model + provider selections for use in `input-template.yaml`.

Key rules:
- For cut-scene videos, use ONE video producer per segment with `[cut]` markers — not nested video producer groups
- The blueprint does NOT specify models — models go in `input-template.yaml`

### Step 4: Design the Director Prompt Producer

**Delegate to the director-prompt-engineer subagent** using the Task tool. Provide:
- The use case, selected producers and their inputs
- The project path and any style preferences
- The output schema requirements

The subagent creates the complete prompt producer files (TOML, JSON schema, YAML).

The director MUST:
- [ ] Define a narrative arc (hook → development → resolution)
- [ ] Establish visual consistency rules (color palette, lighting, style keywords)
- [ ] Include camera movement instructions in all video prompts
- [ ] Follow TTS-friendly writing guidelines for narration
- [ ] Enforce word count limits: SegmentDuration × 2 words max per segment
- [ ] Handle conditional fields explicitly (empty strings for unused fields)
- [ ] Specify "no text/labels/watermarks" in all image prompts
- [ ] Include concrete prompt examples in the system prompt
- [ ] Test timing math: count words in example narrations

### Step 5: Determine Inputs and Artifacts

Based on the selected producers and director output schema, define:
- **inputs:** — User-configurable parameters (PascalCase names, minimal set)
- **artifacts:** — Blueprint outputs (arrays with countInput for looped outputs)
- **loops:** — Iteration dimensions (segment, image, clip, etc.)

Remember: system inputs (`Duration`, `NumOfSegments`, `SegmentDuration`) are automatic — don't declare them in `inputs:`.

### Step 6: Wire the Connection Graph

Build the `connections:` section that routes data between producers. This is the mechanical step that follows from the producer graph and director output schema.

**Connection patterns:**
- **Direct:** `Input:Style → ImageProducer.Style` — broadcast a single value to a producer input
- **Looped:** `Director.Segments[segment].NarrationScript → TTS[segment].TextInput` — per-iteration wiring
- **Broadcast:** `Input:Style → VideoProducer[segment].Style` — same value to every loop iteration
- **Fan-in:** `ImageProducer[segment].Image → TimelineComposer.ImageSegments` — collect loop outputs into an array
- **Offset:** `ImageProducer[i].Image → VideoProducer[segment].SourceImage` — index shift between loops
- **Conditional:** `Input:NarrationType → condition → different producer wiring` — route based on input value

**Audio routing rule:** If audio is only used as video input (e.g., lipsync), do NOT route it as a separate audio track to the timeline. For transcription of lipsync videos, wire `AudioTrack` from the talking-head producer, not the original narration audio.

**Timeline composer configuration:**
- Define `masterTracks` in the timeline composer's config — which artifact arrays map to which track types (video, audio, subtitle)
- Track types: `video` (image sequences or video clips), `audio` (narration, music), `subtitle` (karaoke text)
- Set export config: resolution, FPS, codec

See [Comprehensive Blueprint Guide](./references/comprehensive-blueprint-guide.md) for full connection syntax. See [Timeline Composer Config](./references/timeline-composer-config.md) for track setup and export configuration.

### Step 7: Add Transcription and Karaoke Subtitles (Optional)

If the video includes narration or speech that should be displayed as subtitles, add the TranscriptionProducer.

See [Transcription and Karaoke Guide](./references/transcription-karaoke-guide.md) for wiring and configuration.

### Step 8: Validate Blueprint Structure

```bash
renku blueprints:validate <path-to-blueprint.yaml>
```

Fix any errors before proceeding. See [Common Errors Guide](./references/common-errors-guide.md) for error reference.

| Error Code | Quick Fix |
|------------|-----------|
| E003 | Add producer to `producers[]` |
| E004 | Declare in `inputs[]` or use system input |
| E006 | Check loop names in `loops[]` |
| E007 | Use fan-in target or align dimensions |
| E010 | Check producer's available inputs |
| E021 | Remove circular dependency |
| P053 | Remove `collectors:` — use connection-driven fan-in |

### Step 9: Test with Dry Run

Create a minimal inputs file with required values and model selections (from producer YAML `mappings` sections):

```yaml
inputs:
  InquiryPrompt: 'Test prompt'
  Duration: 30
  NumOfSegments: 2

models:
  - model: gpt-5-mini
    provider: openai
    producerId: ScriptProducer
```

```bash
renku generate --blueprint=<path> --inputs=<path> --dry-run
```

Fix any runtime errors and iterate.

### Step 10: Review and Deliver

- Verify the blueprint produces the expected structure in dry-run output
- Walk the user through the blueprint: inputs they'll configure, producers used, expected output
- Remind them to select models for each producer when running real generation

## Blueprint Schema Reference

```yaml
meta:
  name: <Human-readable name>
  description: <Purpose>
  id: <PascalCase identifier>
  version: 0.1.0

inputs:
  - name: <PascalCase>
    description: <Purpose>
    type: <string|int|image|audio|video|json>
    required: <true|false>

artifacts:
  - name: <PascalCase>
    type: <string|array|image|audio|video|json>
    itemType: <for arrays>
    countInput: <input name for array size>

loops:
  - name: <lowercase>
    countInput: <input providing count>
    parent: <optional parent loop>

producers:
  - name: <PascalCase alias>
    producer: <type/name>            # catalog producer (e.g., image/text-to-image)
    path: <relative path>            # OR local prompt producer (e.g., ./my-director/producer.yaml)
    loop: <loop name or nested like segment.image>

connections:
  - from: <source>
    to: <target>
    if: <optional condition name>

conditions:
  <conditionName>:
    when: <artifact path>
    is: <value>
```

Connection patterns: Direct (`Input → Producer.Input`), Looped (`Script[segment] → Audio[segment].Text`), Broadcast (`Style → Video[segment].Style`), Offset (`Image[i] → Video[segment].Start`), Indexed collection (`CharImage → Video[clip].RefImages[0]`), Multi-index (`Prompt[seg][img] → Image[seg][img].Prompt`), Fan-in (`Image[seg].Out → Timeline.ImageSegments`).

## End-to-End Example: Simple Documentary

1. User says: "Create a Ken Burns documentary about the Silk Road"
2. Scaffold: `renku new:blueprint silk-road-documentary`
3. Requirements: Images with KenBurns effects, narration, background music, text overlays
4. Producers: `prompt/generic` (director), `image/text-to-image` (images), `audio/text-to-speech` (narration), `audio/text-to-music` (music), `composition/timeline-composer`
5. Director creates per-segment: image prompts, narration scripts, text overlays, plus a music prompt
6. Wire: InquiryPrompt → Director → [segment] image/narration/text outputs → asset producers → TimelineComposer
7. Validate: `renku blueprints:validate silk-road-documentary/silk-road-documentary.yaml`
8. Dry-run: `renku generate --blueprint=... --inputs=... --dry-run`

## CLI Commands Reference

```bash
renku init --root=<path>                                    # Initialize workspace
renku new:blueprint <project-name>                          # Scaffold blueprint project
renku blueprints:validate <blueprint.yaml>                  # Validate structure
renku producers:list --blueprint=<path>                     # List available producers
renku generate --blueprint=<path> --inputs=<path> --dry-run # Test without API calls
renku generate --blueprint=<path> --inputs=<path> --costs-only # Estimate costs
```

## Reference Documents

- [Comprehensive Blueprint Guide](./references/comprehensive-blueprint-guide.md) — Full YAML schema, connections, loops, fan-in
- [Timeline Composer Config](./references/timeline-composer-config.md) — Track setup and export config
- [Common Errors Guide](./references/common-errors-guide.md) — Validation and runtime error reference
- [Transcription and Karaoke Guide](./references/transcription-karaoke-guide.md) — Subtitle configuration
- [Requirement Examples](./references/requirement-examples.md) — Detailed use case analysis
