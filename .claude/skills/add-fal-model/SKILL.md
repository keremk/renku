---
name: add-fal-model
description: Add new fal.ai models to the Renku catalog. Fetches JSON schema, looks up pricing from fal.ai, matches/implements cost function, adds entry to fal-ai.yaml.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__find, mcp__claude-in-chrome__get_page_text, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__javascript_tool
---

# Add fal.ai Model to Catalog

Add a new fal.ai model to the Renku pricing catalog.

## Step 1: Gather Information

Ask the user for:

- **Model name** (e.g., `kling-video/v3/pro/text-to-video`)
- **Model type**: `video`, `image`, `audio`, `stt`, or `json`
- **Sub-provider** (optional): e.g., `wan`, `xai` — only if the model is not native to fal.ai

## Step 2: Fetch JSON Schema

Run the schema fetcher to download the model's input/output schema:

```bash
node scripts/fetch-fal-schema.mjs <model-name> --type=<type> [--subprovider=<sub>]
```

This creates a JSON file in `catalog/models/fal-ai/<type>/`. If the schema already exists, skip this step.

### Step 2a: Durable Fix Policy (Required)

Treat generated schema JSON files as refresh artifacts, not manual source of truth.

- Do not rely on hand-editing `catalog/models/fal-ai/**/*.json` for long-term fixes.
- Persist all manual corrections in:
  - `catalog/models/fal-ai/schema-overrides.yaml`
- The refresh scripts re-apply these patches after every upstream fetch.

When you identify a provider/schema mismatch (for example, max list size, enum correction, renamed field behavior), add a patch entry in `schema-overrides.yaml` for that model and type.

Example:

```yaml
version: 1
models:
  - name: qwen-image-2/pro/edit
    type: image
    patches:
      - op: add
        path: /input_schema/properties/image_urls/maxItems
        value: 3
```

## Step 3: Annotate Viewer Metadata (Required)

Immediately annotate and validate viewer metadata after schema fetch:

```bash
node scripts/annotate-viewer-schemas.mjs --model=<model-name>
node scripts/validate-viewer-schemas.mjs --model=<model-name>
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
node scripts/annotate-viewer-schemas.mjs --model=<model-name>
node scripts/validate-viewer-schemas.mjs --model=<model-name>
```

## Step 4: Analyze Schema

Read the generated JSON schema file and its `x-renku-viewer` annotations. Identify cost-relevant input fields:

- **Video models**: Look for `duration`, `generate_audio`, `num_frames`, `video_size`, `resolution`, `aspect_ratio`
- **Image models**: Look for `image_size`, `quality`, `num_images`, `resolution`, `width`, `height`
- **Audio/TTS models**: Look for `text`, `duration`
- **STT models**: Look for `duration`

## Step 5: Look Up Pricing

Browse the model's fal.ai page to find pricing:

1. Get Chrome tab context with `tabs_context_mcp`
2. Create a new tab with `tabs_create_mcp`
3. Navigate to the correct URL based on whether the model has a sub-provider:
   - **Native fal.ai model** (no sub-provider): `https://fal.ai/models/fal-ai/<model-name>`
   - **Sub-provider model** (e.g., `subProvider: xai`, `subProvider: wan`): `https://fal.ai/models/<model-name>` (no `fal-ai/` prefix)
4. Use `find` to search for "cost per second", "price", or "charged"
5. Extract the pricing data (per-second, per-megapixel, per-run, etc.)

## Step 6: Select or Implement Cost Function

Read `docs/cost-functions-reference.md` in this skill directory for the full reference.

Match the model's pricing to an existing cost function:

