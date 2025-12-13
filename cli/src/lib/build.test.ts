import { describe, expect, it, vi } from 'vitest';
import { createProviderProduce } from './build.js';
import type { LoadedProducerOption } from './producer-options.js';
import type {
	ProviderRegistry,
	ProducerHandler,
	ProviderJobContext,
} from '@renku/providers';
import type { ProduceRequest, JobDescriptor } from '@renku/core';
import { createCliLogger } from './logger.js';

describe('createProviderProduce', () => {
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
