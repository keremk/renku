# Resolution Transform Function Catalog and Coverage

Generated from `plans/resolution-width-height-mapping-audit.md` and live producer/schema data.

## Goal
Define a minimal set of transform functions that map canonical `Resolution` (`{ width, height }`) into model-specific schema fields across all producers that declare `Resolution`.

## Scope
- Producers with Resolution input: 14
- Producer x model rows in scope: 216
- Hard unmatched rows (schema unresolved): 9
- Partial-introspection rows (schema fields via unresolved allOf $ref): 37

## Non-Negotiable Runtime Rules
- One source input for sizing: canonical `Resolution` object only.
- No silent mutation: every fallback must emit a warning with requested and selected value.
- Deterministic fallback only (same input + schema => same output).
- If no deterministic fallback exists, fail fast and mark as unmatched.

## Transform Functions

### TF001_resolutionToAspectRatioEnum
- **Input:** `{ width, height }`, target enum (e.g. `16:9`, `9:16`, optionally `auto`).
- **Output:** one enum value for `aspect_ratio`.
- **Algorithm:** reduce ratio using gcd -> exact match; else if `auto` allowed choose `auto`; else choose nearest allowed ratio by absolute ratio distance.
- **Warning behavior:** warn when not exact.

### TF002_resolutionToPresetEnum
- **Input:** `{ width, height }`, target enum (e.g. `360p/540p/720p/1080p/1440p/2160p/4k`).
- **Output:** one enum value for `resolution`.
- **Algorithm:** derive short-edge preset from `min(width,height)`; if exact missing, pick nearest supported preset (prefer lower on tie), or `auto` when configured.
- **Warning behavior:** warn on downgrade/upgrade or `auto` fallback.

### TF003_resolutionToAspectPlusPreset
- **Input:** `{ width, height }`, field names for aspect and preset (e.g. `aspect_ratio`, `resolution`).
- **Output:** object with two fields, or auto-mode fallback object when configured.
- **Algorithm:** TF001 + TF002; supports model-specific auto fallback (e.g. omit preset and set `aspect_ratio=auto`).
- **Warning behavior:** same as TF001/TF002 plus explicit auto-mode warning.

### TF004_resolutionToSizeObject
- **Input:** `{ width, height }`, constraints (min/max/multiple-of if present).
- **Output:** `{ width, height }` assigned to `image_size` or `video_size`.
- **Algorithm:** pass through dimensions; optionally clamp/round to schema constraints.
- **Warning behavior:** warn when clamped/rounded.

### TF005_resolutionToImageSizeToken
- **Input:** `{ width, height }`, token enum (e.g. `landscape_16_9`, `square_hd`).
- **Output:** token string for `image_size`.
- **Algorithm:** map normalized aspect ratio to token; if unavailable choose nearest compatible token by ratio distance.
- **Warning behavior:** warn when nearest token differs from exact.

### TF006_resolutionToDimensionString
- **Input:** `{ width, height }`, format (`WxH` or `W*H`), optional enum allowlist.
- **Output:** dimension string for `size` or equivalent field.
- **Algorithm:** format dimensions; if allowlist exists and exact missing, choose nearest allowed dimension by ratio + area distance.
- **Warning behavior:** warn when selecting nearest allowed entry.

### TF007_resolutionToWidthHeight
- **Input:** `{ width, height }`, optional constraints and snapping step.
- **Output:** separate numeric fields `width`, `height`.
- **Algorithm:** direct split; clamp/snap when required by schema bounds/multiples.
- **Warning behavior:** warn on clamp/snap.

### TF008_resolutionToMegapixelsEnum
- **Input:** `{ width, height }`, model megapixel enum/value format.
- **Output:** megapixel token/value (e.g. `1 MP`, `2 MP`, `4 MP`).
- **Algorithm:** compute megapixels (`width*height/1e6`), then nearest allowed MP value with deterministic tie-break.
- **Warning behavior:** warn when nearest MP differs from computed MP.

### TF009_resolutionToLongestSideInteger
- **Input:** `{ width, height }`, integer constraints for `image_size` style field.
- **Output:** one integer (`max(width,height)`) for longest-side schema fields.
- **Algorithm:** derive longest side then clamp/snap to allowed min/max/multiple.
- **Warning behavior:** warn on clamp/snap.

### TF010_ignoreResolutionWithWarning
- **Input:** `{ width, height }`, model metadata.
- **Output:** no payload field for size.
- **Algorithm:** do nothing because model schema has no size-related input field.
- **Warning behavior:** emit warning that Resolution is ignored for that model.

### TF011_resolutionToSizeTokenOrDimensionEnum
- **Input:** `{ width, height }`, partially known `size` schema (often unresolved `$ref`).
- **Output:** `size` token or dimension string.
- **Algorithm:** attempt token mapping (1K/2K/4K) first, else dimension string fallback; requires model-specific enum source when schema refs are unresolved.
- **Warning behavior:** warn on fallback path; fail if no deterministic mapping table exists.

## Case -> Function Mapping
| Case | Rows | Function(s) | Meaning |
| --- | ---: | --- | --- |
| CASE_A_ASPECT_PLUS_PRESET | 68 | `TF003_resolutionToAspectPlusPreset` | Model expects both aspect_ratio and resolution preset. |
| CASE_B_RESOLUTION_PRESET_ONLY | 29 | `TF002_resolutionToPresetEnum` | Model expects resolution preset only. |
| CASE_C_SIZE_OBJECT | 45 | `TF004_resolutionToSizeObject` | Model accepts object size via image_size (direct or anyOf). |
| CASE_D_IMAGE_SIZE_TOKEN | 5 | `TF005_resolutionToImageSizeToken` | Model expects image_size token/string preset. |
| CASE_E_SIZE_DIMENSION_STRING | 3 | `TF006_resolutionToDimensionString` | Model expects size as dimension string (WxH / W*H). |
| CASE_E_SIZE_TOKEN_OR_DIM_UNRESOLVED | 3 | `TF011_resolutionToSizeTokenOrDimensionEnum` | Model has size field but enum/format comes via unresolved refs. |
| CASE_F_WIDTH_HEIGHT_FIELDS | 6 | `TF007_resolutionToWidthHeight` | Model expects explicit width and height fields. |
| CASE_G_ASPECT_ONLY | 27 | `TF001_resolutionToAspectRatioEnum` | Model expects aspect_ratio only. |
| CASE_H_NO_SIZE_FIELD | 14 | `TF010_ignoreResolutionWithWarning` | Schema has no size/aspect input fields. |
| CASE_J_MEGAPIXELS_WITH_ASPECT | 6 | `TF008_resolutionToMegapixelsEnum`, `TF001_resolutionToAspectRatioEnum` | Model expects megapixels plus aspect_ratio. |
| CASE_K_LONGEST_SIDE_INTEGER | 1 | `TF009_resolutionToLongestSideInteger` | Model expects numeric image_size (long side). |
| CASE_I_SCHEMA_UNRESOLVED | 9 | `UNMAPPED_MANUAL` | MODEL_NOT_FOUND |

