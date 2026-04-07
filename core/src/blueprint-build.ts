import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';
import { createMovieMetadataService } from './movie-metadata.js';
import { createStorageContext, initializeMovieStorage } from './storage.js';

const INPUT_TEMPLATE_FILENAME = 'input-template.yaml';
const INPUTS_FILENAME = 'inputs.yaml';
const BUILDS_BASE_PATH = 'builds';
const MOVIE_ID_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const MOVIE_ID_LENGTH = 6;
const MAX_MOVIE_ID_ATTEMPTS = 25;

export interface CreateBlueprintBuildOptions {
  blueprintFolder: string;
  blueprintPath?: string;
  displayName?: string;
}

export interface CreateBlueprintBuildResult {
  movieId: string;
  buildDir: string;
  inputsPath: string;
}

export function generateBlueprintBuildMovieId(): string {
  let suffix = '';
  for (let index = 0; index < MOVIE_ID_LENGTH; index += 1) {
    const charIndex = Math.floor(Math.random() * MOVIE_ID_CHARSET.length);
    suffix += MOVIE_ID_CHARSET.charAt(charIndex);
  }
  return `movie-${suffix}`;
}

export async function createBlueprintBuild(
  options: CreateBlueprintBuildOptions
): Promise<CreateBlueprintBuildResult> {
  const blueprintFolder = options.blueprintFolder.trim();
  if (blueprintFolder.length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      'Blueprint folder is required to create a build.'
    );
  }

  const templatePath = path.join(blueprintFolder, INPUT_TEMPLATE_FILENAME);
  const templateContent = await readTemplateOrThrow(templatePath);

  const storage = createStorageContext({
    kind: 'local',
    rootDir: blueprintFolder,
    basePath: BUILDS_BASE_PATH,
  });

  const movieId = await allocateMovieId(storage);
  await initializeMovieStorage(storage, movieId);

  const buildDir = path.join(blueprintFolder, BUILDS_BASE_PATH, movieId);
  const inputsPath = path.join(buildDir, INPUTS_FILENAME);
  await writeFile(inputsPath, templateContent, 'utf8');

  const metadataService = createMovieMetadataService(storage);
  const displayName = normalizeOptionalString(options.displayName);
  const blueprintPath = normalizeOptionalString(options.blueprintPath);
  await metadataService.write(movieId, {
    createdAt: new Date().toISOString(),
    displayName,
    blueprintPath,
  });

  return { movieId, buildDir, inputsPath };
}

async function readTemplateOrThrow(templatePath: string): Promise<string> {
  try {
    return await readFile(templatePath, 'utf8');
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      throw createRuntimeError(
        RuntimeErrorCode.MISSING_REQUIRED_INPUT,
        `Missing required template file at "${templatePath}".`,
        {
          suggestion:
            'Create input-template.yaml in the blueprint folder before creating a new build.',
        }
      );
    }
    throw error;
  }
}

async function allocateMovieId(
  storage: ReturnType<typeof createStorageContext>
): Promise<string> {
  for (let attempt = 0; attempt < MAX_MOVIE_ID_ATTEMPTS; attempt += 1) {
    const movieId = generateBlueprintBuildMovieId();
    if (!(await storage.storage.directoryExists(storage.resolve(movieId)))) {
      return movieId;
    }
  }

  throw createRuntimeError(
    RuntimeErrorCode.INVALID_MOVIE_ID,
    'Failed to allocate a unique movie ID for the new build.'
  );
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
