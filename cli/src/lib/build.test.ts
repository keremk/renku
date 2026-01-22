import { describe, expect, it, vi } from 'vitest';
import { createProviderProduce } from '@gorenku/providers';
import { injectDerivedSystemInputs } from '@gorenku/core';
import type { LoadedProducerOption } from '@gorenku/core';
import type {
	ProviderRegistry,
	ProducerHandler,
	ProviderJobContext,
} from '@gorenku/providers';
import type { ProduceRequest, JobDescriptor } from '@gorenku/core';
import { createCliLogger } from './logger.js';

describe('createProviderProduce', () => {
	it('passes all system inputs to providers during execution', async () => {
		// This test verifies that providers receive all system inputs:
		// MovieId, StorageRoot, StorageBasePath, Duration, NumOfSegments, SegmentDuration
		const providerOptions = new Map<string, LoadedProducerOption[]>([
			[
				'VideoExporter',
				[
					{
						priority: 'main',
						provider: 'renku',
						model: 'mp4-exporter',
						environment: 'local',
						attachments: [],
						config: undefined,
						sourcePath: 'VideoExporter',
						customAttributes: undefined,
						sdkMapping: undefined,
						outputs: undefined,
						inputSchema: undefined,
						outputSchema: undefined,
						selectionInputKeys: [],
						configInputPaths: [],
						configDefaults: {},
					},
				],
			],
		]);

		// Simulate the full system input chain from executeBuild
		const resolvedInputs = {
			'Input:MovieId': 'movie-test-123',
			'Input:StorageRoot': '/home/user/movies',
			'Input:StorageBasePath': 'builds',
			'Input:Duration': 60,
			'Input:NumOfSegments': 6,
			'Input:SegmentDuration': 10, // 60/6, computed by injectDerivedSystemInputs
			'Artifact:Timeline': { tracks: [], duration: 60 },
		};

		let capturedContext: ProviderJobContext | undefined;
		const handler: ProducerHandler = {
			provider: 'renku',
			model: 'mp4-exporter',
			environment: 'local',
			mode: 'mock',
			async invoke(request) {
				capturedContext = request;
				return { status: 'succeeded', artefacts: [] };
			},
		};

		const registry: ProviderRegistry = {
			mode: 'mock',
			resolve: vi.fn(() => handler),
			resolveMany: vi.fn(() => []),
			warmStart: vi.fn(),
		};

		const produce = createProviderProduce(
			registry,
			providerOptions,
			resolvedInputs,
			[],
			createCliLogger({ level: 'debug' })
		);

		const job: JobDescriptor = {
			jobId: 'Producer:VideoExporter',
			producer: 'VideoExporter',
			inputs: [
				'Input:MovieId',
				'Input:StorageRoot',
				'Input:StorageBasePath',
				'Artifact:Timeline',
			],
			produces: ['Artifact:FinalVideo'],
			provider: 'renku',
			providerModel: 'mp4-exporter',
			rateKey: 'renku:mp4-exporter',
			context: {
				namespacePath: [],
				indices: {},
				producerAlias: 'VideoExporter',
				inputs: [
					'Input:MovieId',
					'Input:StorageRoot',
					'Input:StorageBasePath',
					'Artifact:Timeline',
				],
				produces: ['Artifact:FinalVideo'],
				inputBindings: {
					MovieId: 'Input:MovieId',
					StorageRoot: 'Input:StorageRoot',
					StorageBasePath: 'Input:StorageBasePath',
					Timeline: 'Artifact:Timeline',
				},
			},
		};

		const request: ProduceRequest = {
			movieId: 'movie-test-123',
			job,
			layerIndex: 0,
			attempt: 1,
			revision: 'rev-0001',
		};

		const result = await produce(request);
		expect(result.status).toBe('succeeded');
		expect(capturedContext).toBeDefined();

		// Verify provider receives all system inputs through extras.resolvedInputs
		const extras = capturedContext?.context.extras as Record<string, unknown> | undefined;
		expect(extras).toBeDefined();
		const forwarded = (extras?.resolvedInputs ?? {}) as Record<string, unknown>;

		// Verify all system inputs are accessible
		expect(forwarded['Input:MovieId']).toBe('movie-test-123');
		expect(forwarded['Input:StorageRoot']).toBe('/home/user/movies');
		expect(forwarded['Input:StorageBasePath']).toBe('builds');
		expect(forwarded['Input:Duration']).toBe(60);
		expect(forwarded['Input:NumOfSegments']).toBe(6);
		expect(forwarded['Input:SegmentDuration']).toBe(10);

		// Verify input bindings are passed through
		const jobContext = (extras?.jobContext ?? {}) as {
			inputBindings?: Record<string, string>;
		};
		expect(jobContext.inputBindings?.MovieId).toBe('Input:MovieId');
		expect(jobContext.inputBindings?.StorageRoot).toBe('Input:StorageRoot');
		expect(jobContext.inputBindings?.StorageBasePath).toBe('Input:StorageBasePath');
	});

	it('passes user overrides for NumOfImagesPerNarrative through resolved inputs and bindings', async () => {
		const providerOptions = new Map<string, LoadedProducerOption[]>([
			[
				'ImagePromptProducer',
				[
					{
						priority: 'main',
						provider: 'openai',
						model: 'gpt-5-mini',
						environment: 'local',
						attachments: [],
						config: undefined,
						sourcePath: 'ImagePromptGenerator.ImagePromptProducer',
						customAttributes: undefined,
						sdkMapping: undefined,
						outputs: undefined,
						inputSchema: undefined,
						outputSchema: undefined,
						selectionInputKeys: [],
						configInputPaths: [],
						configDefaults: {},
					},
				],
			],
		]);

		const resolvedInputs = {
			'Input:ImagePromptGenerator.NumOfImagesPerNarrative': 2,
		};

		let capturedContext: ProviderJobContext | undefined;
		const handler: ProducerHandler = {
			provider: 'openai',
			model: 'gpt-5-mini',
			environment: 'local',
			mode: 'mock',
			async invoke(request) {
				capturedContext = request;
				return { status: 'succeeded', artefacts: [] };
			},
		};

		const registry: ProviderRegistry = {
			mode: 'mock',
			resolve: vi.fn(() => handler),
			resolveMany: vi.fn(() => []),
			warmStart: vi.fn(),
		};

		const produce = createProviderProduce(
			registry,
			providerOptions,
			resolvedInputs,
			[],
			createCliLogger({
				level: 'debug',
			})
		);
		const job: JobDescriptor = {
			jobId: 'Producer:ImagePromptGenerator.ImagePromptProducer[segment=0]',
			producer: 'ImagePromptProducer',
			inputs: ['Input:ImagePromptGenerator.NumOfImagesPerNarrative'],
			produces: [
				'Artifact:ImagePromptGenerator.ImagePrompt[segment=0][image=0]',
			],
			provider: 'openai',
			providerModel: 'gpt-5-mini',
			rateKey: 'openai:gpt-5-mini',
			context: {
				namespacePath: ['ImagePromptGenerator'],
				indices: {},
				producerAlias: 'ImagePromptGenerator.ImagePromptProducer',
				inputs: ['Input:ImagePromptGenerator.NumOfImagesPerNarrative'],
				produces: [
					'Artifact:ImagePromptGenerator.ImagePrompt[segment=0][image=0]',
				],
				inputBindings: {
					NumOfImagesPerNarrative:
						'Input:ImagePromptGenerator.NumOfImagesPerNarrative',
				},
			},
		};

		const request: ProduceRequest = {
			movieId: 'movie-abc',
			job,
			layerIndex: 0,
			attempt: 1,
			revision: 'rev-0001',
		};

		const result = await produce(request);
		expect(result.status).toBe('succeeded');
		expect(registry.resolve).toHaveBeenCalledTimes(1);
		expect(capturedContext).toBeDefined();

		const extras = capturedContext?.context.extras as
			| Record<string, unknown>
			| undefined;
		expect(extras).toBeDefined();
		const forwarded = (extras?.resolvedInputs ?? {}) as Record<string, unknown>;
		expect(
			forwarded['Input:ImagePromptGenerator.NumOfImagesPerNarrative']
		).toBe(2);

		const jobContext = (extras?.jobContext ?? {}) as {
			inputBindings?: Record<string, string>;
		};
		expect(jobContext.inputBindings?.NumOfImagesPerNarrative).toBe(
			'Input:ImagePromptGenerator.NumOfImagesPerNarrative'
		);
	});
});

