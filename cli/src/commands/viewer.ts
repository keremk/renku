import { spawn } from 'node:child_process';
import process from 'node:process';
import { openBrowser } from '../lib/open-browser.js';
import type { CliConfig } from '../lib/cli-config.js';
import { getProjectLocalStorage, readCliConfig } from '../lib/cli-config.js';
import { resolveTargetMovieId } from '../lib/movie-id-utils.js';
import { resolveViewerBundlePaths } from '../lib/viewer-bundle.js';
import {
  getViewerStatePath,
  readViewerState,
  removeViewerState,
  writeViewerState,
} from '../lib/viewer-state.js';
import type { Logger } from '@gorenku/core';
import {
  ensureViewerNetworkConfig,
  isViewerServerRunning,
} from '../lib/viewer-network.js';

export interface ViewerStartOptions {
  host?: string;
  port?: number;
  logger?: Logger;
}

export interface ViewerViewOptions extends ViewerStartOptions {
  movieId?: string;
  useLast?: boolean;
}

export interface ViewerBlueprintOptions extends ViewerStartOptions {
  blueprintPath: string;
  inputsPath?: string;
  movieId?: string;
  useLast?: boolean;
}

export async function runViewerStart(options: ViewerStartOptions = {}): Promise<void> {
  const logger = options.logger ?? globalThis.console;
  const cliConfig = await ensureInitializedConfig(logger);
  if (!cliConfig) {
    return;
  }
  const bundle = resolveViewerBundleOrExit(logger);
  if (!bundle) {
    return;
  }
  const network = await ensureViewerNetworkConfig(cliConfig, options);
  const statePath = getViewerStatePath(cliConfig);

  const existingState = await readViewerState(statePath);
  if (existingState) {
    const alive = await isViewerServerRunning(existingState.host, existingState.port);
    if (alive) {
      logger.error?.(
        `A background viewer server is already running on http://${existingState.host}:${existingState.port}. Stop it first with "renku viewer:stop".`,
      );
      process.exitCode = 1;
      return;
    }
    await removeViewerState(statePath);
  }

  if (await isViewerServerRunning(network.host, network.port)) {
    logger.info?.(`Viewer server already running on http://${network.host}:${network.port}`);
    return;
  }

  logger.info?.(`Starting viewer server at http://${network.host}:${network.port} (Ctrl+C to stop)`);
  // Use project-local storage (cwd) to match generate behavior
  const projectStorage = getProjectLocalStorage();
  await launchViewerServer({
    bundle,
    rootFolder: projectStorage.root,
    host: network.host,
    port: network.port,
    mode: 'foreground',
  });
}

