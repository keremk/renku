/* eslint-env node */
import process from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';

export interface CliConfig {
  storage: {
    root: string;
    basePath: string;
  };
  concurrency?: number;
  lastMovieId?: string;
  lastGeneratedAt?: string;
  viewer?: {
    port?: number;
    host?: string;
  };
}

const DEFAULT_ROOT = resolve(os.homedir(), '.renku');
export function getDefaultCliConfigPath(): string {
  const envPath = process.env.RENKU_CLI_CONFIG;
  if (envPath) {
    return resolve(envPath);
  }
  return resolve(DEFAULT_ROOT, 'cli-config.json');
}

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
      concurrency: normalizeConcurrency(parsed.concurrency),
      lastMovieId: parsed.lastMovieId,
      lastGeneratedAt: parsed.lastGeneratedAt,
      viewer: parsed.viewer,
    };
  } catch {
    return null;
  }
}

export async function writeCliConfig(config: CliConfig, configPath?: string): Promise<string> {
  const targetPath = resolve(configPath ?? getDefaultCliConfigPath());
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(
    targetPath,
    JSON.stringify(
      {
        ...config,
        concurrency: normalizeConcurrency(config.concurrency),
      },
      null,
      2,
    ),
    'utf8',
  );
  return targetPath;
}

export function getDefaultRoot(): string {
  return DEFAULT_ROOT;
}

export const DEFAULT_CONCURRENCY = 1;

export async function persistLastMovieId(movieId: string, configPath?: string): Promise<CliConfig> {
  const targetPath = resolve(configPath ?? getDefaultCliConfigPath());
  const existing = await readCliConfig(targetPath);
  if (!existing) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  const updated: CliConfig = {
    ...existing,
    lastMovieId: movieId,
    lastGeneratedAt: new Date().toISOString(),
  };
  await writeCliConfig(updated, targetPath);
  return updated;
}

export function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CONCURRENCY;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Concurrency must be a positive integer.');
  }
  return value;
}