## Coverage by Case (Producer + Model)

### CASE_A_ASPECT_PLUS_PRESET (68)
Recommended: `TF003_resolutionToAspectPlusPreset`

| Producer | Provider | Model | Current Resolution Rule(s) | Schema Path | Size Fields | Unresolved Refs |
| --- | --- | --- | --- | --- | --- | --- |
| catalog/producers/image/image-compose.yaml | fal-ai | nano-banana-2/edit | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/image/nano-banana-2-edit.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/image/image-compose.yaml | fal-ai | nano-banana-pro/edit | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/image/nano-banana-pro-edit.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/image/image-compose.yaml | replicate | google/nano-banana-2 | `Resolution` -> `resolution` (direct) | catalog/models/replicate/image/google-nano-banana-2.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/image/image-compose.yaml | replicate | google/nano-banana-pro | `Resolution` -> `resolution` (direct) | catalog/models/replicate/image/google-nano-banana-pro.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | nano-banana-2/edit | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/image/nano-banana-2-edit.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | nano-banana-pro/edit | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/image/nano-banana-pro-edit.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/image/image-edit.yaml | replicate | google/nano-banana-2 | `Resolution` -> `resolution` (direct) | catalog/models/replicate/image/google-nano-banana-2.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/image/text-to-grid-images.yaml | fal-ai | nano-banana-pro | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/image/nano-banana-pro.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | nano-banana-2 | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/image/nano-banana-2.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | nano-banana-pro | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/image/nano-banana-pro.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/image/text-to-image.yaml | replicate | google/nano-banana-2 | `Resolution` -> `resolution` (direct) | catalog/models/replicate/image/google-nano-banana-2.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/video/extend-video.yaml | fal-ai | veo3.1/extend-video | `Resolution`: source=`Resolution`, expand=true, resolution.mode=`aspectRatioAndPresetObject` (aspectRatioField=`aspect_ratio`, presetField=`resolution`) | catalog/models/fal-ai/video/veo3-1-extend-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/extend-video.yaml | fal-ai | veo3.1/fast/extend-video | `Resolution`: source=`Resolution`, expand=true, resolution.mode=`aspectRatioAndPresetObject` (aspectRatioField=`aspect_ratio`, presetField=`resolution`) | catalog/models/fal-ai/video/veo3-1-fast-extend-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | bytedance/seedance/v1.5/pro/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/bytedance-seedance-v1-5-pro-image-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | bytedance/seedance/v1/pro/fast/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/bytedance-seedance-v1-pro-fast-image-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | decart/lucy-14b/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/decart-lucy-14b-image-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | ltx-2.3/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/ltx-2-3-image-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | ltx-2.3/image-to-video/fast | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/ltx-2-3-image-to-video-fast.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | sora-2/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/sora-2-image-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | sora-2/image-to-video/pro | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/sora-2-image-to-video-pro.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | veo3.1/fast/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/veo3-1-fast-image-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | veo3.1/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/veo3-1-image-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | xai/grok-imagine-video/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/xai-grok-imagine-video-image-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/image-to-video.yaml | replicate | bytedance/seedance-1-pro-fast | none | catalog/models/replicate/video/bytedance-seedance-1-pro-fast.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/image-to-video.yaml | replicate | google/veo-3.1-fast | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/google-veo-3-1-fast.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/image-to-video.yaml | replicate | lightricks/ltx-2.3-fast | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/lightricks-ltx-2-3-fast.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/video/image-to-video.yaml | replicate | lightricks/ltx-2.3-pro | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/lightricks-ltx-2-3-pro.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/video/image-to-video.yaml | replicate | vidu/q3-pro | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/vidu-q3-pro.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/video/image-to-video.yaml | replicate | vidu/q3-turbo | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/vidu-q3-turbo.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/video/image-to-video.yaml | replicate | xai/grok-imagine-video | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/xai-grok-imagine-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/ref-image-to-video.yaml | fal-ai | wan/v2.6/reference-to-video/flash | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/wan-v2-6-reference-to-video-flash.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/ref-image-to-video.yaml | replicate | bytedance/seedance-1-lite | none | catalog/models/replicate/video/bytedance-seedance-1-lite.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/ref-video-to-video.yaml | fal-ai | wan/v2.6/reference-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/wan-v2-6-reference-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/ref-video-to-video.yaml | fal-ai | wan/v2.6/reference-to-video/flash | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/wan-v2-6-reference-to-video-flash.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/start-end-frame-to-video.yaml | fal-ai | bytedance/seedance/v1.5/pro/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/bytedance-seedance-v1-5-pro-image-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/start-end-frame-to-video.yaml | fal-ai | ltx-2.3/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/ltx-2-3-image-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/start-end-frame-to-video.yaml | fal-ai | ltx-2.3/image-to-video/fast | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/ltx-2-3-image-to-video-fast.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/start-end-frame-to-video.yaml | fal-ai | veo3.1/fast/first-last-frame-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/veo3-1-fast-first-last-frame-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/start-end-frame-to-video.yaml | fal-ai | veo3.1/first-last-frame-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/veo3-1-first-last-frame-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | google/veo-3.1-fast | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/google-veo-3-1-fast.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | lightricks/ltx-2.3-fast | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/lightricks-ltx-2-3-fast.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | lightricks/ltx-2.3-pro | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/lightricks-ltx-2-3-pro.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | vidu/q3-pro | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/vidu-q3-pro.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | vidu/q3-turbo | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/vidu-q3-turbo.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/video/text-to-video.yaml | fal-ai | bytedance/seedance/v1.5/pro/text-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/bytedance-seedance-v1-5-pro-text-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | fal-ai | bytedance/seedance/v1/pro/fast/text-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/bytedance-seedance-v1-pro-fast-text-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | fal-ai | ltx-2.3/text-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/ltx-2-3-text-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | fal-ai | pixverse/v5/text-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/pixverse-v5-text-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | fal-ai | sora-2/text-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/sora-2-text-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | fal-ai | veo3.1 | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/veo3-1.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | fal-ai | veo3.1/fast | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/veo3-1-fast.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | fal-ai | vidu/q3/text-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/vidu-q3-text-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | fal-ai | vidu/q3/text-to-video/turbo | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/vidu-q3-text-to-video-turbo.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | fal-ai | wan-25-preview/text-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/wan-25-preview-text-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | fal-ai | wan/v2.6/text-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/wan-v2-6-text-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | fal-ai | xai/grok-imagine-video/text-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/xai-grok-imagine-video-text-to-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | replicate | bytedance/seedance-1-lite | none | catalog/models/replicate/video/bytedance-seedance-1-lite.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | replicate | bytedance/seedance-1-pro-fast | none | catalog/models/replicate/video/bytedance-seedance-1-pro-fast.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | replicate | google/veo-3.1-fast | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/google-veo-3-1-fast.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/text-to-video.yaml | replicate | lightricks/ltx-2.3-fast | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/lightricks-ltx-2-3-fast.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/video/text-to-video.yaml | replicate | lightricks/ltx-2.3-pro | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/lightricks-ltx-2-3-pro.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/video/text-to-video.yaml | replicate | vidu/q3-pro | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/vidu-q3-pro.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/video/text-to-video.yaml | replicate | vidu/q3-turbo | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/vidu-q3-turbo.json | `aspect_ratio`, `resolution` | `resolution`, `aspect_ratio` |
| catalog/producers/video/text-to-video.yaml | replicate | xai/grok-imagine-video | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/xai-grok-imagine-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/video-edit.yaml | replicate | xai/grok-imagine-video | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/xai-grok-imagine-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/video-to-video.yaml | fal-ai | veo3.1/extend-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/veo3-1-extend-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/video-to-video.yaml | fal-ai | veo3.1/fast/extend-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/veo3-1-fast-extend-video.json | `aspect_ratio`, `resolution` | - |
| catalog/producers/video/video-to-video.yaml | replicate | xai/grok-imagine-video | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/xai-grok-imagine-video.json | `aspect_ratio`, `resolution` | - |

