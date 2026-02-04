import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ExecutionPlan, JobDescriptor, BlueprintProducerSdkMappingField } from '@gorenku/core';

// ============================================================================
// Types
// ============================================================================

/**
 * Cost range for when exact cost cannot be determined (e.g., artefact-sourced inputs).
 */
export interface CostRange {
	min: number;
	max: number;
	samples: Array<{ label: string; cost: number }>;
}

/**
 * Result of a cost calculation.
 */
export interface CostEstimate {
	/** Estimated cost in USD */
	cost: number;
	/** Whether the estimate is valid or a placeholder */
	isPlaceholder: boolean;
	/** Human-readable explanation */
	note?: string;
	/** Cost range when exact cost cannot be determined */
	range?: CostRange;
}

/**
 * Extracted cost inputs from job context using schema-driven approach.
 */
export interface ExtractedCostInputs {
	/** Values keyed by provider field name (from pricing config's inputs array) */
	values: Record<string, unknown>;
	/** Provider field names where value comes from an artefact (not available at planning time) */
	artefactSourcedFields: string[];
	/** Provider field names where value is missing */
	missingFields: string[];
}

/**
 * Supported cost function names.
 */
export type CostFunctionName =
	| 'costByInputTokens'
	| 'costByImageAndResolution'
	| 'costByResolution'
	| 'costByVideoDuration'
	| 'costByVideoDurationAndResolution'
	| 'costByVideoDurationAndWithAudio'
	| 'costByRun'
	| 'costByCharacters'
	| 'costByCharactersAndPlan'
	| 'costByAudioSeconds'
	| 'costByImageSizeAndQuality'
	| 'costByVideoPerMillionTokens'
	| 'costByVideoMegapixels'
	| 'costByImageMegapixels';

/**
 * Price entry for resolution-based pricing.
 */
export interface ResolutionPriceEntry {
	resolution: string;
	pricePerSecond?: number;
	pricePerImage?: number;
}

/**
 * Price entry for audio flag pricing.
 */
export interface AudioFlagPriceEntry {
	generate_audio: boolean;
	pricePerSecond: number;
}

/**
 * Price entry for image size and quality based pricing.
 */
export interface ImageSizeQualityPriceEntry {
	quality: string;
	image_size: string;
	pricePerImage: number;
}

/**
 * Price entry for video token-based pricing.
 */
export interface VideoTokenPriceEntry {
	pricePerMillionTokens: number;
}

/**
 * Price entry for video token-based pricing with audio flag.
 */
export interface VideoTokenAudioPriceEntry {
	generate_audio: boolean;
	pricePerMillionTokens: number;
}

/**
 * Pricing configuration for a model.
 */
export interface ModelPriceConfig {
	function: CostFunctionName;
	inputs?: string[];
	price?: number;
	pricePerToken?: number;
	pricePerImage?: number;
	pricePerSecond?: number;
	pricePerCharacter?: number;
	pricePerMillionTokens?: number;
	pricePerMegapixel?: number;
	prices?: Array<ResolutionPriceEntry | AudioFlagPriceEntry | ImageSizeQualityPriceEntry | VideoTokenPriceEntry>;
	// Plan-based pricing for ElevenLabs
	pricePerCharByPlan?: Record<string, number>;
	defaultPlan?: string;
}

/**
 * Model entry in pricing YAML.
 */
export interface PricingModelEntry {
	name: string;
	price: ModelPriceConfig | number;
}

/**
 * Pricing data from a YAML file.
 */
export interface ProviderPricingData {
	models: PricingModelEntry[];
}

/**
 * Aggregated pricing catalog.
 */
export interface PricingCatalog {
	providers: Map<string, Map<string, ModelPriceConfig | number>>;
}

/**
 * Cost estimate for a single job.
 */
export interface JobCostEstimate {
	jobId: string;
	producer: string;
	provider: string;
	model: string;
	estimate: CostEstimate;
}

/**
 * Aggregated producer cost data.
 */
export interface ProducerCostData {
	count: number;
	totalCost: number;
	hasPlaceholders: boolean;
	hasRanges: boolean;
	minCost: number;
	maxCost: number;
}

/**
 * Summary of costs for an entire plan.
 */
export interface PlanCostSummary {
	jobs: JobCostEstimate[];
	byProducer: Map<string, ProducerCostData>;
	totalCost: number;
	hasPlaceholders: boolean;
	hasRanges: boolean;
	minTotalCost: number;
	maxTotalCost: number;
	missingProviders: string[];
}

// ============================================================================
// Cost Calculation Functions
// ============================================================================

/**
 * Estimate token count from text (~4 characters per token).
 */
