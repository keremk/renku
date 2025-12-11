import { readFile } from 'node:fs/promises';
import { resolve, extname, isAbsolute } from 'node:path';
import { inferMimeType } from '../blob-utils.js';
import type { BlobInput } from '../types.js';

const FILE_PREFIX = 'file:';

export function isFileReference(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(FILE_PREFIX);
}

export interface FileResolverContext {
  baseDir: string;
}

/** Load a local file as BlobInput */
export async function resolveFileReference(
  reference: string,
  context: FileResolverContext,
): Promise<BlobInput> {
  const filePath = reference.slice(FILE_PREFIX.length);
  const absolutePath = isAbsolute(filePath)
    ? filePath
    : resolve(context.baseDir, filePath);

  try {
    const data = await readFile(absolutePath);
    const mimeType = inferMimeType(extname(absolutePath));
    return { data, mimeType };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load file "${filePath}": ${msg}`);
  }
}

/** Recursively resolve file references in a value */
export async function resolveFileReferences(
  value: unknown,
  context: FileResolverContext,
): Promise<unknown> {
  if (isFileReference(value)) {
    return resolveFileReference(value, context);
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveFileReferences(item, context)));
  }
  return value;
}
