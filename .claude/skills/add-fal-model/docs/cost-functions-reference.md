# Cost Functions Reference

All cost functions are implemented in `providers/src/producers/cost-functions.ts`.

## Function Table

| Function | Inputs | YAML Price Fields | Use When |
|----------|--------|-------------------|----------|
| `costByRun` | (none) | `price` | Flat per-run pricing |
| `costByVideoDuration` | `[duration]` | `pricePerSecond` | Simple duration-based video |
| `costByVideoDurationAndResolution` | `[duration, resolution]` | `prices[].resolution + pricePerSecond` | Duration varies by resolution tier |
| `costByVideoDurationAndWithAudio` | `[duration, generate_audio]` | `prices[].generate_audio + pricePerSecond` | Duration with audio toggle |
| `costByVideoPerMillionTokens` | `[duration, resolution, aspect_ratio]` | `prices[].pricePerMillionTokens` | Token-based (Seedance) |
| `costByVideoMegapixels` | `[num_frames, video_size]` | `pricePerMegapixel` | Per-megapixel (LTX) |
| `costByCharacters` | `[text]` | `pricePerCharacter` | Per-character TTS |
| `costByCharactersAndPlan` | `[text]` | `pricePerCharByPlan + defaultPlan` | Plan-tiered character pricing |
| `costByAudioSeconds` | `[duration]` | `pricePerSecond` | Per-second audio |
| `costByImageSizeAndQuality` | `[image_size, quality, num_images]` | `prices[].quality + image_size + pricePerImage` | Size+quality grid |
| `costByImageMegapixels` | `[num_images, image_size]` | `pricePerMegapixel` | Per-megapixel images |
| `costByImageAndResolution` | `[resolution]` | `prices[].resolution + pricePerImage` | Resolution-tiered images |
| `costByResolution` | `[width, height]` | `prices[].resolution + pricePerImage` | Dimension-based images |
| `costByInputTokens` | `[text]` | `pricePerToken` | Token-based text |

## YAML Examples

### costByRun
```yaml
price:
  function: costByRun
  price: 0.03
```

### costByVideoDuration
```yaml
price:
  function: costByVideoDuration
  inputs: [duration]
  pricePerSecond: 0.20
```

### costByVideoDurationAndResolution
```yaml
price:
  function: costByVideoDurationAndResolution
  inputs: [duration, resolution]
  prices:
    - resolution: 720p
      pricePerSecond: 0.1
    - resolution: 1080p
      pricePerSecond: 0.15
```

### costByVideoDurationAndWithAudio
```yaml
price:
  function: costByVideoDurationAndWithAudio
  inputs: [duration, generate_audio]
  prices:
    - generate_audio: true
      pricePerSecond: 0.14
    - generate_audio: false
      pricePerSecond: 0.07
```

### costByVideoPerMillionTokens (simple)
```yaml
price:
  function: costByVideoPerMillionTokens
  inputs: [duration, resolution, aspect_ratio]
  price:
    - pricePerMillionTokens: 1
```

### costByVideoPerMillionTokens (with audio flag)
```yaml
price:
  function: costByVideoPerMillionTokens
  inputs: [duration, resolution, aspect_ratio, generate_audio]
  prices:
    - generate_audio: true
      pricePerMillionTokens: 2.4
    - generate_audio: false
      pricePerMillionTokens: 1.2
```

### costByVideoMegapixels
```yaml
price:
  function: costByVideoMegapixels
  inputs: [num_frames, video_size]
  pricePerMegapixel: 0.0008
```

### costByCharacters
```yaml
price:
  function: costByCharacters
  inputs: [text]
  pricePerCharacter: 0.0001
```

### costByCharactersAndPlan
```yaml
price:
  function: costByCharactersAndPlan
  inputs: [text]
  pricePerCharByPlan:
    free: 0.0003
    starter: 0.0003
    creator: 0.00024
    pro: 0.000132
    scale: 0.000099
    business: 0.000066
  defaultPlan: starter
```

### costByAudioSeconds
```yaml
price:
  function: costByAudioSeconds
  inputs: [duration]
  pricePerSecond: 0.002
```

### costByImageSizeAndQuality
```yaml
price:
  function: costByImageSizeAndQuality
  inputs: [image_size, quality, num_images]
  prices:
    - quality: "low"
      image_size: "1024x1024"
      pricePerImage: 0.009
    - quality: "high"
      image_size: "1024x1024"
      pricePerImage: 0.133
```

### costByImageMegapixels
```yaml
price:
  function: costByImageMegapixels
  inputs: [num_images, image_size]
  pricePerMegapixel: 0.09
```

### costByImageAndResolution
```yaml
price:
  function: costByImageAndResolution
  inputs: [resolution]
  prices:
    - resolution: "0.5K"
      pricePerImage: 0.02
    - resolution: "1K"
      pricePerImage: 0.03
```

### costByResolution
```yaml
price:
  function: costByResolution
  inputs: [width, height]
  prices:
    - resolution: "0.5K"
      pricePerImage: 0.02
    - resolution: "1K"
      pricePerImage: 0.03
```

### costByInputTokens
```yaml
price:
  function: costByInputTokens
  inputs: [text]
  pricePerToken: 0.0001
```

## How to Add a New Cost Function

If none of the existing functions match the model's pricing structure:

1. **Add to `CostFunctionName` type** (line ~48 in `cost-functions.ts`):
   ```typescript
   export type CostFunctionName =
     | 'costByInputTokens'
     // ... existing ...
     | 'costByMyNewFunction';
   ```

2. **Implement the function** following the pattern:
   ```typescript
   function costByMyNewFunction(
     config: ModelPriceConfig,
     extracted: ExtractedCostInputs
   ): CostEstimate {
     // Handle artefact-sourced fields (return range)
     // Handle missing fields (return placeholder)
     // Calculate and return cost
   }
   ```

3. **Add case to `calculateCost()` switch** (line ~1169):
   ```typescript
   case 'costByMyNewFunction':
     return costByMyNewFunction(priceConfig, extracted);
   ```

4. **Add display case to `formatPrice()`** (line ~1488):
   ```typescript
   case 'costByMyNewFunction':
     return price.myField !== undefined
       ? `$${price.myField.toFixed(2)}/unit`
       : '-';
   ```

5. **Run validation**:
   ```bash
   pnpm --filter @gorenku/providers check:all
   ```
