/**
 * CLI config loading for the viewer.
 * Reads the same config file as the CLI (~/.config/renku/cli-config.json).
 */

import { resolve } from 'node:path';
import {
  DEFAULT_CLI_CONCURRENCY,
  normalizeCliConcurrency,
  readCliConfig,
  type CliConfig,
  createRuntimeError,
  RuntimeErrorCode,
} from '@gorenku/core';

// Re-export for backward compatibility with other viewer server modules
export type { CliConfig };
export { readCliConfig };

/**
 * Default concurrency for job execution.
 */
export const DEFAULT_CONCURRENCY = DEFAULT_CLI_CONCURRENCY;

/**
 * Reads the CLI config, throwing an error if not found or invalid.
 * Use this when the config is required (e.g., for generation).
 */
export async function requireCliConfig(
  configPath?: string
): Promise<CliConfig> {
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
  return normalizeCliConcurrency(value);
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