function estimateTokenCount(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Normalize resolution string to standard format.
 */
function normalizeResolution(resolution: string | undefined): string {
	if (!resolution) {
		return '1K';
	}
	const lower = resolution.toLowerCase();
	if (lower.includes('480')) {
		return '480p';
	}
	if (lower.includes('720')) {
		return '720p';
	}
	if (lower.includes('1080')) {
		return '1080p';
	}
	if (lower.includes('4k') || lower.includes('2160')) {
		return '4K';
	}
	if (lower.includes('2k') || lower.includes('1440')) {
		return '2K';
	}
	if (lower.includes('0.5k') || lower.includes('512')) {
		return '0.5K';
	}
	return resolution;
}

/**
 * Categorize resolution by pixel dimensions.
 */
function categorizeByDimensions(width: number, height: number): string {
	const maxDim = Math.max(width, height);
	if (maxDim <= 512) {
		return '0.5K';
	}
	if (maxDim <= 1024) {
		return '1K';
	}
	if (maxDim <= 2048) {
		return '2K';
	}
	return '4K';
}

function costByInputTokens(
	config: ModelPriceConfig,
	extracted: ExtractedCostInputs
): CostEstimate {
	const pricePerToken = config.pricePerToken;
	if (pricePerToken === undefined) {
		return {
			cost: 0,
			isPlaceholder: true,
			note: 'Missing pricePerToken in config',
		};
	}

	// Check if any required field comes from artefact
	if (extracted.artefactSourcedFields.length > 0) {
		const samples = [
			{ label: '100 chars', cost: 25 * pricePerToken },
			{ label: '500 chars', cost: 125 * pricePerToken },
			{ label: '1000 chars', cost: 250 * pricePerToken },
		];
		return {
			cost: samples[1].cost,
			isPlaceholder: true,
			note: `Input from artefact: ${extracted.artefactSourcedFields.join(', ')}`,
			range: {
				min: samples[0].cost,
				max: samples[2].cost,
				samples,
			},
		};
	}

	// Get the text value - first field from inputs array
	const textField = config.inputs?.[0];
	const text = textField ? extracted.values[textField] : undefined;

	if (typeof text !== 'string' || text.length === 0) {
		return {
			cost: 0,
			isPlaceholder: true,
			note: 'No text value found',
		};
	}

	const tokens = estimateTokenCount(text);
	return { cost: tokens * pricePerToken, isPlaceholder: false };
}

function costByImageAndResolution(
	config: ModelPriceConfig,
	extracted: ExtractedCostInputs
): CostEstimate {
	const prices = config.prices as ResolutionPriceEntry[] | undefined;
	if (!prices || prices.length === 0) {
		return { cost: 0, isPlaceholder: true, note: 'Missing resolution prices' };
	}

	// Check for artefact-sourced resolution
	if (extracted.artefactSourcedFields.length > 0) {
		const minPrice = Math.min(...prices.map(p => p.pricePerImage ?? 0));
		const maxPrice = Math.max(...prices.map(p => p.pricePerImage ?? 0));
		return {
			cost: (minPrice + maxPrice) / 2,
			isPlaceholder: true,
			note: `Resolution from artefact: ${extracted.artefactSourcedFields.join(', ')}`,
			range: {
				min: minPrice,
				max: maxPrice,
				samples: prices.map(p => ({ label: p.resolution, cost: p.pricePerImage ?? 0 })),
			},
		};
	}

	// Get resolution from first field in inputs array
	const resField = config.inputs?.[0];
	const resValue = resField ? extracted.values[resField] : undefined;
	const resolution = normalizeResolution(resValue as string | undefined);

	const match = prices.find((p) => p.resolution === resolution);
	if (!match || match.pricePerImage === undefined) {
		const fallback = prices[0];
		return {
			cost: fallback?.pricePerImage ?? 0,
			isPlaceholder: true,
			note: `No price for resolution ${resolution}, using fallback`,
		};
	}
	return { cost: match.pricePerImage, isPlaceholder: false };
}

function costByResolution(
	config: ModelPriceConfig,
	extracted: ExtractedCostInputs
): CostEstimate {
	const prices = config.prices as ResolutionPriceEntry[] | undefined;
	if (!prices || prices.length === 0) {
		return { cost: 0, isPlaceholder: true, note: 'Missing resolution prices' };
	}

	// Check for artefact-sourced dimensions
	if (extracted.artefactSourcedFields.length > 0) {
		const minPrice = Math.min(...prices.map(p => p.pricePerImage ?? 0));
		const maxPrice = Math.max(...prices.map(p => p.pricePerImage ?? 0));
		return {
			cost: (minPrice + maxPrice) / 2,
			isPlaceholder: true,
			note: `Dimensions from artefact: ${extracted.artefactSourcedFields.join(', ')}`,
			range: {
				min: minPrice,
				max: maxPrice,
				samples: prices.map(p => ({ label: p.resolution, cost: p.pricePerImage ?? 0 })),
			},
		};
	}

	// Get width and height from inputs array
	const inputs = config.inputs ?? [];
	const widthField = inputs[0];
	const heightField = inputs[1];
	const width = widthField ? Number(extracted.values[widthField]) : 1024;
	const height = heightField ? Number(extracted.values[heightField]) : 1024;

	const category = categorizeByDimensions(
		Number.isFinite(width) ? width : 1024,
		Number.isFinite(height) ? height : 1024
	);
	const match = prices.find((p) => p.resolution === category);
	if (!match || match.pricePerImage === undefined) {
		const fallback = prices[0];
		return {
			cost: fallback?.pricePerImage ?? 0,
			isPlaceholder: true,
			note: `No price for dimensions ${width}x${height}`,
		};
	}
	return { cost: match.pricePerImage, isPlaceholder: false };
}

function costByVideoDuration(
	config: ModelPriceConfig,
	extracted: ExtractedCostInputs
): CostEstimate {
	const pricePerSecond = config.pricePerSecond;
	if (pricePerSecond === undefined) {
		return { cost: 0, isPlaceholder: true, note: 'Missing pricePerSecond' };
	}

	// Get duration from first field in inputs array
	const durationField = config.inputs?.[0];
	const durationValue = durationField ? extracted.values[durationField] : undefined;
	const duration = parseDurationValue(durationValue);

	// Check for artefact-sourced duration
	if (extracted.artefactSourcedFields.length > 0) {
		if (duration === undefined) {
			return { cost: 0, isPlaceholder: true, note: 'Missing duration, cannot calculate' };
		}
		const samples = [
			{ label: '5s', cost: 5 * pricePerSecond },
			{ label: '10s', cost: 10 * pricePerSecond },
			{ label: '30s', cost: 30 * pricePerSecond },
		];
		return {
			cost: duration * pricePerSecond,
			isPlaceholder: true,
			note: `Duration from artefact: ${extracted.artefactSourcedFields.join(', ')}`,
			range: {
				min: samples[0].cost,
				max: samples[2].cost,
				samples,
			},
		};
	}

	if (duration === undefined) {
		return { cost: 0, isPlaceholder: true, note: 'Missing duration, cannot calculate' };
	}

	return { cost: duration * pricePerSecond, isPlaceholder: false };
}

function costByVideoDurationAndResolution(
	config: ModelPriceConfig,
	extracted: ExtractedCostInputs
): CostEstimate {
	const prices = config.prices as ResolutionPriceEntry[] | undefined;
	if (!prices || prices.length === 0) {
		return { cost: 0, isPlaceholder: true, note: 'Missing resolution prices' };
	}

	const inputs = config.inputs ?? [];
	const durationField = inputs[0];
	const resolutionField = inputs[1];

	const durationValue = durationField ? extracted.values[durationField] : undefined;
	const duration = parseDurationValue(durationValue);

	// Check for artefact-sourced inputs
	if (extracted.artefactSourcedFields.length > 0) {
		if (duration === undefined) {
			return { cost: 0, isPlaceholder: true, note: 'Missing duration, cannot calculate' };
		}
		const minRate = Math.min(...prices.map(p => p.pricePerSecond ?? 0));
		const maxRate = Math.max(...prices.map(p => p.pricePerSecond ?? 0));
		return {
			cost: duration * (minRate + maxRate) / 2,
			isPlaceholder: true,
			note: `Some inputs from artefact: ${extracted.artefactSourcedFields.join(', ')}`,
			range: {
				min: duration * minRate,
				max: duration * maxRate,
				samples: prices.map(p => ({ label: `${duration}s @ ${p.resolution}`, cost: duration * (p.pricePerSecond ?? 0) })),
			},
		};
	}

	if (duration === undefined) {
		return { cost: 0, isPlaceholder: true, note: 'Missing duration, cannot calculate' };
	}

	const resolutionValue = resolutionField ? extracted.values[resolutionField] : undefined;
	const resolution = normalizeResolution(resolutionValue as string | undefined);

	const match = prices.find((p) => p.resolution === resolution);
	if (!match || match.pricePerSecond === undefined) {
		const fallback = prices[0];
		const rate = fallback?.pricePerSecond ?? 0;
		return {
			cost: duration * rate,
			isPlaceholder: true,
			note: `No price for resolution ${resolution}`,
		};
	}
	return { cost: duration * match.pricePerSecond, isPlaceholder: false };
}

function parseDurationValue(value: unknown): number | undefined {
	if (typeof value === 'number') {
		return value;
	}
	if (typeof value === 'string') {
		const match = value.match(/^(\d+(?:\.\d+)?)s$/);
		if (match) {
			return parseFloat(match[1]);
		}
	}
	return undefined;
}

function costByVideoDurationAndWithAudio(
	config: ModelPriceConfig,
	extracted: ExtractedCostInputs
): CostEstimate {
	const prices = config.prices as AudioFlagPriceEntry[] | undefined;
	if (!prices || prices.length === 0) {
		return { cost: 0, isPlaceholder: true, note: 'Missing audio flag prices' };
	}

	const inputs = config.inputs ?? [];
	const durationField = inputs[0];
	const audioField = inputs[1];

	// Check for artefact-sourced inputs
	if (extracted.artefactSourcedFields.length > 0) {
		const durationValue = durationField ? extracted.values[durationField] : undefined;
		const duration = parseDurationValue(durationValue);
		if (duration === undefined) {
			return { cost: 0, isPlaceholder: true, note: 'Missing duration, cannot calculate' };
		}
		const minRate = Math.min(...prices.map(p => p.pricePerSecond));
		const maxRate = Math.max(...prices.map(p => p.pricePerSecond));
		return {
			cost: duration * (minRate + maxRate) / 2,
			isPlaceholder: true,
			note: `Some inputs from artefact: ${extracted.artefactSourcedFields.join(', ')}`,
			range: {
				min: duration * minRate,
				max: duration * maxRate,
				samples: prices.map(p => ({
					label: `${duration}s ${p.generate_audio ? 'with' : 'without'} audio`,
					cost: duration * p.pricePerSecond,
				})),
			},
		};
	}

	const durationValue = durationField ? extracted.values[durationField] : undefined;
	const audioValue = audioField ? extracted.values[audioField] : undefined;
	const duration = parseDurationValue(durationValue);
	if (duration === undefined) {
		return { cost: 0, isPlaceholder: true, note: 'Missing duration, cannot calculate' };
	}
	const generateAudio = audioValue === true;

	const match = prices.find((p) => p.generate_audio === generateAudio);
	if (!match) {
		const fallback = prices[0];
		return {
			cost: duration * (fallback?.pricePerSecond ?? 0),
			isPlaceholder: true,
			note: `No price for generate_audio=${generateAudio}`,
		};
	}
	return { cost: duration * match.pricePerSecond, isPlaceholder: false };
}

function costByRun(
	config: ModelPriceConfig,
	_extracted: ExtractedCostInputs
): CostEstimate {
	const price = config.price;
	if (price === undefined) {
		return {
			cost: 0,
			isPlaceholder: true,
			note: 'Missing price in config',
		};
	}
	return { cost: price, isPlaceholder: false };
}

function costByCharacters(
	config: ModelPriceConfig,
	extracted: ExtractedCostInputs
): CostEstimate {
	const pricePerCharacter = config.pricePerCharacter;
	if (pricePerCharacter === undefined) {
		return {
			cost: 0,
			isPlaceholder: true,
			note: 'Missing pricePerCharacter in config',
		};
	}

	// Check if any required field comes from artefact
	if (extracted.artefactSourcedFields.length > 0) {
		const samples = [
			{ label: '100 chars', cost: 100 * pricePerCharacter },
			{ label: '500 chars', cost: 500 * pricePerCharacter },
			{ label: '1000 chars', cost: 1000 * pricePerCharacter },
		];
		return {
			cost: samples[1].cost,
			isPlaceholder: true,
			note: `Input from artefact: ${extracted.artefactSourcedFields.join(', ')}`,
			range: {
				min: samples[0].cost,
				max: samples[2].cost,
				samples,
			},
		};
	}

	// Get the text value - first field from inputs array
	const textField = config.inputs?.[0];
	const text = textField ? extracted.values[textField] : undefined;

	if (typeof text !== 'string' || text.length === 0) {
		return {
			cost: 0,
			isPlaceholder: true,
			note: 'No text value found',
		};
	}

	return { cost: text.length * pricePerCharacter, isPlaceholder: false };
}

/**
 * Calculate cost based on character count with plan-based pricing.
 * Used for providers like ElevenLabs that have different pricing tiers.
 */
function costByCharactersAndPlan(
	config: ModelPriceConfig,
	extracted: ExtractedCostInputs
): CostEstimate {
	const prices = config.pricePerCharByPlan;
	if (!prices || Object.keys(prices).length === 0) {
		return {
			cost: 0,
			isPlaceholder: true,
			note: 'Missing pricePerCharByPlan in config',
		};
	}

	// Get plan from environment, fall back to defaultPlan or first available
	const plan = process.env.ELEVEN_LABS_PLAN ?? config.defaultPlan;
	const pricePerCharacter = plan ? prices[plan] : Object.values(prices)[0];

	if (pricePerCharacter === undefined) {
		return {
			cost: 0,
			isPlaceholder: true,
			note: `Unknown plan: ${plan}`,
		};
	}

	// Check if text comes from artefact
	if (extracted.artefactSourcedFields.length > 0) {
		const samples = [
			{ label: '100 chars', cost: 100 * pricePerCharacter },
			{ label: '500 chars', cost: 500 * pricePerCharacter },
			{ label: '1000 chars', cost: 1000 * pricePerCharacter },
		];
		return {
			cost: samples[1].cost,
			isPlaceholder: true,
			note: `Input from artefact: ${extracted.artefactSourcedFields.join(', ')} (Plan: ${plan ?? 'default'})`,
			range: {
				min: samples[0].cost,
				max: samples[2].cost,
				samples,
			},
		};
	}

	// Get the text value
	const textField = config.inputs?.[0];
	const text = textField ? extracted.values[textField] : undefined;

	if (typeof text !== 'string' || text.length === 0) {
		return {
			cost: 0,
			isPlaceholder: true,
			note: 'No text value found',
		};
	}

	return {
		cost: text.length * pricePerCharacter,
		isPlaceholder: false,
		note: `Plan: ${plan ?? 'default'}`,
	};
}

function costByAudioSeconds(
	config: ModelPriceConfig,
	extracted: ExtractedCostInputs
): CostEstimate {
	const pricePerSecond = config.pricePerSecond;
	if (pricePerSecond === undefined) {
		return { cost: 0, isPlaceholder: true, note: 'Missing pricePerSecond' };
	}

	// Get duration from first field in inputs array
	const durationField = config.inputs?.[0];
	const durationValue = durationField ? extracted.values[durationField] : undefined;
	const duration = parseDurationValue(durationValue);

	// Check for artefact-sourced duration
	if (extracted.artefactSourcedFields.length > 0) {
		const samples = [
			{ label: '10s', cost: 10 * pricePerSecond },
			{ label: '30s', cost: 30 * pricePerSecond },
			{ label: '60s', cost: 60 * pricePerSecond },
		];
		return {
			cost: samples[1].cost,
			isPlaceholder: true,
			note: `Duration from artefact: ${extracted.artefactSourcedFields.join(', ')}`,
			range: {
				min: samples[0].cost,
				max: samples[2].cost,
				samples,
			},
		};
	}

	if (duration === undefined) {
		return { cost: 0, isPlaceholder: true, note: 'Missing duration, cannot calculate' };
	}

	return { cost: duration * pricePerSecond, isPlaceholder: false };
}

function costByImageSizeAndQuality(
	config: ModelPriceConfig,
	extracted: ExtractedCostInputs
): CostEstimate {
	const prices = config.prices as ImageSizeQualityPriceEntry[] | undefined;
	if (!prices || prices.length === 0) {
		return { cost: 0, isPlaceholder: true, note: 'Missing size/quality prices' };
	}

	// Check for artefact-sourced inputs
	if (extracted.artefactSourcedFields.length > 0) {
		const allPrices = prices.map(p => p.pricePerImage);
		const minPrice = Math.min(...allPrices);
		const maxPrice = Math.max(...allPrices);
		return {
			cost: (minPrice + maxPrice) / 2,
			isPlaceholder: true,
			note: `Input from artefact: ${extracted.artefactSourcedFields.join(', ')}`,
			range: {
				min: minPrice,
				max: maxPrice,
				samples: prices.map(p => ({ label: `${p.quality}/${p.image_size}`, cost: p.pricePerImage })),
			},
		};
	}

	// Get inputs: image_size, quality, num_images
	const inputs = config.inputs ?? [];
	const imageSizeField = inputs[0];
	const qualityField = inputs[1];
	const numImagesField = inputs[2];

	const imageSize = imageSizeField ? extracted.values[imageSizeField] as string : undefined;
	const quality = qualityField ? extracted.values[qualityField] as string : undefined;
	const numImages = numImagesField ? Number(extracted.values[numImagesField]) : 1;
	const count = Number.isFinite(numImages) && numImages > 0 ? numImages : 1;

	// Find matching price
	const match = prices.find(p => p.image_size === imageSize && p.quality === quality);
	if (!match) {
		// Try to find a fallback with just quality or first entry
		const qualityMatch = prices.find(p => p.quality === quality);
		const fallback = qualityMatch ?? prices[0];
		return {
			cost: (fallback?.pricePerImage ?? 0) * count,
			isPlaceholder: true,
			note: `No exact price for ${quality}/${imageSize}`,
		};
	}

	return { cost: match.pricePerImage * count, isPlaceholder: false };
}

/**
 * Parse resolution and aspect ratio to get width and height.
 */
function parseResolutionDimensions(
	resolution: string | undefined,
	aspectRatio: string | undefined
): { width: number; height: number } {
	// Default dimensions
	let width = 1920;
	let height = 1080;

	// Parse resolution (e.g., "1080p", "720p", "4k")
	if (resolution) {
		const lower = resolution.toLowerCase();
		if (lower.includes('480')) {
			height = 480;
		} else if (lower.includes('720')) {
			height = 720;
		} else if (lower.includes('1080')) {
			height = 1080;
		} else if (lower.includes('4k') || lower.includes('2160')) {
			height = 2160;
		}
	}

	// Parse aspect ratio (e.g., "16:9", "9:16", "1:1")
	if (aspectRatio) {
		const match = aspectRatio.match(/(\d+):(\d+)/);
		if (match) {
			const ratioW = parseInt(match[1], 10);
			const ratioH = parseInt(match[2], 10);
			if (ratioW > 0 && ratioH > 0) {
				// Calculate width based on height and aspect ratio
				width = Math.round(height * (ratioW / ratioH));
			}
		}
	} else {
		// Default to 16:9 if no aspect ratio
		width = Math.round(height * (16 / 9));
	}

	return { width, height };
}

function costByVideoPerMillionTokens(
	config: ModelPriceConfig,
	extracted: ExtractedCostInputs
): CostEstimate {
	const prices = config.prices;

	// Check if this is audio-based pricing (prices array has generate_audio entries)
	const hasAudioPricing = prices?.some(p => 'generate_audio' in p);

	let pricePerMillionTokens: number | undefined;

	// Fixed fps for seedance models
	const fps = 30;

	if (hasAudioPricing) {
		// Audio-based pricing
		const audioEntries = prices as VideoTokenAudioPriceEntry[];

		// Check if generate_audio is artefact-sourced - return range
		if (extracted.artefactSourcedFields.includes('generate_audio')) {
			// Get duration to calculate token cost range
			const inputs = config.inputs ?? [];
			const durationField = inputs[0];
			const resolutionField = inputs[1];
			const aspectRatioField = inputs[2];

			const durationValue = durationField ? extracted.values[durationField] : undefined;
			const duration = parseDurationValue(durationValue);

			if (duration === undefined) {
				return { cost: 0, isPlaceholder: true, note: 'Missing duration, cannot calculate' };
			}

			const resolution = resolutionField ? extracted.values[resolutionField] as string : undefined;
			const aspectRatio = aspectRatioField ? extracted.values[aspectRatioField] as string : undefined;
			const { width, height } = parseResolutionDimensions(resolution, aspectRatio);
			const tokens = (height * width * duration * fps) / 1024;

			const pricesArr = audioEntries.map(p => p.pricePerMillionTokens);
			const minPrice = Math.min(...pricesArr);
			const maxPrice = Math.max(...pricesArr);

			const minCost = (tokens / 1_000_000) * minPrice;
			const maxCost = (tokens / 1_000_000) * maxPrice;

			return {
				cost: (minCost + maxCost) / 2,
				isPlaceholder: true,
				note: `generate_audio from artefact`,
				range: {
					min: minCost,
					max: maxCost,
					samples: audioEntries.map(p => ({
						label: p.generate_audio ? 'with audio' : 'without audio',
						cost: (tokens / 1_000_000) * p.pricePerMillionTokens,
					})),
				},
			};
		}

		// Look up price based on generate_audio value
		const generateAudio = extracted.values['generate_audio'] === true;
		const match = audioEntries.find(p => p.generate_audio === generateAudio);
		pricePerMillionTokens = match?.pricePerMillionTokens;

		// If no match found, try to find the false entry as default
		if (pricePerMillionTokens === undefined) {
			const defaultEntry = audioEntries.find(p => p.generate_audio === false);
			pricePerMillionTokens = defaultEntry?.pricePerMillionTokens ?? audioEntries[0]?.pricePerMillionTokens;
		}
	} else {
		// Legacy: single price (backward compatible)
		pricePerMillionTokens = config.pricePerMillionTokens;
		if (pricePerMillionTokens === undefined) {
			const priceEntries = prices as VideoTokenPriceEntry[] | undefined;
			pricePerMillionTokens = priceEntries?.[0]?.pricePerMillionTokens;
		}
	}

	if (pricePerMillionTokens === undefined) {
		return { cost: 0, isPlaceholder: true, note: 'Missing pricePerMillionTokens' };
	}

	// Check for artefact-sourced inputs (other than generate_audio which is handled above)
	const nonAudioArtefactFields = extracted.artefactSourcedFields.filter(f => f !== 'generate_audio');
	if (nonAudioArtefactFields.length > 0) {
		// Use default 1080p 5s video for estimate
		const defaultWidth = 1920;
		const defaultHeight = 1080;
		const defaultDuration = 5;
		const defaultTokens = (defaultWidth * defaultHeight * defaultDuration * fps) / 1024;
		const defaultCost = (defaultTokens / 1_000_000) * pricePerMillionTokens;

		const samples = [
			{ label: '720p 5s', cost: ((1280 * 720 * 5 * fps) / 1024 / 1_000_000) * pricePerMillionTokens },
			{ label: '1080p 5s', cost: defaultCost },
			{ label: '1080p 10s', cost: ((1920 * 1080 * 10 * fps) / 1024 / 1_000_000) * pricePerMillionTokens },
		];
		return {
			cost: defaultCost,
			isPlaceholder: true,
			note: `Input from artefact: ${nonAudioArtefactFields.join(', ')}`,
			range: {
				min: samples[0].cost,
				max: samples[2].cost,
				samples,
			},
		};
	}

	// Get inputs: duration, resolution, aspect_ratio
	const inputs = config.inputs ?? [];
	const durationField = inputs[0];
	const resolutionField = inputs[1];
	const aspectRatioField = inputs[2];

	const durationValue = durationField ? extracted.values[durationField] : undefined;
	const duration = parseDurationValue(durationValue);

	if (duration === undefined) {
		return { cost: 0, isPlaceholder: true, note: 'Missing duration, cannot calculate' };
	}

	const resolution = resolutionField ? extracted.values[resolutionField] as string : undefined;
	const aspectRatio = aspectRatioField ? extracted.values[aspectRatioField] as string : undefined;

	const { width, height } = parseResolutionDimensions(resolution, aspectRatio);

	// Calculate tokens: (height * width * duration * fps) / 1024
	const tokens = (height * width * duration * fps) / 1024;
	const cost = (tokens / 1_000_000) * pricePerMillionTokens;

	return { cost, isPlaceholder: false };
}

/**
 * Image size presets mapped to dimensions.
 */
const IMAGE_SIZE_PRESETS: Record<string, { width: number; height: number }> = {
	landscape_4_3: { width: 1365, height: 1024 },
	landscape_16_9: { width: 1820, height: 1024 },
	portrait_4_3: { width: 1024, height: 1365 },
	portrait_16_9: { width: 1024, height: 1820 },
	square: { width: 1024, height: 1024 },
	square_hd: { width: 1024, height: 1024 },
	auto: { width: 1024, height: 1024 }, // Default fallback
};

/**
 * Parse image_size value to width and height.
 * Supports string presets (e.g., "landscape_16_9") and object {width, height}.
 */
function parseImageSize(
	imageSize: unknown
): { width: number; height: number } | null {
	if (imageSize === undefined || imageSize === null) {
		return null;
	}

	// Handle string preset
	if (typeof imageSize === 'string') {
		const preset = IMAGE_SIZE_PRESETS[imageSize];
		if (preset) {
			return preset;
		}
		return null;
	}

	// Handle object {width, height}
	if (typeof imageSize === 'object') {
		const obj = imageSize as Record<string, unknown>;
		const width = Number(obj.width);
		const height = Number(obj.height);
		if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
			return { width, height };
		}
	}

	return null;
}

