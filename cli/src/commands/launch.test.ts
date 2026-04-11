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
	isPortAvailableMock,
	isViewerServerRunningMock,
	writeCliConfigMock,
	accessMock,
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
	isPortAvailableMock: vi.fn(),
	isViewerServerRunningMock: vi.fn(),
	writeCliConfigMock: vi.fn(),
	accessMock: vi.fn(),
}));

vi.mock('../lib/open-browser.js', () => ({
	openBrowser: openBrowserMock,
}));

vi.mock('../lib/cli-config.js', () => ({
	readCliConfig: readCliConfigMock,
	writeCliConfig: writeCliConfigMock,
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
	isPortAvailable: isPortAvailableMock,
}));

vi.mock('../lib/viewer-network.js', () => ({
	isViewerServerRunning: isViewerServerRunningMock,
}));

vi.mock('node:fs/promises', () => ({
	access: accessMock,
}));

import { runLaunch, runShutdown } from './launch.js';

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
} as unknown as Logger;

describe('runLaunch', () => {
	const originalExitCode = process.exitCode;
	let killSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;

		readCliConfigMock.mockResolvedValue({
			storage: { root: '/workspace', basePath: 'builds' },
			viewer: { host: '127.0.0.1', port: 5300 },
		});
		writeCliConfigMock.mockResolvedValue('/tmp/config.json');
		getViewerStatePathMock.mockReturnValue('/tmp/renku-viewer-state.json');
		readViewerStateMock.mockResolvedValue(null);
		isPortAvailableMock.mockResolvedValue(true);
		isViewerServerRunningMock.mockResolvedValue(false);
		accessMock.mockResolvedValue(undefined);
		resolveViewerBundleOrExitMock.mockReturnValue({
			assetsDir: '/bundle/dist',
			serverEntry: '/bundle/server-dist/bin.js',
		});
		getBundledCatalogRootMock.mockReturnValue('/bundle/catalog');
		launchViewerServerMock.mockResolvedValue(undefined);
		waitForViewerServerMock.mockResolvedValue(true);
		killSpy = vi.spyOn(process, 'kill').mockImplementation(
			((pid: number, signal?: string | number) => {
				if (signal === 0) {
					const error = new Error('No such process') as Error & {
						code?: string;
					};
					error.code = 'ESRCH';
					throw error;
				}
				return true;
			}) as typeof process.kill
		) as unknown as ReturnType<typeof vi.spyOn>;
	});

	afterEach(() => {
		killSpy.mockRestore();
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

	it('reuses a running managed singleton server on the same host/port', async () => {
		readViewerStateMock.mockResolvedValueOnce({
			pid: 2_147_483_647,
			host: '127.0.0.1',
			port: 5300,
			startedAt: '2026-01-01T00:00:00.000Z',
		});
		isViewerServerRunningMock.mockResolvedValueOnce(true);

		await runLaunch({
			logger,
			blueprintName: 'my-blueprint',
		});

		expect(launchViewerServerMock).not.toHaveBeenCalled();
		expect(openBrowserMock).toHaveBeenCalledWith(
			'http://127.0.0.1:5300/blueprints?bp=my-blueprint'
		);
		expect(accessMock).toHaveBeenCalledWith(
			'/workspace/my-blueprint/my-blueprint.yaml'
		);
	});

	it('resolves blueprint names from storage root deterministic layout', async () => {
		await runLaunch({
			logger,
			blueprintName: 'style-cartoon',
		});

		expect(accessMock).toHaveBeenCalledWith(
			'/workspace/style-cartoon/style-cartoon.yaml'
		);
		expect(openBrowserMock).toHaveBeenCalledWith(
			'http://127.0.0.1:5300/blueprints?bp=style-cartoon'
		);
	});

	it('rejects path-like blueprint launch input', async () => {
		await runLaunch({
			logger,
			blueprintName: './my-blueprint/my-blueprint.yaml',
		});

		expect(process.exitCode).toBe(1);
		expect(launchViewerServerMock).not.toHaveBeenCalled();
		expect(openBrowserMock).not.toHaveBeenCalled();
	});

	it('stops and relaunches when managed server runs on a different port', async () => {
		readViewerStateMock.mockResolvedValueOnce({
			pid: 3210,
			host: '127.0.0.1',
			port: 4400,
			startedAt: '2026-01-01T00:00:00.000Z',
		});
		isViewerServerRunningMock.mockResolvedValueOnce(true).mockResolvedValueOnce(
			false
		);

		await runLaunch({ logger });

		expect(killSpy).toHaveBeenCalledWith(3210, 'SIGTERM');
		expect(removeViewerStateMock).toHaveBeenCalledWith(
			'/tmp/renku-viewer-state.json'
		);
		expect(launchViewerServerMock).toHaveBeenCalledTimes(1);
	});

	it('fails if desired port is already occupied by a non-viewer process', async () => {
		isViewerServerRunningMock.mockResolvedValueOnce(false);
		isPortAvailableMock.mockResolvedValueOnce(false);

		await runLaunch({ logger });

		expect(process.exitCode).toBe(1);
		expect(launchViewerServerMock).not.toHaveBeenCalled();
		expect(openBrowserMock).not.toHaveBeenCalled();
	});

	it('fails if a viewer is already running without managed state', async () => {
		isViewerServerRunningMock.mockResolvedValueOnce(true);

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

describe('runShutdown', () => {
	const originalExitCode = process.exitCode;
	let killSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		getViewerStatePathMock.mockReturnValue('/tmp/renku-viewer-state.json');
		readViewerStateMock.mockResolvedValue(null);
		isViewerServerRunningMock.mockResolvedValue(false);
		killSpy = vi.spyOn(process, 'kill').mockImplementation(
			((pid: number, signal?: string | number) => {
				if (signal === 0) {
					const error = new Error('No such process') as Error & {
						code?: string;
					};
					error.code = 'ESRCH';
					throw error;
				}
				return true;
			}) as typeof process.kill
		) as unknown as ReturnType<typeof vi.spyOn>;
	});

	afterEach(() => {
		killSpy.mockRestore();
		process.exitCode = originalExitCode;
	});

	it('reports when no background viewer server exists', async () => {
		await runShutdown({ logger });

		expect(logger.info).toHaveBeenCalledWith('No background viewer server found.');
	});

	it('cleans stale state when process is no longer running', async () => {
		readViewerStateMock.mockResolvedValueOnce({
			pid: 1234,
			host: '127.0.0.1',
			port: 5300,
			startedAt: '2026-01-01T00:00:00.000Z',
		});
		isViewerServerRunningMock.mockResolvedValueOnce(false);

		await runShutdown({ logger });

		expect(removeViewerStateMock).toHaveBeenCalledWith(
			'/tmp/renku-viewer-state.json'
		);
		expect(logger.info).toHaveBeenCalledWith(
			'Viewer server was not running. Cleaned up stale state.'
		);
	});

	it('stops the managed viewer server and removes state', async () => {
		readViewerStateMock.mockResolvedValueOnce({
			pid: 5678,
			host: '127.0.0.1',
			port: 5300,
			startedAt: '2026-01-01T00:00:00.000Z',
		});
		isViewerServerRunningMock.mockResolvedValueOnce(true);

		await runShutdown({ logger });

		expect(killSpy).toHaveBeenCalledWith(5678, 'SIGTERM');
		expect(removeViewerStateMock).toHaveBeenCalledWith(
			'/tmp/renku-viewer-state.json'
		);
		expect(logger.info).toHaveBeenCalledWith('Viewer server stopped.');
	});
});
