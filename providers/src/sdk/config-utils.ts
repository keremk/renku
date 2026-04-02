import { isCanonicalInputId } from '@gorenku/core';

export function canonicalizeAuthoredInputId(
  authoredId: string,
  availableInputs: string[],
  producerAlias: string
): string {
  const trimmed = authoredId.trim();
  if (trimmed.length === 0) {
    throw new Error('Timeline clip input reference must be a non-empty string.');
  }
  const canonicalInputs = availableInputs.filter((value) => isCanonicalInputId(value));
  if (canonicalInputs.length === 0) {
    throw new Error('No canonical inputs available to map authored IDs.');
  }

  const canonicalId = isCanonicalInputId(trimmed)
    ? trimmed
    : `Input:${producerAlias}.${trimmed}`;

  if (canonicalInputs.includes(canonicalId)) {
    return canonicalId;
  }

  throw new Error(
    `Unknown canonical input ID "${canonicalId}" derived from "${authoredId}". Expected an exact canonical input binding for producer "${producerAlias}".`
  );
}