### CASE_B_RESOLUTION_PRESET_ONLY (29)
Recommended: `TF002_resolutionToPresetEnum`

| Producer | Provider | Model | Current Resolution Rule(s) | Schema Path | Size Fields | Unresolved Refs |
| --- | --- | --- | --- | --- | --- | --- |
| catalog/producers/video/image-to-video.yaml | fal-ai | pixverse/v5/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/pixverse-v5-image-to-video.json | `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | vidu/q3/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/vidu-q3-image-to-video.json | `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | vidu/q3/image-to-video/turbo | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/vidu-q3-image-to-video-turbo.json | `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | wan-25-preview/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/wan-25-preview-image-to-video.json | `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | wan/v2.6/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/wan-v2-6-image-to-video.json | `resolution` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | wan/v2.6/image-to-video/flash | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/wan-v2-6-image-to-video-flash.json | `resolution` | - |
| catalog/producers/video/image-to-video.yaml | replicate | minimax/hailuo-02 | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/minimax-hailuo-02.json | `resolution` | - |
| catalog/producers/video/image-to-video.yaml | replicate | minimax/hailuo-02-fast | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/minimax-hailuo-02-fast.json | `resolution` | - |
| catalog/producers/video/image-to-video.yaml | replicate | minimax/hailuo-2.3 | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/minimax-hailuo-2-3.json | `resolution` | - |
| catalog/producers/video/image-to-video.yaml | replicate | minimax/hailuo-2.3-fast | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/minimax-hailuo-2-3-fast.json | `resolution` | - |
| catalog/producers/video/image-to-video.yaml | replicate | wan-video/wan-2.6-i2v | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/wan-video-wan-2-6-i2v.json | `resolution` | `resolution` |
| catalog/producers/video/image-to-video.yaml | replicate | wan-video/wan2.6-i2v-flash | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/wan-video-wan2-6-i2v-flash.json | `resolution` | `resolution` |
| catalog/producers/video/ref-image-to-video.yaml | fal-ai | veo3.1/reference-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/veo3-1-reference-to-video.json | `resolution` | - |
| catalog/producers/video/start-end-frame-to-video.yaml | fal-ai | vidu/q3/image-to-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/vidu-q3-image-to-video.json | `resolution` | - |
| catalog/producers/video/start-end-frame-to-video.yaml | fal-ai | vidu/q3/image-to-video/turbo | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/vidu-q3-image-to-video-turbo.json | `resolution` | - |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | minimax/hailuo-02 | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/minimax-hailuo-02.json | `resolution` | - |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | minimax/hailuo-02-fast | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/minimax-hailuo-02-fast.json | `resolution` | - |
| catalog/producers/video/talking-head.yaml | fal-ai | bytedance/omnihuman/v1.5 | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/bytedance-omnihuman-v1-5.json | `resolution` | - |
| catalog/producers/video/talking-head.yaml | fal-ai | creatify/aurora | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/creatify-aurora.json | `resolution` | - |
| catalog/producers/video/talking-head.yaml | fal-ai | infinitalk | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/infinitalk.json | `resolution` | - |
| catalog/producers/video/talking-head.yaml | fal-ai | veed/fabric-1.0/fast | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/veed-fabric-1-0-fast.json | `resolution` | - |
| catalog/producers/video/talking-head.yaml | wavespeed-ai | wavespeed-ai/infinitetalk | `Resolution` -> `resolution` (direct) | catalog/models/wavespeed-ai/video/wavespeed-ai-infinitetalk.json | `resolution` | - |
| catalog/producers/video/text-to-talking-head.yaml | fal-ai | infinitalk/single-text | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/infinitalk-single-text.json | `resolution` | - |
| catalog/producers/video/text-to-talking-head.yaml | fal-ai | veed/fabric-1.0/text | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/veed-fabric-1-0-text.json | `resolution` | - |
| catalog/producers/video/text-to-video.yaml | replicate | minimax/hailuo-2.3 | `Resolution` -> `resolution` (direct) | catalog/models/replicate/video/minimax-hailuo-2-3.json | `resolution` | - |
| catalog/producers/video/video-edit.yaml | fal-ai | decart/lucy-edit/pro | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/decart-lucy-edit-pro.json | `resolution` | - |
| catalog/producers/video/video-edit.yaml | fal-ai | xai/grok-imagine-video/edit-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/xai-grok-imagine-video-edit-video.json | `resolution` | - |
| catalog/producers/video/video-to-video.yaml | fal-ai | decart/lucy-edit/pro | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/decart-lucy-edit-pro.json | `resolution` | - |
| catalog/producers/video/video-to-video.yaml | fal-ai | xai/grok-imagine-video/edit-video | `Resolution` -> `resolution` (direct) | catalog/models/fal-ai/video/xai-grok-imagine-video-edit-video.json | `resolution` | - |

### CASE_C_SIZE_OBJECT (45)
Recommended: `TF004_resolutionToSizeObject`

