---
name: director-prompt-engineer
description: Create and improve Renku director prompt producers for video generation. Use when users say "create a director prompt", "improve my prompt producer", "fix my video script prompt", "write better prompts", or when building/improving TOML/JSON/YAML files for a prompt producer. Specializes in narrative arc, visual consistency, model-specific prompting, and TTS-friendly narration.
allowed-tools: Read, Grep, Glob, Write, Edit, AskUserQuestion
---

# Director Prompt Engineer

Create and improve Renku director prompt producers — the TOML/YAML/JSON files that instruct an LLM to generate ALL downstream image, video, audio, and narration prompts for a video blueprint.

## Why This Matters

The director prompt is the single highest-leverage file in any blueprint. It's a "meta-prompt" — a prompt that generates prompts. Every downstream asset (images, videos, narration audio, music) is only as good as the prompt the director produces for it. Investing extra time here has cascading quality effects.

## What You Need

To create or improve a director prompt producer, you need:
1. **The blueprint YAML** — to understand which producers exist and what inputs they accept
2. **The output schema JSON** — to understand the structured output the director must produce
3. **The catalog producer YAMLs** — to understand what inputs each asset producer accepts

## Core Principles

### 1. Narrative Arc (Every Director Needs One)

Structure segments with intentional ordering:
- **Segment 1 (Hook):** Most compelling visual or statement
- **Segments 2-3 (Context):** Establish setting and subject
- **Middle segments (Development):** Build complexity and engagement
- **Second-to-last (Climax):** Most dramatic or revealing moment
- **Final segment (Resolution):** Conclude with impact

Adapt by use case:
- **Documentary:** Surprising fact → chronological development → legacy/impact
- **Ads:** Product tease → problem → solution → social proof → CTA
- **Educational:** Attention question → concept intro → examples → recap
- **Music video:** Establish mood → build intensity → peak → denouement

### 2. Visual Consistency Rules

Include these in every director system prompt:
- **Color palette locking:** Establish palette in segment 1, repeat same keywords in ALL prompts
- **Lighting direction:** Choose once (e.g., "dramatic side-lighting from the left"), repeat everywhere
- **Character anchors:** 15-20 word appearance description, pasted verbatim in every prompt featuring that character
- **Environment anchors:** 10-word location description, pasted verbatim for recurring settings
- **Style keyword:** Include `{{Style}}` in EVERY image and video prompt
- **Negative constraints:** "No text, labels, titles, or watermarks" in every visual prompt

### 3. Camera Movement Instructions

Always instruct the director to specify camera movement. Without them, video models produce static or random motion:
- **Dolly:** Forward/backward — approaching subjects
- **Pan:** Horizontal rotation — revealing wide scenes
- **Tilt:** Vertical rotation — tall subjects or reveals
- **Crane:** Vertical movement — establishing shots
- **Tracking:** Following subject — action sequences
- **Orbit:** Circular around subject — dramatic reveals

### 4. TTS-Friendly Narration

Narration will be read by text-to-speech engines. Instruct the director to:
- Write ONLY spoken words (no stage directions)
- Spell out numbers: "nineteen forty-five" not "1945"
- Spell out abbreviations: "United States" not "US"
- Use em-dashes for dramatic pauses
- Vary sentence length: short-medium-long-short
- Match energy to content: action → punchy; reflective → flowing

### 5. Timing Enforcement

The most common failure is narration exceeding segment duration.

**Formula: 2 words per second maximum.**

| SegmentDuration | Max Words |
|----------------|-----------|
| 6s | 12 words |
| 8s | 16 words |
| 10s | 20 words |
| 12s | 24 words |
| 15s | 30 words |

Include calibration examples in the system prompt so the LLM can self-check.

### 6. Conditional Field Handling

When a JSON schema requires fields that are only relevant for some segment types:
- Use empty string `""` for inapplicable fields
- Never use "N/A" or placeholder text — these get sent to downstream AI models
- Add explicit instructions: "If NarrationType is ImageNarration, set TalkingHeadText to empty string"

### 7. [cut] Scene Syntax

For videos with internal scene transitions:
```
Camera transition description between scenes
First scene camera and action (inherits from input start image)
[cut] Second scene with new angle and camera movement
[cut] Third scene with different perspective
```

Number of `[cut]` markers = CutScenesPerSegment - 1 (the input image defines scene 1).

## File Structure

A prompt producer consists of three files:

### producer.yaml
```yaml
meta:
  name: "Director"
  description: "Generates the video script and all prompts"
  id: DirectorProducer

type: prompt

inputs:
  - name: InquiryPrompt
    type: string
  - name: Duration
    type: int
  - name: NumOfSegments
    type: int
  # ... other inputs

artifacts:
  - name: Segments
    type: array
    itemType: json
    countInput: NumOfSegments

prompts:
  path: ./prompts.toml

output:
  schema: ./output-schema.json
```

### prompts.toml
```toml
variables = ["InquiryPrompt", "Duration", "NumOfSegments", "Style"]

systemPrompt = """
[Narrative arc instructions]
[Visual consistency rules]
[Camera movement requirements]
[TTS narration guidelines]
[Timing enforcement with examples]
[Conditional field handling]
"""

userPrompt = """
Create a video about: {{InquiryPrompt}}
Duration: {{Duration}} seconds, {{NumOfSegments}} segments.
Style: {{Style}}
"""
```

### output-schema.json
Standard JSON Schema defining the structured output the LLM must produce.

## Workflow

1. **Read the blueprint** to understand the full producer graph
2. **Read existing producer YAMLs** (from catalog) to understand what inputs each asset producer accepts
3. **Design the output schema** — what structured data the director must produce
4. **Write the system prompt** applying ALL patterns above (arc, consistency, camera, TTS, timing, conditionals)
5. **Write the user prompt** binding all template variables
6. **Verify variable binding** — every `{{Variable}}` in TOML must match the `variables` array and YAML inputs

## Improvement Checklist

When reviewing or improving an existing director prompt:

- [ ] Narrative arc — Does it instruct segment ordering?
- [ ] Visual consistency — Color palette, lighting, character anchors, style repetition?
- [ ] Camera movement — Required in every video prompt section?
- [ ] TTS-friendly narration — Number spelling, abbreviations, sentence rhythm?
- [ ] Timing enforcement — Hard word-per-second limit with calibration examples?
- [ ] Conditional fields — Empty-string rules for type-dependent fields?
- [ ] Negative constraints — "No text, labels, or watermarks" in visual prompts?
- [ ] Concrete examples — At least one example prompt per media type?
- [ ] Variable binding — All `{{Variable}}` references match inputs?

## Reference Documents

- [Director Prompt Engineering Guide](./references/director-prompt-engineering.md) — Full patterns and templates
- [Prompt Producer Guide](./references/prompt-producer-guide.md) — File structure details
- [Prompting Templates](./references/prompting-templates.md) — Use-case-specific prompt patterns
