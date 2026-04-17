import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	appendStartedMock,
	appendCompletedMock,
	createStorageContextMock,
	initializeMovieStorageMock,
	createEventLogMock,
	createBuildStateServiceMock,
	createRunLifecycleServiceMock,
	resolveBlobRefsToInputsMock,
	injectAllSystemInputsMock,
	executePlanWithConcurrencyMock,
	readLlmInvocationSettingsMock,
	createProviderRegistryMock,
	createProviderProduceMock,
	prepareProviderHandlersMock,
	warmStartMock,
} = vi.hoisted(() => ({
	appendStartedMock: vi.fn(),
	appendCompletedMock: vi.fn(),
	createStorageContextMock: vi.fn(),
	initializeMovieStorageMock: vi.fn(),
	createEventLogMock: vi.fn(),
	createBuildStateServiceMock: vi.fn(),
	createRunLifecycleServiceMock: vi.fn(),
	resolveBlobRefsToInputsMock: vi.fn(),
	injectAllSystemInputsMock: vi.fn(),
	executePlanWithConcurrencyMock: vi.fn(),
	readLlmInvocationSettingsMock: vi.fn(),
	createProviderRegistryMock: vi.fn(),
	createProviderProduceMock: vi.fn(),
	prepareProviderHandlersMock: vi.fn(),
	warmStartMock: vi.fn(),
}));

vi.mock('@gorenku/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@gorenku/core')>();
	return {
		...actual,
		createEventLog: createEventLogMock,
		createBuildStateService: createBuildStateServiceMock,
		createRunLifecycleService: createRunLifecycleServiceMock,
		createStorageContext: createStorageContextMock,
		initializeMovieStorage: initializeMovieStorageMock,
		resolveBlobRefsToInputs: resolveBlobRefsToInputsMock,
		injectAllSystemInputs: injectAllSystemInputsMock,
		executePlanWithConcurrency: executePlanWithConcurrencyMock,
		readLlmInvocationSettings: readLlmInvocationSettingsMock,
	};
});

vi.mock('@gorenku/providers', () => ({
	createProviderRegistry: createProviderRegistryMock,
	createProviderProduce: createProviderProduceMock,
	prepareProviderHandlers: prepareProviderHandlersMock,
}));

import { executeBuild } from './build.js';

describe('executeBuild run lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		createStorageContextMock.mockReturnValue({
			resolve: vi.fn(() => 'builds/movie-test/events/runs.log'),
			storage: {},
		});
		initializeMovieStorageMock.mockResolvedValue(undefined);
		createEventLogMock.mockReturnValue({});
		createBuildStateServiceMock.mockReturnValue({
			buildFromEvents: vi.fn(),
		});
		createRunLifecycleServiceMock.mockReturnValue({
			appendStarted: appendStartedMock,
			appendCompleted: appendCompletedMock,
		});
		appendStartedMock.mockResolvedValue(undefined);
		appendCompletedMock.mockResolvedValue(undefined);
		prepareProviderHandlersMock.mockReturnValue([]);
		createProviderRegistryMock.mockReturnValue({
			warmStart: warmStartMock,
		});
	});

	it('appends a failed terminal event when setup fails after execution commit', async () => {
		const warmStartError = new Error('Provider warm start failed.');
		warmStartMock.mockRejectedValue(warmStartError);

		await expect(
			executeBuild({
				cliConfig: {
					storage: {
						root: '/tmp/renku',
						basePath: 'builds',
					},
				} as never,
				movieId: 'movie-test',
				plan: {
					revision: 'rev-0001',
					layers: [[{ jobId: 'job-1' }], [{ jobId: 'job-2' }]],
				} as never,
				buildState: {
					revision: 'rev-0000',
				} as never,
				baselineHash: null,
				providerOptions: new Map(),
				resolvedInputs: {},
			})
		).rejects.toThrow('Provider warm start failed.');

		expect(appendStartedMock).not.toHaveBeenCalled();
		expect(appendCompletedMock).toHaveBeenCalledTimes(1);
		expect(appendCompletedMock).toHaveBeenCalledWith('movie-test', {
			type: 'run-completed',
			revision: 'rev-0001',
			completedAt: expect.any(String),
			status: 'failed',
			summary: {
				jobCount: 2,
				counts: {
					succeeded: 0,
					failed: 0,
					skipped: 0,
				},
				layers: 2,
			},
		});
		expect(executePlanWithConcurrencyMock).not.toHaveBeenCalled();
		expect(resolveBlobRefsToInputsMock).not.toHaveBeenCalled();
		expect(readLlmInvocationSettingsMock).not.toHaveBeenCalled();
		expect(createProviderProduceMock).not.toHaveBeenCalled();
	});
});
