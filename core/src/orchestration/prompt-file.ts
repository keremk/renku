/**
 * Prompt file operations for reading and writing TOML prompt files.
 * Used by both the core planning system and the viewer for editing prompts.
 */

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

/**
 * Prompt data structure from TOML file.
 */
export interface PromptFileData {
  /** Variables used in the prompts (e.g., ["Audience", "Duration"]) */
  variables?: string[];
  /** System prompt template */
  systemPrompt?: string;
  /** User prompt template */
  userPrompt?: string;
  /** Additional config from TOML */
  config?: Record<string, unknown>;
  /** Output definitions */
  outputs?: Record<string, unknown>;
  /** Model hint (optional) */
  model?: string;
  /** Text format hint (optional) */
  textFormat?: string;
}

/**
 * Load prompt data from a TOML file.
 *
 * @param promptPath - Absolute path to the TOML prompt file
 * @returns Parsed prompt data
 * @throws Error if file cannot be read or parsed
 */
export async function loadPromptFile(promptPath: string): Promise<PromptFileData> {
  const contents = await readFile(promptPath, 'utf8');
  const parsed = parseToml(contents) as Record<string, unknown>;

  const prompt: PromptFileData = {};

  if (typeof parsed.model === 'string') {
    prompt.model = parsed.model;
  }
  if (typeof parsed.textFormat === 'string') {
    prompt.textFormat = parsed.textFormat;
  }
  if (Array.isArray(parsed.variables)) {
    prompt.variables = parsed.variables.map(String);
  }
  if (typeof parsed.systemPrompt === 'string') {
    prompt.systemPrompt = parsed.systemPrompt;
  }
  if (typeof parsed.userPrompt === 'string') {
    prompt.userPrompt = parsed.userPrompt;
  }
  if (parsed.config && typeof parsed.config === 'object') {
    prompt.config = parsed.config as Record<string, unknown>;
  }
  if (parsed.outputs && typeof parsed.outputs === 'object') {
    prompt.outputs = parsed.outputs as Record<string, unknown>;
  }

  return prompt;
}

/**
 * Save prompt data to a TOML file.
 * Creates parent directories if they don't exist.
 *
 * @param promptPath - Absolute path to the TOML prompt file
 * @param data - Prompt data to save
 */
export async function savePromptFile(promptPath: string, data: PromptFileData): Promise<void> {
  const obj: Record<string, unknown> = {};

  if (data.model) {
    obj.model = data.model;
  }
  if (data.textFormat) {
    obj.textFormat = data.textFormat;
  }
  if (data.variables && data.variables.length > 0) {
    obj.variables = data.variables;
  }
  if (data.systemPrompt) {
    obj.systemPrompt = data.systemPrompt;
  }
  if (data.userPrompt) {
    obj.userPrompt = data.userPrompt;
  }
  if (data.config && Object.keys(data.config).length > 0) {
    obj.config = data.config;
  }
  if (data.outputs && Object.keys(data.outputs).length > 0) {
    obj.outputs = data.outputs;
  }

  // Ensure parent directory exists
  const dir = dirname(promptPath);
  await mkdir(dir, { recursive: true });

  const content = stringifyToml(obj);
  await writeFile(promptPath, content, 'utf8');
}

/**
 * Check if a prompt file exists.
 *
 * @param promptPath - Absolute path to the TOML prompt file
 * @returns true if the file exists
 */
export function promptFileExists(promptPath: string): boolean {
  return existsSync(promptPath);
}

/**
 * Delete a prompt file if it exists.
 *
 * @param promptPath - Absolute path to the TOML prompt file
 */
export async function deletePromptFile(promptPath: string): Promise<void> {
  if (existsSync(promptPath)) {
    await unlink(promptPath);
  }
}
