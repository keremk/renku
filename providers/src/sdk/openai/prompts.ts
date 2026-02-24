import type { OpenAiLlmConfig } from './config.js';
import type { ProviderLogger } from '../../types.js';

export interface RenderedPrompts {
  system: string;
  user?: string;
}

/**
 * Renders prompts with variable substitution.
 * Variables are replaced using {{VariableName}} syntax.
 *
 * @example
 * Config:
 *   variables: ["InquiryPrompt", "Duration"]
 *   userPrompt: "Topic: {{InquiryPrompt}}\nDuration: {{Duration}}"
 *
 * Inputs:
 *   { InquiryPrompt: "French Revolution", Duration: "30 seconds" }
 *
 * Result:
 *   "Topic: French Revolution\nDuration: 30 seconds"
 */
export function renderPrompts(
  config: OpenAiLlmConfig,
  inputs: Record<string, unknown>,
  logger?: ProviderLogger
): RenderedPrompts {
  const system = substituteVariables(config.systemPrompt, inputs, logger);
  const user = config.userPrompt
    ? substituteVariables(config.userPrompt, inputs, logger)
    : undefined;

  return { system, user };
}

/**
 * Substitutes {{VariableName}} placeholders with values from inputs.
 * Uses simple direct lookup - variable names must match input keys exactly.
 */
function substituteVariables(
  template: string,
  inputs: Record<string, unknown>,
  logger?: ProviderLogger
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, varName: string) => {
    const value = inputs[varName];
    if (value === null || value === undefined) {
      logger?.warn?.('openai.prompts.missingInput', { variable: varName });
      return '';
    }
    return formatPromptVariable(value);
  });
}

function formatPromptVariable(value: unknown): string {
  if (Array.isArray(value)) {
    return formatPromptArray(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatPromptArray(values: unknown[]): string {
  if (values.length === 0) {
    return '';
  }
  return values
    .map((entry, index) => `${index + 1}. ${formatPromptArrayEntry(entry)}`)
    .join('\n\n');
}

function formatPromptArrayEntry(value: unknown): string {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.stringify(value);
  }
  return String(value ?? '');
}

/**
 * Builds the prompt string for AI SDK from rendered prompts.
 * Prefers user prompt if available, falls back to system prompt.
 */
export function buildPrompt(rendered: RenderedPrompts): string {
  return rendered.user?.trim() || rendered.system?.trim() || '';
}