function costByImageMegapixels(
	config: ModelPriceConfig,
	extracted: ExtractedCostInputs
): CostEstimate {
	const pricePerMegapixel = config.pricePerMegapixel;
	if (pricePerMegapixel === undefined) {
		return { cost: 0, isPlaceholder: true, note: 'Missing pricePerMegapixel' };
	}

	// inputs: [num_images_field, image_size_field]
	const inputs = config.inputs ?? [];
	const numImagesField = inputs[0];
	const imageSizeField = inputs[1];

	const numImagesValue = numImagesField ? extracted.values[numImagesField] : 1;
	const imageSizeValue = imageSizeField ? extracted.values[imageSizeField] : undefined;

	const numImages = typeof numImagesValue === 'number' ? numImagesValue : 1;
	const dimensions = parseImageSize(imageSizeValue);

	// Handle artefact-sourced or missing dimensions
	const hasArtefactSources = extracted.artefactSourcedFields.length > 0;

	if (hasArtefactSources || !dimensions) {
		const defaultDims = IMAGE_SIZE_PRESETS.square_hd;
		const samples = [
			{ label: '1024x1024', cost: (1024 * 1024 / 1_000_000) * numImages * pricePerMegapixel },
			{ label: '1820x1024', cost: (1820 * 1024 / 1_000_000) * numImages * pricePerMegapixel },
			{ label: '2048x2048', cost: (2048 * 2048 / 1_000_000) * numImages * pricePerMegapixel },
		];

		return {
			cost: (defaultDims.width * defaultDims.height / 1_000_000) * numImages * pricePerMegapixel,
			isPlaceholder: true,
			note: hasArtefactSources
				? `Input from artefact: ${extracted.artefactSourcedFields.join(', ')}`
				: 'image_size missing or auto',
			range: { min: samples[0].cost, max: samples[2].cost, samples },
		};
	}

	const megapixels = (dimensions.width * dimensions.height) / 1_000_000;
	const cost = megapixels * numImages * pricePerMegapixel;

	return { cost, isPlaceholder: false };
}

