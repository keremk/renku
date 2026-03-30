export function getPathValue(
  values: Record<string, unknown>,
  path: string
): unknown {
  const parts = path.split('.');
  let current: unknown = values;

  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

export function hasPath(
  values: Record<string, unknown>,
  path: string
): boolean {
  const parts = path.split('.');
  let current: unknown = values;

  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return false;
    }
    if (!(part in (current as Record<string, unknown>))) {
      return false;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return true;
}

export function getLeafKey(path: string): string {
  const segments = path.split('.');
  return segments[segments.length - 1] ?? path;
}
