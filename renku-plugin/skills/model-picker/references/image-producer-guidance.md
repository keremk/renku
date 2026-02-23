# Image Producer Guidance

Decision tree for choosing the right image producer when building blueprints.

## Decision Tree

```
What kind of image output do you need?
│
├── SVG vector graphics (logos, icons, illustrations)?
│   └── text-to-vector.yaml
│       Inputs: Prompt, AspectRatio
│       Models: Recraft v4 (fal-ai + replicate)
│
├── Multi-panel grid/storyboard?
│   └── text-to-grid-images.yaml
│       Inputs: Prompt, GridStyle, PanelCount
│       Models: nano-banana-pro, gpt-image-1.5 (only reliable grid generators)
│       Artifacts: GeneratedImage (full grid) + PanelImages (split panels)
│
├── Raster image from text only (no image input)?
│   └── text-to-image.yaml
│       Inputs: Prompt, AspectRatio, Resolution, Width, Height
│       Models: 15+ fal-ai, 12+ replicate, wavespeed-ai
│
├── Edit a SINGLE existing image?
│   └── image-edit.yaml
│       Inputs: SourceImage (single image), Prompt, MaskImage (optional)
│       Artifact: TransformedImage
│       Use when:
│       • Style changes on one image
│       • Object removal/inpainting
│       • Relighting or recoloring
│       • Any transformation of a single source
│
└── Combine MULTIPLE images into a new image?
    └── image-compose.yaml
        Inputs: SourceImages (collection), Prompt, MaskImage (optional)
        Artifact: ComposedImage
        Use when:
        • "Put person from image 1 in setting from image 2"
        • "Dress the model in clothes from image 2"
        • Merging visual elements from 2+ sources
        • Multi-reference composition
```

## image-edit vs image-compose

Many models support both single-image editing and multi-image composition. The distinction is about **intent**:

| Aspect | image-edit | image-compose |
|--------|-----------|---------------|
| Input | `SourceImage` (single `image`) | `SourceImages` (collection of `image`) |
| Artifact | `TransformedImage` | `ComposedImage` |
| Intent | Modify one image | Combine multiple images |
| Array models | Wrapped via `firstOf` (single → array of 1) | Passed directly as array |

**Models in both producers:** Flux 2 edit family, SeedDream v4/v4.5 edit, GPT Image 1.5 edit, Nano Banana Pro edit, Qwen edit, WAN v2.6 i2i, Hunyuan edit.

**Models in image-edit only:** Flux Pro Kontext, XAI Grok edit, Z-Image Turbo i2i, Bria Fibo edit (fal-ai); Qwen Image, Flux Kontext Fast (replicate). These only accept a single image.

## Key Rules

1. **One image to modify** → `image-edit.yaml`
2. **Two or more images to combine** → `image-compose.yaml`
3. **No image input, text only** → `text-to-image.yaml`
4. **Need SVG output** → `text-to-vector.yaml`
5. **Need grid panels** → `text-to-grid-images.yaml`
