/* eslint-env node */
import process from 'node:process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';

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

export function getDefaultCliConfigPath(): string {
  const envPath = process.env.RENKU_CLI_CONFIG;
  if (envPath) {
    return resolve(envPath);
  }
  return resolve(os.homedir(), '.config', 'renku', 'cli-config.json');
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
