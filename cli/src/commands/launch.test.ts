import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@gorenku/core';

const {
	openBrowserMock,
	readCliConfigMock,
	getBundledCatalogRootMock,
	launchViewerServerMock,
	resolveViewerBundleOrExitMock,
	waitForViewerServerMock,
	getViewerStatePathMock,
	readViewerStateMock,
	removeViewerStateMock,
	findAvailablePortMock,
} = vi.hoisted(() => ({
	openBrowserMock: vi.fn(),
	readCliConfigMock: vi.fn(),
	getBundledCatalogRootMock: vi.fn(),
	launchViewerServerMock: vi.fn(),
	resolveViewerBundleOrExitMock: vi.fn(),
	waitForViewerServerMock: vi.fn(),
	getViewerStatePathMock: vi.fn(),
	readViewerStateMock: vi.fn(),
	removeViewerStateMock: vi.fn(),
	findAvailablePortMock: vi.fn(),
}));

vi.mock('../lib/open-browser.js', () => ({
	openBrowser: openBrowserMock,
}));

vi.mock('../lib/cli-config.js', () => ({
	readCliConfig: readCliConfigMock,
}));

vi.mock('../lib/config-assets.js', () => ({
	getBundledCatalogRoot: getBundledCatalogRootMock,
}));

vi.mock('./viewer.js', () => ({
	launchViewerServer: launchViewerServerMock,
	resolveViewerBundleOrExit: resolveViewerBundleOrExitMock,
	waitForViewerServer: waitForViewerServerMock,
}));

vi.mock('../lib/viewer-state.js', () => ({
	getViewerStatePath: getViewerStatePathMock,
	readViewerState: readViewerStateMock,
	removeViewerState: removeViewerStateMock,
}));

vi.mock('../lib/ports.js', () => ({
	findAvailablePort: findAvailablePortMock,
}));

import { runLaunch } from './launch.js';

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
} as unknown as Logger;

describe('runLaunch', () => {
	const originalExitCode = process.exitCode;

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;

		readCliConfigMock.mockResolvedValue({
			storage: { root: '/workspace', basePath: 'builds' },
			viewer: { host: '127.0.0.1', port: 5300 },
		});
		getViewerStatePathMock.mockReturnValue('/tmp/renku-viewer-state.json');
		readViewerStateMock.mockResolvedValue(null);
		findAvailablePortMock.mockResolvedValue(5300);
		resolveViewerBundleOrExitMock.mockReturnValue({
			assetsDir: '/bundle/dist',
			serverEntry: '/bundle/server-dist/bin.js',
		});
		getBundledCatalogRootMock.mockReturnValue('/bundle/catalog');
		launchViewerServerMock.mockResolvedValue(undefined);
		waitForViewerServerMock.mockResolvedValue(true);
	});

	afterEach(() => {
		process.exitCode = originalExitCode;
	});

	it('launches a fresh server and opens the blueprints route', async () => {
		await runLaunch({ logger });

		expect(launchViewerServerMock).toHaveBeenCalledWith({
			bundle: {
				assetsDir: '/bundle/dist',
				serverEntry: '/bundle/server-dist/bin.js',
			},
			rootFolder: '/workspace',
			host: '127.0.0.1',
			port: 5300,
			mode: 'background',
			statePath: '/tmp/renku-viewer-state.json',
			catalogPath: '/bundle/catalog',
		});
		expect(openBrowserMock).toHaveBeenCalledWith(
			'http://127.0.0.1:5300/blueprints'
		);
	});

	it('continues launch when previous server pid is already gone', async () => {
		readViewerStateMock.mockResolvedValueOnce({
			pid: 2_147_483_647,
			host: '127.0.0.1',
			port: 5300,
			startedAt: '2026-01-01T00:00:00.000Z',
		});

		await runLaunch({ logger });

		expect(removeViewerStateMock).toHaveBeenCalledWith(
			'/tmp/renku-viewer-state.json'
		);
		expect(launchViewerServerMock).toHaveBeenCalledTimes(1);
		expect(openBrowserMock).toHaveBeenCalledWith(
			'http://127.0.0.1:5300/blueprints'
		);
	});

	it('fails fast when previous server cannot be stopped', async () => {
		readViewerStateMock.mockResolvedValueOnce({
			pid: Number.NaN,
			host: '127.0.0.1',
			port: 5300,
			startedAt: '2026-01-01T00:00:00.000Z',
		});

		await runLaunch({ logger });

		expect(process.exitCode).toBe(1);
		expect(launchViewerServerMock).not.toHaveBeenCalled();
		expect(openBrowserMock).not.toHaveBeenCalled();
	});

	it('fails when the freshly launched server is not ready in time', async () => {
		waitForViewerServerMock.mockResolvedValueOnce(false);

		await runLaunch({ logger });

		expect(process.exitCode).toBe(1);
		expect(removeViewerStateMock).toHaveBeenCalledWith(
			'/tmp/renku-viewer-state.json'
		);
		expect(openBrowserMock).not.toHaveBeenCalled();
	});
});
