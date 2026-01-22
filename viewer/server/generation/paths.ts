/**
 * Path resolution helpers for blueprint and inputs.
 * Resolves blueprint names to full paths based on CLI config.
 */

import { access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRuntimeError, RuntimeErrorCode } from '@gorenku/core';
import type { CliConfig } from './config.js';

/**
 * Default inputs filename.
 */
const DEFAULT_INPUTS_FILENAME = 'inputs.yaml';

/**
 * Default blueprint filename within blueprint directory.
 */
const DEFAULT_BLUEPRINT_FILENAME = 'blueprint.yaml';

/**
 * Blueprints subdirectory within storage root.
 */
const BLUEPRINTS_DIR = 'blueprints';

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
 * - Blueprint: `storage.root/blueprints/<name>/blueprint.yaml`
 * - Inputs: `storage.root/blueprints/<name>/<inputs>` (default: inputs.yaml)
 * - Builds: `storage.root/blueprints/<name>/builds/`
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
  const blueprintFolder = resolve(storageRoot, BLUEPRINTS_DIR, blueprintName);
  const blueprintPath = join(blueprintFolder, DEFAULT_BLUEPRINT_FILENAME);
  const inputsPath = join(blueprintFolder, inputsFilename ?? DEFAULT_INPUTS_FILENAME);
  const buildsFolder = join(blueprintFolder, BUILDS_DIR);

  // Validate blueprint path exists
  try {
    await access(blueprintPath);
  } catch {
    throw createRuntimeError(
      RuntimeErrorCode.CATALOG_BLUEPRINT_NOT_FOUND,
      `Blueprint not found: ${blueprintName}`,
      {
        suggestion: `Expected blueprint at: ${blueprintPath}. Check that the blueprint exists in ${resolve(storageRoot, BLUEPRINTS_DIR)}`,
      }
    );
  }

  // Validate inputs path exists
  try {
    await access(inputsPath);
  } catch {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      `Inputs file not found: ${inputsFilename ?? DEFAULT_INPUTS_FILENAME}`,
      {
        suggestion: `Expected inputs at: ${inputsPath}`,
      }
    );
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
