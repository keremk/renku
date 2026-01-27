/**
 * Path resolution helpers for blueprint and inputs.
 * Resolves blueprint names to full paths based on CLI config.
 */

import { access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRuntimeError, RuntimeErrorCode } from '@gorenku/core';
import type { CliConfig } from './config.js';

/**
 * Default inputs filename options (tried in order).
 */
const DEFAULT_INPUTS_FILENAMES = ['inputs.yaml', 'input-template.yaml', 'input.yaml'];

/**
 * Blueprint file extension.
 */
const BLUEPRINT_EXTENSION = '.yaml';

/**
 * Builds subdirectory within blueprint folder.
 */
const BUILDS_DIR = 'builds';

/**
 * Resolved blueprint paths.
 */
export interface ResolvedPaths {
  /** Full path to blueprint.yaml */
  blueprintPath: string;
  /** Full path to inputs file */
  inputsPath: string;
  /** Blueprint folder (contains blueprint.yaml and builds/) */
  blueprintFolder: string;
  /** Builds folder for this blueprint */
  buildsFolder: string;
}

/**
 * Resolves blueprint name and inputs to full paths.
 *
 * Blueprint naming convention:
 * - Blueprint: `storage.root/<name>/blueprint.yaml`
 * - Inputs: `storage.root/<name>/<inputs>` (default: inputs.yaml)
 * - Builds: `storage.root/<name>/builds/`
 *
 * @param blueprintName - Blueprint name (e.g., "my-blueprint")
 * @param inputsFilename - Optional inputs filename (default: "inputs.yaml")
 * @param config - CLI configuration
 * @returns Resolved paths
 */
export async function resolveBlueprintPaths(
  blueprintName: string,
  inputsFilename: string | undefined,
  config: CliConfig
): Promise<ResolvedPaths> {
  const storageRoot = config.storage.root;
  const blueprintFolder = resolve(storageRoot, blueprintName);
  // Blueprint file is <name>/<name>.yaml
  const blueprintPath = join(blueprintFolder, `${blueprintName}${BLUEPRINT_EXTENSION}`);
  const buildsFolder = join(blueprintFolder, BUILDS_DIR);

  // Validate blueprint path exists
  try {
    await access(blueprintPath);
  } catch {
    throw createRuntimeError(
      RuntimeErrorCode.CATALOG_BLUEPRINT_NOT_FOUND,
      `Blueprint not found: ${blueprintName}`,
      {
        suggestion: `Expected blueprint at: ${blueprintPath}. Check that the blueprint folder exists in ${storageRoot}`,
      }
    );
  }

  // Find inputs file - try explicit filename first, then defaults
  let inputsPath: string | null = null;
  if (inputsFilename) {
    const explicitPath = join(blueprintFolder, inputsFilename);
    try {
      await access(explicitPath);
      inputsPath = explicitPath;
    } catch {
      throw createRuntimeError(
        RuntimeErrorCode.MISSING_REQUIRED_INPUT,
        `Inputs file not found: ${inputsFilename}`,
        {
          suggestion: `Expected inputs at: ${explicitPath}`,
        }
      );
    }
  } else {
    // Try default filenames in order
    for (const defaultName of DEFAULT_INPUTS_FILENAMES) {
      const candidatePath = join(blueprintFolder, defaultName);
      try {
        await access(candidatePath);
        inputsPath = candidatePath;
        break;
      } catch {
        // Continue to next candidate
      }
    }
    if (!inputsPath) {
      throw createRuntimeError(
        RuntimeErrorCode.MISSING_REQUIRED_INPUT,
        `Inputs file not found. Tried: ${DEFAULT_INPUTS_FILENAMES.join(', ')}`,
        {
          suggestion: `Create an inputs file in ${blueprintFolder}`,
        }
      );
    }
  }

  return {
    blueprintPath,
    inputsPath,
    blueprintFolder,
    buildsFolder,
  };
}

/**
 * Resolves movie directory path.
 *
 * @param movieId - Movie ID (e.g., "movie-abc123")
 * @param config - CLI configuration
 * @returns Full path to movie directory
 */
export function resolveMovieDir(movieId: string, config: CliConfig): string {
  return resolve(config.storage.root, config.storage.basePath, movieId);
}

/**
 * Resolves movie directory path within a blueprint's builds folder.
 *
 * @param blueprintFolder - Blueprint folder path
 * @param movieId - Movie ID (e.g., "movie-abc123")
 * @returns Full path to movie directory within blueprint's builds/
 */
export function resolveBlueprintMovieDir(blueprintFolder: string, movieId: string): string {
  return join(blueprintFolder, BUILDS_DIR, movieId);
}

/**
 * Generates a unique movie ID with optional prefix.
 *
 * @param prefix - Optional prefix (default: "movie")
 * @returns Unique movie ID (e.g., "movie-abc123")
 */
export function generateMovieId(prefix: string = 'movie'): string {
  // Generate a short random suffix (6 characters)
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${suffix}`;
}

/**
 * Validates and normalizes a movie ID.
 * Ensures it starts with "movie-" prefix.
 *
 * @param movieId - Movie ID (with or without prefix)
 * @returns Normalized movie ID with prefix
 */
export function normalizeMovieId(movieId: string): string {
  if (movieId.startsWith('movie-')) {
    return movieId;
  }
  return `movie-${movieId}`;
}

/**
 * Resolves build-specific inputs path if it exists.
 * Returns null if the build doesn't have a custom inputs.yaml.
 *
 * @param blueprintFolder - Blueprint folder path
 * @param movieId - Movie ID (e.g., "movie-abc123")
 * @returns Full path to build inputs.yaml if exists, null otherwise
 */
export async function resolveBuildInputsPath(
  blueprintFolder: string,
  movieId: string
): Promise<string | null> {
  const buildInputsPath = join(blueprintFolder, 'builds', movieId, 'inputs.yaml');
  try {
    await access(buildInputsPath);
    return buildInputsPath;
  } catch {
    return null;
  }
}