/**
 * Video size presets for LTX models mapped to dimensions.
 */
const VIDEO_SIZE_PRESETS: Record<string, { width: number; height: number }> = {
	landscape_4_3: { width: 1248, height: 704 },
	landscape_16_9: { width: 1280, height: 720 },
	portrait_4_3: { width: 704, height: 1248 },
	portrait_16_9: { width: 720, height: 1280 },
	square: { width: 704, height: 704 },
	square_hd: { width: 1024, height: 1024 },
};

/**
 * Parse video_size value to width and height.
 * Supports string presets (e.g., "landscape_16_9") and object {width, height}.
 */
function parseVideoSize(
	videoSize: unknown
): { width: number; height: number } | null {
	if (!videoSize) {
		return null;
	}

	// Handle string preset
	if (typeof videoSize === 'string') {
		const preset = VIDEO_SIZE_PRESETS[videoSize];
		if (preset) {
			return preset;
		}
		// "auto" means dimensions come from artefact
		if (videoSize === 'auto') {
			return null;
		}
		return null;
	}

	// Handle object {width, height}
	if (typeof videoSize === 'object') {
		const obj = videoSize as Record<string, unknown>;
		const width = Number(obj.width);
		const height = Number(obj.height);
		if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
			return { width, height };
		}
	}

	return null;
}

