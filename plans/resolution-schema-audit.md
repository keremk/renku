# Schema Audit: Description-Only Resolution/Aspect/Duration Constraints

## Scope

Audited model schema files under `catalog/models/**` for these field families:

- `aspect_ratio`
- `resolution`
- `size`
- `video_size`
- `image_size`
- `target_resolution`
- `megapixels`
- `duration`
- `seconds`

The audit resolves local `$ref` before classification.

Fields are marked "description-only" when:

1. no explicit enum/const constraint is present on the resolved schema node, and
2. description text still communicates meaningful constraints (for example `only 1080p`, `5 or 10`, `match_input_image`, `2K`).

---

## Summary

- Files with description-only constraints: **26**
- Affected fields: **46**
- Provider distribution:
  - `replicate`: 25 files / 45 fields
  - `wavespeed-ai`: 1 file / 1 field

---

## Affected Files

## replicate/image

- `catalog/models/replicate/image/black-forest-labs-flux-2-flex.json`
  - `resolution`: description defines megapixel + ratio interactions, no enum
  - `aspect_ratio`: description references `match_input_image`, no enum
- `catalog/models/replicate/image/black-forest-labs-flux-2-klein-9b.json`
  - `megapixels`: description-only
  - `aspect_ratio`: description-only
- `catalog/models/replicate/image/black-forest-labs-flux-2-max.json`
  - `resolution`: description-only
  - `aspect_ratio`: description-only
- `catalog/models/replicate/image/black-forest-labs-flux-2-pro.json`
  - `resolution`: description-only
  - `aspect_ratio`: description-only
- `catalog/models/replicate/image/black-forest-labs-flux-kontext-pro.json`
  - `aspect_ratio`: description-only
- `catalog/models/replicate/image/bytedance-seedream-5-lite.json`
  - `size`: description implies `2K`/`3K`, no enum
  - `aspect_ratio`: description-only
- `catalog/models/replicate/image/google-nano-banana-2.json`
  - `resolution`: description-only
  - `aspect_ratio`: description-only
- `catalog/models/replicate/image/prunaai-flux-kontext-fast.json`
  - `aspect_ratio`: description-only
- `catalog/models/replicate/image/prunaai-p-image.json`
  - `aspect_ratio`: description-only
- `catalog/models/replicate/image/recraft-ai-recraft-v4-svg.json`
  - `size`: description says width/height semantics, no schema enum/object constraints
  - `aspect_ratio`: description-only
- `catalog/models/replicate/image/recraft-ai-recraft-v4.json`
  - `size`: description-only
  - `aspect_ratio`: description-only
- `catalog/models/replicate/image/xai-grok-imagine-image.json`
  - `aspect_ratio`: description-only

## replicate/video

- `catalog/models/replicate/video/kwaivgi-kling-o1.json`
  - `duration`: description implies mode-specific constraints (`5 or 10`, `3-10`)
  - `aspect_ratio`: description-only
- `catalog/models/replicate/video/kwaivgi-kling-v2-5-turbo-pro.json`
  - `duration`: description-only
  - `aspect_ratio`: description-only
- `catalog/models/replicate/video/kwaivgi-kling-v2-6.json`
  - `duration`: description-only
  - `aspect_ratio`: description-only
- `catalog/models/replicate/video/kwaivgi-kling-v3-omni-video.json`
  - `aspect_ratio`: description-only
- `catalog/models/replicate/video/kwaivgi-kling-v3-video.json`
  - `aspect_ratio`: description-only
- `catalog/models/replicate/video/lightricks-ltx-2-3-fast.json`
  - `duration`: description includes cross-field constraint (long duration requires 1080p + fps)
  - `resolution`: description implies mode-specific fixed value (`only 1080p`)
  - `aspect_ratio`: description-only
- `catalog/models/replicate/video/lightricks-ltx-2-3-pro.json`
  - `duration`: description-only
  - `resolution`: description implies mode-specific fixed value (`only 1080p`)
  - `aspect_ratio`: description-only
- `catalog/models/replicate/video/topazlabs-video-upscale.json`
  - `target_resolution`: description-only
- `catalog/models/replicate/video/vidu-q3-pro.json`
  - `resolution`: description-only
  - `aspect_ratio`: description-only
- `catalog/models/replicate/video/vidu-q3-turbo.json`
  - `resolution`: description-only
  - `aspect_ratio`: description-only
- `catalog/models/replicate/video/wan-video-wan-2-6-i2v.json`
  - `duration`: description-only
  - `resolution`: description-only
- `catalog/models/replicate/video/wan-video-wan-2-6-t2v.json`
  - `size`: description-only (contains both resolution and ratio semantics)
  - `duration`: description-only
- `catalog/models/replicate/video/wan-video-wan2-6-i2v-flash.json`
  - `duration`: description-only
  - `resolution`: description-only

## wavespeed-ai/image

- `catalog/models/wavespeed-ai/image/bytedance-seedream-v4-5.json`
  - `size`: `type: string` with description-only width/height semantics

---

## Implication for planning

For these files, enum-driven compatibility alone is insufficient. We need ingestion-time enrichment metadata so:

- UI can show valid options and warnings,
- compatibility snapping can happen in dry-run/live where safe,
- we avoid mutating provider contract semantics blindly.
