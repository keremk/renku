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

## Step 3: Analyze Schema

Read the generated JSON schema file. Identify cost-relevant input fields:

- **Video models**: Look for `duration`, `generate_audio`, `num_frames`, `video_size`, `resolution`, `aspect_ratio`
- **Image models**: Look for `image_size`, `quality`, `num_images`, `resolution`, `width`, `height`
- **Audio/TTS models**: Look for `text`, `duration`
- **STT models**: Look for `duration`

## Step 4: Look Up Pricing

Browse the model's fal.ai page to find pricing:

1. Get Chrome tab context with `tabs_context_mcp`
2. Create a new tab with `tabs_create_mcp`
3. Navigate to `https://fal.ai/models/fal-ai/<model-name>`
4. Use `find` to search for "cost per second", "price", or "charged"
5. Extract the pricing data (per-second, per-megapixel, per-run, etc.)

## Step 5: Select or Implement Cost Function

Read `docs/cost-functions-reference.md` in this skill directory for the full reference.

Match the model's pricing to an existing cost function:

| Pricing Pattern | Cost Function |
|----------------|---------------|
| Flat per run | `costByRun` |
| Per second (simple) | `costByVideoDuration` |
| Per second + audio toggle | `costByVideoDurationAndWithAudio` |
| Per second + resolution tiers | `costByVideoDurationAndResolution` |
| Per megapixel (video) | `costByVideoMegapixels` |
| Per million tokens | `costByVideoPerMillionTokens` |
| Per character | `costByCharacters` |
| Per second (audio) | `costByAudioSeconds` |
| Per megapixel (image) | `costByImageMegapixels` |
| Size + quality grid | `costByImageSizeAndQuality` |
| Resolution tiers (image) | `costByImageAndResolution` |
| Dimension-based (image) | `costByResolution` |
| Per token (text) | `costByInputTokens` |

If no existing function matches, implement a new one following the guide in `docs/cost-functions-reference.md` under "How to Add a New Cost Function".

## Step 6: Build & Insert YAML Entry

Read `docs/fal-yaml-format-reference.md` for the full format reference and section map.

1. Read `catalog/models/fal-ai/fal-ai.yaml`
2. Find the correct insertion point based on model family (see Section Map in the reference)
3. Build the YAML entry using the appropriate template
4. Insert using the Edit tool

## Step 7: Verify

Run the dry-run verifier:

```bash
node scripts/update-fal-catalog.mjs catalog/models/fal-ai/fal-ai.yaml --dry-run
```

If you modified `cost-functions.ts`, also run:

```bash
pnpm --filter @gorenku/providers check:all
```
