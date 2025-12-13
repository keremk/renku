import { readdir, readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ExecutionPlan, JobDescriptor, BlueprintProducerSdkMappingField } from '@renku/core';

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
	| 'costByImage'
	| 'costByImageAndResolution'
	| 'costByResolution'
	| 'costByVideoDuration'
	| 'costByVideoDurationAndResolution'
	| 'costByVideoDurationAndWithAudio'
	| 'costByOutputFile';

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
 * Pricing configuration for a model.
 */
export interface ModelPriceConfig {
	function: CostFunctionName;
	inputs?: string[];
	pricePerToken?: number;
	pricePerImage?: number;
	pricePerSecond?: number;
	pricePerAudioFile?: number;
	prices?: Array<ResolutionPriceEntry | AudioFlagPriceEntry>;
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

function costByImage(
	config: ModelPriceConfig,
	_extracted: ExtractedCostInputs
): CostEstimate {
	const pricePerImage = config.pricePerImage;
	if (pricePerImage === undefined) {
		return {
			cost: 0,
			isPlaceholder: true,
			note: 'Missing pricePerImage in config',
		};
	}
	return { cost: pricePerImage, isPlaceholder: false };
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

function costByOutputFile(
	config: ModelPriceConfig,
	_extracted: ExtractedCostInputs
): CostEstimate {
	const pricePerAudioFile = config.pricePerAudioFile;
	if (pricePerAudioFile === undefined) {
		return {
			cost: 0,
			isPlaceholder: true,
			note: 'Missing pricePerAudioFile',
		};
	}
	return { cost: pricePerAudioFile, isPlaceholder: false };
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
		case 'costByImage':
			return costByImage(priceConfig, extracted);
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
		case 'costByOutputFile':
			return costByOutputFile(priceConfig, extracted);
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
 * Load pricing catalog from a directory containing provider YAML files.
 * Each YAML file should be named after the provider (e.g., replicate.yaml).
 */
export async function loadPricingCatalog(
	catalogModelsDir: string
): Promise<PricingCatalog> {
	const catalog: PricingCatalog = {
		providers: new Map(),
	};

	let files: string[];
	try {
		files = await readdir(catalogModelsDir);
	} catch {
		// Directory doesn't exist - return empty catalog
		return catalog;
	}

	const yamlFiles = files.filter((f) => f.endsWith('.yaml'));

	for (const file of yamlFiles) {
		const providerName = basename(file, '.yaml');
		const filePath = resolve(catalogModelsDir, file);

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
			// Skip files that fail to parse
			console.warn(`Failed to load pricing file ${file}: ${error}`);
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
		case 'costByImage':
			return price.pricePerImage !== undefined
				? `$${price.pricePerImage.toFixed(2)}/image`
				: '-';

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

		case 'costByOutputFile':
			return price.pricePerAudioFile !== undefined
				? `$${price.pricePerAudioFile.toFixed(2)}/file`
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

		default:
			return '-';
	}
}