function costByVideoMegapixels(
	config: ModelPriceConfig,
	extracted: ExtractedCostInputs
): CostEstimate {
	const pricePerMegapixel = config.pricePerMegapixel;
	if (pricePerMegapixel === undefined) {
		return { cost: 0, isPlaceholder: true, note: 'Missing pricePerMegapixel' };
	}

	// Get inputs: num_frames, video_size
	const inputs = config.inputs ?? [];
	const numFramesField = inputs[0];
	const videoSizeField = inputs[1];

	const numFramesValue = numFramesField ? extracted.values[numFramesField] : undefined;
	const videoSizeValue = videoSizeField ? extracted.values[videoSizeField] : undefined;

	const numFrames = typeof numFramesValue === 'number' ? numFramesValue : undefined;
	const dimensions = parseVideoSize(videoSizeValue);

	// Check for artefact-sourced or missing inputs
	const hasArtefactSources = extracted.artefactSourcedFields.length > 0;
	const hasMissingDimensions = !dimensions || videoSizeValue === 'auto';

	if (hasArtefactSources || hasMissingDimensions) {
		// Return range for common video sizes
		const commonSamples = [
			{ label: '720p 81f', dims: { width: 1280, height: 720 }, frames: 81 },
			{ label: '720p 121f', dims: { width: 1280, height: 720 }, frames: 121 },
			{ label: '1024p 121f', dims: { width: 1024, height: 1024 }, frames: 121 },
		];

		const samples = commonSamples.map(s => {
			const mp = (s.dims.width * s.dims.height * s.frames) / 1_000_000;
			return { label: s.label, cost: mp * pricePerMegapixel };
		});

		const usedFrames = numFrames ?? 121;
		const defaultDims = dimensions ?? VIDEO_SIZE_PRESETS.landscape_16_9;
		const defaultMp = (defaultDims.width * defaultDims.height * usedFrames) / 1_000_000;
		const defaultCost = defaultMp * pricePerMegapixel;

		return {
			cost: defaultCost,
			isPlaceholder: true,
			note: hasArtefactSources
				? `Input from artefact: ${extracted.artefactSourcedFields.join(', ')}`
				: 'video_size is auto or missing',
			range: {
				min: samples[0].cost,
				max: samples[2].cost,
				samples,
			},
		};
	}

	if (numFrames === undefined) {
		return { cost: 0, isPlaceholder: true, note: 'Missing num_frames, cannot calculate' };
	}

	// Calculate megapixels and cost
	const megapixels = (dimensions.width * dimensions.height * numFrames) / 1_000_000;
	const cost = megapixels * pricePerMegapixel;

	return { cost, isPlaceholder: false };
}

