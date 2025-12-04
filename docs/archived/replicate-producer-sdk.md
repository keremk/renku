# Replicate Producer SDK Guide

This document provides a comprehensive guide for creating new producers and adding support for different models using the Replicate provider. It covers the full stack architecture, the SDK patterns we've established, and step-by-step instructions for extending the system.

## Table of Contents

1. [Full Stack Architecture](#full-stack-architecture)
2. [Core Concepts](#core-concepts)
3. [Creating a New Producer](#creating-a-new-producer)
4. [Adding Support for New Models](#adding-support-for-new-models)
5. [projectConfig Integration](#projectconfig-integration)
6. [Examples](#examples)
7. [Testing](#testing)
8. [Best Practices](#best-practices)

---

## Full Stack Architecture

### Overview

The system follows a three-layer architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Package                           │
│  - User Commands                                            │
│  - Project Configuration (projectConfig)                    │
│  - Provider Settings (producer-options.ts)                 │
│  - Producer Catalog Building                                │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      │ Converts projectConfig → inputValues
                      ↓
┌─────────────────────────────────────────────────────────────┐
│                        Core Package                          │
│  - Blueprint System (defines workflow structure)            │
│  - Input System (InputEvents, content hashing)              │
│  - Producer Planning (creates execution plan)               │
│  - Artefact Management                                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      │ inputValues → InputEvents → resolvedInputs
                      ↓
┌─────────────────────────────────────────────────────────────┐
│                     Providers Package                        │
│  - Producer Registry (mappings.ts)                          │
│  - Producer Handlers (audio, video, music, image, llm)      │
│  - SDK Helpers (handler-factory, replicate SDK)             │
│  - Model-specific Field Mapping                             │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

#### 1. Configuration Flow

```typescript
// CLI: User provides project configuration
const projectConfig = {
  voice: 'English_CaptivatingStoryteller',
  size: '720p',
  aspectRatio: '16:9',
  duration: 60,
  // ... other settings
};

// CLI: Converts to inputValues (cli/src/lib/project-config.ts)
const inputValues = {
  VoiceId: projectConfig.voice,
  Size: projectConfig.size,
  AspectRatio: projectConfig.aspectRatio,
  Duration: projectConfig.duration,
  // ...
};

// Core: Creates InputEvents from inputValues
const inputEvents = createInputEvents(inputValues);

// Core: Resolves inputs for each producer job
const resolvedInputs = {
  VoiceId: 'English_CaptivatingStoryteller',
  Size: '720p',
  AspectRatio: '16:9',
  SegmentNarration: ['Segment 1 text', 'Segment 2 text', ...],
  // ...
};

// Provider: Reads from resolvedInputs
const voice = resolveVoice(resolvedInputs); // 'English_CaptivatingStoryteller'
const size = resolveSize(resolvedInputs);   // '720p'
```

#### 2. Provider Settings Flow

Replicate producers are now schema-first: the blueprint supplies `sdkMapping` and `inputBindings`, the runtime builds the payload via `runtime.sdk.buildPayload()`, and the payload is validated against `extras.schema.input`. Provider config defaults/customAttributes are intentionally ignored—inputs must come from the mapped, canonical IDs so failures surface immediately.

### Why This Architecture?

1. **Content Hashing**: Values in `resolvedInputs` are part of the content hash. When projectConfig values change (voice, size, aspectRatio), the system knows to regenerate artefacts.

2. **Separation of Concerns**:
   - CLI handles user interaction and configuration
   - Core handles workflow planning and dirty detection
   - Providers handle external API calls and model-specific mapping

3. **Flexibility**:
   - User configuration (projectConfig) is separate from model-specific attributes (customAttributes)
   - Easy to switch models or providers without changing user-facing config

---

## Core Concepts

### 1. Producer Types and Scope

Producers operate at different scopes:

- **Per-Segment Producers**: Generate artefacts for each segment (audio, video, images)
- **Per-Movie Producers**: Generate artefacts once per movie (music, script)

```typescript
// Per-segment: processes each segment independently
// Reads from resolvedInputs using segment index
const segmentIndex = planner.index?.segment ?? 0;
const text = narrationInput[segmentIndex] ?? narrationInput[0];

// Per-movie: processes once for the entire movie
// Reads single values from resolvedInputs
const duration = resolveDuration(resolvedInputs); // Number, not array
```

### 2. Input Resolution Pattern

All producers follow this pattern for reading inputs:

```typescript
// 1. Get all resolved inputs
const resolvedInputs = runtime.inputs.all();

// 2. Get planner context (for segment index, etc.)
const plannerContext = extractPlannerContext(request);

// 3. Resolve specific inputs using helper functions
const text = resolveText(resolvedInputs, plannerContext);
const voice = resolveVoice(resolvedInputs);
const size = resolveSize(resolvedInputs);

// Helper function pattern
function resolveText(
  resolvedInputs: Record<string, unknown>,
  planner: PlannerContext
): string | undefined {
  const input = resolvedInputs['SegmentNarration'];
  const segmentIndex = planner.index?.segment ?? 0;

  // Handle array (per-segment)
  if (Array.isArray(input) && input.length > 0) {
    const text = input[segmentIndex] ?? input[0];
    if (typeof text === 'string' && text.trim()) {
      return text;
    }
  }

  // Handle single string
  if (typeof input === 'string' && input.trim()) {
    return input;
  }

  return undefined;
}
```

### 3. Model-Specific Field Mapping

Different models use different parameter names. Producers handle mapping in code:

```typescript
// Pattern: Field name mapping function
function getVoiceFieldName(model: string): string {
  if (model.includes('elevenlabs')) {
    return 'voice';
  }
  // Default to minimax format
  return 'voice_id';
}

// Usage
if (voice) {
  const fieldName = getVoiceFieldName(request.model);
  input[fieldName] = voice;
}
```

### 4. Schema-first Input Construction

Inputs now come solely from `runtime.sdk.buildPayload()` using the mapping provided by the blueprint (sdkMapping + inputBindings). The payload is validated against `extras.schema.input` before calling Replicate. Provider config defaults/customAttributes are ignored—if a mapped value is missing or invalid, the handler throws immediately instead of supplying a fallback.

---

## Creating a New Producer

### Step 1: Understand Your Producer's Requirements

Answer these questions:

1. **Scope**: Is this per-segment or per-movie?
2. **Inputs**: What inputs does it need from resolvedInputs?
3. **Config**: What model-specific configuration does it need?
4. **Output**: What artefact(s) does it produce?
5. **Models**: Which Replicate models will you support?

### Step 2: Create the Handler File

Create a file in `providers/src/producers/<domain>/replicate-<domain>.ts`:

```typescript
import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import type { HandlerFactory } from '../../types.js';
import { createProviderError } from '../../sdk/errors.js';
import {
  createSchemaFirstReplicateHandler,
  createReplicateClientManager,
  normalizeReplicateOutput,
  buildArtefactsFromUrls,
  extractPlannerContext,
  type PlannerContext,
} from '../../sdk/replicate/index.js';

// 1. Define your configuration interface
interface ReplicateYourDomainConfig {
  promptKey: string;
  someOtherKey?: string;
  defaults?: Record<string, unknown>;
  outputMimeType: string;
}

// 2. Create the handler factory
export function createReplicateYourDomainHandler(): HandlerFactory {
  return (init) => {
    const { descriptor, secretResolver, logger } = init;
    const clientManager = createReplicateClientManager(secretResolver, logger);

    const factory = createProducerHandlerFactory({
      domain: 'media', // or 'text' for prompts
      configValidator: parseConfig,

      // 3. Implement warmStart (optional but recommended)
      warmStart: async () => {
        try {
          await clientManager.ensure();
        } catch (error) {
          logger?.error?.('providers.replicate.yourdomain.warmStart.error', {
            provider: descriptor.provider,
            model: descriptor.model,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },

      // 4. Implement invoke (core logic)
      invoke: async ({ request, runtime }) => {
        // Schema-first input
        const replicate = await clientManager.ensure();
        const plannerContext = extractPlannerContext(request);
        const inputSchema = (request.context.extras as any)?.schema?.input;
        if (!inputSchema) {
          throw createProviderError('Missing input schema for model.', {
            code: 'missing_input_schema',
            kind: 'unknown',
          });
        }

        const input = runtime.sdk.buildPayload();
        validatePayload(inputSchema, input, 'input');

        // Call Replicate API
        let predictionOutput: unknown;
        const modelIdentifier = request.model as
          | `${string}/${string}`
          | `${string}/${string}:${string}`;

        try {
          predictionOutput = await replicate.run(modelIdentifier, { input });
        } catch (error) {
          throw createProviderError('Replicate prediction failed.', {
            code: 'replicate_prediction_failed',
            kind: 'transient',
            retryable: true,
            raw: error,
          });
        }

        // Build artefacts
        const outputUrls = normalizeReplicateOutput(predictionOutput);
        const artefacts = await buildArtefactsFromUrls({
          produces: request.produces,
          urls: outputUrls,
          mimeType: config.outputMimeType,
        });

        const status = artefacts.some((artefact) => artefact.status === 'failed')
          ? 'failed'
          : 'succeeded';

        return {
          status,
          artefacts,
          diagnostics: {
            provider: 'replicate',
            model: request.model,
            input,
            outputUrls,
            plannerContext,
          },
        };
      },
    });

    return factory(init);
  };
}

// 5. Implement config parser
function parseConfig(raw: unknown): ReplicateYourDomainConfig {
  const source = isRecord(raw) ? raw : {};

  const defaults: Record<string, unknown> = {
    ...(isRecord(source.defaults) ? source.defaults : {}),
    ...(isRecord(source.inputs) ? source.inputs : {}),
  };

  const promptKey = typeof source.promptKey === 'string' && source.promptKey
    ? source.promptKey
    : 'prompt';

  const outputMimeType = 'audio/mpeg'; // or whatever your output is

  return {
    promptKey,
    defaults,
    outputMimeType,
  };
}

// 6. Implement resolution functions
function resolveRequiredInput(
  resolvedInputs: Record<string, unknown>,
  planner: PlannerContext
): string | undefined {
  const input = resolvedInputs['YourInputName'];
  const segmentIndex = planner.index?.segment ?? 0;

  // For per-segment
  if (Array.isArray(input) && input.length > 0) {
    const value = input[segmentIndex] ?? input[0];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  // For per-movie (single string)
  if (typeof input === 'string' && input.trim()) {
    return input;
  }

  return undefined;
}

function resolveProjectConfigValue(
  resolvedInputs: Record<string, unknown>
): string | undefined {
  const value = resolvedInputs['YourProjectConfigValue'];

  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  return undefined;
}

// 7. Implement field mapping (if needed)
function getFieldName(model: string): string {
  if (model.includes('provider-a')) {
    return 'field_name_a';
  }
  if (model.includes('provider-b')) {
    return 'field_name_b';
  }
  return 'default_field_name';
}
```

### Step 3: Register in Mappings

Add your handler to `providers/src/mappings.ts`:

```typescript
import { createReplicateYourDomainHandler } from './producers/yourdomain/replicate-yourdomain.js';

// In the implementations array
{
  match: {
    provider: 'replicate',
    model: 'provider/model-name',
    environment: 'local'
  },
  mode: 'live',
  factory: createReplicateYourDomainHandler(),
},
```

### Step 4: Create Unit Tests

Create `providers/src/producers/<domain>/replicate-<domain>.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createReplicateYourDomainHandler } from './replicate-yourdomain.js';
import type { ProviderJobContext, SecretResolver } from '../../types.js';

// Mock the Replicate SDK
vi.mock('replicate', () => ({
  default: vi.fn().mockImplementation(() => ({
    run: vi.fn(),
  })),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('createReplicateYourDomainHandler', () => {
  let secretResolver: SecretResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    secretResolver = {
      async getSecret(key: string) {
        if (key === 'REPLICATE_API_TOKEN') {
          return 'test-token';
        }
        return null;
      },
    };
  });

  describe('basic functionality', () => {
    it('generates output successfully', async () => {
      const handler = createReplicateYourDomainHandler()({
        descriptor: {
          provider: 'replicate',
          model: 'provider/model-name',
          environment: 'local',
        },
        mode: 'live',
        secretResolver,
        logger: undefined,
      });

      const request: ProviderJobContext = {
        jobId: 'test-job',
        provider: 'replicate',
        model: 'provider/model-name',
        revision: 'test-rev',
        layerIndex: 0,
        attempt: 1,
        inputs: ['Input:YourInput'],
        produces: ['Artifact:YourOutput'],
        context: {
          providerConfig: {},
          rawAttachments: [],
          environment: 'local',
          observability: undefined,
          extras: {
            plannerContext: {
              index: { segment: 0 },
            },
            resolvedInputs: {
              YourInput: 'test input',
            },
          },
        },
      };

      const testData = new Uint8Array([1, 2, 3]);
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => testData.buffer,
      });

      const Replicate = (await import('replicate')).default;
      const mockRun = vi.fn().mockResolvedValue('https://example.com/output.mp3');
      (Replicate as any).mockImplementation(() => ({
        run: mockRun,
      }));

      await handler.warmStart?.({ logger: undefined });
      const result = await handler.invoke(request);

      expect(result.status).toBe('succeeded');
      expect(mockRun).toHaveBeenCalledWith('provider/model-name', {
        input: expect.objectContaining({
          prompt: 'test input',
        }),
      });
    });
  });

  // Add more test cases:
  // - Test input resolution from arrays
  // - Test projectConfig value mapping
  // - Test field name mapping for different models
  // - Test error handling
  // - Test missing inputs
});
```

### Step 5: Create Integration Tests (Optional)

Create `providers/tests/integration/replicate-yourdomain.int.test.ts`:

```typescript
/**
 * YourDomain Integration Tests
 *
 * These tests call real Replicate APIs and are expensive/slow.
 * By default, all tests are SKIPPED even if REPLICATE_API_TOKEN is available.
 *
 * Enable via environment variables:
 * - RUN_YOURDOMAIN_TESTS=1
 */

import { describe, expect, it } from 'vitest';
import { createReplicateYourDomainHandler } from '../../src/producers/yourdomain/replicate-yourdomain.js';
import type { ProviderJobContext } from '../../src/types.js';
import { saveTestArtifact } from './test-utils.js';

const describeIfToken = process.env.REPLICATE_API_TOKEN ? describe : describe.skip;
const describeIfEnabled = process.env.RUN_YOURDOMAIN_TESTS ? describe : describe.skip;

describeIfToken('Replicate yourdomain integration', () => {
  describeIfEnabled('provider/model-name', () => {
    it('generates output via Replicate', async () => {
      const handler = createReplicateYourDomainHandler()(/* ... */);
      // ... test implementation
    }, 120000); // 2 minute timeout
  });
});
```

---

## Adding Support for New Models

### Option 1: Same Producer Type, Different Model

If the new model is similar to existing models (e.g., another audio model):

1. **Check field name differences**: Look up the model's API schema in `docs/AI-SDKs/replicate.md`

2. **Update field mapping function** (if needed):

```typescript
function getVoiceFieldName(model: string): string {
  if (model.includes('elevenlabs')) {
    return 'voice';
  }
  if (model.includes('newprovider')) {
    return 'voice_setting'; // New model uses different name
  }
  return 'voice_id'; // Default
}
```

3. **Register in mappings.ts**:

```typescript
{
  match: {
    provider: 'replicate',
    model: 'newprovider/new-model',
    environment: 'local'
  },
  mode: 'live',
  factory: createReplicateAudioHandler(), // Reuse existing handler
},
```

4. **Add to producer-options.ts**:

```typescript
{
  producer: 'AudioProducer',
  providers: [
    {
      priority: 'main',
      provider: 'replicate',
      model: 'newprovider/new-model',
      customAttributes: {
        // Model-specific settings
        quality: 'high',
      }
    }
  ]
}
```

5. **Add unit test** for the new model:

```typescript
it('works with newprovider/new-model', async () => {
  // Test with the new model
});
```

### Option 2: New Config Parameters

If the new model needs different configuration parameters:

1. **Check if using config file** (for LLM producers only):

```typescript
// In producer-options.ts
{
  producer: 'ScriptProducer',
  providers: [
    {
      provider: 'replicate',
      model: 'new-llm-model',
      configFile: 'script-producer.toml', // Points to TOML config
    }
  ]
}
```

2. **For media producers, use customAttributes**:

```typescript
{
  producer: 'AudioProducer',
  providers: [
    {
      provider: 'replicate',
      model: 'newprovider/new-model',
      customAttributes: {
        // New model-specific parameters
        enhancement_level: 2,
        noise_reduction: true,
      }
    }
  ]
}
```

3. **Update config parser if needed**:

```typescript
function parseReplicateAudioConfig(raw: unknown): ReplicateAudioConfig {
  const source = isRecord(raw) ? raw : {};

  // Merge all config sources
  const defaults: Record<string, unknown> = {
    ...(isRecord(source.defaults) ? source.defaults : {}),
    ...(isRecord(source.inputs) ? source.inputs : {}),
  };

  // Handle model-specific keys
  const textKey = source.textKey ??
    (model.includes('elevenlabs') ? 'prompt' : 'text');

  return { textKey, defaults, outputMimeType: 'audio/mpeg' };
}
```

### Option 3: Different Duration/Size Units

Some models use different units (e.g., seconds vs milliseconds):

```typescript
// Example from music producer
interface ReplicateMusicConfig {
  promptKey: string;
  durationKey: string;
  durationMultiplier: number; // 1 for seconds, 1000 for milliseconds
  maxDuration?: number;
  defaults?: Record<string, unknown>;
  outputMimeType: string;
}

// In producer-options.ts
{
  producer: 'TextToMusicProducer',
  providers: [
    {
      provider: 'replicate',
      model: 'stability-ai/stable-audio-2.5',
      customAttributes: {
        promptKey: 'prompt',
        durationKey: 'duration', // Uses seconds
        durationMultiplier: 1,
        maxDuration: 190,
      }
    },
    {
      provider: 'replicate',
      model: 'elevenlabs/music',
      customAttributes: {
        promptKey: 'prompt',
        durationKey: 'music_length_ms', // Uses milliseconds
        durationMultiplier: 1000,
        maxDuration: 300000,
      }
    }
  ]
}

// In producer code
const duration = resolveDuration(resolvedInputs);
if (duration !== undefined) {
  const mappedDuration = capDuration(
    duration,
    config.durationMultiplier,
    config.maxDuration
  );
  input[config.durationKey] = mappedDuration;
}
```

---

## projectConfig Integration

### Understanding the Flow

```
User Input (CLI)
    ↓
projectConfig (cli/src/lib/project-config.ts)
    ↓
inputValues (deriveBlueprintAndInputs)
    ↓
Blueprint System (core)
    ↓
InputEvents
    ↓
resolvedInputs (in extras.resolvedInputs)
    ↓
Producer Handler
```

### Adding New projectConfig Values

#### Step 1: Add to ProjectConfig Type (in core package)

```typescript
// core/src/types.ts
export interface ProjectConfig {
  // Existing
  voice?: string;
  size?: string;
  aspectRatio?: string;
  duration?: number;

  // New
  yourNewSetting?: string;
}
```

#### Step 2: Map to InputValues

```typescript
// cli/src/lib/project-config.ts
export function deriveBlueprintAndInputs(
  config: ProjectConfig,
): {
  blueprint: BlueprintExpansionConfig;
  inputValues: InputValues;
  segmentCount: number;
} {
  // ... existing code ...

  const inputs: InputValues = {
    UseVideo: config.useVideo,
    Audience: config.audience,
    Language: config.language,
    Duration: config.duration,
    AspectRatio: config.aspectRatio,
    Size: config.size,
    VoiceId: config.voice,

    // Add your new setting
    YourNewSetting: config.yourNewSetting,
  };

  return { blueprint, inputValues, segmentCount };
}
```

#### Step 3: Add to Blueprint (if needed)

```typescript
// core/src/blueprints/yourdomain.ts
export const yourSection: BlueprintSection = {
  id: 'yourdomain',
  label: 'Your Section',
  nodes: [
    node(inputRef('YourNewSetting'), 'perMovie'), // or 'perSegment'
    node(producerRef('YourProducer'), 'perSegment'),
    node(artifactRef('YourOutput'), 'perSegment'),
  ],
  edges: [
    edge(inputRef('YourNewSetting'), producerRef('YourProducer'), {
      dimensions: segmentDim, // or movieDim
    }),
    edge(producerRef('YourProducer'), artifactRef('YourOutput'), {
      dimensions: segmentDim,
    }),
  ],
};
```

#### Step 4: Read in Producer

```typescript
// providers/src/producers/yourdomain/replicate-yourdomain.ts
function resolveYourNewSetting(
  resolvedInputs: Record<string, unknown>
): string | undefined {
  const value = resolvedInputs['YourNewSetting'];

  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  return undefined;
}

// In invoke function
const yourSetting = resolveYourNewSetting(resolvedInputs);
if (yourSetting) {
  const fieldName = getYourSettingFieldName(request.model);
  input[fieldName] = yourSetting;
}
```

#### Step 5: Remove from customAttributes

If this setting was previously in customAttributes, comment it out:

```typescript
// cli/src/lib/producer-options.ts
{
  producer: 'YourProducer',
  providers: [
    {
      provider: 'replicate',
      model: 'provider/model',
      customAttributes: {
        // your_setting: 'default', // Now comes from projectConfig
        other_setting: 'value',
      }
    }
  ]
}
```

### When to Use customAttributes vs projectConfig

**Use projectConfig when**:
- The setting is user-facing (CLI flag, UI setting)
- Changes should trigger regeneration
- The value is consistent across different models
- Examples: voice, size, aspectRatio, duration

**Use customAttributes when**:
- The setting is model-specific
- The setting is technical/advanced
- The value differs between models
- Examples: fps, camera_fixed, enhancement_level, guidance_scale

---

## Examples

### Example 1: Audio Producer (Per-Segment)

The audio producer generates narration for each segment:

```typescript
// Key characteristics:
// - Per-segment (one audio file per segment)
// - Reads VoiceId from projectConfig via resolvedInputs
// - Maps to model-specific field names (voice_id vs voice)
// - Reads SegmentNarration array using segment index

export function createReplicateAudioHandler(): HandlerFactory {
  return (init) => {
    const factory = createProducerHandlerFactory({
      domain: 'media',
      configValidator: parseReplicateAudioConfig,
      warmStart: async () => {
        await clientManager.ensure();
      },
      invoke: async ({ request, runtime }) => {
        const resolvedInputs = runtime.inputs.all();
        const plannerContext = extractPlannerContext(request);

        // Resolve text using segment index
        const text = resolveText(resolvedInputs, plannerContext);

        // Resolve voice from projectConfig
        const voice = resolveVoice(resolvedInputs);

        // Build input from sdk mapping
        const input = runtime.sdk.buildPayload();

        // Map voice to model-specific field name
        if (voice) {
          const voiceFieldName = getVoiceFieldName(request.model);
          input[voiceFieldName] = voice; // Overrides customAttributes
        }

        // Call API and build artefacts
        const predictionOutput = await replicate.run(modelIdentifier, { input });
        const outputUrls = normalizeReplicateOutput(predictionOutput);
        const artefacts = await buildArtefactsFromUrls({
          produces: request.produces,
          urls: outputUrls,
          mimeType: config.outputMimeType,
        });

        return { status: 'succeeded', artefacts, diagnostics };
      },
    });
    return factory(init);
  };
}

// Resolution functions
function resolveText(
  resolvedInputs: Record<string, unknown>,
  planner: PlannerContext
): string | undefined {
  const narrationInput = resolvedInputs['SegmentNarration'];
  const segmentIndex = planner.index?.segment ?? 0;

  // Handle array of narration texts
  if (Array.isArray(narrationInput) && narrationInput.length > 0) {
    const text = narrationInput[segmentIndex] ?? narrationInput[0];
    if (typeof text === 'string' && text.trim()) {
      return text;
    }
  }

  // Handle single string narration
  if (typeof narrationInput === 'string' && narrationInput.trim()) {
    return narrationInput;
  }

  return undefined;
}

function resolveVoice(resolvedInputs: Record<string, unknown>): string | undefined {
  const voiceInput = resolvedInputs['VoiceId'];

  if (typeof voiceInput === 'string' && voiceInput.trim()) {
    return voiceInput;
  }

  return undefined;
}

function getVoiceFieldName(model: string): string {
  if (model.includes('elevenlabs')) {
    return 'voice';
  }
  return 'voice_id'; // Default to minimax format
}
```

### Example 2: Video Producer (Per-Segment)

The video producer generates videos for each segment:

```typescript
// Key characteristics:
// - Per-segment
// - Reads Size and AspectRatio from projectConfig via resolvedInputs
// - Both map to standard field names (resolution, aspect_ratio)
// - Handles multiple prompt types (TextToVideoPrompt, ImageToVideoPrompt)
// - Optionally handles images (SegmentStartImage, LastFrameImage)

export function createReplicateVideoHandler(): HandlerFactory {
  return createSchemaFirstReplicateHandler({
    outputMimeType: 'video/mp4',
    logKey: 'video',
    missingSchemaMessage: 'Missing input schema for Replicate video provider.',
    predictionFailedMessage: 'Replicate video prediction failed.',
  });
}

// Resolution functions
function resolveSize(resolvedInputs: Record<string, unknown>): string | undefined {
  const sizeInput = resolvedInputs['Size'];

  if (typeof sizeInput === 'string' && sizeInput.trim()) {
    return sizeInput;
  }

  return undefined;
}

function resolveAspectRatio(resolvedInputs: Record<string, unknown>): string | undefined {
  const aspectRatioInput = resolvedInputs['AspectRatio'];

  if (typeof aspectRatioInput === 'string' && aspectRatioInput.trim()) {
    return aspectRatioInput;
  }

  return undefined;
}

function getSizeFieldName(model: string): string {
  // All current video models use 'resolution'
  return 'resolution';
}

function getAspectRatioFieldName(model: string): string {
  // All current video models use 'aspect_ratio'
  return 'aspect_ratio';
}
```

### Example 3: Music Producer (Per-Movie)

The music producer generates a single music track for the entire movie:

```typescript
// Key characteristics:
// - Per-movie (single music track for entire movie)
// - Reads Duration from projectConfig via resolvedInputs
// - Maps duration with multiplier (seconds vs milliseconds)
// - Caps duration at model-specific max
// - No segment index needed

export function createReplicateMusicHandler(): HandlerFactory {
  return createSchemaFirstReplicateHandler({
    outputMimeType: 'audio/mpeg',
    logKey: 'music',
    missingSchemaMessage: 'Missing input schema for Replicate music provider.',
    predictionFailedMessage: 'Replicate music prediction failed.',
  });
}

function resolveMusicPrompt(resolvedInputs: Record<string, unknown>): string | undefined {
  const promptInput = resolvedInputs['MusicPrompt'];

  // Per-movie: single string, no array
  if (typeof promptInput === 'string' && promptInput.trim()) {
    return promptInput;
  }

  return undefined;
}

function resolveDuration(resolvedInputs: Record<string, unknown>): number | undefined {
  const durationInput = resolvedInputs['Duration'];

  // Per-movie: single number, no array
  if (typeof durationInput === 'number' && durationInput > 0) {
    return durationInput;
  }

  return undefined;
}

function capDuration(
  duration: number,
  multiplier: number,
  max: number | undefined
): number {
  const converted = duration * multiplier;

  if (max !== undefined) {
    return Math.min(converted, max);
  }

  return converted;
}
```

### Example 4: Image Producer (Per-Segment)

The image producer generates images for each segment:

```typescript
// Key characteristics:
// - Per-segment
// - Reads Size and AspectRatio from projectConfig via resolvedInputs
// - Maps to model-specific field names (varies by model)
// - Some models use (width, height) instead of size string
// - May produce multiple images per segment

export function createReplicateTextToImageHandler(): HandlerFactory {
  return createSchemaFirstReplicateHandler({
    outputMimeType: 'image/png',
    logKey: 'image',
    missingSchemaMessage: 'Missing input schema for Replicate image provider.',
    predictionFailedMessage: 'Replicate prediction failed',
  });
}

```

---

## Testing

### Unit Testing Patterns

#### Test Structure

```typescript
describe('createReplicateYourDomainHandler', () => {
  let secretResolver: SecretResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    secretResolver = {
      async getSecret(key: string) {
        if (key === 'REPLICATE_API_TOKEN') {
          return 'test-token';
        }
        return null;
      },
    };
  });

  // Group tests by functionality
  describe('config validation', () => {
    it('uses default config when not specified', async () => {
      // Test
    });

    it('uses custom config when specified', async () => {
      // Test
    });
  });

  describe('input resolution', () => {
    it('resolves from array using segment index', async () => {
      // Test with array input
    });

    it('resolves from single string', async () => {
      // Test with string input
    });

    it('throws error when input is missing', async () => {
      // Test error case
    });
  });

  describe('projectConfig value mapping', () => {
    it('maps value to model-specific field name', async () => {
      // Test field mapping
    });

    it('value from resolvedInputs takes precedence over customAttributes', async () => {
      // Test precedence
    });

    it('does not add field when value is not provided', async () => {
      // Test optional values
    });
  });

  describe('model-specific behavior', () => {
    it('works with model-a', async () => {
      // Test model A
    });

    it('works with model-b', async () => {
      // Test model B
    });
  });

  describe('error handling', () => {
    it('throws error when API fails', async () => {
      // Test API error
    });

    it('handles download failure gracefully', async () => {
      // Test download error
    });
  });
});
```

#### Testing Input Resolution

```typescript
it('resolves text from array using segment index', async () => {
  const request: ProviderJobContext = {
    // ... basic setup
    context: {
      providerConfig: {},
      rawAttachments: [],
      environment: 'local',
      observability: undefined,
      extras: {
        plannerContext: {
          index: { segment: 1 }, // Second segment
        },
        resolvedInputs: {
          SegmentNarration: ['First', 'Second', 'Third'],
        },
      },
    },
  };

  const mockRun = vi.fn().mockResolvedValue('https://example.com/audio.mp3');
  // ... mock setup

  await handler.invoke(request);

  expect(mockRun).toHaveBeenCalledWith('model-name', {
    input: expect.objectContaining({
      text: 'Second', // Should use segment index 1
    }),
  });
});
```

#### Testing Field Mapping

```typescript
it('maps VoiceId to voice_id for minimax models', async () => {
  const request: ProviderJobContext = {
    model: 'minimax/speech-02-hd',
    context: {
      extras: {
        resolvedInputs: {
          SegmentNarration: ['Test'],
          VoiceId: 'English_CaptivatingStoryteller',
        },
      },
    },
    // ...
  };

  await handler.invoke(request);

  expect(mockRun).toHaveBeenCalledWith('minimax/speech-02-hd', {
    input: expect.objectContaining({
      voice_id: 'English_CaptivatingStoryteller',
    }),
  });
});

it('maps VoiceId to voice for elevenlabs models', async () => {
  const request: ProviderJobContext = {
    model: 'elevenlabs/v3',
    context: {
      extras: {
        resolvedInputs: {
          SegmentNarration: ['Test'],
          VoiceId: 'Grimblewood',
        },
      },
    },
    // ...
  };

  await handler.invoke(request);

  expect(mockRun).toHaveBeenCalledWith('elevenlabs/v3', {
    input: expect.objectContaining({
      voice: 'Grimblewood',
    }),
  });
});
```

#### Testing Precedence

```typescript
it('resolvedInputs value takes precedence over customAttributes', async () => {
  const request: ProviderJobContext = {
    context: {
      providerConfig: {
        customAttributes: {
          voice_id: 'OldVoice', // In customAttributes
        },
      },
      extras: {
        resolvedInputs: {
          SegmentNarration: ['Test'],
          VoiceId: 'NewVoice', // In resolvedInputs
        },
      },
    },
    // ...
  };

  await handler.invoke(request);

  expect(mockRun).toHaveBeenCalledWith('model-name', {
    input: expect.objectContaining({
      voice_id: 'NewVoice', // Should use resolvedInputs value
    }),
  });
});
```

### Integration Testing

Integration tests call real APIs and should be:
- Opt-in (skipped by default)
- Fast (use short durations, small sizes)
- Conditional (only run when explicitly enabled)

```typescript
/**
 * Audio Integration Tests
 *
 * Enable via environment variables:
 * - RUN_AUDIO_MINIMAX=1 (test minimax model)
 * - RUN_AUDIO_ELEVENLABS=1 (test elevenlabs model)
 * - RUN_ALL_AUDIO_TESTS=1 (test all models)
 */

const describeIfToken = process.env.REPLICATE_API_TOKEN ? describe : describe.skip;
const describeIfMinimax =
  process.env.RUN_AUDIO_MINIMAX || process.env.RUN_ALL_AUDIO_TESTS
    ? describe
    : describe.skip;

describeIfToken('Replicate audio integration', () => {
  describeIfMinimax('minimax/speech-02-hd', () => {
    it('generates audio via Replicate', async () => {
      const handler = createReplicateAudioHandler()(/* ... */);

      const request: ProviderJobContext = {
        // Use SHORT narration for fast test
        extras: {
          resolvedInputs: {
            SegmentNarration: ['Short test narration'],
            VoiceId: 'English_CaptivatingStoryteller',
          },
        },
      };

      const result = await handler.invoke(request);

      expect(result.status).toBe('succeeded');
      expect(result.artefacts).toHaveLength(1);
      expect(result.artefacts[0]?.blob?.mimeType).toBe('audio/mpeg');

      // Optional: save for manual verification
      if (result.artefacts[0]?.blob?.data) {
        saveTestArtifact('test-minimax-output.mp3', result.artefacts[0].blob.data);
      }
    }, 60000); // 1 minute timeout
  });
});
```

---

## Best Practices

### 1. Resolution Functions

Always create separate resolution functions for each input:

```typescript
// ✅ Good: Clear, testable, reusable
function resolveText(resolvedInputs, planner) { /* ... */ }
function resolveVoice(resolvedInputs) { /* ... */ }
function resolveSize(resolvedInputs) { /* ... */ }

// ❌ Bad: Inline, hard to test
const text = Array.isArray(resolvedInputs['SegmentNarration'])
  ? resolvedInputs['SegmentNarration'][planner.index?.segment ?? 0]
  : resolvedInputs['SegmentNarration'];
```

### 2. Field Mapping Functions

Create field mapping functions even if currently only one model:

```typescript
// ✅ Good: Extensible for future models
function getVoiceFieldName(model: string): string {
  if (model.includes('elevenlabs')) {
    return 'voice';
  }
  return 'voice_id';
}

// ❌ Bad: Hardcoded, not extensible
input.voice_id = voice;
```

### 3. Error Handling

Use typed errors with clear codes:

```typescript
// ✅ Good: Clear, retryable, with context
throw createProviderError('No text available for audio generation.', {
  code: 'missing_text',
  kind: 'user_input',
  causedByUser: true,
});

// ❌ Bad: Generic error, no context
throw new Error('Missing input');
```

### 4. Diagnostics

Include comprehensive diagnostics in results:

```typescript
// ✅ Good: Complete context for debugging
return {
  status,
  artefacts,
  diagnostics: {
    provider: 'replicate',
    model: request.model,
    input, // Full input sent to API
    outputUrls, // URLs returned
    plannerContext, // Segment/movie context
    duration, // Original value
    mappedDuration, // After transformation
    // Include rawOutput if no URLs
    ...(outputUrls.length === 0 && { rawOutput: predictionOutput }),
  },
};
```

### 5. Config Validation

Parse and validate config with sensible defaults:

```typescript
// ✅ Good: Safe parsing with defaults
function parseConfig(raw: unknown): Config {
  const source = isRecord(raw) ? raw : {};

  const defaults: Record<string, unknown> = {
    ...(isRecord(source.defaults) ? source.defaults : {}),
    ...(isRecord(source.inputs) ? source.inputs : {}),
  };

  const promptKey = typeof source.promptKey === 'string' && source.promptKey
    ? source.promptKey
    : 'prompt'; // Sensible default

  return { promptKey, defaults, outputMimeType: 'audio/mpeg' };
}

// ❌ Bad: Assumes structure, no validation
const config = raw as Config;
```

### 6. WarmStart

Always implement warmStart for production handlers:

```typescript
// ✅ Good: Initialize client in warmStart
warmStart: async () => {
  try {
    await clientManager.ensure();
  } catch (error) {
    logger?.error?.('providers.replicate.audio.warmStart.error', {
      provider: descriptor.provider,
      model: descriptor.model,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
},

// ❌ Bad: Client initialization on first invoke
// This delays the first request
```

### 7. Type Safety

Use type guards and validation:

```typescript
// ✅ Good: Type-safe with validation
function resolveText(resolvedInputs: Record<string, unknown>): string | undefined {
  const input = resolvedInputs['SegmentNarration'];

  if (Array.isArray(input)) {
    const text = input[segmentIndex];
    if (typeof text === 'string' && text.trim()) {
      return text;
    }
  }

  if (typeof input === 'string' && input.trim()) {
    return input;
  }

  return undefined;
}

// ❌ Bad: Assumes type
const text = resolvedInputs['SegmentNarration'][segmentIndex];
```

### 8. Testing Coverage

Test all paths and edge cases:

```typescript
describe('resolveText', () => {
  it('resolves from array using segment index'); // Happy path
  it('falls back to first element when index out of bounds'); // Edge case
  it('handles single string'); // Alternative path
  it('returns undefined when input missing'); // Error case
  it('returns undefined when input is empty string'); // Edge case
});
```

### 9. Documentation

Document model-specific behavior:

```typescript
/**
 * Determine the voice parameter name based on the model.
 * Different models use different parameter names:
 * - minimax models: 'voice_id'
 * - elevenlabs models: 'voice'
 */
function getVoiceFieldName(model: string): string {
  if (model.includes('elevenlabs')) {
    return 'voice';
  }
  return 'voice_id';
}
```

### 10. Consistent Patterns

Follow established patterns from existing producers:

- Audio producer: per-segment, VoiceId mapping
- Video producer: per-segment, Size/AspectRatio mapping
- Music producer: per-movie, Duration with multiplier
- Image producer: per-segment, Size/AspectRatio mapping

When creating a new producer, refer to the most similar existing producer and follow its patterns.

---

## Summary Checklist

When creating a new producer or adding model support, use this checklist:

### New Producer Checklist

- [ ] Identify producer type (per-segment or per-movie)
- [ ] Identify required inputs from resolvedInputs
- [ ] Identify projectConfig values needed
- [ ] Create handler file with SDK imports
- [ ] Define configuration interface
- [ ] Implement config parser with defaults
- [ ] Implement warmStart
- [ ] Implement invoke with input resolution
- [ ] Create resolution functions for each input
- [ ] Create field mapping functions
- [ ] Handle errors with typed errors
- [ ] Build artefacts with complete diagnostics
- [ ] Register in mappings.ts
- [ ] Add to producer-options.ts
- [ ] Create unit tests (15+ tests recommended)
- [ ] Create integration tests (optional)
- [ ] Update projectConfig if needed
- [ ] Update blueprint if needed
- [ ] Document model-specific behavior

### New Model Checklist

- [ ] Check model API schema in replicate.md
- [ ] Identify parameter name differences
- [ ] Update field mapping functions if needed
- [ ] Register in mappings.ts
- [ ] Add to producer-options.ts with customAttributes
- [ ] Add unit tests for new model
- [ ] Add integration test (optional)
- [ ] Document new model in provider-architecture.md

---

## Reference Files

Key files to reference when working with producers:

### CLI Package
- `cli/src/lib/project-config.ts` - projectConfig → inputValues mapping
- `cli/src/lib/producer-options.ts` - Producer catalog and customAttributes

### Core Package
- `core/src/types.ts` - ProjectConfig type definition
- `core/src/blueprints/*.ts` - Blueprint definitions
- `core/src/inputs.ts` - Input system

### Providers Package
- `providers/src/mappings.ts` - Producer registry
- `providers/src/sdk/handler-factory.ts` - SDK factory
- `providers/src/sdk/replicate/*.ts` - Replicate SDK helpers
- `providers/src/producers/audio/replicate-audio.ts` - Audio example
- `providers/src/producers/video/replicate-video.ts` - Video example
- `providers/src/producers/music/replicate-music.ts` - Music example
- `providers/src/producers/image/replicate-text-to-image.ts` - Image example

### Documentation
- `providers/docs/AI-SDKs/replicate.md` - Model schemas
- `providers/docs/provider-architecture.md` - Architecture overview
- `providers/docs/extensibility.md` - SDK goals and patterns
