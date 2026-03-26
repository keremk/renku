import process from 'node:process';
import { openBrowser } from '../lib/open-browser.js';
import { readCliConfig } from '../lib/cli-config.js';
import { getBundledCatalogRoot } from '../lib/config-assets.js';
import {
	launchViewerServer,
	resolveViewerBundleOrExit,
	waitForViewerServer,
} from './viewer.js';
import {
	getViewerStatePath,
	readViewerState,
	removeViewerState,
} from '../lib/viewer-state.js';
import { findAvailablePort } from '../lib/ports.js';
import type { Logger } from '@gorenku/core';

export interface LaunchOptions {
	host?: string;
	port?: number;
	logger?: Logger;
}

/**
 * Opens the viewer without requiring prior initialization.
 * If the workspace is not initialized, the viewer will show the onboarding flow.
 */
export async function runLaunch(options: LaunchOptions = {}): Promise<void> {
	const logger = options.logger ?? globalThis.console;

	const config = await readCliConfig();

	const statePath = getViewerStatePath();
	const stopped = await stopExistingViewerServer(statePath, logger);
	if (!stopped) {
		process.exitCode = 1;
		return;
	}

	const host = options.host ?? config?.viewer?.host ?? '127.0.0.1';
	const port = await findAvailablePort(options.port ?? config?.viewer?.port);

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

	const url = `http://${host}:${port}/blueprints`;
	logger.info?.(`Opening Renku at ${url}`);
	void openBrowser(url);
}

async function stopExistingViewerServer(
	statePath: string,
	logger: Logger
): Promise<boolean> {
	const state = await readViewerState(statePath);
	if (!state) {
		return true;
	}

	logger.info?.('Stopping existing viewer server...');
	try {
		process.kill(state.pid, 'SIGTERM');
		const stopped = await waitForProcessExit(state.pid);
		if (!stopped) {
			logger.error?.(
				`Previous viewer server (pid ${state.pid}) did not stop in time.`
			);
			return false;
		}
	} catch (error) {
		if (!isNoSuchProcessError(error)) {
			logger.error?.(
				`Unable to stop previous viewer server (pid ${state.pid}): ${
					error instanceof Error ? error.message : String(error)
				}`
			);
			return false;
		}
	}

	await removeViewerState(statePath);
	return true;
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
