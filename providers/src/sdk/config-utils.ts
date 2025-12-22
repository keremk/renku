import { isCanonicalInputId } from '@gorenku/core';

export function canonicalizeAuthoredInputId(authoredId: string, availableInputs: string[]): string {
  const canonicalInputs = availableInputs.filter((value) => isCanonicalInputId(value));
  if (canonicalInputs.length === 0) {
    throw new Error('No canonical inputs available to map authored IDs.');
  }
  if (canonicalInputs.includes(authoredId)) {
    return authoredId;
  }
  const base = extractBaseName(authoredId);
  const matches = canonicalInputs.filter((candidate) => extractBaseName(candidate) === base);
  if (matches.length === 1) {
    return matches[0]!;
  }
  if (matches.length === 0) {
    throw new Error(`No canonical input ID found for "${authoredId}".`);
  }
  throw new Error(`Ambiguous canonical input ID for "${authoredId}". Candidates: ${matches.join(', ')}`);
}

function extractBaseName(value: string): string {
  const bracketIndex = value.indexOf('[');
  const trimmed = bracketIndex >= 0 ? value.slice(0, bracketIndex) : value;
  const cleaned = isCanonicalInputId(trimmed) ? trimmed.slice('Input:'.length) : trimmed;
  const separatorIndex = cleaned.lastIndexOf('.');
  return separatorIndex >= 0 ? cleaned.slice(separatorIndex + 1) : cleaned;
}