| Producer | Provider | Model | Current Resolution Rule(s) | Schema Path | Size Fields | Unresolved Refs |
| --- | --- | --- | --- | --- | --- | --- |
| catalog/producers/image/image-compose.yaml | fal-ai | bytedance/seedream/v4.5/edit | `ImageSize`: source=`ImageSize`, field=`image_size`, combine.inputs=[AspectRatio, Resolution] | catalog/models/fal-ai/image/bytedance-seedream-v4-5-edit.json | `image_size` | - |
| catalog/producers/image/image-compose.yaml | fal-ai | bytedance/seedream/v4/edit | none | catalog/models/fal-ai/image/bytedance-seedream-v4-edit.json | `image_size` | - |
| catalog/producers/image/image-compose.yaml | fal-ai | bytedance/seedream/v5/lite/edit | `ImageSize`: source=`ImageSize`, field=`image_size`, combine.inputs=[AspectRatio, Resolution] | catalog/models/fal-ai/image/bytedance-seedream-v5-lite-edit.json | `image_size` | - |
| catalog/producers/image/image-compose.yaml | fal-ai | flux-2/edit | none | catalog/models/fal-ai/image/flux-2-edit.json | `image_size` | - |
| catalog/producers/image/image-compose.yaml | fal-ai | flux-2/flash/edit | none | catalog/models/fal-ai/image/flux-2-flash-edit.json | `image_size` | - |
| catalog/producers/image/image-compose.yaml | fal-ai | flux-2/turbo/edit | none | catalog/models/fal-ai/image/flux-2-turbo-edit.json | `image_size` | - |
| catalog/producers/image/image-compose.yaml | fal-ai | hunyuan-image/v3/instruct/edit | none | catalog/models/fal-ai/image/hunyuan-image-v3-instruct-edit.json | `image_size` | - |
| catalog/producers/image/image-compose.yaml | fal-ai | qwen-image-2/edit | none | catalog/models/fal-ai/image/qwen-image-2-edit.json | `image_size` | - |
| catalog/producers/image/image-compose.yaml | fal-ai | qwen-image-2/pro/edit | none | catalog/models/fal-ai/image/qwen-image-2-pro-edit.json | `image_size` | - |
| catalog/producers/image/image-compose.yaml | fal-ai | qwen-image-edit-2511 | none | catalog/models/fal-ai/image/qwen-image-edit-2511.json | `image_size` | - |
| catalog/producers/image/image-compose.yaml | fal-ai | wan/v2.6/image-to-image | none | catalog/models/fal-ai/image/wan-v2-6-image-to-image.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | bytedance/seedream/v4.5/edit | `ImageSize`: source=`ImageSize`, field=`image_size`, combine.inputs=[AspectRatio, Resolution] | catalog/models/fal-ai/image/bytedance-seedream-v4-5-edit.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | bytedance/seedream/v4/edit | none | catalog/models/fal-ai/image/bytedance-seedream-v4-edit.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | bytedance/seedream/v5/lite/edit | `ImageSize`: source=`ImageSize`, field=`image_size`, combine.inputs=[AspectRatio, Resolution] | catalog/models/fal-ai/image/bytedance-seedream-v5-lite-edit.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | flux-2/edit | none | catalog/models/fal-ai/image/flux-2-edit.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | flux-2/flash/edit | none | catalog/models/fal-ai/image/flux-2-flash-edit.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | flux-2/turbo/edit | none | catalog/models/fal-ai/image/flux-2-turbo-edit.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | hunyuan-image/v3/instruct/edit | none | catalog/models/fal-ai/image/hunyuan-image-v3-instruct-edit.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | qwen-image-2/edit | none | catalog/models/fal-ai/image/qwen-image-2-edit.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | qwen-image-2/pro/edit | none | catalog/models/fal-ai/image/qwen-image-2-pro-edit.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | qwen-image-edit-2511 | none | catalog/models/fal-ai/image/qwen-image-edit-2511.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | wan/v2.6/image-to-image | none | catalog/models/fal-ai/image/wan-v2-6-image-to-image.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | z-image/turbo/image-to-image | none | catalog/models/fal-ai/image/z-image-turbo-image-to-image.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | bytedance/seedream/v4.5/text-to-image | `ImageSize`: source=`ImageSize`, field=`image_size`, combine.inputs=[AspectRatio, Resolution] | catalog/models/fal-ai/image/bytedance-seedream-v4-5-text-to-image.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | bytedance/seedream/v4/text-to-image | none | catalog/models/fal-ai/image/bytedance-seedream-v4-text-to-image.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | bytedance/seedream/v5/lite/text-to-image | `ImageSize`: source=`ImageSize`, field=`image_size`, combine.inputs=[AspectRatio, Resolution] | catalog/models/fal-ai/image/bytedance-seedream-v5-lite-text-to-image.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | flux-2 | none | catalog/models/fal-ai/image/flux-2.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | flux-2/flash | none | catalog/models/fal-ai/image/flux-2-flash.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | flux-2/turbo | none | catalog/models/fal-ai/image/flux-2-turbo.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | hunyuan-image/v3/instruct/text-to-image | none | catalog/models/fal-ai/image/hunyuan-image-v3-instruct-text-to-image.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | qwen-image-2/pro/text-to-image | none | catalog/models/fal-ai/image/qwen-image-2-pro-text-to-image.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | qwen-image-2/text-to-image | none | catalog/models/fal-ai/image/qwen-image-2-text-to-image.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | qwen-image-2512 | `ImageSize`: source=`ImageSize`, conditional=true | catalog/models/fal-ai/image/qwen-image-2512.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | recraft/v4/pro/text-to-image | none | catalog/models/fal-ai/image/recraft-v4-pro-text-to-image.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | recraft/v4/text-to-image | none | catalog/models/fal-ai/image/recraft-v4-text-to-image.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | wan/v2.6/text-to-image | none | catalog/models/fal-ai/image/wan-v2-6-text-to-image.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | z-image/turbo | none | catalog/models/fal-ai/image/z-image-turbo.json | `image_size` | - |
| catalog/producers/video/extend-video.yaml | fal-ai | ltx-2-19b/distilled/extend-video | `Resolution` -> `video_size` (direct) | catalog/models/fal-ai/video/ltx-2-19b-distilled-extend-video.json | `video_size` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | ltx-2-19b/distilled/image-to-video | `VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution] | catalog/models/fal-ai/video/ltx-2-19b-distilled-image-to-video.json | `video_size` | - |
| catalog/producers/video/start-end-frame-to-video.yaml | fal-ai | ltx-2-19b/distilled/image-to-video | `VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution] | catalog/models/fal-ai/video/ltx-2-19b-distilled-image-to-video.json | `video_size` | - |
| catalog/producers/video/talking-head.yaml | fal-ai | ltx-2-19b/audio-to-video | `VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution] | catalog/models/fal-ai/video/ltx-2-19b-audio-to-video.json | `video_size` | - |
| catalog/producers/video/talking-head.yaml | fal-ai | ltx-2-19b/distilled/audio-to-video | `VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution] | catalog/models/fal-ai/video/ltx-2-19b-distilled-audio-to-video.json | `video_size` | - |
| catalog/producers/video/text-to-video.yaml | fal-ai | ltx-2-19b/distilled/text-to-video | `VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution] | catalog/models/fal-ai/video/ltx-2-19b-distilled-text-to-video.json | `video_size` | - |
| catalog/producers/video/video-to-video.yaml | fal-ai | ltx-2-19b/distilled/extend-video | `VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution] | catalog/models/fal-ai/video/ltx-2-19b-distilled-extend-video.json | `video_size` | - |
| catalog/producers/video/video-to-video.yaml | fal-ai | ltx-2-19b/distilled/video-to-video | `VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution] | catalog/models/fal-ai/video/ltx-2-19b-distilled-video-to-video.json | `video_size` | - |

### CASE_D_IMAGE_SIZE_TOKEN (5)
Recommended: `TF005_resolutionToImageSizeToken`

| Producer | Provider | Model | Current Resolution Rule(s) | Schema Path | Size Fields | Unresolved Refs |
| --- | --- | --- | --- | --- | --- | --- |
| catalog/producers/image/image-compose.yaml | fal-ai | gpt-image-1.5/edit | none | catalog/models/fal-ai/image/gpt-image-1-5-edit.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | gpt-image-1.5/edit | none | catalog/models/fal-ai/image/gpt-image-1-5-edit.json | `image_size` | - |
| catalog/producers/image/image-edit.yaml | replicate | qwen/qwen-image | `Resolution`: source=`Resolution`, field=`image_size`, transform.entries=3 | catalog/models/replicate/image/qwen-qwen-image.json | `aspect_ratio`, `image_size` | - |
| catalog/producers/image/text-to-grid-images.yaml | fal-ai | gpt-image-1.5 | none | catalog/models/fal-ai/image/gpt-image-1-5.json | `image_size` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | gpt-image-1.5 | none | catalog/models/fal-ai/image/gpt-image-1-5.json | `image_size` | - |

### CASE_E_SIZE_DIMENSION_STRING (3)
Recommended: `TF006_resolutionToDimensionString`

| Producer | Provider | Model | Current Resolution Rule(s) | Schema Path | Size Fields | Unresolved Refs |
| --- | --- | --- | --- | --- | --- | --- |
| catalog/producers/image/text-to-image.yaml | replicate | recraft-ai/recraft-v4 | `Resolution`: source=`Resolution`, field=`size`, transform.entries=2 | catalog/models/replicate/image/recraft-ai-recraft-v4.json | `aspect_ratio`, `size` | `size`, `aspect_ratio` |
| catalog/producers/image/text-to-image.yaml | wavespeed-ai | bytedance/seedream-v4.5 | `Resolution`: source=`Resolution`, field=`size`, transform.entries=3 | catalog/models/wavespeed-ai/image/bytedance-seedream-v4-5.json | `size` | - |
| catalog/producers/video/text-to-video.yaml | replicate | wan-video/wan-2.6-t2v | none | catalog/models/replicate/video/wan-video-wan-2-6-t2v.json | `size` | `size` |

### CASE_E_SIZE_TOKEN_OR_DIM_UNRESOLVED (3)
Recommended: `TF011_resolutionToSizeTokenOrDimensionEnum`

| Producer | Provider | Model | Current Resolution Rule(s) | Schema Path | Size Fields | Unresolved Refs |
| --- | --- | --- | --- | --- | --- | --- |
| catalog/producers/image/image-compose.yaml | replicate | bytedance/seedream-5-lite | `Resolution`: source=`Resolution`, field=`size`, transform.entries=3 | catalog/models/replicate/image/bytedance-seedream-5-lite.json | `aspect_ratio`, `size` | `size`, `aspect_ratio` |
| catalog/producers/image/image-edit.yaml | replicate | bytedance/seedream-5-lite | `Resolution` -> `size` (direct) | catalog/models/replicate/image/bytedance-seedream-5-lite.json | `aspect_ratio`, `size` | `size`, `aspect_ratio` |
| catalog/producers/image/text-to-image.yaml | replicate | bytedance/seedream-5-lite | `Resolution` -> `size` (direct) | catalog/models/replicate/image/bytedance-seedream-5-lite.json | `aspect_ratio`, `size` | `size`, `aspect_ratio` |

### CASE_F_WIDTH_HEIGHT_FIELDS (6)
Recommended: `TF007_resolutionToWidthHeight`

| Producer | Provider | Model | Current Resolution Rule(s) | Schema Path | Size Fields | Unresolved Refs |
| --- | --- | --- | --- | --- | --- | --- |
| catalog/producers/image/image-compose.yaml | replicate | bytedance/seedream-4 | `Resolution`: source=`Resolution`, field=`size`, transform.entries=4<br>`Width`: source=`Width`, conditional=true<br>`Height`: source=`Height`, conditional=true | catalog/models/replicate/image/bytedance-seedream-4.json | `aspect_ratio`, `height`, `output_size`, `size`, `width` | - |
| catalog/producers/image/image-compose.yaml | replicate | bytedance/seedream-4.5 | `Resolution`: source=`Resolution`, field=`size`, transform.entries=4<br>`Width`: source=`Width`, conditional=true<br>`Height`: source=`Height`, conditional=true | catalog/models/replicate/image/bytedance-seedream-4-5.json | `aspect_ratio`, `height`, `size`, `width` | - |
| catalog/producers/image/text-to-image.yaml | replicate | bytedance/seedream-4 | `Resolution` -> `size` (direct) | catalog/models/replicate/image/bytedance-seedream-4.json | `aspect_ratio`, `height`, `output_size`, `size`, `width` | - |
| catalog/producers/image/text-to-image.yaml | replicate | bytedance/seedream-4.5 | `Resolution` -> `size` (direct) | catalog/models/replicate/image/bytedance-seedream-4-5.json | `aspect_ratio`, `height`, `size`, `width` | - |
| catalog/producers/image/text-to-image.yaml | replicate | prunaai/p-image | none | catalog/models/replicate/image/prunaai-p-image.json | `aspect_ratio`, `height`, `width` | `aspect_ratio` |
| catalog/producers/image/text-to-image.yaml | replicate | prunaai/z-image-turbo | `ImageSize`: source=`ImageSize`, conditional=true | catalog/models/replicate/image/prunaai-z-image-turbo.json | `height`, `width` | - |

### CASE_G_ASPECT_ONLY (27)
Recommended: `TF001_resolutionToAspectRatioEnum`

| Producer | Provider | Model | Current Resolution Rule(s) | Schema Path | Size Fields | Unresolved Refs |
| --- | --- | --- | --- | --- | --- | --- |
| catalog/producers/image/image-compose.yaml | replicate | black-forest-labs/flux-kontext-pro | none | catalog/models/replicate/image/black-forest-labs-flux-kontext-pro.json | `aspect_ratio` | `aspect_ratio` |
| catalog/producers/image/image-compose.yaml | replicate | google/nano-banana | none | catalog/models/replicate/image/google-nano-banana.json | `aspect_ratio` | - |
| catalog/producers/image/image-compose.yaml | replicate | qwen/qwen-image-edit-2511 | none | catalog/models/replicate/image/qwen-qwen-image-edit-2511.json | `aspect_ratio` | - |
| catalog/producers/image/image-edit.yaml | fal-ai | flux-pro/kontext | none | catalog/models/fal-ai/image/flux-pro-kontext.json | `aspect_ratio` | - |
| catalog/producers/image/image-edit.yaml | replicate | qwen/qwen-image-edit-2511 | none | catalog/models/replicate/image/qwen-qwen-image-edit-2511.json | `aspect_ratio` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | flux-pro/kontext/text-to-image | none | catalog/models/fal-ai/image/flux-pro-kontext-text-to-image.json | `aspect_ratio` | - |
| catalog/producers/image/text-to-image.yaml | fal-ai | xai/grok-imagine-image | none | catalog/models/fal-ai/image/xai-grok-imagine-image.json | `aspect_ratio` | - |
| catalog/producers/image/text-to-image.yaml | replicate | google/imagen-4 | none | catalog/models/replicate/image/google-imagen-4.json | `aspect_ratio` | - |
| catalog/producers/image/text-to-image.yaml | replicate | google/nano-banana | none | catalog/models/replicate/image/google-nano-banana.json | `aspect_ratio` | - |
| catalog/producers/image/text-to-image.yaml | replicate | xai/grok-imagine-image | none | catalog/models/replicate/image/xai-grok-imagine-image.json | `aspect_ratio` | `aspect_ratio` |
| catalog/producers/video/image-to-video.yaml | fal-ai | kling-video/v3/pro/image-to-video | none | catalog/models/fal-ai/video/kling-video-v3-pro-image-to-video.json | `aspect_ratio` | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | kling-video/v3/standard/image-to-video | none | catalog/models/fal-ai/video/kling-video-v3-standard-image-to-video.json | `aspect_ratio` | - |
| catalog/producers/video/image-to-video.yaml | replicate | bytedance/seedance-1.5-pro | none | catalog/models/replicate/video/bytedance-seedance-1-5-pro.json | `aspect_ratio` | - |
| catalog/producers/video/image-to-video.yaml | replicate | kwaivgi/kling-v3-video | none | catalog/models/replicate/video/kwaivgi-kling-v3-video.json | `aspect_ratio` | `aspect_ratio` |
| catalog/producers/video/ref-image-to-video.yaml | fal-ai | kling-video/o1/reference-to-video | none | catalog/models/fal-ai/video/kling-video-o1-reference-to-video.json | `aspect_ratio` | - |
| catalog/producers/video/ref-image-to-video.yaml | fal-ai | kling-video/o1/standard/reference-to-video | none | catalog/models/fal-ai/video/kling-video-o1-standard-reference-to-video.json | `aspect_ratio` | - |
| catalog/producers/video/ref-image-to-video.yaml | fal-ai | kling-video/o3/pro/reference-to-video | none | catalog/models/fal-ai/video/kling-video-o3-pro-reference-to-video.json | `aspect_ratio` | - |
| catalog/producers/video/ref-image-to-video.yaml | fal-ai | kling-video/o3/standard/reference-to-video | none | catalog/models/fal-ai/video/kling-video-o3-standard-reference-to-video.json | `aspect_ratio` | - |
| catalog/producers/video/ref-image-to-video.yaml | replicate | kwaivgi/kling-o1 | none | catalog/models/replicate/video/kwaivgi-kling-o1.json | `aspect_ratio` | `aspect_ratio` |
| catalog/producers/video/ref-image-to-video.yaml | replicate | kwaivgi/kling-v3-omni-video | none | catalog/models/replicate/video/kwaivgi-kling-v3-omni-video.json | `aspect_ratio` | `aspect_ratio` |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | bytedance/seedance-1.5-pro | none | catalog/models/replicate/video/bytedance-seedance-1-5-pro.json | `aspect_ratio` | - |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | kwaivgi/kling-v3-video | none | catalog/models/replicate/video/kwaivgi-kling-v3-video.json | `aspect_ratio` | `aspect_ratio` |
| catalog/producers/video/text-to-video.yaml | fal-ai | kling-video/v3/pro/text-to-video | none | catalog/models/fal-ai/video/kling-video-v3-pro-text-to-video.json | `aspect_ratio` | - |
| catalog/producers/video/text-to-video.yaml | fal-ai | kling-video/v3/standard/text-to-video | none | catalog/models/fal-ai/video/kling-video-v3-standard-text-to-video.json | `aspect_ratio` | - |
| catalog/producers/video/text-to-video.yaml | replicate | bytedance/seedance-1.5-pro | none | catalog/models/replicate/video/bytedance-seedance-1-5-pro.json | `aspect_ratio` | - |
| catalog/producers/video/text-to-video.yaml | replicate | kwaivgi/kling-v3-video | none | catalog/models/replicate/video/kwaivgi-kling-v3-video.json | `aspect_ratio` | `aspect_ratio` |
| catalog/producers/video/text-to-video.yaml | replicate | openai/sora-2 | none | catalog/models/replicate/video/openai-sora-2.json | `aspect_ratio` | - |

### CASE_H_NO_SIZE_FIELD (14)
Recommended: `TF010_ignoreResolutionWithWarning`

| Producer | Provider | Model | Current Resolution Rule(s) | Schema Path | Size Fields | Unresolved Refs |
| --- | --- | --- | --- | --- | --- | --- |
| catalog/producers/image/image-compose.yaml | fal-ai | xai/grok-imagine-image/edit | none | catalog/models/fal-ai/image/xai-grok-imagine-image-edit.json | - | - |
| catalog/producers/image/image-edit.yaml | fal-ai | bria/fibo-edit/edit | none | catalog/models/fal-ai/image/bria-fibo-edit-edit.json | - | - |
| catalog/producers/image/image-edit.yaml | fal-ai | xai/grok-imagine-image/edit | none | catalog/models/fal-ai/image/xai-grok-imagine-image-edit.json | - | - |
| catalog/producers/video/extend-video.yaml | fal-ai | ltx-2.3/extend-video | none | catalog/models/fal-ai/video/ltx-2-3-extend-video.json | - | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | kling-video/v2.5-turbo/pro/image-to-video | none | catalog/models/fal-ai/video/kling-video-v2-5-turbo-pro-image-to-video.json | - | - |
| catalog/producers/video/image-to-video.yaml | fal-ai | kling-video/v2.6/pro/image-to-video | none | catalog/models/fal-ai/video/kling-video-v2-6-pro-image-to-video.json | - | - |
| catalog/producers/video/start-end-frame-to-video.yaml | fal-ai | kling-video/v2.5-turbo/pro/image-to-video | none | catalog/models/fal-ai/video/kling-video-v2-5-turbo-pro-image-to-video.json | - | - |
| catalog/producers/video/talking-head.yaml | fal-ai | kling-video/ai-avatar/v2/pro | none | catalog/models/fal-ai/video/kling-video-ai-avatar-v2-pro.json | - | - |
| catalog/producers/video/talking-head.yaml | fal-ai | kling-video/ai-avatar/v2/standard | none | catalog/models/fal-ai/video/kling-video-ai-avatar-v2-standard.json | - | - |
| catalog/producers/video/talking-head.yaml | fal-ai | ltx-2.3/audio-to-video | none | catalog/models/fal-ai/video/ltx-2-3-audio-to-video.json | - | - |
| catalog/producers/video/talking-head.yaml | replicate | kwaivgi/kling-avatar-v2 | none | catalog/models/replicate/video/kwaivgi-kling-avatar-v2.json | - | - |
| catalog/producers/video/video-edit.yaml | fal-ai | decart/lucy-edit/fast | none | catalog/models/fal-ai/video/decart-lucy-edit-fast.json | - | - |
| catalog/producers/video/video-edit.yaml | fal-ai | ltx-2.3/retake-video | none | catalog/models/fal-ai/video/ltx-2-3-retake-video.json | - | - |
| catalog/producers/video/video-to-video.yaml | fal-ai | decart/lucy-edit/fast | none | catalog/models/fal-ai/video/decart-lucy-edit-fast.json | - | - |

### CASE_J_MEGAPIXELS_WITH_ASPECT (6)
Recommended: `TF008_resolutionToMegapixelsEnum`, `TF001_resolutionToAspectRatioEnum`

| Producer | Provider | Model | Current Resolution Rule(s) | Schema Path | Size Fields | Unresolved Refs |
| --- | --- | --- | --- | --- | --- | --- |
| catalog/producers/image/image-compose.yaml | replicate | black-forest-labs/flux-2-flex | `Resolution` -> `resolution` (direct) | catalog/models/replicate/image/black-forest-labs-flux-2-flex.json | `aspect_ratio`, `height`, `resolution`, `width` | `resolution`, `aspect_ratio` |
| catalog/producers/image/image-compose.yaml | replicate | black-forest-labs/flux-2-max | `Resolution` -> `resolution` (direct) | catalog/models/replicate/image/black-forest-labs-flux-2-max.json | `aspect_ratio`, `height`, `resolution`, `width` | `resolution`, `aspect_ratio` |
| catalog/producers/image/image-compose.yaml | replicate | black-forest-labs/flux-2-pro | `Resolution` -> `resolution` (direct) | catalog/models/replicate/image/black-forest-labs-flux-2-pro.json | `aspect_ratio`, `height`, `resolution`, `width` | `resolution`, `aspect_ratio` |
| catalog/producers/image/text-to-image.yaml | replicate | black-forest-labs/flux-2-klein-9b | `Resolution` -> `megapixels` (direct) | catalog/models/replicate/image/black-forest-labs-flux-2-klein-9b.json | `aspect_ratio` | `aspect_ratio` |
| catalog/producers/image/text-to-image.yaml | replicate | black-forest-labs/flux-2-max | `Resolution` -> `resolution` (direct) | catalog/models/replicate/image/black-forest-labs-flux-2-max.json | `aspect_ratio`, `height`, `resolution`, `width` | `resolution`, `aspect_ratio` |
| catalog/producers/image/text-to-image.yaml | replicate | black-forest-labs/flux-2-pro | `Resolution` -> `resolution` (direct) | catalog/models/replicate/image/black-forest-labs-flux-2-pro.json | `aspect_ratio`, `height`, `resolution`, `width` | `resolution`, `aspect_ratio` |

### CASE_K_LONGEST_SIDE_INTEGER (1)
Recommended: `TF009_resolutionToLongestSideInteger`

| Producer | Provider | Model | Current Resolution Rule(s) | Schema Path | Size Fields | Unresolved Refs |
| --- | --- | --- | --- | --- | --- | --- |
| catalog/producers/image/image-edit.yaml | replicate | prunaai/flux-kontext-fast | none | catalog/models/replicate/image/prunaai-flux-kontext-fast.json | `aspect_ratio`, `image_size` | `aspect_ratio` |

### CASE_I_SCHEMA_UNRESOLVED (9)
Recommended: `UNMAPPED_MANUAL`

| Producer | Provider | Model | Current Resolution Rule(s) | Schema Path | Size Fields | Unresolved Refs |
| --- | --- | --- | --- | --- | --- | --- |
| catalog/producers/video/image-to-video.yaml | replicate | kwaivgi/kling-v2-5-turbo-pro | none | - | - | - |
| catalog/producers/video/image-to-video.yaml | replicate | kwaivgi/kling-v2-6 | none | - | - | - |
| catalog/producers/video/image-to-video.yaml | replicate | pixverse/pixverse-v5-6 | none | - | - | - |
| catalog/producers/video/image-to-video.yaml | replicate | runwayml/gen-4-5 | none | - | - | - |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | kwaivgi/kling-v2-5-turbo-pro | none | - | - | - |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | pixverse/pixverse-v5-6 | none | - | - | - |
| catalog/producers/video/text-to-video.yaml | replicate | kwaivgi/kling-v2-6 | none | - | - | - |
| catalog/producers/video/text-to-video.yaml | replicate | pixverse/pixverse-v5-6 | none | - | - | - |
| catalog/producers/video/text-to-video.yaml | replicate | runwayml/gen-4-5 | none | - | - | - |

## Cases Where Exact Matching Cannot Be Found

### 1) Hard Unmatched: schema lookup failed
| Producer | Provider | Model | Reason |
| --- | --- | --- | --- |
| catalog/producers/video/image-to-video.yaml | replicate | pixverse/pixverse-v5-6 | MODEL_NOT_FOUND |
| catalog/producers/video/image-to-video.yaml | replicate | runwayml/gen-4-5 | MODEL_NOT_FOUND |
| catalog/producers/video/image-to-video.yaml | replicate | kwaivgi/kling-v2-5-turbo-pro | MODEL_NOT_FOUND |
| catalog/producers/video/image-to-video.yaml | replicate | kwaivgi/kling-v2-6 | MODEL_NOT_FOUND |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | pixverse/pixverse-v5-6 | MODEL_NOT_FOUND |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | kwaivgi/kling-v2-5-turbo-pro | MODEL_NOT_FOUND |
| catalog/producers/video/text-to-video.yaml | replicate | pixverse/pixverse-v5-6 | MODEL_NOT_FOUND |
| catalog/producers/video/text-to-video.yaml | replicate | runwayml/gen-4-5 | MODEL_NOT_FOUND |
| catalog/producers/video/text-to-video.yaml | replicate | kwaivgi/kling-v2-6 | MODEL_NOT_FOUND |

### 2) Partial Unmatched: schema fields use unresolved `$ref`
These rows can be placed in a case/function bucket, but exact allowed enum values are not fully visible in-repo and require provider schema expansion or explicit mapping tables.

| Producer | Provider | Model | Case | Unresolved Fields |
| --- | --- | --- | --- | --- |
| catalog/producers/image/image-compose.yaml | replicate | black-forest-labs/flux-2-flex | CASE_J_MEGAPIXELS_WITH_ASPECT | resolution, aspect_ratio |
| catalog/producers/image/image-compose.yaml | replicate | black-forest-labs/flux-2-max | CASE_J_MEGAPIXELS_WITH_ASPECT | resolution, aspect_ratio |
| catalog/producers/image/image-compose.yaml | replicate | black-forest-labs/flux-2-pro | CASE_J_MEGAPIXELS_WITH_ASPECT | resolution, aspect_ratio |
| catalog/producers/image/image-compose.yaml | replicate | black-forest-labs/flux-kontext-pro | CASE_G_ASPECT_ONLY | aspect_ratio |
| catalog/producers/image/image-compose.yaml | replicate | bytedance/seedream-5-lite | CASE_E_SIZE_TOKEN_OR_DIM_UNRESOLVED | size, aspect_ratio |
| catalog/producers/image/image-compose.yaml | replicate | google/nano-banana-2 | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/image/image-edit.yaml | replicate | bytedance/seedream-5-lite | CASE_E_SIZE_TOKEN_OR_DIM_UNRESOLVED | size, aspect_ratio |
| catalog/producers/image/image-edit.yaml | replicate | google/nano-banana-2 | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/image/image-edit.yaml | replicate | prunaai/flux-kontext-fast | CASE_K_LONGEST_SIDE_INTEGER | aspect_ratio |
| catalog/producers/image/text-to-image.yaml | replicate | black-forest-labs/flux-2-klein-9b | CASE_J_MEGAPIXELS_WITH_ASPECT | aspect_ratio |
| catalog/producers/image/text-to-image.yaml | replicate | black-forest-labs/flux-2-max | CASE_J_MEGAPIXELS_WITH_ASPECT | resolution, aspect_ratio |
| catalog/producers/image/text-to-image.yaml | replicate | black-forest-labs/flux-2-pro | CASE_J_MEGAPIXELS_WITH_ASPECT | resolution, aspect_ratio |
| catalog/producers/image/text-to-image.yaml | replicate | bytedance/seedream-5-lite | CASE_E_SIZE_TOKEN_OR_DIM_UNRESOLVED | size, aspect_ratio |
| catalog/producers/image/text-to-image.yaml | replicate | google/nano-banana-2 | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/image/text-to-image.yaml | replicate | prunaai/p-image | CASE_F_WIDTH_HEIGHT_FIELDS | aspect_ratio |
| catalog/producers/image/text-to-image.yaml | replicate | recraft-ai/recraft-v4 | CASE_E_SIZE_DIMENSION_STRING | size, aspect_ratio |
| catalog/producers/image/text-to-image.yaml | replicate | xai/grok-imagine-image | CASE_G_ASPECT_ONLY | aspect_ratio |
| catalog/producers/video/image-to-video.yaml | replicate | kwaivgi/kling-v3-video | CASE_G_ASPECT_ONLY | aspect_ratio |
| catalog/producers/video/image-to-video.yaml | replicate | lightricks/ltx-2.3-fast | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/video/image-to-video.yaml | replicate | lightricks/ltx-2.3-pro | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/video/image-to-video.yaml | replicate | vidu/q3-pro | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/video/image-to-video.yaml | replicate | vidu/q3-turbo | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/video/image-to-video.yaml | replicate | wan-video/wan-2.6-i2v | CASE_B_RESOLUTION_PRESET_ONLY | resolution |
| catalog/producers/video/image-to-video.yaml | replicate | wan-video/wan2.6-i2v-flash | CASE_B_RESOLUTION_PRESET_ONLY | resolution |
| catalog/producers/video/ref-image-to-video.yaml | replicate | kwaivgi/kling-o1 | CASE_G_ASPECT_ONLY | aspect_ratio |
| catalog/producers/video/ref-image-to-video.yaml | replicate | kwaivgi/kling-v3-omni-video | CASE_G_ASPECT_ONLY | aspect_ratio |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | kwaivgi/kling-v3-video | CASE_G_ASPECT_ONLY | aspect_ratio |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | lightricks/ltx-2.3-fast | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | lightricks/ltx-2.3-pro | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | vidu/q3-pro | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/video/start-end-frame-to-video.yaml | replicate | vidu/q3-turbo | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/video/text-to-video.yaml | replicate | kwaivgi/kling-v3-video | CASE_G_ASPECT_ONLY | aspect_ratio |
| catalog/producers/video/text-to-video.yaml | replicate | lightricks/ltx-2.3-fast | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/video/text-to-video.yaml | replicate | lightricks/ltx-2.3-pro | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/video/text-to-video.yaml | replicate | vidu/q3-pro | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/video/text-to-video.yaml | replicate | vidu/q3-turbo | CASE_A_ASPECT_PLUS_PRESET | resolution, aspect_ratio |
| catalog/producers/video/text-to-video.yaml | replicate | wan-video/wan-2.6-t2v | CASE_E_SIZE_DIMENSION_STRING | size |

## Implementation Order (Recommended)
1. Implement TF001/TF002/TF003/TF004 first (covers most rows).
2. Add TF005/TF006/TF007 for token/string/width-height schema families.
3. Add TF008/TF009/TF011 for megapixels, longest-side integer, and unresolved `size` token families.
4. Resolve `CASE_I_SCHEMA_UNRESOLVED` model catalog mismatches before broad rollout.
5. Expand unresolved `$ref` enums or freeze explicit per-model tables where needed.
