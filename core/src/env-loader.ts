import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

export interface EnvLoaderOptions {
  verbose?: boolean;
}

export interface EnvLoaderResult {
  loaded: string[];
}

function findMonorepoRoot(startDir: string): string | null {
  let current = startDir;
  const root = resolve('/');
  while (current !== root) {
    if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    current = dirname(current);
  }
  return null;
}

/**
 * Load environment variables from .env files.
 *
 * Searches for .env files in the following order (first file found takes priority):
 * 1. Monorepo root (detected by pnpm-workspace.yaml)
 * 2. Current working directory (as fallback)
 *
 * @param callerUrl - The import.meta.url of the calling module
 * @param options - Optional configuration
 * @returns Object containing list of loaded .env file paths
 */
export function loadEnv(callerUrl: string, options: EnvLoaderOptions = {}): EnvLoaderResult {
  const callerDir = dirname(fileURLToPath(callerUrl));
  const monorepoRoot = findMonorepoRoot(callerDir);
  const loaded: string[] = [];

  // 1. Load from monorepo root (highest priority)
  if (monorepoRoot) {
    const rootEnvPath = resolve(monorepoRoot, '.env');
    if (existsSync(rootEnvPath)) {
      const result = dotenvConfig({ path: rootEnvPath });
      if (result.parsed) {
        loaded.push(rootEnvPath);
        if (options.verbose) {
          console.log(`[env] Loaded: ${rootEnvPath}`);
        }
      }
    }
  }

  // 2. Load from cwd as fallback (won't override existing values)
  const cwdEnvPath = resolve(process.cwd(), '.env');
  if (!loaded.includes(cwdEnvPath) && existsSync(cwdEnvPath)) {
    const result = dotenvConfig({ path: cwdEnvPath, override: false });
    if (result.parsed) {
      loaded.push(cwdEnvPath);
      if (options.verbose) {
        console.log(`[env] Loaded (fallback): ${cwdEnvPath}`);
      }
    }
  }

  return { loaded };
}
