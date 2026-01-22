/**
 * CLI config loading for the viewer.
 * Reads the same config file as the CLI (~/.config/renku/cli-config.json).
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { createRuntimeError, RuntimeErrorCode } from '@gorenku/core';

/**
 * CLI configuration structure.
 * Matches the structure from cli/src/lib/cli-config.ts.
 */
export interface CliConfig {
  storage: {
    root: string;
    basePath: string;
  };
  catalog?: {
    root: string;
  };
  concurrency?: number;
  lastMovieId?: string;
  lastGeneratedAt?: string;
  viewer?: {
    port?: number;
    host?: string;
  };
}

/**
 * Default concurrency for job execution.
 */
export const DEFAULT_CONCURRENCY = 1;

/**
 * Gets the default CLI config path.
 * Uses RENKU_CLI_CONFIG environment variable if set, otherwise ~/.config/renku/cli-config.json.
 */
export function getDefaultCliConfigPath(): string {
  const envPath = process.env.RENKU_CLI_CONFIG;
  if (envPath) {
    return resolve(envPath);
  }
  return resolve(os.homedir(), '.config', 'renku', 'cli-config.json');
}

/**
 * Reads the CLI config from the default or specified path.
 * Returns null if the config file doesn't exist or is invalid.
 */
export async function readCliConfig(configPath?: string): Promise<CliConfig | null> {
  const targetPath = resolve(configPath ?? getDefaultCliConfigPath());
  try {
    const contents = await readFile(targetPath, 'utf8');
    const parsed = JSON.parse(contents) as Partial<CliConfig>;
    if (!parsed.storage) {
      return null;
    }
    return {
      storage: parsed.storage,
      catalog: parsed.catalog,
      concurrency: normalizeConcurrency(parsed.concurrency),
      lastMovieId: parsed.lastMovieId,
      lastGeneratedAt: parsed.lastGeneratedAt,
      viewer: parsed.viewer,
    };
  } catch {
    return null;
  }
}

/**
 * Reads the CLI config, throwing an error if not found or invalid.
 * Use this when the config is required (e.g., for generation).
 */
export async function requireCliConfig(configPath?: string): Promise<CliConfig> {
  const config = await readCliConfig(configPath);
  if (!config) {
    throw createRuntimeError(
      RuntimeErrorCode.VIEWER_CONFIG_MISSING,
      'Renku CLI is not initialized. Run "renku init" first.',
      {
        suggestion: 'Initialize Renku CLI with: renku init',
      }
    );
  }
  return config;
}

/**
 * Normalizes concurrency value to a positive integer.
 */
export function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CONCURRENCY;
  }
  if (!Number.isInteger(value) || value <= 0) {
    return DEFAULT_CONCURRENCY;
  }
  return value;
}

/**
 * Gets the catalog models directory path from CLI config.
 * Returns null if catalog is not configured.
 */
export function getCatalogModelsDir(config: CliConfig): string | null {
  if (config.catalog?.root) {
    return resolve(config.catalog.root, 'models');
  }
  return null;
}
