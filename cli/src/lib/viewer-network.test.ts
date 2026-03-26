import { describe, expect, it, vi, beforeEach } from 'vitest';
import { simpleGet } from './http-utils.js';
import { isViewerServerRunning } from './viewer-network.js';

vi.mock('./http-utils.js', () => ({
	simpleGet: vi.fn(),
}));

const simpleGetMock = vi.mocked(simpleGet);

describe('isViewerServerRunning', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns true for a compatible viewer health response', async () => {
		simpleGetMock.mockResolvedValueOnce({
			statusCode: 200,
			body: JSON.stringify({
				ok: true,
				app: 'renku-viewer',
				launchRoute: '/blueprints',
			}),
		});

		await expect(isViewerServerRunning('127.0.0.1', 5300)).resolves.toBe(true);
	});

	it('returns false when health payload is from an incompatible server', async () => {
		simpleGetMock.mockResolvedValueOnce({
			statusCode: 200,
			body: JSON.stringify({ ok: true }),
		});

		await expect(isViewerServerRunning('127.0.0.1', 5300)).resolves.toBe(false);
	});

	it('returns false when health status is non-200', async () => {
		simpleGetMock.mockResolvedValueOnce({
			statusCode: 503,
			body: '',
		});

		await expect(isViewerServerRunning('127.0.0.1', 5300)).resolves.toBe(false);
	});

	it('returns false when health payload is invalid JSON', async () => {
		simpleGetMock.mockResolvedValueOnce({
			statusCode: 200,
			body: 'not-json',
		});

		await expect(isViewerServerRunning('127.0.0.1', 5300)).resolves.toBe(false);
	});

	it('returns false when health request fails', async () => {
		simpleGetMock.mockRejectedValueOnce(new Error('connection refused'));

		await expect(isViewerServerRunning('127.0.0.1', 5300)).resolves.toBe(false);
	});
});