/**
 * Calculate cost for a model using its pricing configuration.
 */
export function calculateCost(
	priceConfig: ModelPriceConfig | number,
	extracted: ExtractedCostInputs
): CostEstimate {
	// Handle flat price (e.g., internal producers with price: 0)
	if (typeof priceConfig === 'number') {
		return { cost: priceConfig, isPlaceholder: false };
	}

	const fn = priceConfig.function;
	switch (fn) {
		case 'costByInputTokens':
			return costByInputTokens(priceConfig, extracted);
		case 'costByImageAndResolution':
			return costByImageAndResolution(priceConfig, extracted);
		case 'costByResolution':
			return costByResolution(priceConfig, extracted);
		case 'costByVideoDuration':
			return costByVideoDuration(priceConfig, extracted);
		case 'costByVideoDurationAndResolution':
			return costByVideoDurationAndResolution(priceConfig, extracted);
		case 'costByVideoDurationAndWithAudio':
			return costByVideoDurationAndWithAudio(priceConfig, extracted);
		case 'costByRun':
			return costByRun(priceConfig, extracted);
		case 'costByCharacters':
			return costByCharacters(priceConfig, extracted);
		case 'costByCharactersAndPlan':
			return costByCharactersAndPlan(priceConfig, extracted);
		case 'costByAudioSeconds':
			return costByAudioSeconds(priceConfig, extracted);
		case 'costByImageSizeAndQuality':
			return costByImageSizeAndQuality(priceConfig, extracted);
		case 'costByVideoPerMillionTokens':
			return costByVideoPerMillionTokens(priceConfig, extracted);
		case 'costByVideoMegapixels':
			return costByVideoMegapixels(priceConfig, extracted);
		case 'costByImageMegapixels':
			return costByImageMegapixels(priceConfig, extracted);
		default:
			return {
				cost: 0,
				isPlaceholder: true,
				note: `Unknown cost function: ${fn}`,
			};
	}
}

