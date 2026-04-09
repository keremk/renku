import { access } from 'node:fs/promises';
import process from 'node:process';
import { resolve } from 'node:path';
import { openBrowser } from '../lib/open-browser.js';
import { readCliConfig, writeCliConfig } from '../lib/cli-config.js';
import { getBundledCatalogRoot } from '../lib/config-assets.js';
import {
	launchViewerServer,
	resolveViewerBundleOrExit,
	waitForViewerServer,
} from './viewer.js';
import {
	getViewerStatePath,
	type ViewerServerState,
	readViewerState,
	removeViewerState,
} from '../lib/viewer-state.js';
import { isPortAvailable } from '../lib/ports.js';
import { isViewerServerRunning } from '../lib/viewer-network.js';
import type { Logger } from '@gorenku/core';

const DEFAULT_LAUNCH_HOST = '127.0.0.1';
const DEFAULT_LAUNCH_PORT = 5300;

export interface LaunchOptions {
	blueprintName?: string;
	host?: string;
	port?: number;
	logger?: Logger;
}

export interface ShutdownOptions {
	logger?: Logger;
}

/**
 * Opens the viewer without requiring prior initialization.
 * If the workspace is not initialized, the viewer will show the onboarding flow.
 */
export async function runLaunch(options: LaunchOptions = {}): Promise<void> {
	const logger = options.logger ?? globalThis.console;
	const config = await readCliConfig();
	const host = options.host ?? config?.viewer?.host ?? DEFAULT_LAUNCH_HOST;
	const port = options.port ?? config?.viewer?.port ?? DEFAULT_LAUNCH_PORT;
	const blueprintName = await resolveLaunchBlueprintName({
		blueprintName: options.blueprintName,
		config,
		logger,
	});
	if (process.exitCode === 1) {
		return;
	}

	await persistViewerNetworkConfig(config, { host, port });

	const statePath = getViewerStatePath();
	const state = await readViewerState(statePath);

	if (state) {
		const stateAlive = await isViewerServerRunning(state.host, state.port);
		if (!stateAlive) {
			await removeViewerState(statePath);
		} else if (state.host === host && state.port === port) {
			openLaunchUrl({ host, port, blueprintName, logger });
			return;
		} else {
			logger.info?.('Stopping existing viewer server...');
			const stopped = await stopViewerServerState({
				state,
				logger,
				failurePrefix: 'Unable to stop previous viewer server',
			});
			if (!stopped) {
				logger.error?.(
					`Previous viewer server (pid ${state.pid}) did not stop in time.`
				);
				process.exitCode = 1;
				return;
			}
			await removeViewerState(statePath);
		}
	}

	const viewerAlreadyRunning = await isViewerServerRunning(host, port);
	if (viewerAlreadyRunning) {
		logger.error?.(
			`A viewer server is already running at http://${host}:${port}, but it is not managed by Renku state. Stop that process and retry.`
		);
		process.exitCode = 1;
		return;
	}

	const portAvailable = await isPortAvailable(port, host);
	if (!portAvailable) {
		logger.error?.(
			`Port ${port} on ${host} is already in use. Free the port or launch with --port=<port>.`
		);
		process.exitCode = 1;
		return;
	}

	const rootFolder = config?.storage.root ?? process.cwd();

	const bundle = resolveViewerBundleOrExit(logger);
	if (!bundle) {
		return;
	}

	logger.info?.('Launching viewer server...');
	await launchViewerServer({
		bundle,
		rootFolder,
		host,
		port,
		mode: 'background',
		statePath,
		catalogPath: getBundledCatalogRoot(),
	});
	const ready = await waitForViewerServer(host, port);
	if (!ready) {
		await removeViewerState(statePath);
		logger.error?.('Viewer server failed to start in time.');
		process.exitCode = 1;
		return;
	}

	openLaunchUrl({ host, port, blueprintName, logger });
}

export async function runShutdown(options: ShutdownOptions = {}): Promise<void> {
	const logger = options.logger ?? globalThis.console;
	const statePath = getViewerStatePath();
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

	const stopped = await stopViewerServerState({
		state,
		logger,
		failurePrefix: 'Unable to stop viewer server',
	});
	await removeViewerState(statePath);
	if (stopped) {
		logger.info?.('Viewer server stopped.');
	} else {
		logger.warn?.('Viewer server did not exit cleanly. It may still be running.');
	}
}

async function persistViewerNetworkConfig(
	config: Awaited<ReturnType<typeof readCliConfig>>,
	address: { host: string; port: number }
): Promise<void> {
	if (!config) {
		return;
	}
	if (
		config.viewer?.host === address.host &&
		config.viewer?.port === address.port
	) {
		return;
	}
	config.viewer = { host: address.host, port: address.port };
	await writeCliConfig(config);
}

async function stopViewerServerState({
	state,
	logger,
	failurePrefix,
}: {
	state: ViewerServerState;
	logger: Logger;
	failurePrefix: string;
}): Promise<boolean> {
	try {
		process.kill(state.pid, 'SIGTERM');
		const stopped = await waitForProcessExit(state.pid);
		if (!stopped) {
			return false;
		}
	} catch (error) {
		if (isNoSuchProcessError(error)) {
			return true;
		}
		logger.error?.(
			`${failurePrefix} (pid ${state.pid}): ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		return false;
	}
	return true;
}

function openLaunchUrl({
	host,
	port,
	blueprintName,
	logger,
}: {
	host: string;
	port: number;
	blueprintName?: string;
	logger: Logger;
}): void {
	const url = new URL(`http://${host}:${port}/blueprints`);
	if (blueprintName) {
		url.searchParams.set('bp', blueprintName);
	}
	logger.info?.(`Opening Renku at ${url.toString()}`);
	void openBrowser(url.toString());
}

async function resolveLaunchBlueprintName({
	blueprintName,
	config,
	logger,
}: {
	blueprintName?: string;
	config: Awaited<ReturnType<typeof readCliConfig>>;
	logger: Logger;
}): Promise<string | undefined> {
	if (!blueprintName) {
		return undefined;
	}
	if (isPathLikeBlueprintSpecifier(blueprintName)) {
		logger.error?.(
			'launch accepts blueprint name only (for example: renku launch style-cartoon). Do not pass a path.'
		);
		process.exitCode = 1;
		return undefined;
	}
	const storageRoot = config?.storage?.root;
	if (!storageRoot) {
		logger.error?.(
			'Cannot resolve blueprint by name because Renku workspace is not initialized. Run "renku init" first.'
		);
		process.exitCode = 1;
		return undefined;
	}
	const expectedBlueprintPath = resolve(
		storageRoot,
		blueprintName,
		`${blueprintName}.yaml`
	);
	try {
		await access(expectedBlueprintPath);
		return blueprintName;
	} catch {
		logger.error?.(
			`Blueprint "${blueprintName}" not found at ${expectedBlueprintPath}.`
		);
		process.exitCode = 1;
		return undefined;
	}
}

function isPathLikeBlueprintSpecifier(specifier: string): boolean {
	return (
		specifier.includes('/') ||
		specifier.includes('\\') ||
		specifier.endsWith('.yaml') ||
		specifier.endsWith('.yml')
	);
}

async function waitForProcessExit(
	pid: number,
	timeoutMs = 5000
): Promise<boolean> {
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

function isNoSuchProcessError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const maybeErrno = error as Error & { code?: string };
	return maybeErrno.code === 'ESRCH';
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		globalThis.setTimeout(resolve, ms);
	});
}
