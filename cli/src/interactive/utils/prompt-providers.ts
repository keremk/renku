/**
 * Providers that support prompt producers (LLM text generation).
 * This is the ONE place where prompt providers are defined.
 * Easy to modify when adding new providers in the future.
 */
export const PROMPT_PROVIDERS = ['openai', 'vercel'] as const;

export type PromptProvider = (typeof PROMPT_PROVIDERS)[number];
