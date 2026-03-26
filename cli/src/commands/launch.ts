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
import { isViewerServerRunning } from '../lib/viewer-network.js';
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
	const hasExplicitHost = options.host !== undefined;
	const hasExplicitPort = options.port !== undefined;

	const config = await readCliConfig();

	const host = options.host ?? config?.viewer?.host ?? '127.0.0.1';
	const port = await findAvailablePort(options.port ?? config?.viewer?.port);

	const statePath = getViewerStatePath();

	const rootFolder = config?.storage.root ?? process.cwd();

	const bundle = resolveViewerBundleOrExit(logger);
	if (!bundle) {
		return;
	}

	let activeHost = host;
	let activePort = port;

	const recordedState = await readViewerState(statePath);
	if (recordedState) {
		const alive = await isViewerServerRunning(
			recordedState.host,
			recordedState.port
		);
		const hostMatches = recordedState.host === host;
		const portMatches = recordedState.port === port;
		const canReuseRecordedState =
			(!hasExplicitHost || hostMatches) && (!hasExplicitPort || portMatches);

		if (alive && canReuseRecordedState) {
			activeHost = recordedState.host;
			activePort = recordedState.port;
		} else {
			if (!alive) {
				await removeViewerState(statePath);
			}
		}
	}

	if (!(await isViewerServerRunning(activeHost, activePort))) {
		logger.info?.(
			'Viewer server is not running. Launching background instance...'
		);
		await launchViewerServer({
			bundle,
			rootFolder,
			host,
			port,
			mode: 'background',
			statePath,
			catalogPath: getBundledCatalogRoot(),
		});
		activeHost = host;
		activePort = port;
		const ready = await waitForViewerServer(activeHost, activePort);
		if (!ready) {
			await removeViewerState(statePath);
			logger.error?.('Viewer server failed to start in time.');
			process.exitCode = 1;
			return;
		}
	}

	const url = `http://${activeHost}:${activePort}/blueprints`;
	logger.info?.(`Opening Renku at ${url}`);
	void openBrowser(url);
}
