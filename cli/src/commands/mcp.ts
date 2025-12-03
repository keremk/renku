import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../mcp/server.js';
import {
  getBundledBlueprintsRoot,
  getCliBlueprintsRoot,
} from '../lib/config-assets.js';
import {
  getDefaultCliConfigPath,
  readCliConfig,
  type CliConfig,
} from '../lib/cli-config.js';
import { expandPath } from '../lib/path.js';
import type { Logger } from '@renku/core';
type ShutdownSignal = 'SIGINT' | 'SIGTERM';

export interface RunMcpServerOptions {
  configPath?: string;
  blueprintsDir?: string;
  defaultBlueprint?: string;
  openViewer?: boolean;
  logger?: Logger;
}

export async function runMcpServer(options: RunMcpServerOptions = {}): Promise<void> {
  const logger = options.logger ?? globalThis.console;
  const resolvedConfigPath = options.configPath ? expandPath(options.configPath) : getDefaultCliConfigPath();
  const cliConfig = await readCliConfig(resolvedConfigPath);
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" before starting the MCP server.');
  }

  // Ensure downstream helpers (runGenerate, viewer commands) use the same config file.
  process.env.RENKU_CLI_CONFIG = resolvedConfigPath;

  const blueprintDirectory = await resolveBlueprintDirectory({
    cliConfig,
    override: options.blueprintsDir,
  });
  const packageInfo = await readPackageMetadata();
  const defaultBlueprintPath = await resolveDefaultBlueprint({
    blueprintDir: blueprintDirectory,
    specifier: options.defaultBlueprint,
  });
  const openViewerDefault = options.openViewer ?? true;

  const restoreConsole = redirectConsoleOutput();
  const server = createMcpServer({
    storageRoot: cliConfig.storage.root,
    storageBasePath: cliConfig.storage.basePath,
    blueprintDir: blueprintDirectory,
    defaultBlueprintPath,
    openViewerDefault,
    packageInfo,
    cliConfigPath: resolvedConfigPath,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info?.(`Renku MCP server ready. Default blueprint: ${shortBlueprintLabel(defaultBlueprintPath, blueprintDirectory)}`);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    let closed = false;

    async function shutdown(signal?: ShutdownSignal): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      if (signal) {
        logger.info?.(`Received ${signal}. Shutting down Renku MCP server...`);
      }
      try {
        await transport.close();
      } catch (error) {
        logger.error?.('Error closing MCP transport:', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      try {
        await server.close();
      } catch (error) {
        logger.error?.('Error closing MCP server:', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      resolvePromise();
    }

    const handleTransportError = (error: Error): void => {
      if (closed) {
        return;
      }
      logger.error?.('MCP server transport error:', { error });
      rejectPromise(error);
    };

    const handleTransportClose = (): void => {
      void shutdown();
    };

    transport.onclose = handleTransportClose;
    transport.onerror = handleTransportError;

    const signals: ShutdownSignal[] = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
      process.once(signal, () => {
        void shutdown(signal);
      });
    }
  }).finally(() => {
    restoreConsole();
  });
}

async function resolveBlueprintDirectory({
  cliConfig,
  override,
}: {
  cliConfig: CliConfig;
  override?: string;
}): Promise<string> {
  const attemptPaths: string[] = [];
  const checkPath = async (candidate: string | null | undefined): Promise<string | null> => {
    if (!candidate) {
      return null;
    }
    const expanded = expandPath(candidate);
    attemptPaths.push(expanded);
    try {
      const stats = await statSafe(expanded);
      if (stats?.isDirectory()) {
        return expanded;
      }
    } catch {
      // fallthrough
    }
    return null;
  };

  const viaOverride = await checkPath(override);
  if (viaOverride) {
    return viaOverride;
  }
  const cliRootDir = getCliBlueprintsRoot(cliConfig!.storage.root);
  const viaCliRoot = await checkPath(cliRootDir);
  if (viaCliRoot) {
    return viaCliRoot;
  }
  const bundled = await checkPath(getBundledBlueprintsRoot());
  if (bundled) {
    return bundled;
  }
  throw new Error(
    `No blueprint directory found. Tried: ${attemptPaths.join(', ')}. Initialize the CLI or provide --blueprintsDir.`,
  );
}

async function resolveDefaultBlueprint({
  blueprintDir,
  specifier,
}: {
  blueprintDir: string;
  specifier?: string;
}): Promise<string> {
  if (!specifier || specifier.trim().length === 0) {
    throw new Error('Default blueprint not configured. Pass --defaultBlueprint=/path/to/blueprint.yaml when launching the MCP server.');
  }

  if (specifier.startsWith('~/') || isAbsolute(specifier)) {
    const absolute = expandPath(specifier);
    if (await fileExists(absolute)) {
      return absolute;
    }
  }

  const joined = resolve(blueprintDir, specifier);
  if (await fileExists(joined)) {
    return joined;
  }

  throw new Error(
    `Default blueprint "${specifier}" not found. Checked ${joined}${
      specifier.startsWith('/') ? '' : ` and ${specifier}`
    }.`,
  );
}

function shortBlueprintLabel(absolutePath: string, blueprintDir: string): string {
  if (absolutePath.startsWith(blueprintDir)) {
    const relativePath = absolutePath.slice(blueprintDir.length).replace(/^\/+/, '');
    return relativePath.length > 0 ? relativePath : absolutePath;
  }
  return absolutePath;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stats = await statSafe(path);
    return stats ? stats.isFile() : false;
  } catch {
    return false;
  }
}

async function statSafe(target: string) {
  try {
    return await stat(target);
  } catch {
    return null;
  }
}

async function readPackageMetadata(): Promise<{ name: string; version: string }> {
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const pkgPath = resolve(__dirname, '../../package.json');
  const raw = await readFile(pkgPath, 'utf8');
  const parsed = JSON.parse(raw) as { name?: string; version?: string };
  return {
    name: parsed.name ?? 'renku-cli',
    version: parsed.version ?? '0.0.0',
  };
}

function redirectConsoleOutput(): () => void {
  const log = globalThis.console;
  const originalLog = log.log;
  const originalInfo = log.info;
  const originalDebug = log.debug;
  const originalError = log.error;

  const toStderr = (...args: unknown[]): void => {
    originalError(...args);
  };

  log.log = toStderr;
  log.info = toStderr;
  log.debug = toStderr;

  return () => {
    log.log = originalLog;
    log.info = originalInfo;
    log.debug = originalDebug;
  };
}
/* eslint-disable no-console */