// ============================================================================
// Pricing Catalog Loading
// ============================================================================

/**
 * Load pricing catalog from a directory containing provider subdirectories.
 * Each provider has a subdirectory with a YAML file named after the provider.
 * Structure: catalog/models/{provider}/{provider}.yaml
 */
export async function loadPricingCatalog(
	catalogModelsDir: string
): Promise<PricingCatalog> {
	const catalog: PricingCatalog = {
		providers: new Map(),
	};

	let entries: string[];
	try {
		entries = await readdir(catalogModelsDir);
	} catch {
		// Directory doesn't exist - return empty catalog
		return catalog;
	}

	// Filter to only directories (provider subdirectories)
	const providerDirs: string[] = [];
	for (const entry of entries) {
		const entryPath = resolve(catalogModelsDir, entry);
		try {
			const stats = await stat(entryPath);
			if (stats.isDirectory()) {
				providerDirs.push(entry);
			}
		} catch {
			// Skip entries we can't stat
			continue;
		}
	}

	for (const providerName of providerDirs) {
		// Look for {provider}/{provider}.yaml
		const filePath = resolve(catalogModelsDir, providerName, `${providerName}.yaml`);

		try {
			const contents = await readFile(filePath, 'utf8');
			const data = parseYaml(contents) as ProviderPricingData;

			if (!data.models || !Array.isArray(data.models)) {
				continue;
			}

			const modelMap = new Map<string, ModelPriceConfig | number>();
			for (const model of data.models) {
				modelMap.set(model.name, model.price);
			}
			catalog.providers.set(providerName, modelMap);
		} catch (error) {
			// Skip providers that fail to load
			console.warn(`Failed to load pricing for provider ${providerName}: ${error}`);
		}
	}

	return catalog;
}

/**
 * Look up pricing configuration for a provider/model combination.
 */
export function lookupModelPrice(
	catalog: PricingCatalog,
	provider: string,
	model: string
): ModelPriceConfig | number | null {
	const providerMap = catalog.providers.get(provider);
	if (!providerMap) {
		return null;
	}
	return providerMap.get(model) ?? null;
}

// ============================================================================
// Schema-Driven Input Extraction
// ============================================================================

/**
 * Extract cost-relevant inputs from a job's context using schema-driven approach.
 * Uses the pricing config's inputs array to determine which provider fields to extract,
 * then maps through sdkMapping and inputBindings to get actual values.
 */
export function extractCostInputs(
	job: JobDescriptor,
	resolvedInputs: Record<string, unknown>,
	requiredFields: string[]
): ExtractedCostInputs {
	const values: Record<string, unknown> = {};
	const artefactSourcedFields: string[] = [];
	const missingFields: string[] = [];

	const sdkMapping = job.context?.sdkMapping ?? {};
	const inputBindings = job.context?.inputBindings ?? {};

	// Merge global resolved inputs with job-specific ones
	const jobExtras = job.context?.extras as
		| { resolvedInputs?: Record<string, unknown> }
		| undefined;
	const jobResolvedInputs = jobExtras?.resolvedInputs ?? {};
	const allInputs = { ...resolvedInputs, ...jobResolvedInputs };

	// Build reverse map: provider field name → producer alias
	const fieldToAlias = new Map<string, string>();
	for (const [alias, mapping] of Object.entries(sdkMapping)) {
		const fieldName = getFieldName(mapping);
		if (fieldName) {
			fieldToAlias.set(fieldName, alias);
		}
	}

	for (const providerField of requiredFields) {
		const producerAlias = fieldToAlias.get(providerField);
		if (!producerAlias) {
			missingFields.push(providerField);
			continue;
		}

		const canonicalId = inputBindings[producerAlias];
		if (!canonicalId) {
			missingFields.push(providerField);
			continue;
		}

		// Check if this comes from an artefact (not available at planning time)
		if (canonicalId.startsWith('Artifact:')) {
			artefactSourcedFields.push(providerField);
			continue;
		}

		// Look up the actual value
		const value = allInputs[canonicalId];
		if (value !== undefined) {
			values[providerField] = value;
		} else {
			missingFields.push(providerField);
		}
	}

	return { values, artefactSourcedFields, missingFields };
}

/**
 * Get the provider field name from an SDK mapping entry.
 */
function getFieldName(mapping: BlueprintProducerSdkMappingField | string | undefined): string | undefined {
	if (!mapping) {
		return undefined;
	}
	if (typeof mapping === 'string') {
		return mapping;
	}
	return mapping.field;
}

// ============================================================================
// Plan Cost Estimation
// ============================================================================

/**
 * Estimate costs for an entire execution plan.
 */
