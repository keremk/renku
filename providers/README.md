# @gorenku/providers

> AI provider integrations for Renku

[![npm version](https://img.shields.io/npm/v/@gorenku/providers.svg)](https://www.npmjs.com/package/@gorenku/providers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AI provider integrations for Renku - includes implementations for OpenAI, Replicate, fal.ai, Wavespeed AI, and other AI services. Provides producer implementations, model catalogs, and a unified provider registry system.

## Overview

`@gorenku/providers` abstracts away the complexity of working with multiple AI service providers. It provides:

- **Unified provider interface** - Consistent API across different AI services
- **Provider registry** - Dynamic provider and model resolution
- **Producer implementations** - Ready-to-use producers for common tasks
- **Model catalog system** - Centralized model definitions and configuration
- **Schema validation** - Input/output schema validation for all producers
- **Mock support** - Test mode with mock responses for development

This package is designed for developers building on top of Renku or extending it with new providers.

## Installation

```bash
npm install @gorenku/providers
```

## Key Exports

### Registry

- `createProviderRegistry()` - Main factory for creating the provider registry
- `ProviderRegistry` - Type for the registry interface

### Producers

Producer implementations organized by type:
- **LLM Producers** - Text generation and structured output
- **Timeline Producers** - Timeline composition and assembly
- **Export Producers** - Video export and rendering

### Model Catalog

- `loadModelCatalog()` - Load model definitions from YAML files
- `lookupModel()` - Find model configurations by ID
- `loadModelInputSchema()` - Load input schemas for models
- Types: `ModelDefinition`, `ProducerModelEntry`, `ModelType`

### Schema

- `SchemaRegistry` - Schema validation and resolution
- Input/output schema validation utilities

### SDK

Provider-specific SDK implementations and utilities for:
- OpenAI
- Replicate
- fal.ai
- Wavespeed AI
- Unified provider abstraction

## Supported Providers

### OpenAI

Text generation and structured output using GPT models.

**Models:**
- `gpt-4o` - Latest GPT-4 Omni model
- `gpt-4o-mini` - Smaller, faster GPT-4 variant
- `gpt-4-turbo` - High-performance GPT-4

**Producers:** ScriptProducer, ImagePromptProducer

### Replicate

Video, audio, and image generation using various open-source models.

**Model Examples:**
- `google/nano-banana` - Image generation
- `minimax/speech-2.6-hd` - Text-to-speech
- `minimax/video-01` - Video generation

**Producers:** ImageProducer, AudioProducer, VideoProducer

### fal.ai

Fast video, audio, and image generation with optimized inference.

**Model Examples:**
- `fal-ai/fast-sdxl` - Fast Stable Diffusion XL
- `fal-ai/whisper` - Speech recognition

**Producers:** ImageProducer, AudioProducer

### Wavespeed AI

Video and audio generation services.

**Producers:** VideoProducer, AudioProducer

### Renku (Built-in)

Built-in providers for timeline composition and video rendering.

**Producers:**
- `TimelineComposer` - Assembles timeline from segments
- `VideoExporter` - Exports timeline to MP4 video

## Usage Example

```typescript
import { createProviderRegistry } from '@gorenku/providers';

// Create the provider registry
const registry = await createProviderRegistry({
  mode: 'live', // or 'mock' for testing
  catalogPath: './catalog/producers'
});

// Get a handler for a specific producer and provider
const handler = registry.getHandler('ScriptProducer', 'openai');

// Execute the handler with context
const context = {
  inputs: {
    InquiryPrompt: 'Tell me about renewable energy',
    Audience: 'Adult'
  },
  providerConfig: {
    model: 'gpt-4o-mini',
    temperature: 0.7
  }
};

const result = await handler(context);
console.log(result); // Generated script
```

## Model Catalog

Models are defined in YAML files within the `producers/` directory. Each producer has a catalog of supported models and their configurations.

Example model definition:

```yaml
models:
  - id: gpt-4o-mini
    type: llm
    provider: openai
    config:
      maxTokens: 4096
      temperature: 0.7
```

To list available models for a blueprint:

```bash
renku producers:list --blueprint=./blueprint.yaml
```

## Development

### Setup

```bash
# Clone the monorepo
git clone https://github.com/yourusername/renku.git
cd renku

# Install dependencies
pnpm install
```

### Build

```bash
# Build the providers package
pnpm --filter @gorenku/providers build

# Watch mode for development
pnpm --filter @gorenku/providers dev
```

### Testing

```bash
# Run all tests
pnpm --filter @gorenku/providers test

# Run unit tests only
pnpm test:providers

# Run integration tests (requires API keys)
pnpm --filter @gorenku/providers test:integration

# Run e2e tests (requires API keys)
pnpm --filter @gorenku/providers test:e2e
```

### Type Checking

```bash
# Type check the package
pnpm --filter @gorenku/providers type-check
```

### Linting

```bash
# Lint the code
pnpm --filter @gorenku/providers lint
```

## Adding a New Provider

To add a new AI provider:

1. **Create SDK implementation** in `src/sdk/<provider>/`

   ```typescript
   // src/sdk/my-provider/handler.ts
   export function createMyProviderHandler(config: ProviderConfig) {
     return async (context: JobContext) => {
       // Implement provider-specific logic
       return result;
     };
   }
   ```

2. **Add model catalog** in `producers/<producer-type>/models/`

   ```yaml
   # producers/llm/models/my-provider.yaml
   models:
     - id: my-model-v1
       type: llm
       provider: my-provider
       config:
         maxTokens: 2048
   ```

3. **Register in provider registry** by adding to the catalog path

4. **Add tests** in `tests/` directory

   ```typescript
   // tests/integration/my-provider.test.ts
   describe('MyProvider', () => {
     it('should generate content', async () => {
       // Test implementation
     });
   });
   ```

5. **Update documentation** with provider details and examples

## Testing

The providers package includes multiple test suites:

- **Unit tests** - Test individual functions and modules
- **Integration tests** - Test provider integrations (may require API keys)
- **E2E tests** - End-to-end workflow tests

Set required API keys in your environment before running integration/e2e tests:

```bash
export OPENAI_API_KEY="your-key"
export REPLICATE_API_TOKEN="your-token"
export FAL_KEY="your-key"
```

## Contributing

When contributing to the providers package:

- Follow the coding conventions in [CLAUDE.md](../CLAUDE.md)
- Add comprehensive tests for new providers
- Document new models in the catalog
- Update this README with provider details
- Ensure TypeScript strict mode compliance

## License

MIT
