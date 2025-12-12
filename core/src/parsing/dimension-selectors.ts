export type DimensionSelector =
  | { kind: 'loop'; symbol: string; offset: number }
  | { kind: 'const'; value: number };

export function parseDimensionSelector(raw: string): DimensionSelector {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('Empty dimension selector.');
  }
  if (/^[0-9]+$/.test(trimmed)) {
    return { kind: 'const', value: parseInt(trimmed, 10) };
  }
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)([+-][0-9]+)?$/);
  if (!match) {
    throw new Error(
      `Invalid dimension selector "${raw}". Expected "<loop>", "<loop>+<int>", "<loop>-<int>", or "<int>".`,
    );
  }
  const symbol = match[1]!;
  const offset = match[2] ? parseInt(match[2], 10) : 0;
  return { kind: 'loop', symbol, offset };
}

