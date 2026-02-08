/**
 * Prompt file operations for reading and writing TOML prompt files.
 * Used by both the core planning system and the viewer for editing prompts.
 */

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { BlueprintMeta } from '../types.js';
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
 * Formats a string value for TOML output.
 * Uses multi-line basic strings (triple quotes) if the string contains newlines.
 * Otherwise uses a regular basic string.
 */
function formatTomlString(value: string): string {
  if (value.includes('\n')) {
    // Multi-line basic string with triple quotes
    // We need to escape any backslashes and triple quotes inside the string
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"""/g, '\\"\\"\\"');
    // Per TOML spec: newline immediately after opening """ is trimmed
    // So we add one, then put content, then closing """ on same line as content end
    // This ensures the content is preserved exactly
    return `"""\n${escaped}"""`;
  }
  // Regular basic string - escape special characters
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

/**
 * Formats an array of strings for TOML output.
 */
function formatTomlArray(arr: string[]): string {
  const items = arr.map(s => `"${s.replace(/"/g, '\\"')}"`);
  return `[ ${items.join(', ')} ]`;
}

/**
 * Save prompt data to a TOML file.
 * Creates parent directories if they don't exist.
 * Uses multi-line strings for prompts containing newlines.
 *
 * @param promptPath - Absolute path to the TOML prompt file
 * @param data - Prompt data to save
 */
export async function savePromptFile(promptPath: string, data: PromptFileData): Promise<void> {
  // Ensure parent directory exists
  const dir = dirname(promptPath);
  await mkdir(dir, { recursive: true });

  // Build TOML content manually to preserve multi-line strings
  const lines: string[] = [];

  if (data.model) {
    lines.push(`model = ${formatTomlString(data.model)}`);
  }
  if (data.textFormat) {
    lines.push(`textFormat = ${formatTomlString(data.textFormat)}`);
  }
  if (data.variables && data.variables.length > 0) {
    lines.push(`variables = ${formatTomlArray(data.variables)}`);
  }

  // Add blank line before prompts for readability
  if (lines.length > 0 && (data.systemPrompt || data.userPrompt)) {
    lines.push('');
  }

  if (data.systemPrompt) {
    lines.push(`systemPrompt = ${formatTomlString(data.systemPrompt)}`);
  }

  // Add blank line between prompts for readability
  if (data.systemPrompt && data.userPrompt) {
    lines.push('');
  }

  if (data.userPrompt) {
    lines.push(`userPrompt = ${formatTomlString(data.userPrompt)}`);
  }

  // Use smol-toml's stringify for complex nested structures
  if (data.config && Object.keys(data.config).length > 0) {
    lines.push('');
    lines.push(stringifyToml({ config: data.config }));
  }
  if (data.outputs && Object.keys(data.outputs).length > 0) {
    lines.push('');
    lines.push(stringifyToml({ outputs: data.outputs }));
  }

  const content = lines.join('\n') + '\n';
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

// ---------------------------------------------------------------------------
// Build-folder prompt path resolution
// ---------------------------------------------------------------------------

/**
 * Get the prompts directory inside a movie's builds folder.
 *
 * @param buildsDir - Absolute path to the movie-specific builds directory
 *                    (e.g., `.../builds/movie-123/`)
 */
export function getBuildPromptsDir(buildsDir: string): string {
  return resolve(buildsDir, 'prompts');
}

/**
 * Get the build prompt file path for a specific producer.
 *
 * @param buildsDir - Absolute path to the movie-specific builds directory
 * @param producerId - The producer alias (e.g., "ScriptProducer")
 */
export function getBuildPromptPath(buildsDir: string, producerId: string): string {
  return resolve(getBuildPromptsDir(buildsDir), `${producerId}.toml`);
}

/**
 * Resolve the prompt file path for a producer.
 * Checks builds folder first (user edits), falls back to blueprint template.
 *
 * Resolution order:
 * 1. {buildsDir}/prompts/{producerId}.toml — if exists (user edited)
 * 2. {producerDir}/{meta.promptFile} — blueprint template (always exists)
 * 3. undefined — producer has no promptFile in meta
 *
 * @param producerMeta - The blueprint meta containing promptFile reference
 * @param producerSourcePath - Absolute path to the producer YAML file
 * @param buildsDir - Optional absolute path to the movie builds directory
 * @param producerId - Optional producer alias for builds folder lookup
 */
export function resolvePromptPath(
  producerMeta: BlueprintMeta,
  producerSourcePath: string,
  buildsDir?: string,
  producerId?: string,
): string | undefined {
  // Check builds folder first
  if (buildsDir && producerId) {
    const buildPath = getBuildPromptPath(buildsDir, producerId);
    if (promptFileExists(buildPath)) {
      return buildPath;
    }
  }
  // Fall back to blueprint template
  if (producerMeta.promptFile) {
    return resolve(dirname(producerSourcePath), producerMeta.promptFile);
  }
  return undefined;
}

/**
 * Save prompt data to the builds folder for a specific producer.
 *
 * @param buildsDir - Absolute path to the movie-specific builds directory
 * @param producerId - The producer alias
 * @param prompts - The prompt data to save
 */
export async function saveProducerPrompts(
  buildsDir: string,
  producerId: string,
  prompts: PromptFileData,
): Promise<void> {
  const promptPath = getBuildPromptPath(buildsDir, producerId);
  await savePromptFile(promptPath, prompts);
}

/**
 * Restore prompts to the template version by deleting the build copy.
 *
 * @param buildsDir - Absolute path to the movie-specific builds directory
 * @param producerId - The producer alias
 */
export async function restoreProducerPrompts(
  buildsDir: string,
  producerId: string,
): Promise<void> {
  const buildPath = getBuildPromptPath(buildsDir, producerId);
  await deletePromptFile(buildPath);
}