export async function runViewerView(options: ViewerViewOptions = {}): Promise<void> {
  const logger = options.logger ?? globalThis.console;

  // Validate mutual exclusivity
  const usingLast = Boolean(options.useLast);
  if (usingLast && options.movieId) {
    logger.error?.('Error: Use either --last or --movie-id/--id, not both.');
    process.exitCode = 1;
    return;
  }

  const cliConfig = await ensureInitializedConfig(logger);
  if (!cliConfig) {
    return;
  }

  // Resolve movie ID using helper
  let movieId: string;
  try {
    movieId = await resolveTargetMovieId({
      explicitMovieId: options.movieId,
      useLast: usingLast,
      cliConfig,
    });
  } catch (error) {
    logger.error?.(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const bundle = resolveViewerBundleOrExit(logger);
  if (!bundle) {
    return;
  }
  const network = await ensureViewerNetworkConfig(cliConfig, options);
  const statePath = getViewerStatePath(cliConfig);
  let activeHost = network.host;
  let activePort = network.port;

  const recordedState = await readViewerState(statePath);
  if (recordedState) {
    const alive = await isViewerServerRunning(recordedState.host, recordedState.port);
    if (alive) {
      activeHost = recordedState.host;
      activePort = recordedState.port;
    } else {
      await removeViewerState(statePath);
    }
  }

  if (!(await isViewerServerRunning(activeHost, activePort))) {
    logger.info?.('Viewer server is not running. Launching background instance...');
    // Use project-local storage (cwd) to match generate behavior
    const projectStorage = getProjectLocalStorage();
    await launchViewerServer({
      bundle,
      rootFolder: projectStorage.root,
      host: network.host,
      port: network.port,
      mode: 'background',
      statePath,
    });
    activeHost = network.host;
    activePort = network.port;
    const ready = await waitForViewerServer(activeHost, activePort);
    if (!ready) {
      await removeViewerState(statePath);
      logger.error?.('Viewer server failed to start in time. Check logs with "renku viewer:start".');
      process.exitCode = 1;
      return;
    }
  }

  const targetUrl = `http://${activeHost}:${activePort}/movies/${encodeURIComponent(movieId)}`;
  logger.info?.(`Opening viewer at ${targetUrl}`);
  void openBrowser(targetUrl);
}

export async function runViewerBlueprint(options: ViewerBlueprintOptions): Promise<void> {
  const logger = options.logger ?? globalThis.console;

  // Validate mutual exclusivity
  const usingLast = Boolean(options.useLast);
  if (usingLast && options.movieId) {
    logger.error?.('Error: Use either --last or --movie-id/--id, not both.');
    process.exitCode = 1;
    return;
  }

  const cliConfig = await ensureInitializedConfig(logger);
  if (!cliConfig) {
    return;
  }

  const bundle = resolveViewerBundleOrExit(logger);
  if (!bundle) {
    return;
  }
  const network = await ensureViewerNetworkConfig(cliConfig, options);
  const statePath = getViewerStatePath(cliConfig);
  let activeHost = network.host;
  let activePort = network.port;

  const recordedState = await readViewerState(statePath);
  if (recordedState) {
    const alive = await isViewerServerRunning(recordedState.host, recordedState.port);
    if (alive) {
      activeHost = recordedState.host;
      activePort = recordedState.port;
    } else {
      await removeViewerState(statePath);
    }
  }

  if (!(await isViewerServerRunning(activeHost, activePort))) {
    logger.info?.('Viewer server is not running. Launching background instance...');
    const projectStorage = getProjectLocalStorage();
    await launchViewerServer({
      bundle,
      rootFolder: projectStorage.root,
      host: network.host,
      port: network.port,
      mode: 'background',
      statePath,
    });
    activeHost = network.host;
    activePort = network.port;
    const ready = await waitForViewerServer(activeHost, activePort);
    if (!ready) {
      await removeViewerState(statePath);
      logger.error?.('Viewer server failed to start in time. Check logs with "renku viewer:start".');
      process.exitCode = 1;
      return;
    }
  }

  // Build the URL with query parameters
  const url = new URL(`http://${activeHost}:${activePort}/blueprints`);
  url.searchParams.set('bp', options.blueprintPath);
  if (options.inputsPath) {
    url.searchParams.set('in', options.inputsPath);
  }
  if (options.movieId) {
    url.searchParams.set('movie', options.movieId);
  }
  // Include catalog root for resolving qualified producer names
  if (cliConfig.catalog?.root) {
    url.searchParams.set('catalog', cliConfig.catalog.root);
  }
  if (usingLast) {
    url.searchParams.set('last', '1');
  }

  logger.info?.(`Opening blueprint viewer at ${url.toString()}`);
  void openBrowser(url.toString());
}

export async function runViewerStop(options: { logger?: Logger } = {}): Promise<void> {
  const logger = options.logger ?? globalThis.console;
  const cliConfig = await readCliConfig();
  if (!cliConfig?.storage?.root) {
    logger.error?.('Renku viewer requires a configured root. Run "renku init" first.');
    process.exitCode = 1;
    return;
  }
  const statePath = getViewerStatePath(cliConfig);
  const state = await readViewerState(statePath);
  if (!state) {
    logger.info?.('No background viewer server found.');
    return;
  }

  const alive = await isViewerServerRunning(state.host, state.port);
  if (!alive) {
    await removeViewerState(statePath);
    logger.info?.('Viewer server was not running. Cleaned up stale state.');
    return;
  }

  try {
    process.kill(state.pid, 'SIGTERM');
  } catch (error) {
    logger.error?.(
      `Unable to stop viewer server (pid ${state.pid}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
    return;
  }

  const stopped = await waitForProcessExit(state.pid);
  await removeViewerState(statePath);
  if (stopped) {
    logger.info?.('Viewer server stopped.');
  } else {
    logger.warn?.('Viewer server did not exit cleanly. It may still be running.');
  }
}

async function ensureInitializedConfig(logger: Logger): Promise<CliConfig | null> {
  const cliConfig = await readCliConfig();
  if (!cliConfig?.storage?.root) {
    logger.error?.('Renku viewer requires a configured root. Run "renku init" first.');
    process.exitCode = 1;
    return null;
  }
  return cliConfig;
}

async function launchViewerServer({
  bundle,
  rootFolder,
  host,
  port,
  mode,
  statePath,
}: {
  bundle: ReturnType<typeof resolveViewerBundlePaths>;
  rootFolder: string;
  host: string;
  port: number;
  mode: 'foreground' | 'background';
  statePath?: string;
}): Promise<void> {
  const args = [
    bundle.serverEntry,
    `--root=${rootFolder}`,
    `--dist=${bundle.assetsDir}`,
    `--host=${host}`,
    `--port=${port}`,
  ];

  const child = spawn(process.execPath, args, {
    stdio: mode === 'foreground' ? 'inherit' : 'ignore',
    env: {
      ...process.env,
      RENKU_VIEWER_ROOT: rootFolder,
    },
    detached: mode === 'background',
  });

  if (mode === 'foreground') {
    await new Promise<void>((resolve) => {
      child.on('exit', (code) => {
        process.exitCode = code ?? 0;
        resolve();
      });
    });
    return;
  }

  if (!child.pid) {
    throw new Error('Failed to start viewer server in background (missing pid).');
  }

  if (!statePath) {
    throw new Error('Missing statePath for background viewer launch.');
  }

  child.unref();
  await writeViewerState(statePath, {
    pid: child.pid,
    port,
    host,
    startedAt: new Date().toISOString(),
  });
}

async function waitForViewerServer(host: string, port: number): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await isViewerServerRunning(host, port)) {
      return true;
    }
    await delay(250);
  }
  return false;
}

async function waitForProcessExit(pid: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await delay(200);
  }
  return !isProcessAlive(pid);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveViewerBundleOrExit(logger: Logger): ReturnType<typeof resolveViewerBundlePaths> | null {
  try {
    return resolveViewerBundlePaths();
  } catch (error) {
    logger.error?.(
      `Unable to locate the bundled viewer. Build the viewer project or set RENKU_VIEWER_BUNDLE_ROOT. ${
        error instanceof Error ? error.message : error
      }`,
    );
    process.exitCode = 1;
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
