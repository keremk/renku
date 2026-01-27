import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface MovieMetadata {
  blueprintPath?: string;
  lastInputsPath?: string;
  displayName?: string;       // User-friendly name for the build
  createdAt?: string;         // ISO timestamp when the build was created
}

const METADATA_FILE = 'movie-metadata.json';

export async function readMovieMetadata(movieDir: string): Promise<MovieMetadata | null> {
  const targetPath = resolve(movieDir, METADATA_FILE);
  try {
    const contents = await readFile(targetPath, 'utf8');
    return JSON.parse(contents) as MovieMetadata;
  } catch {
    return null;
  }
}

export async function writeMovieMetadata(movieDir: string, metadata: MovieMetadata): Promise<void> {
  const targetPath = resolve(movieDir, METADATA_FILE);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(metadata, null, 2), 'utf8');
}

export async function mergeMovieMetadata(
  movieDir: string,
  updates: Partial<MovieMetadata>,
): Promise<MovieMetadata> {
  const current = (await readMovieMetadata(movieDir)) ?? {};
  const next: MovieMetadata = {
    ...current,
    ...updates,
  };
  await writeMovieMetadata(movieDir, next);
  return next;
}