export function estimatePlanCosts(
	plan: ExecutionPlan,
	pricingCatalog: PricingCatalog,
	resolvedInputs: Record<string, unknown>
): PlanCostSummary {
	const jobs: JobCostEstimate[] = [];
	const byProducer = new Map<string, ProducerCostData>();
	const missingProviders = new Set<string>();
	let totalCost = 0;
	let minTotalCost = 0;
	let maxTotalCost = 0;
	let hasPlaceholders = false;
	let hasRanges = false;

	const allJobs = plan.layers.flat();

	for (const job of allJobs) {
		const producer =
			typeof job.producer === 'string' ? job.producer : 'unknown';
		const provider = job.provider;
		const model = job.providerModel;

		// Look up pricing
		const priceConfig = lookupModelPrice(pricingCatalog, provider, model);

		let estimate: CostEstimate;

		if (priceConfig === null) {
			// No pricing data for this provider/model
			const providerMap = pricingCatalog.providers.get(provider);
			if (!providerMap) {
				missingProviders.add(provider);
			} else {
				// Provider exists but model is missing - track for better diagnostics
				missingProviders.add(`${provider}:${model}`);
			}
			estimate = {
				cost: 0,
				isPlaceholder: true,
				note: `No pricing data for ${provider}/${model}`,
			};
		} else {
			// Extract inputs based on pricing config's inputs array
			const requiredFields = typeof priceConfig === 'number' ? [] : (priceConfig.inputs ?? []);
			const extracted = extractCostInputs(job, resolvedInputs, requiredFields);
			estimate = calculateCost(priceConfig, extracted);
		}

		jobs.push({
			jobId: job.jobId,
			producer,
			provider,
			model,
			estimate,
		});

		// Calculate min/max for this estimate
		const estimateMin = estimate.range?.min ?? estimate.cost;
		const estimateMax = estimate.range?.max ?? estimate.cost;

		// Aggregate by producer
		const existing = byProducer.get(producer) ?? {
			count: 0,
			totalCost: 0,
			hasPlaceholders: false,
			hasRanges: false,
			minCost: 0,
			maxCost: 0,
		};
		existing.count += 1;
		existing.totalCost += estimate.cost;
		existing.minCost += estimateMin;
		existing.maxCost += estimateMax;
		existing.hasPlaceholders = existing.hasPlaceholders || estimate.isPlaceholder;
		existing.hasRanges = existing.hasRanges || !!estimate.range;
		byProducer.set(producer, existing);

		totalCost += estimate.cost;
		minTotalCost += estimateMin;
		maxTotalCost += estimateMax;
		hasPlaceholders = hasPlaceholders || estimate.isPlaceholder;
		hasRanges = hasRanges || !!estimate.range;
	}

	return {
		jobs,
		byProducer,
		totalCost,
		hasPlaceholders,
		hasRanges,
		minTotalCost,
		maxTotalCost,
		missingProviders: Array.from(missingProviders),
	};
}

// ============================================================================
// Price Formatting
// ============================================================================

/**
 * Format a price configuration for display.
 * Returns a human-readable string representation of the pricing.
 */
export function formatPrice(price: ModelPriceConfig | number | undefined): string {
	if (price === undefined) {
		return '-';
	}

	if (typeof price === 'number') {
		return price === 0 ? 'free' : `$${price.toFixed(2)}`;
	}

	switch (price.function) {
		case 'costByImageAndResolution': {
			const entries = price.prices as ResolutionPriceEntry[] | undefined;
			if (!entries || entries.length === 0) {
				return '-';
			}
			return entries
				.map((e) => `${e.resolution}: $${(e.pricePerImage ?? 0).toFixed(2)}`)
				.join(', ') + '/image';
		}

		case 'costByResolution': {
			const entries = price.prices as ResolutionPriceEntry[] | undefined;
			if (!entries || entries.length === 0) {
				return '-';
			}
			return entries
				.map((e) => `${e.resolution}: $${(e.pricePerImage ?? 0).toFixed(4)}`)
				.join(', ') + '/image';
		}

		case 'costByInputTokens':
			return price.pricePerToken !== undefined
				? `$${price.pricePerToken.toFixed(4)}/token`
				: '-';

		case 'costByVideoDuration':
			return price.pricePerSecond !== undefined
				? `$${price.pricePerSecond.toFixed(2)}/s`
				: '-';

		case 'costByVideoDurationAndResolution': {
			const entries = price.prices as ResolutionPriceEntry[] | undefined;
			if (!entries || entries.length === 0) {
				return '-';
			}
			return entries
				.map((e) => `${e.resolution}: $${(e.pricePerSecond ?? 0).toFixed(3)}/s`)
				.join(', ');
		}

		case 'costByVideoDurationAndWithAudio': {
			const entries = price.prices as AudioFlagPriceEntry[] | undefined;
			if (!entries || entries.length === 0) {
				return '-';
			}
			return entries
				.map((e) => `${e.generate_audio ? 'audio' : 'no-audio'}: $${e.pricePerSecond.toFixed(2)}/s`)
				.join(', ');
		}

		case 'costByRun':
			return price.price !== undefined
				? `$${price.price.toFixed(2)}/run`
				: '-';

		case 'costByCharacters':
			return price.pricePerCharacter !== undefined
				? `$${price.pricePerCharacter.toFixed(6)}/char`
				: '-';

		case 'costByCharactersAndPlan': {
			const planPrices = price.pricePerCharByPlan;
			if (!planPrices || Object.keys(planPrices).length === 0) {
				return '-';
			}
			const defaultPlan = price.defaultPlan ?? Object.keys(planPrices)[0];
			const defaultPrice = planPrices[defaultPlan];
			return defaultPrice !== undefined
				? `$${defaultPrice.toFixed(6)}/char (${defaultPlan})`
				: '-';
		}

		case 'costByAudioSeconds':
			return price.pricePerSecond !== undefined
				? `$${price.pricePerSecond.toFixed(3)}/s`
				: '-';

		case 'costByImageSizeAndQuality': {
			const entries = price.prices as ImageSizeQualityPriceEntry[] | undefined;
			if (!entries || entries.length === 0) {
				return '-';
			}
			// Show a summary with range
			const allPrices = entries.map(e => e.pricePerImage);
			const minPrice = Math.min(...allPrices);
			const maxPrice = Math.max(...allPrices);
			return `$${minPrice.toFixed(2)}-$${maxPrice.toFixed(2)}/image`;
		}

		case 'costByVideoPerMillionTokens': {
			let pricePerMillion = price.pricePerMillionTokens;
			if (pricePerMillion === undefined) {
				const entries = price.prices as VideoTokenPriceEntry[] | undefined;
				pricePerMillion = entries?.[0]?.pricePerMillionTokens;
			}
			return pricePerMillion !== undefined
				? `$${pricePerMillion.toFixed(2)}/M tokens`
				: '-';
		}

		case 'costByVideoMegapixels':
			return price.pricePerMegapixel !== undefined
				? `$${price.pricePerMegapixel.toFixed(4)}/MP`
				: '-';

		case 'costByImageMegapixels':
			return price.pricePerMegapixel !== undefined
				? `$${price.pricePerMegapixel.toFixed(4)}/MP/image`
				: '-';

		default:
			return '-';
	}
}
