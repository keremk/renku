import { readCliConfig, writeCliConfig, type CliConfig } from './cli-config.js';
import { findAvailablePort } from './ports.js';
import { getViewerStatePath, readViewerState } from './viewer-state.js';
import { simpleGet } from './http-utils.js';

export interface ViewerAddress {
  host: string;
  port: number;
}

interface DetectViewerAddressArgs {
  config?: CliConfig | null;
  requireRunning?: boolean;
}

export async function ensureViewerNetworkConfig(
  config: CliConfig,
  overrides: { host?: string; port?: number },
): Promise<ViewerAddress> {
  const host = overrides.host ?? config.viewer?.host ?? '127.0.0.1';
  const desiredPort = overrides.port ?? config.viewer?.port;
  const port = await findAvailablePort(desiredPort);

  if (!config.viewer || config.viewer.host !== host || config.viewer.port !== port) {
    config.viewer = { host, port };
    await writeCliConfig(config);
  }

  return { host, port };
}

export async function detectViewerAddress(
  args: DetectViewerAddressArgs = {},
): Promise<{ address: ViewerAddress; source: 'state' | 'config' } | null> {
  const config = args.config ?? (await readCliConfig());
  if (!config?.storage?.root) {
    return null;
  }

  const requireRunning = args.requireRunning ?? false;
  const statePath = getViewerStatePath(config);
  const state = await readViewerState(statePath);
  if (state) {
    if (!requireRunning || (await isViewerServerRunning(state.host, state.port))) {
      return { address: { host: state.host, port: state.port }, source: 'state' };
    }
  }

  const host = config.viewer?.host;
  const port = config.viewer?.port;
  if (host && typeof port === 'number') {
    if (!requireRunning || (await isViewerServerRunning(host, port))) {
      return { address: { host, port }, source: 'config' };
    }
  }

  return null;
}

export async function isViewerServerRunning(host: string, port: number): Promise<boolean> {
  try {
    const response = await simpleGet(`http://${host}:${port}/viewer-api/health`, 1500);
    return response.statusCode === 200;
  } catch {
    return false;
  }
}
