import { describe, expect, it } from 'vitest';
import {
	calculateCost,
	estimatePlanCosts,
	extractCostInputs,
	lookupModelPrice,
	type ExtractedCostInputs,
	type ModelPriceConfig,
	type PricingCatalog,
} from './cost-functions.js';
import type { ExecutionPlan, JobDescriptor } from '@gorenku/core';

describe('calculateCost', () => {
	describe('flat pricing', () => {
		it('returns flat price when config is a number', () => {
			const result = calculateCost(0, { values: {}, artefactSourcedFields: [], missingFields: [] });
			expect(result.cost).toBe(0);
			expect(result.isPlaceholder).toBe(false);
		});

		it('returns flat price for non-zero values', () => {
			const result = calculateCost(0.05, { values: {}, artefactSourcedFields: [], missingFields: [] });
			expect(result.cost).toBe(0.05);
			expect(result.isPlaceholder).toBe(false);
		});
	});

	describe('costByInputTokens', () => {
		it('calculates cost based on token count', () => {
			const config: ModelPriceConfig = {
				function: 'costByInputTokens',
				inputs: ['text'],
				pricePerToken: 0.0001,
			};
			const extracted: ExtractedCostInputs = {
				values: { text: 'Hello world' }, // 11 chars = ~3 tokens
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBeCloseTo(0.0003, 4);
			expect(result.isPlaceholder).toBe(false);
		});

		it('returns placeholder when no text value found', () => {
			const config: ModelPriceConfig = {
				function: 'costByInputTokens',
				inputs: ['text'],
				pricePerToken: 0.0001,
			};
			const result = calculateCost(config, { values: {}, artefactSourcedFields: [], missingFields: ['text'] });
			expect(result.cost).toBe(0);
			expect(result.isPlaceholder).toBe(true);
		});

		it('returns range when text comes from artefact', () => {
			const config: ModelPriceConfig = {
				function: 'costByInputTokens',
				inputs: ['text'],
				pricePerToken: 0.0001,
			};
			const extracted: ExtractedCostInputs = {
				values: {},
				artefactSourcedFields: ['text'],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.isPlaceholder).toBe(true);
			expect(result.range).toBeDefined();
			expect(result.range!.min).toBeCloseTo(0.0025, 4); // 25 tokens * 0.0001
			expect(result.range!.max).toBeCloseTo(0.025, 4);  // 250 tokens * 0.0001
			expect(result.range!.samples).toHaveLength(3);
		});
	});

	describe('costByRun', () => {
		it('returns flat price per run', () => {
			const config: ModelPriceConfig = {
				function: 'costByRun',
				price: 0.05,
			};
			const result = calculateCost(config, { values: {}, artefactSourcedFields: [], missingFields: [] });
			expect(result.cost).toBe(0.05);
			expect(result.isPlaceholder).toBe(false);
		});

		it('returns placeholder when price is missing', () => {
			const config: ModelPriceConfig = {
				function: 'costByRun',
			};
			const result = calculateCost(config, { values: {}, artefactSourcedFields: [], missingFields: [] });
			expect(result.cost).toBe(0);
			expect(result.isPlaceholder).toBe(true);
		});
	});

	describe('costByCharacters', () => {
		it('calculates cost based on character count', () => {
			const config: ModelPriceConfig = {
				function: 'costByCharacters',
				inputs: ['text'],
				pricePerCharacter: 0.0001,
			};
			const extracted: ExtractedCostInputs = {
				values: { text: 'Hello world' }, // 11 characters
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBeCloseTo(0.0011, 4);
			expect(result.isPlaceholder).toBe(false);
		});

		it('returns placeholder when no text value found', () => {
			const config: ModelPriceConfig = {
				function: 'costByCharacters',
				inputs: ['text'],
				pricePerCharacter: 0.0001,
			};
			const result = calculateCost(config, { values: {}, artefactSourcedFields: [], missingFields: ['text'] });
			expect(result.cost).toBe(0);
			expect(result.isPlaceholder).toBe(true);
		});

		it('returns range when text comes from artefact', () => {
			const config: ModelPriceConfig = {
				function: 'costByCharacters',
				inputs: ['text'],
				pricePerCharacter: 0.0001,
			};
			const extracted: ExtractedCostInputs = {
				values: {},
				artefactSourcedFields: ['text'],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.isPlaceholder).toBe(true);
			expect(result.range).toBeDefined();
			// 100-1000 character range
			expect(result.range!.min).toBeCloseTo(0.01, 4);
			expect(result.range!.max).toBeCloseTo(0.1, 4);
		});
	});

	describe('costByAudioSeconds', () => {
		it('calculates cost based on audio duration', () => {
			const config: ModelPriceConfig = {
				function: 'costByAudioSeconds',
				inputs: ['duration'],
				pricePerSecond: 0.01,
			};
			const extracted: ExtractedCostInputs = {
				values: { duration: 30 },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0.30);
			expect(result.isPlaceholder).toBe(false);
		});

		it('returns placeholder when duration is missing', () => {
			const config: ModelPriceConfig = {
				function: 'costByAudioSeconds',
				inputs: ['duration'],
				pricePerSecond: 0.01,
			};
			const result = calculateCost(config, { values: {}, artefactSourcedFields: [], missingFields: ['duration'] });
			expect(result.cost).toBe(0);
			expect(result.isPlaceholder).toBe(true);
		});
	});

	describe('costByImageSizeAndQuality', () => {
		it('returns price for matching size and quality', () => {
			const config: ModelPriceConfig = {
				function: 'costByImageSizeAndQuality',
				inputs: ['image_size', 'quality', 'num_images'],
				prices: [
					{ image_size: 'square_hd', quality: 'standard', pricePerImage: 0.04 },
					{ image_size: 'square_hd', quality: 'hd', pricePerImage: 0.08 },
					{ image_size: 'landscape_4_3', quality: 'standard', pricePerImage: 0.04 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { image_size: 'square_hd', quality: 'hd', num_images: 2 },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0.16); // 0.08 * 2
			expect(result.isPlaceholder).toBe(false);
		});

		it('uses default num_images when not provided', () => {
			const config: ModelPriceConfig = {
				function: 'costByImageSizeAndQuality',
				inputs: ['image_size', 'quality'],
				prices: [
					{ image_size: 'square_hd', quality: 'standard', pricePerImage: 0.04 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { image_size: 'square_hd', quality: 'standard' },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0.04); // default num_images = 1
		});

		it('returns placeholder when size/quality not found', () => {
			const config: ModelPriceConfig = {
				function: 'costByImageSizeAndQuality',
				inputs: ['image_size', 'quality'],
				prices: [
					{ image_size: 'square_hd', quality: 'standard', pricePerImage: 0.04 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { image_size: 'unknown_size', quality: 'unknown_quality' },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.isPlaceholder).toBe(true);
		});
	});

	describe('costByVideoPerMillionTokens', () => {
		it('calculates cost based on video tokens', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoPerMillionTokens',
				inputs: ['duration', 'resolution', 'aspect_ratio'],
				pricePerMillionTokens: 1.3,
			};
			const extracted: ExtractedCostInputs = {
				values: { duration: 5, resolution: '720p', aspect_ratio: '16:9' },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			// 1280x720 * 5s * 30fps / 1024 = ~135000 tokens
			// 135000 / 1000000 * 1.3 ≈ 0.1755
			expect(result.cost).toBeGreaterThan(0);
			expect(result.isPlaceholder).toBe(false);
		});

		it('returns placeholder when duration is missing', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoPerMillionTokens',
				inputs: ['duration', 'resolution', 'aspect_ratio'],
				pricePerMillionTokens: 1.3,
			};
			const extracted: ExtractedCostInputs = {
				values: { resolution: '720p', aspect_ratio: '16:9' },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0);
			expect(result.isPlaceholder).toBe(true);
		});
	});

	describe('costByImageAndResolution', () => {
		it('returns price for matching resolution', () => {
			const config: ModelPriceConfig = {
				function: 'costByImageAndResolution',
				inputs: ['resolution'],
				prices: [
					{ resolution: '1K', pricePerImage: 0.15 },
					{ resolution: '4K', pricePerImage: 0.30 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { resolution: '4K' },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0.30);
			expect(result.isPlaceholder).toBe(false);
		});

		it('normalizes resolution strings', () => {
			const config: ModelPriceConfig = {
				function: 'costByImageAndResolution',
				inputs: ['resolution'],
				prices: [
					{ resolution: '1K', pricePerImage: 0.15 },
					{ resolution: '4K', pricePerImage: 0.30 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { resolution: '4k' },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0.30);
		});

		it('uses fallback for unknown resolution', () => {
			const config: ModelPriceConfig = {
				function: 'costByImageAndResolution',
				inputs: ['resolution'],
				prices: [
					{ resolution: '1K', pricePerImage: 0.15 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { resolution: '8K' },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0.15);
			expect(result.isPlaceholder).toBe(true);
		});

		it('returns range when resolution comes from artefact', () => {
			const config: ModelPriceConfig = {
				function: 'costByImageAndResolution',
				inputs: ['resolution'],
				prices: [
					{ resolution: '1K', pricePerImage: 0.15 },
					{ resolution: '4K', pricePerImage: 0.30 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: {},
				artefactSourcedFields: ['resolution'],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.isPlaceholder).toBe(true);
			expect(result.range).toBeDefined();
			expect(result.range!.min).toBe(0.15);
			expect(result.range!.max).toBe(0.30);
		});
	});

	describe('costByResolution', () => {
		it('categorizes by dimensions', () => {
			const config: ModelPriceConfig = {
				function: 'costByResolution',
				inputs: ['width', 'height'],
				prices: [
					{ resolution: '0.5K', pricePerImage: 0.0025 },
					{ resolution: '1K', pricePerImage: 0.005 },
					{ resolution: '2K', pricePerImage: 0.01 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { width: 1024, height: 1024 },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0.005);
			expect(result.isPlaceholder).toBe(false);
		});

		it('uses default dimensions when not provided', () => {
			const config: ModelPriceConfig = {
				function: 'costByResolution',
				prices: [
					{ resolution: '1K', pricePerImage: 0.005 },
				],
			};
			const result = calculateCost(config, { values: {}, artefactSourcedFields: [], missingFields: [] });
			expect(result.cost).toBe(0.005);
		});
	});

	describe('costByVideoDuration', () => {
		it('calculates cost based on duration', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDuration',
				inputs: ['duration'],
				pricePerSecond: 0.10,
			};
			const extracted: ExtractedCostInputs = {
				values: { duration: 10 },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(1.0);
			expect(result.isPlaceholder).toBe(false);
		});

		it('parses duration from string with "s" suffix', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDuration',
				inputs: ['duration'],
				pricePerSecond: 0.10,
			};
			const extracted: ExtractedCostInputs = {
				values: { duration: '5s' },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0.5);
			expect(result.isPlaceholder).toBe(false);
		});

		it('returns placeholder when duration is missing', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDuration',
				pricePerSecond: 0.10,
			};
			const result = calculateCost(config, { values: {}, artefactSourcedFields: [], missingFields: [] });
			expect(result.cost).toBe(0);
			expect(result.isPlaceholder).toBe(true);
			expect(result.note).toBe('Missing duration, cannot calculate');
		});

		it('returns range when duration is provided with artefact-sourced fields', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDuration',
				inputs: ['duration'],
				pricePerSecond: 0.10,
			};
			const extracted: ExtractedCostInputs = {
				values: { duration: 10 },
				artefactSourcedFields: ['other_field'],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(1.0);  // 10s * 0.10
			expect(result.isPlaceholder).toBe(true);
			expect(result.range).toBeDefined();
			expect(result.range!.min).toBe(0.5);  // 5s * 0.10
			expect(result.range!.max).toBe(3.0);  // 30s * 0.10
		});

		it('returns placeholder when duration comes from artefact without value', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDuration',
				inputs: ['duration'],
				pricePerSecond: 0.10,
			};
			const extracted: ExtractedCostInputs = {
				values: {},
				artefactSourcedFields: ['duration'],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0);
			expect(result.isPlaceholder).toBe(true);
			expect(result.note).toBe('Missing duration, cannot calculate');
		});
	});

	describe('costByVideoDurationAndResolution', () => {
		it('calculates cost based on duration and resolution', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDurationAndResolution',
				inputs: ['duration', 'resolution'],
				prices: [
					{ resolution: '480p', pricePerSecond: 0.015 },
					{ resolution: '720p', pricePerSecond: 0.025 },
					{ resolution: '1080p', pricePerSecond: 0.06 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { duration: 10, resolution: '720p' },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0.25);
			expect(result.isPlaceholder).toBe(false);
		});

		it('normalizes resolution with "p" suffix', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDurationAndResolution',
				inputs: ['duration', 'resolution'],
				prices: [
					{ resolution: '1080p', pricePerSecond: 0.06 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { duration: 5, resolution: '1080' },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0.30);
		});

		it('parses duration from string with "s" suffix', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDurationAndResolution',
				inputs: ['duration', 'resolution'],
				prices: [
					{ resolution: '720p', pricePerSecond: 0.025 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { duration: '10s', resolution: '720p' },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0.25);
			expect(result.isPlaceholder).toBe(false);
		});

		it('returns placeholder when duration is missing', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDurationAndResolution',
				inputs: ['duration', 'resolution'],
				prices: [
					{ resolution: '720p', pricePerSecond: 0.025 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { resolution: '720p' },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0);
			expect(result.isPlaceholder).toBe(true);
			expect(result.note).toBe('Missing duration, cannot calculate');
		});
	});

	describe('costByVideoDurationAndWithAudio', () => {
		it('uses higher price when audio is enabled', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDurationAndWithAudio',
				inputs: ['duration', 'generate_audio'],
				prices: [
					{ generate_audio: true, pricePerSecond: 0.15 },
					{ generate_audio: false, pricePerSecond: 0.10 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { duration: 10, generate_audio: true },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(1.5);
			expect(result.isPlaceholder).toBe(false);
		});

		it('uses lower price when audio is disabled', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDurationAndWithAudio',
				inputs: ['duration', 'generate_audio'],
				prices: [
					{ generate_audio: true, pricePerSecond: 0.15 },
					{ generate_audio: false, pricePerSecond: 0.10 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { duration: 10, generate_audio: false },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(1.0);
		});

		it('parses duration from string with "s" suffix', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDurationAndWithAudio',
				inputs: ['duration', 'generate_audio'],
				prices: [
					{ generate_audio: true, pricePerSecond: 0.15 },
					{ generate_audio: false, pricePerSecond: 0.10 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { duration: '5s', generate_audio: true },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0.75);
			expect(result.isPlaceholder).toBe(false);
		});

		it('returns placeholder when duration is missing', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDurationAndWithAudio',
				inputs: ['duration', 'generate_audio'],
				prices: [
					{ generate_audio: true, pricePerSecond: 0.15 },
					{ generate_audio: false, pricePerSecond: 0.10 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { generate_audio: true },
				artefactSourcedFields: [],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0);
			expect(result.isPlaceholder).toBe(true);
			expect(result.note).toBe('Missing duration, cannot calculate');
		});

		it('returns placeholder when duration comes from artefact without value', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDurationAndWithAudio',
				inputs: ['duration', 'generate_audio'],
				prices: [
					{ generate_audio: true, pricePerSecond: 0.15 },
					{ generate_audio: false, pricePerSecond: 0.10 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: {},
				artefactSourcedFields: ['duration'],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.cost).toBe(0);
			expect(result.isPlaceholder).toBe(true);
			expect(result.note).toBe('Missing duration, cannot calculate');
		});

		it('calculates range when duration is provided and artefact-sourced fields exist', () => {
			const config: ModelPriceConfig = {
				function: 'costByVideoDurationAndWithAudio',
				inputs: ['duration', 'generate_audio'],
				prices: [
					{ generate_audio: true, pricePerSecond: 0.15 },
					{ generate_audio: false, pricePerSecond: 0.10 },
				],
			};
			const extracted: ExtractedCostInputs = {
				values: { duration: 10 },
				artefactSourcedFields: ['generate_audio'],
				missingFields: [],
			};
			const result = calculateCost(config, extracted);
			expect(result.isPlaceholder).toBe(true);
			expect(result.range).toBeDefined();
			expect(result.range!.min).toBe(1.0);  // 10s * 0.10
			expect(result.range!.max).toBe(1.5);  // 10s * 0.15
		});
	});

	describe('unknown function', () => {
		it('returns placeholder for unknown function', () => {
			const config = {
				function: 'unknownFunction' as ModelPriceConfig['function'],
			};
			const result = calculateCost(config, { values: {}, artefactSourcedFields: [], missingFields: [] });
			expect(result.cost).toBe(0);
			expect(result.isPlaceholder).toBe(true);
			expect(result.note).toContain('Unknown cost function');
		});
	});
});

describe('extractCostInputs', () => {
	it('extracts values using sdkMapping and inputBindings', () => {
		const job: JobDescriptor = {
			jobId: 'job-1',
			producer: 'AudioProducer',
			inputs: [],
			produces: [],
			provider: 'replicate',
			providerModel: 'minimax/speech-2.6-hd',
			rateKey: 'audio',
			context: {
				namespacePath: [],
				indices: {},
				producerAlias: 'AudioProducer',
				inputs: [],
				produces: [],
				sdkMapping: {
					TextInput: { field: 'text' },
					VoiceId: { field: 'voice_id' },
				},
				inputBindings: {
					TextInput: 'Input:SegmentText',
					VoiceId: 'Input:Voice',
				},
			},
		};
		const resolvedInputs = {
			'Input:SegmentText': 'Hello world',
			'Input:Voice': 'narrator',
		};

		const result = extractCostInputs(job, resolvedInputs, ['text', 'voice_id']);

		expect(result.values).toEqual({ text: 'Hello world', voice_id: 'narrator' });
		expect(result.artefactSourcedFields).toEqual([]);
		expect(result.missingFields).toEqual([]);
	});

	it('detects artefact-sourced fields', () => {
		const job: JobDescriptor = {
			jobId: 'job-1',
			producer: 'AudioProducer',
			inputs: [],
			produces: [],
			provider: 'replicate',
			providerModel: 'minimax/speech-2.6-hd',
			rateKey: 'audio',
			context: {
				namespacePath: [],
				indices: {},
				producerAlias: 'AudioProducer',
				inputs: [],
				produces: [],
				sdkMapping: {
					TextInput: { field: 'text' },
				},
				inputBindings: {
					TextInput: 'Artifact:NarrativeSegment.0.SegmentText',
				},
			},
		};

		const result = extractCostInputs(job, {}, ['text']);

		expect(result.values).toEqual({});
		expect(result.artefactSourcedFields).toEqual(['text']);
		expect(result.missingFields).toEqual([]);
	});

	it('tracks missing fields when mapping not found', () => {
		const job: JobDescriptor = {
			jobId: 'job-1',
			producer: 'SomeProducer',
			inputs: [],
			produces: [],
			provider: 'provider',
			providerModel: 'model',
			rateKey: 'key',
			context: {
				namespacePath: [],
				indices: {},
				producerAlias: 'SomeProducer',
				inputs: [],
				produces: [],
				sdkMapping: {},
				inputBindings: {},
			},
		};

		const result = extractCostInputs(job, {}, ['nonexistent_field']);

		expect(result.values).toEqual({});
		expect(result.artefactSourcedFields).toEqual([]);
		expect(result.missingFields).toEqual(['nonexistent_field']);
	});
});

describe('lookupModelPrice', () => {
	it('returns price config for existing provider and model', () => {
		const catalog: PricingCatalog = {
			providers: new Map([
				['replicate', new Map([
					['bytedance/seedream-4', { function: 'costByRun' as const, price: 0.03 }],
				])],
			]),
		};
		const result = lookupModelPrice(catalog, 'replicate', 'bytedance/seedream-4');
		expect(result).toEqual({ function: 'costByRun', price: 0.03 });
	});

	it('returns null for missing provider', () => {
		const catalog: PricingCatalog = { providers: new Map() };
		const result = lookupModelPrice(catalog, 'unknown', 'model');
		expect(result).toBeNull();
	});

	it('returns null for missing model', () => {
		const catalog: PricingCatalog = {
			providers: new Map([
				['replicate', new Map()],
			]),
		};
		const result = lookupModelPrice(catalog, 'replicate', 'unknown-model');
		expect(result).toBeNull();
	});
});

describe('estimatePlanCosts', () => {
	const createMockPlan = (jobs: Partial<JobDescriptor>[]): ExecutionPlan => ({
		revision: 'rev-0001' as const,
		manifestBaseHash: 'hash123',
		layers: [jobs.map((j, i) => ({
			jobId: j.jobId ?? `job-${i}`,
			producer: j.producer ?? 'TestProducer',
			inputs: j.inputs ?? [],
			produces: j.produces ?? [],
			provider: j.provider ?? 'replicate',
			providerModel: j.providerModel ?? 'test-model',
			rateKey: j.rateKey ?? 'test',
			context: j.context,
		}))],
		createdAt: new Date().toISOString(),
	});

	it('calculates total cost for multiple jobs', () => {
		const catalog: PricingCatalog = {
			providers: new Map([
				['replicate', new Map([
					['image-model', { function: 'costByRun' as const, price: 0.04 }],
				])],
			]),
		};
		const plan = createMockPlan([
			{ provider: 'replicate', providerModel: 'image-model' },
			{ provider: 'replicate', providerModel: 'image-model' },
		]);
		const summary = estimatePlanCosts(plan, catalog, {});
		expect(summary.totalCost).toBe(0.08);
		expect(summary.hasPlaceholders).toBe(false);
	});

	it('aggregates by producer', () => {
		const catalog: PricingCatalog = {
			providers: new Map([
				['replicate', new Map([
					['image-model', { function: 'costByRun' as const, price: 0.04 }],
				])],
			]),
		};
		const plan = createMockPlan([
			{ producer: 'ImageProducer', provider: 'replicate', providerModel: 'image-model' },
			{ producer: 'ImageProducer', provider: 'replicate', providerModel: 'image-model' },
			{ producer: 'OtherImageProducer', provider: 'replicate', providerModel: 'image-model' },
		]);
		const summary = estimatePlanCosts(plan, catalog, {});

		const imageData = summary.byProducer.get('ImageProducer');
		expect(imageData?.count).toBe(2);
		expect(imageData?.totalCost).toBe(0.08);

		const otherData = summary.byProducer.get('OtherImageProducer');
		expect(otherData?.count).toBe(1);
		expect(otherData?.totalCost).toBe(0.04);
	});

	it('tracks missing providers', () => {
		const catalog: PricingCatalog = { providers: new Map() };
		const plan = createMockPlan([
			{ provider: 'unknown-provider', providerModel: 'model' },
		]);
		const summary = estimatePlanCosts(plan, catalog, {});
		expect(summary.missingProviders).toContain('unknown-provider');
		expect(summary.hasPlaceholders).toBe(true);
	});

	it('tracks missing models within existing providers', () => {
		const catalog: PricingCatalog = {
			providers: new Map([
				['replicate', new Map([
					['known-model', { function: 'costByRun' as const, price: 0.04 }],
				])],
			]),
		};
		const plan = createMockPlan([
			{ provider: 'replicate', providerModel: 'unknown-model' },
		]);
		const summary = estimatePlanCosts(plan, catalog, {});
		expect(summary.missingProviders).toContain('replicate:unknown-model');
		expect(summary.hasPlaceholders).toBe(true);
	});

	it('handles internal producers with zero cost', () => {
		const catalog: PricingCatalog = {
			providers: new Map([
				['renku', new Map([
					['OrderedTimeline', 0],
					['Mp4Exporter', 0],
				])],
			]),
		};
		const plan = createMockPlan([
			{ producer: 'TimelineComposer', provider: 'renku', providerModel: 'OrderedTimeline' },
			{ producer: 'VideoExporter', provider: 'renku', providerModel: 'Mp4Exporter' },
		]);
		const summary = estimatePlanCosts(plan, catalog, {});
		expect(summary.totalCost).toBe(0);
		expect(summary.hasPlaceholders).toBe(false);
	});

	it('calculates min/max totals when ranges are present', () => {
		const catalog: PricingCatalog = {
			providers: new Map([
				['replicate', new Map([
					['speech-model', {
						function: 'costByInputTokens' as const,
						inputs: ['text'],
						pricePerToken: 0.0001,
					}],
				])],
			]),
		};
		const plan = createMockPlan([
			{
				producer: 'AudioProducer',
				provider: 'replicate',
				providerModel: 'speech-model',
				context: {
					namespacePath: [],
					indices: {},
					producerAlias: 'AudioProducer',
					inputs: [],
					produces: [],
					sdkMapping: { TextInput: { field: 'text' } },
					inputBindings: { TextInput: 'Artifact:SomeText' },
				},
			},
		]);
		const summary = estimatePlanCosts(plan, catalog, {});

		expect(summary.hasRanges).toBe(true);
		expect(summary.minTotalCost).toBeCloseTo(0.0025, 4); // 25 tokens * 0.0001
		expect(summary.maxTotalCost).toBeCloseTo(0.025, 4);  // 250 tokens * 0.0001
	});
});
