// Client management
export { createOpenAiClientManager, type OpenAiClientManager } from './client.js';

// Configuration
export {
  parseOpenAiConfig,
  normalizeJsonSchema,
  type OpenAiLlmConfig,
  type OpenAiResponseFormat,
} from './config.js';

// Prompt rendering
export { renderPrompts, buildPrompt, type RenderedPrompts } from './prompts.js';

// Artifact mapping
export {
  buildArtefactsFromResponse,
  parseArtefactIdentifier,
  type BuildArtefactOptions,
  type ParsedArtefactIdentifier,
} from './artefacts.js';

// OpenAI generation
export {
  callOpenAi,
  sanitizeResponseMetadata,
  type GenerationOptions,
  type GenerationResult,
} from './generation.js';

// Simulation for dry-run (used internally by generation.ts)
export { simulateOpenAiGeneration, type SimulationSizeHints } from './simulation.js';
