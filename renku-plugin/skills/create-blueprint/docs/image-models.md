# Image Model Selection Guide

This guide helps you choose the right image generation model based on your specific requirements.

## Table of Contents

- [Quick Comparison Table](#quick-comparison-table)
- [Model Deep Dives](#model-deep-dives)
- [Model by Producer](#model-by-producer)

---

## Quick Comparison Table

| Model | Provider | Aspect Ratios | Resolution | Key Features |
|-------|----------|---------------|------------|--------------|
| **SeedDream 4.5** | fal-ai/replicate | Multiple | 2K, 4K | Advanced image_size presets |
| **SeedDream 4** | fal-ai/replicate | Multiple | 1K-4K | Prompt enhancement modes |
| **Flux Pro Kontext** | fal-ai | Standard | N/A | Simple, guidance scale |
| **Qwen Image** | fal-ai/replicate | Multiple | Quality modes | Full editing support |
| **GPT Image 1.5** | fal-ai | 1:1, 16:9, 9:16 | Fixed sizes | Background control |
| **Nano Banana Pro** | fal-ai/replicate | Multiple | Multiple | Aspect + resolution |
| **Imagen-4** | replicate | 5 ratios | N/A | Simple Google model |
| **WAN v2.6** | fal-ai | Standard | Presets | Safety checker |

---

## Model Deep Dives

### SeedDream 4.5 (ByteDance)

**Provider:** fal-ai, replicate
**ID:** `bytedance/seedream/v4.5/text-to-image`, `bytedance/seedream-4.5`

**Strengths:**
- High quality output
- Advanced resolution presets (auto_2K, auto_4K)
- Supports reference images (hybrid mode on replicate)
- Multiple images per request

**Limitations:**
- 1K not supported (upgrades to 2K)

**Best for:**
- High-resolution marketing images
- Product photography
- Character generation with references

**Key inputs (fal-ai):**
- `AspectRatio` + `Resolution` combine into `image_size` preset
- `NumImages` - Up to 6 images
- `Seed` - Reproducibility

**Key inputs (replicate):**
- `ReferenceImages` - For hybrid/style transfer
- `Resolution` - "2K", "4K", or "custom"
- `Width/Height` - When Resolution is "custom"

---

### SeedDream 4 (ByteDance)

**Provider:** fal-ai, replicate
**ID:** `bytedance/seedream/v4/text-to-image`, `bytedance/seedream-4`

**Strengths:**
- Prompt enhancement modes (standard/fast)
- Good aspect ratio support
- Reference image support (replicate)

**Best for:**
- Quick iterations with prompt enhancement
- Standard quality images
- Style transfer with references

**Key inputs:**
- `EnhancePrompt` - Maps to enhancement mode (standard/fast)
- `AspectRatio` - Transforms to image_size preset

---

### Flux Pro Kontext

**Provider:** fal-ai
**ID:** `flux-pro/kontext/text-to-image`, `flux-pro/kontext` (image-edit)

**Strengths:**
- Simple API
- Guidance scale control
- Good for editing existing images

**Limitations:**
- No resolution control
- Takes first image only for editing

**Best for:**
- Quick image generation
- Image editing with prompts
- When simplicity is preferred

**Key inputs:**
- `GuidanceScale` - Prompt adherence
- `EnhancePrompt` - Prompt enhancement
- `AspectRatio` - Direct pass-through

---

### Qwen Image

**Provider:** fal-ai, replicate
**ID:** `qwen-image-2512` (text-to-image), `qwen-image-edit-2511` (image-edit/image-compose), `qwen/qwen-image` (image-edit)

**Strengths:**
- Full editing support with masks
- Guidance scale control
- Negative prompts
- Quality mode based on resolution

**Best for:**
- Image editing with masks
- Precise control over generation
- When quality mode matters

**Key inputs:**
- `GuidanceScale` - Prompt adherence
- `NegativePrompt` - What to avoid
- `Resolution` - Maps to quality mode (optimize_for_speed/optimize_for_quality)
- `MaskImage` - For selective editing (edit version)

---

### GPT Image 1.5

**Provider:** fal-ai
**ID:** `gpt-image-1.5`, `gpt-image-1.5/edit`

**Strengths:**
- Background control (auto/transparent/opaque)
- Quality levels (low/medium/high)
- Mask support for editing

**Limitations:**
- Only 3 aspect ratios: 1:1, 16:9, 9:16
- Fixed dimension sizes

**Best for:**
- Product images with transparent backgrounds
- Simple compositions
- When background control is important

**Key inputs:**
- `Background` - "auto", "transparent", "opaque"
- `Quality` - "low", "medium", "high"
- `AspectRatio` - Transforms to fixed sizes (1024x1024, 1536x1024, 1024x1536)

---

### Nano Banana Pro (Google)

**Provider:** fal-ai, replicate
**ID:** `nano-banana-pro`, `google/nano-banana-pro`, `google/nano-banana`

**Strengths:**
- Supports both aspect ratio and resolution
- Reference image support (replicate)
- Simple API

**Best for:**
- Standard image generation
- When both aspect ratio and resolution matter
- Reference-guided generation

**Key inputs:**
- `AspectRatio` - Direct pass-through
- `Resolution` - Direct pass-through (pro version)
- `OutputFormat` - jpeg, png, webp

---

### Imagen-4 (Google)

**Provider:** replicate
**ID:** `google/imagen-4`

**Strengths:**
- Simple Google-powered model
- Good general quality

**Limitations:**
- Only 5 aspect ratios: 1:1, 9:16, 16:9, 3:4, 4:3
- No resolution control

**Best for:**
- Simple, high-quality generation
- When Google's model is preferred

**Key inputs:**
- `AspectRatio` - Limited to 5 options
- `OutputFormat` - Output format selection

---

### WAN v2.6

**Provider:** fal-ai
**ID:** `wan/v2.6/text-to-image`, `wan/v2.6/image-to-image` (image-edit/image-compose)

**Strengths:**
- Prompt expansion
- Safety checker control
- Good for variations

**Best for:**
- Image variations
- When prompt expansion helps
- Safety-conscious generation

**Key inputs:**
- `EnhancePrompt` (maps to `enable_prompt_expansion`)
- `EnableSafetyChecker` - Content moderation
- `NegativePrompt` - What to avoid

---

## Model by Producer

### text-to-image.yaml

| Model | Provider | Aspect Ratios | Resolution |
|-------|----------|---------------|------------|
| `bytedance/seedream/v4.5/text-to-image` | fal-ai | Multiple | Presets |
| `bytedance/seedream/v4/text-to-image` | fal-ai | Multiple | Presets |
| `flux-pro/kontext/text-to-image` | fal-ai | Standard | N/A |
| `gpt-image-1.5` | fal-ai | 3 options | Fixed |
| `nano-banana-pro` | fal-ai | Multiple | Multiple |
| `qwen-image-2512` | fal-ai | Multiple | Quality |
| `wan/v2.6/text-to-image` | fal-ai | Standard | Presets |
| `hunyuan-image/v3/instruct/text-to-image` | fal-ai | Standard | Custom W/H |
| `xai/grok-imagine-image` | fal-ai | Standard | N/A |
| `flux-2` | fal-ai | Standard | Presets |
| `flux-2/flash` | fal-ai | Standard | Fast |
| `flux-2/turbo` | fal-ai | Standard | Fastest |
| `recraft/v4/text-to-image` | fal-ai | Standard | Presets |
| `recraft/v4/pro/text-to-image` | fal-ai | Standard | High quality |
| `z-image/turbo` | fal-ai | Standard | Presets |
| `bytedance/seedream-4` | replicate | Multiple | 1K-4K |
| `bytedance/seedream-4.5` | replicate | Multiple | 2K-4K |
| `google/nano-banana` | replicate | Multiple | N/A |
| `google/imagen-4` | replicate | 5 options | N/A |
| `prunaai/z-image-turbo` | replicate | Via W/H | Custom |
| `black-forest-labs/flux-2-pro` | replicate | Standard | Megapixels |
| `black-forest-labs/flux-2-max` | replicate | Standard | Megapixels |
| `black-forest-labs/flux-2-klein-9b` | replicate | Standard | Megapixels |
| `recraft-ai/recraft-v4` | replicate | Standard | Size enum |
| `xai/grok-imagine-image` | replicate | Standard | N/A |
| `prunaai/p-image` | replicate | Standard | Custom W/H |
| `bytedance/seedream-v4.5` | wavespeed-ai | N/A | Size string |

### image-edit.yaml

| Model | Provider | Mask Support | Key Feature |
|-------|----------|--------------|-------------|
| `flux-pro/kontext` | fal-ai | No | Single image editing |
| `xai/grok-imagine-image/edit` | fal-ai | No | Single image editing |
| `z-image/turbo/image-to-image` | fal-ai | No | Fast single image edit |
| `bria/fibo-edit/edit` | fal-ai | Yes | Instruction-based editing |
| `flux-2/edit` | fal-ai | No | Edit via firstOf |
| `flux-2/flash/edit` | fal-ai | No | Fast edit via firstOf |
| `flux-2/turbo/edit` | fal-ai | No | Fastest edit via firstOf |
| `bytedance/seedream/v4/edit` | fal-ai | No | Edit via firstOf |
| `bytedance/seedream/v4.5/edit` | fal-ai | No | High quality edit |
| `gpt-image-1.5/edit` | fal-ai | Yes | Background control |
| `nano-banana-pro/edit` | fal-ai | No | Aspect + resolution |
| `qwen-image-edit-2511` | fal-ai | No | Full editing |
| `wan/v2.6/image-to-image` | fal-ai | No | Prompt expansion |
| `hunyuan-image/v3/instruct/edit` | fal-ai | No | Custom dimensions |
| `qwen/qwen-image` | replicate | No | Quality modes |
| `prunaai/flux-kontext-fast` | replicate | No | Fast single edit |
| `qwen/qwen-image-edit-2511` | replicate | No | Edit via firstOf |

### image-compose.yaml

| Model | Provider | Max Images | Key Feature |
|-------|----------|------------|-------------|
| `bytedance/seedream/v4/edit` | fal-ai | 10 | Multi-image composition |
| `bytedance/seedream/v4.5/edit` | fal-ai | 10 | High quality compose |
| `wan/v2.6/image-to-image` | fal-ai | 3 | Order-aware composition |
| `flux-2/edit` | fal-ai | 4 | Multi-image composition |
| `flux-2/flash/edit` | fal-ai | 4 | Fast composition |
| `flux-2/turbo/edit` | fal-ai | 4 | Fastest composition |
| `gpt-image-1.5/edit` | fal-ai | Multiple | Mask + composition |
| `nano-banana-pro/edit` | fal-ai | Multiple | Aspect + resolution |
| `qwen-image-edit-2511` | fal-ai | Multiple | Full composition |
| `hunyuan-image/v3/instruct/edit` | fal-ai | 2 | Custom dimensions |
| `bytedance/seedream-4.5` | replicate | 14 | High resolution |
| `bytedance/seedream-4` | replicate | 10 | Prompt enhancement |
| `google/nano-banana-pro` | replicate | Multiple | Aspect + resolution |
| `google/nano-banana` | replicate | Multiple | Simple |
| `qwen/qwen-image-edit-2511` | replicate | Multiple | Safety control |
| `black-forest-labs/flux-2-pro` | replicate | 8 | High quality |
| `black-forest-labs/flux-2-max` | replicate | 8 | Maximum quality |
| `black-forest-labs/flux-2-flex` | replicate | 10 | Multi-reference design |
| `black-forest-labs/flux-kontext-pro` | replicate | 1 (firstOf) | Context-aware |

### text-to-grid-images.yaml

| Model | Provider | Key Feature |
|-------|----------|-------------|
| `nano-banana-pro` | fal-ai | Reliable grid layouts |
| `gpt-image-1.5` | fal-ai | Reliable grid layouts |

### text-to-vector.yaml

| Model | Provider | Key Feature |
|-------|----------|-------------|
| `recraft/v4/text-to-vector` | fal-ai | SVG vector output |
| `recraft/v4/pro/text-to-vector` | fal-ai | Higher quality SVG |
| `recraft-ai/recraft-v4-svg` | replicate | SVG vector output |

---

## Resolution Patterns

Different models handle resolution differently:

1. **Preset-based:** `AspectRatio` + `Resolution` → `image_size` preset
   - SeedDream 4.5: `auto_2K`, `landscape_16_9`, etc.
   - Qwen: `landscape_16_9`, `portrait_16_9`, etc.

2. **Direct pass-through:** Both values pass directly
   - Nano Banana Pro: `aspect_ratio` + `resolution`

3. **Fixed dimensions:** Aspect ratio → specific pixel sizes
   - GPT Image 1.5: "1:1" → "1024x1024"

4. **Width/Height only:** Custom dimensions
   - Z-Image Turbo: `width` + `height`

5. **Quality modes:** Resolution → quality setting
   - Qwen Image: "1K" → `optimize_for_speed`, "2K"+ → `optimize_for_quality`
