import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';

type PathToken = string | number;

interface ResolveResult<T = unknown> {
  value?: T;
  exists: boolean;
}

export function readJsonPath<T = unknown>(source: unknown, path: string): ResolveResult<T> {
  if (!path) {
    return { exists: false };
  }
  const tokens = tokenize(path);
  let current: unknown = source;
  for (const token of tokens) {
    if (current === null || current === undefined) {
      return { exists: false };
    }
    if (typeof token === 'number') {
      if (!Array.isArray(current) || token < 0 || token >= current.length) {
        return { exists: false };
      }
      current = current[token];
      continue;
    }
    if (typeof current !== 'object') {
      return { exists: false };
    }
    if (!(token in (current as Record<string, unknown>))) {
      return { exists: false };
    }
    current = (current as Record<string, unknown>)[token];
  }
  return { exists: true, value: current as T };
}

function tokenize(path: string): PathToken[] {
  const tokens: PathToken[] = [];
  let buffer = '';
  let indexBuffer = '';
  let inBracket = false;

  for (let i = 0; i < path.length; i += 1) {
    const char = path[i]!;
    if (inBracket) {
      if (char === ']') {
        if (indexBuffer.trim().length === 0) {
          throw createRuntimeError(
            RuntimeErrorCode.INVALID_JSON_PATH,
            `Invalid JSON path "${path}" – empty index`,
          );
        }
        const index = Number.parseInt(indexBuffer, 10);
        if (Number.isNaN(index)) {
          throw createRuntimeError(
            RuntimeErrorCode.INVALID_JSON_PATH,
            `Invalid JSON path "${path}" – non-numeric index "${indexBuffer}"`,
          );
        }
        tokens.push(index);
        indexBuffer = '';
        inBracket = false;
      } else {
        indexBuffer += char;
      }
      continue;
    }
    if (char === '.') {
      if (buffer.length > 0) {
        tokens.push(buffer);
        buffer = '';
      }
      continue;
    }
    if (char === '[') {
      if (buffer.length > 0) {
        tokens.push(buffer);
        buffer = '';
      }
      inBracket = true;
      continue;
    }
    buffer += char;
  }

  if (inBracket) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_JSON_PATH,
      `Invalid JSON path "${path}" – missing closing bracket`,
    );
  }
  if (buffer.length > 0) {
    tokens.push(buffer);
  }

  return tokens;
}
