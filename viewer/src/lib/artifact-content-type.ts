/**
 * Content-based type inference for artifact display.
 * Determines how an artifact value should be rendered based on its content.
 */

/** Display types for artifact content */
export type ArtifactDisplayType = 'boolean' | 'compact' | 'text';

/** Threshold for compact display (characters) */
const COMPACT_CHAR_LIMIT = 100;

/** Max words for compact display — longer phrases are substantive text */
const COMPACT_WORD_LIMIT = 5;

/**
 * Infer the display type from artifact content.
 *
 * Rules:
 * - Trimmed content exactly "true" or "false" → 'boolean'
 * - Content < 100 chars AND no newlines AND ≤ 5 words → 'compact'
 * - Everything else → 'text'
 */
export function inferDisplayType(content: string): ArtifactDisplayType {
  const trimmed = content.trim();

  if (trimmed === 'true' || trimmed === 'false') {
    return 'boolean';
  }

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (
    trimmed.length < COMPACT_CHAR_LIMIT &&
    !trimmed.includes('\n') &&
    wordCount <= COMPACT_WORD_LIMIT
  ) {
    return 'compact';
  }

  return 'text';
}

/**
 * Parse boolean content string to a boolean value.
 * Assumes content has already been identified as boolean by inferDisplayType.
 */
export function parseBooleanContent(content: string): boolean {
  return content.trim() === 'true';
}
