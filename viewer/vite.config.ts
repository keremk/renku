import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { loadEnv as loadEnvFromCore } from '@gorenku/core';
import { createViewerApiMiddleware } from './server/viewer-api';

// Load .env from monorepo root for the API middleware (providers need API keys)
loadEnvFromCore(import.meta.url, { verbose: true });

const expandPath = (input: string | null | undefined) => {
  if (!input) return null;
  const withHome = input.startsWith('~/')
    ? path.join(os.homedir(), input.slice(2))
    : input;
  return path.isAbsolute(withHome)
    ? withHome
    : path.resolve(process.cwd(), withHome);
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REQUIRED_CATALOG_DIRECTORIES = [
  'blueprints',
  'models',
  'producers',
] as const;

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, process.cwd(), ''),
    ...loadEnv(mode, __dirname, ''),
  };
  const candidate =
    env.RENKU_VIEWER_ROOT ??
    env.VITE_RENKU_ROOT ??
    process.env.RENKU_VIEWER_ROOT ??
    process.env.VITE_RENKU_ROOT ??
    resolveCliRootFromConfig();
  const viewerRoot = expandPath(candidate);
  const catalogPath = resolveViewerCatalogPath(env, viewerRoot);

  return {
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler']],
        },
      }),
      tailwindcss(),
      {
        name: 'renku-viewer-api',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use(
            createViewerApiMiddleware({ catalogPath: catalogPath ?? undefined })
          );
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      fs: {
        allow: [
          path.resolve(__dirname, '..'),
          ...(viewerRoot ? [viewerRoot] : []),
        ],
      },
    },
  };
});

function resolveCliRootFromConfig(): string | null {
  const configPath =
    process.env.RENKU_CLI_CONFIG ??
    path.join(os.homedir(), '.config', 'renku', 'cli-config.json');
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      storage?: { root?: string };
    };
    return data.storage?.root ?? null;
  } catch {
    return null;
  }
}

function resolveViewerCatalogPath(
  env: Record<string, string>,
  viewerRoot: string | null
): string | null {
  const explicitCandidate =
    env.RENKU_VIEWER_CATALOG ??
    env.VITE_RENKU_CATALOG ??
    process.env.RENKU_VIEWER_CATALOG ??
    process.env.VITE_RENKU_CATALOG;
  const explicitPath = expandPath(explicitCandidate);
  if (explicitPath) {
    return explicitPath;
  }

  if (!viewerRoot) {
    return null;
  }

  const workspaceCatalogPath = path.resolve(viewerRoot, 'catalog');
  if (isValidCatalogRoot(workspaceCatalogPath)) {
    return workspaceCatalogPath;
  }

  return null;
}

function isValidCatalogRoot(catalogRoot: string): boolean {
  if (!isDirectory(catalogRoot)) {
    return false;
  }

  return REQUIRED_CATALOG_DIRECTORIES.every((directory) =>
    isDirectory(path.resolve(catalogRoot, directory))
  );
}

function isDirectory(targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}
