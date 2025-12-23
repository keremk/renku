// Client
export {
  createVercelGatewayClientManager,
  type VercelGatewayClientManager,
} from './client.js';

// Generation
export {
  callVercelGateway,
  sanitizeResponseMetadata,
  type VercelGatewayGenerationOptions,
  type VercelGatewayGenerationResult,
} from './generation.js';

// Re-export config parsing from OpenAI SDK (same config shape)
export { parseOpenAiConfig, normalizeJsonSchema, type OpenAiLlmConfig, type OpenAiResponseFormat } from '../openai/config.js';

// Re-export prompt rendering from OpenAI SDK
export { renderPrompts, buildPrompt, type RenderedPrompts } from '../openai/prompts.js';

// Re-export simulation from OpenAI SDK
export { simulateOpenAiGeneration } from '../openai/simulation.js';

// Re-export artefact building from OpenAI SDK
export { buildArtefactsFromResponse } from '../openai/artefacts.js';
