---
name: add-replicate-model
description: Add new Replicate models to the Renku catalog. Fetches JSON schema, looks up pricing from replicate.com, matches/implements cost function, adds entry to replicate.yaml.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__find, mcp__claude-in-chrome__get_page_text, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__javascript_tool
---

# Add Replicate Model to Catalog

Add a new Replicate model to the Renku pricing catalog.

## Step 1: Gather Information

Ask the user for:

- **Model name** (e.g., `openai/sora-2`) — always in `owner/model-name` format
- **Model type**: `video`, `image`, or `audio`

## Step 2: Fetch JSON Schema

Run the schema fetcher to download the model's input schema:

```bash
node scripts/fetch-replicate-schema.mjs <owner/model-name> --type=<type>
```

This creates a JSON file in `catalog/models/replicate/<type>/`. If the schema already exists, skip this step.

Requires `REPLICATE_API_TOKEN` environment variable.

## Step 3: Annotate Viewer Metadata (Required)

Immediately annotate and validate viewer metadata after schema fetch:

```bash
node scripts/annotate-viewer-schemas.mjs --model=<owner/model-name>
node scripts/validate-viewer-schemas.mjs --model=<owner/model-name>
```

Notes:

- `x-renku-viewer` is the UI source of truth for component initialization.
- If validation reports `placeholder-to-be-annotated` pointers, ask the user exactly which component should be used for each pointer and update annotations before continuing.
- Do not leave unresolved placeholders for newly added models unless user explicitly agrees.

### Step 3a: Voice-ID Markers for Audio/TTS (Required when applicable)

For audio narration/TTS schemas, propose voice field markers before moving on:

- **Heuristic candidates to inspect** (proposal only): `voice`, `voice_id`, `voiceId`, and nested variants like `voice_setting.voice_id`
- Ask the user to confirm exactly which schema pointer(s) should be marked
- After confirmation, annotate the **source schema node** (or referenced definition node) with:
  - `"x-voice-id": true`
  - optionally `"x-voices-file": "voices/<file>.json"` when shared rich voice metadata exists

Important rules:

- Never place `x-voice-id` / `x-voices-file` under `x-renku-viewer`; they belong to the original schema node.
- When `x-voices-file` is present, it is authoritative for voice options.
- Re-run annotation + validation after applying these markers:

```bash
node scripts/annotate-viewer-schemas.mjs --model=<owner/model-name>
node scripts/validate-viewer-schemas.mjs --model=<owner/model-name>
```

## Step 4: Analyze Schema

Read the generated JSON schema file and its `x-renku-viewer` annotations. Identify cost-relevant input fields:

- **Video models**: Look for `duration`, `seconds`, `generate_audio`, `mode`, `resolution`, `aspect_ratio`
- **Image models**: Look for `image_size`, `quality`, `num_images`, `resolution`, `width`, `height`
- **Audio/TTS models**: Look for `text`, `duration`

## Step 5: Look Up Pricing

Browse the model's Replicate pricing section directly using the `#pricing` anchor:

1. Get Chrome tab context with `tabs_context_mcp`
2. Create a new tab with `tabs_create_mcp`
3. Navigate to `https://replicate.com/<owner>/<model-name>#pricing`
4. Use `find` to search for "cost per second", "price", or pricing amounts
5. Take a screenshot to read the pricing cards
6. Extract the pricing data (per-second, per-run, per-character, etc.) and criteria (mode, audio, resolution)

## Step 6: Select or Implement Cost Function

Read `docs/cost-functions-reference.md` in this skill directory for the full reference.

Match the model's pricing to an existing cost function:

| Pricing Pattern                  | Cost Function                      |
| -------------------------------- | ---------------------------------- |
| Flat per run                     | `costByRun`                        |
| Per second (simple)              | `costByVideoDuration`              |
| Per second + audio toggle        | `costByVideoDurationAndWithAudio`  |
| Per second + resolution tiers    | `costByVideoDurationAndResolution` |
| Per second + mode (standard/pro) | `costByVideoDurationAndMode`       |
| Per second + mode + audio toggle | `costByVideoDurationModeAndAudio`  |
| Per megapixel (video)            | `costByVideoMegapixels`            |
| Per million tokens               | `costByVideoPerMillionTokens`      |
| Per character                    | `costByCharacters`                 |
| Per second (audio)               | `costByAudioSeconds`               |
| Per megapixel (image)            | `costByImageMegapixels`            |
| Size + quality grid              | `costByImageSizeAndQuality`        |
| Resolution tiers (image)         | `costByImageAndResolution`         |
| Dimension-based (image)          | `costByResolution`                 |
| Per token (text)                 | `costByInputTokens`                |

If no existing function matches, implement a new one following the guide in `docs/cost-functions-reference.md` under "How to Add a New Cost Function".

## Step 7: Build & Insert YAML Entry

Read `docs/replicate-yaml-format-reference.md` for the full format reference and section map.

1. Read `catalog/models/replicate/replicate.yaml`
2. Find the correct insertion point based on model family (see Section Map in the reference)
3. Build the YAML entry using the appropriate template
4. Insert using the Edit tool

## Step 8: Verify

Run the dry-run verifier:

```bash
node scripts/update-replicate-catalog.mjs catalog/models/replicate/replicate.yaml --dry-run
node scripts/validate-viewer-schemas.mjs --model=<owner/model-name>
```

If you modified `cost-functions.ts`, also run:

```bash
pnpm --filter @gorenku/providers check:all
```

## Step 9: Add to Producer Files

Map each new model to the correct producer YAML under `catalog/producers/`.

### 9a: Determine Producer Mapping

Read the relevant producer files and the model schemas, then build a proposed mapping table. Present it to the user in this format before making any changes:

```
| Model | Producer file | Reasoning |
|---|---|---|
| `owner/model-name` | `category/producer.yaml` | why this producer fits |
```

Also show the proposed field-level mappings for each model:

- Which producer inputs map to which API fields
- Any transformations needed (intToString, resolution mode, expand, etc.)

Ask the user:

> "Does this mapping look correct? Let me know if anything needs adjusting before I add it."

Wait for confirmation before proceeding to 9c.

### 9b: Producer Selection Reference

| Model type / schema inputs                       | Producer file                   |
| ------------------------------------------------ | ------------------------------- |
| `text` (TTS)                                     | `audio/text-to-speech.yaml`     |
| `lyrics` + `prompt` (music)                      | `audio/text-to-music.yaml`      |
| `reference_images` array + `prompt` + `duration` | `video/ref-image-to-video.yaml` |
| `video` + `prompt` + `duration` (extend)         | `video/extend-video.yaml`       |
| `image` + `prompt` + `duration` (single image)   | `video/image-to-video.yaml`     |
| `prompt` + `duration` only (text-to-video)       | `video/text-to-video.yaml`      |

### 9c: Insert Mappings

For each model, add an entry under `mappings.replicate:` in the correct producer YAML, following existing patterns in that file. Use the Edit tool to insert after the last existing `replicate:` entry. If no `replicate:` section exists yet, add one at the end of the file.

Common transformation patterns:

- **Plain integer duration**: `Duration: duration`
- **Duration as string**: `Duration: { field: duration, intToString: true }`
- **Aspect ratio only**: `Resolution: { field: aspect_ratio, resolution: { mode: aspectRatio } }`
- **Aspect ratio + preset (two fields)**: `Resolution: { expand: true, resolution: { mode: aspectRatioAndPresetObject, aspectRatioField: aspect_ratio, presetField: resolution } }`
