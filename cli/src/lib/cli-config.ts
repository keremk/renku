/* eslint-env node */
import process from 'node:process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import os from 'node:os';
import {
  getDefaultCliConfigPath as coreGetDefaultCliConfigPath,
  readCliConfig as coreReadCliConfig,
  writeCliConfig as coreWriteCliConfig,
  type CliConfig,
} from '@gorenku/core';

// Re-export shared types and functions from core
export type { CliConfig };
export { coreGetDefaultCliConfigPath as getDefaultCliConfigPath };
export { coreReadCliConfig as readCliConfig };
export { coreWriteCliConfig as writeCliConfig };

export const DEFAULT_CONCURRENCY = 1;

export function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CONCURRENCY;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Concurrency must be a positive integer.');
  }
  return value;
}

/**
 * Creates a project-local storage configuration using the current working directory.
 * Both builds/ and artifacts/ folders will be created in cwd.
 */
export function getProjectLocalStorage(): { root: string; basePath: string } {
  return {
    root: process.cwd(),
    basePath: 'builds',
  };
}

export async function persistLastMovieId(movieId: string, configPath?: string): Promise<CliConfig> {
  const targetPath = resolve(configPath ?? coreGetDefaultCliConfigPath());
  const existing = await coreReadCliConfig(targetPath);
  if (!existing) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  const updated: CliConfig = {
    ...existing,
    lastMovieId: movieId,
    lastGeneratedAt: new Date().toISOString(),
  };
  await coreWriteCliConfig(updated, targetPath);
  return updated;
}

export function getDefaultEnvFilePath(): string {
  return resolve(os.homedir(), '.config', 'renku', 'env.sh');
}

const ENV_TEMPLATE = `# Renku API Keys Configuration
# Replace the placeholder values with your actual API keys
# Then source this file: source ~/.config/renku/env.sh

export REPLICATE_API_TOKEN="your-replicate-api-token-here"
export FAL_KEY="your-fal-api-key-here"
export WAVESPEED_API_KEY="your-wavespeed-api-key-here"
export OPENAI_API_KEY="your-openai-api-key-here"
`;

export interface WriteEnvTemplateResult {
  path: string;
  created: boolean;
}

export async function writeEnvTemplate(envPath?: string): Promise<WriteEnvTemplateResult> {
  const targetPath = resolve(envPath ?? getDefaultEnvFilePath());

  // Check if file already exists to avoid overwriting user's real keys
  try {
    await access(targetPath);
    return { path: targetPath, created: false };
  } catch {
    // File doesn't exist, create it
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, ENV_TEMPLATE, 'utf8');
  return { path: targetPath, created: true };
}