| Pricing Pattern               | Cost Function                      |
| ----------------------------- | ---------------------------------- |
| Flat per run                  | `costByRun`                        |
| Per second (simple)           | `costByVideoDuration`              |
| Per second + audio toggle     | `costByVideoDurationAndWithAudio`  |
| Per second + resolution tiers | `costByVideoDurationAndResolution` |
| Per megapixel (video)         | `costByVideoMegapixels`            |
| Per million tokens            | `costByVideoPerMillionTokens`      |
| Per character                 | `costByCharacters`                 |
| Per second (audio)            | `costByAudioSeconds`               |
| Per megapixel (image)         | `costByImageMegapixels`            |
| Size + quality grid           | `costByImageSizeAndQuality`        |
| Resolution tiers (image)      | `costByImageAndResolution`         |
| Dimension-based (image)       | `costByResolution`                 |
| Per token (text)              | `costByInputTokens`                |

If no existing function matches, implement a new one following the guide in `docs/cost-functions-reference.md` under "How to Add a New Cost Function".

## Step 7: Build & Insert YAML Entry

Read `docs/fal-yaml-format-reference.md` for the full format reference and section map.

1. Read `catalog/models/fal-ai/fal-ai.yaml`
2. Find the correct insertion point based on model family (see Section Map in the reference)
3. Build the YAML entry using the appropriate template
4. Insert using the Edit tool

## Step 8: Verify

Run the dry-run verifier:

```bash
node scripts/update-fal-catalog.mjs catalog/models/fal-ai/fal-ai.yaml --dry-run
node scripts/update-fal-catalog.mjs catalog/models/fal-ai/fal-ai.yaml --check-diff
node scripts/validate-viewer-schemas.mjs --model=<model-name>
```

If a model fails due to override patch drift:

- update `catalog/models/fal-ai/schema-overrides.yaml` for that model, then
- re-run only the model:

```bash
node scripts/update-fal-catalog.mjs catalog/models/fal-ai/fal-ai.yaml --update-diff --model=<model-name>
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
| `model-name` | `category/producer.yaml` | why this producer fits |
```

Also show the proposed field-level mappings for each model:

- Which producer inputs map to which API fields
- Any transformations needed (intToString, resolution mode, asArray, etc.)

Use `AskUserQuestion` to present this table and ask:

> "Does this mapping look correct? Let me know if anything needs adjusting before I add it."

Wait for confirmation before proceeding to 9b.

### 9b: Producer Selection Reference

| Model type / schema inputs                           | Producer file                   |
| ---------------------------------------------------- | ------------------------------- |
| `text` (TTS)                                         | `audio/text-to-speech.yaml`     |
| `reference_image_urls` array + `prompt` + `duration` | `video/ref-image-to-video.yaml` |
| `video_url` + `prompt` + `duration` (extend)         | `video/extend-video.yaml`       |
| `image_url` + `prompt` + `duration` (single image)   | `video/image-to-video.yaml`     |
| `prompt` + `duration` only (text-to-video)           | `video/text-to-video.yaml`      |
| `prompt` + `duration` + video editing                | `video/video-edit.yaml`         |

### 9c: Insert Mappings

For each model, add an entry under `mappings.fal-ai:` in the correct producer YAML, following existing patterns in that file. Use the Edit tool to insert after the last existing `fal-ai:` entry.

Common transformation patterns:

- **Plain integer duration**: `Duration: duration`
- **Duration as string**: `Duration: { field: duration, intToString: true }`
- **Duration as seconds string**: `Duration: { field: duration, intToSecondsString: true }`
- **Aspect ratio only**: `Resolution: { field: aspect_ratio, resolution: { mode: aspectRatio } }`
- **Aspect ratio + preset**: `Resolution: { expand: true, resolution: { mode: aspectRatioAndPresetObject, aspectRatioField: aspect_ratio, presetField: resolution } }`
- **Sub-provider models**: use the model name as-is (e.g., `xai/grok-imagine-video/extend-video:`)

### 9d: Validate Producer Mapping Contracts (Required)

After adding or updating producer mappings, run the producer mapping contract suite from the repo root:

```bash
pnpm validate:producers
```

Do not finish until this command passes. If it fails, fix the producer mappings and re-run.
