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

## Step 3: Analyze Schema

Read the generated JSON schema file. It uses a flat format (`{type, title, required, properties}`) with `x-order` for field ordering. Identify cost-relevant input fields:

- **Video models**: Look for `duration`, `seconds`, `generate_audio`, `mode`, `resolution`, `aspect_ratio`
- **Image models**: Look for `image_size`, `quality`, `num_images`, `resolution`, `width`, `height`
- **Audio/TTS models**: Look for `text`, `duration`

## Step 4: Look Up Pricing

Browse the model's Replicate pricing section directly using the `#pricing` anchor:

1. Get Chrome tab context with `tabs_context_mcp`
2. Create a new tab with `tabs_create_mcp`
3. Navigate to `https://replicate.com/<owner>/<model-name>#pricing`
4. Use `find` to search for "cost per second", "price", or pricing amounts
5. Take a screenshot to read the pricing cards
6. Extract the pricing data (per-second, per-run, per-character, etc.) and criteria (mode, audio, resolution)

## Step 5: Select or Implement Cost Function

Read `docs/cost-functions-reference.md` in this skill directory for the full reference.

Match the model's pricing to an existing cost function:

| Pricing Pattern | Cost Function |
|----------------|---------------|
| Flat per run | `costByRun` |
| Per second (simple) | `costByVideoDuration` |
| Per second + audio toggle | `costByVideoDurationAndWithAudio` |
| Per second + resolution tiers | `costByVideoDurationAndResolution` |
| Per second + mode (standard/pro) | `costByVideoDurationAndMode` |
| Per second + mode + audio toggle | `costByVideoDurationModeAndAudio` |
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

Read `docs/replicate-yaml-format-reference.md` for the full format reference and section map.

1. Read `catalog/models/replicate/replicate.yaml`
2. Find the correct insertion point based on model family (see Section Map in the reference)
3. Build the YAML entry using the appropriate template
4. Insert using the Edit tool

## Step 7: Verify

Run the dry-run verifier:

```bash
node scripts/update-replicate-catalog.mjs catalog/models/replicate/replicate.yaml --dry-run
```

If you modified `cost-functions.ts`, also run:

```bash
pnpm --filter @gorenku/providers check:all
```