describe('injectDerivedSystemInputs', () => {
	describe('SegmentDuration computation', () => {
		it('computes SegmentDuration from Duration and NumOfSegments', () => {
			const inputs = {
				'Input:Duration': 40,
				'Input:NumOfSegments': 5,
			};
			const result = injectDerivedSystemInputs(inputs);
			expect(result['Input:SegmentDuration']).toBe(8);
		});

		it('does not overwrite existing SegmentDuration', () => {
			const inputs = {
				'Input:Duration': 40,
				'Input:NumOfSegments': 5,
				'Input:SegmentDuration': 10, // User override
			};
			const result = injectDerivedSystemInputs(inputs);
			expect(result['Input:SegmentDuration']).toBe(10);
		});

		it('handles missing Duration gracefully', () => {
			const inputs = {
				'Input:NumOfSegments': 5,
			};
			const result = injectDerivedSystemInputs(inputs);
			expect(result['Input:SegmentDuration']).toBeUndefined();
		});

		it('handles missing NumOfSegments gracefully', () => {
			const inputs = {
				'Input:Duration': 40,
			};
			const result = injectDerivedSystemInputs(inputs);
			expect(result['Input:SegmentDuration']).toBeUndefined();
		});

		it('handles zero NumOfSegments gracefully', () => {
			const inputs = {
				'Input:Duration': 40,
				'Input:NumOfSegments': 0,
			};
			const result = injectDerivedSystemInputs(inputs);
			expect(result['Input:SegmentDuration']).toBeUndefined();
		});

		it('handles fractional segment durations', () => {
			const inputs = {
				'Input:Duration': 100,
				'Input:NumOfSegments': 3,
			};
			const result = injectDerivedSystemInputs(inputs);
			expect(result['Input:SegmentDuration']).toBeCloseTo(33.333, 2);
		});
	});

	describe('input preservation', () => {
		it('preserves all existing inputs when computing SegmentDuration', () => {
			const inputs = {
				'Input:Duration': 40,
				'Input:NumOfSegments': 5,
				'Input:SomeOther': 'value',
				'Input:AnotherInput': 123,
			};
			const result = injectDerivedSystemInputs(inputs);
			expect(result['Input:SomeOther']).toBe('value');
			expect(result['Input:AnotherInput']).toBe(123);
			expect(result['Input:Duration']).toBe(40);
			expect(result['Input:NumOfSegments']).toBe(5);
			expect(result['Input:SegmentDuration']).toBe(8);
		});

		it('preserves existing system inputs (MovieId, StorageRoot, StorageBasePath)', () => {
			const inputs = {
				'Input:Duration': 40,
				'Input:NumOfSegments': 5,
				'Input:MovieId': 'movie-123',
				'Input:StorageRoot': '/storage/root',
				'Input:StorageBasePath': 'builds',
			};
			const result = injectDerivedSystemInputs(inputs);
			expect(result['Input:MovieId']).toBe('movie-123');
			expect(result['Input:StorageRoot']).toBe('/storage/root');
			expect(result['Input:StorageBasePath']).toBe('builds');
			expect(result['Input:SegmentDuration']).toBe(8);
		});
	});

	describe('full system input chain simulation', () => {
		/**
		 * This test simulates the full system input injection chain as it happens
		 * in executeBuild:
		 * 1. First, MovieId/StorageRoot/StorageBasePath are injected if not present
		 * 2. Then, injectDerivedSystemInputs adds SegmentDuration
		 */
		it('simulates executeBuild system input injection order', () => {
			// Simulating resolvedInputsWithBlobs (user-provided inputs)
			const resolvedInputsWithBlobs: Record<string, unknown> = {
				'Input:Duration': 60,
				'Input:NumOfSegments': 6,
				'Input:Prompt': 'Test prompt',
			};

			// Simulating the system input injection from executeBuild (lines 139-146)
			const movieId = 'movie-test-123';
			const storageRoot = '/home/user/movies';
			const storageBasePath = 'builds';

			const resolvedInputsWithSystem = {
				...resolvedInputsWithBlobs,
				...(resolvedInputsWithBlobs['Input:MovieId'] === undefined
					? { 'Input:MovieId': movieId }
					: {}),
				...(resolvedInputsWithBlobs['Input:StorageRoot'] === undefined
					? { 'Input:StorageRoot': storageRoot }
					: {}),
				...(resolvedInputsWithBlobs['Input:StorageBasePath'] === undefined
					? { 'Input:StorageBasePath': storageBasePath }
					: {}),
			};

			// Then injectDerivedSystemInputs is called
			const resolvedInputsWithDerived = injectDerivedSystemInputs(resolvedInputsWithSystem);

			// Verify all system inputs are present
			expect(resolvedInputsWithDerived['Input:MovieId']).toBe(movieId);
			expect(resolvedInputsWithDerived['Input:StorageRoot']).toBe(storageRoot);
			expect(resolvedInputsWithDerived['Input:StorageBasePath']).toBe(storageBasePath);
			expect(resolvedInputsWithDerived['Input:SegmentDuration']).toBe(10); // 60/6

			// Verify original inputs are preserved
			expect(resolvedInputsWithDerived['Input:Duration']).toBe(60);
			expect(resolvedInputsWithDerived['Input:NumOfSegments']).toBe(6);
			expect(resolvedInputsWithDerived['Input:Prompt']).toBe('Test prompt');
		});

		it('does not overwrite user-provided system inputs', () => {
			// User explicitly provided MovieId and StorageRoot
			const resolvedInputsWithBlobs: Record<string, unknown> = {
				'Input:Duration': 40,
				'Input:NumOfSegments': 4,
				'Input:MovieId': 'user-movie-id',
				'Input:StorageRoot': '/user/custom/path',
			};

			// Simulating the system input injection (should NOT overwrite)
			const movieId = 'system-movie-id';
			const storageRoot = '/system/default/path';
			const storageBasePath = 'builds';

			const resolvedInputsWithSystem = {
				...resolvedInputsWithBlobs,
				...(resolvedInputsWithBlobs['Input:MovieId'] === undefined
					? { 'Input:MovieId': movieId }
					: {}),
				...(resolvedInputsWithBlobs['Input:StorageRoot'] === undefined
					? { 'Input:StorageRoot': storageRoot }
					: {}),
				...(resolvedInputsWithBlobs['Input:StorageBasePath'] === undefined
					? { 'Input:StorageBasePath': storageBasePath }
					: {}),
			};

			const resolvedInputsWithDerived = injectDerivedSystemInputs(resolvedInputsWithSystem);

			// User-provided values should be preserved
			expect(resolvedInputsWithDerived['Input:MovieId']).toBe('user-movie-id');
			expect(resolvedInputsWithDerived['Input:StorageRoot']).toBe('/user/custom/path');
			// StorageBasePath was not provided by user, so system value is used
			expect(resolvedInputsWithDerived['Input:StorageBasePath']).toBe(storageBasePath);
			expect(resolvedInputsWithDerived['Input:SegmentDuration']).toBe(10); // 40/4
		});
	});
});
