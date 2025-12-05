import process from 'node:process';
import * as readline from 'node:readline';
import type { ExecutionPlan, InputEvent, Logger } from '@renku/core';
import chalk from 'chalk';

interface PlanConfirmationOptions {
	inputs?: InputEvent[];
	concurrency?: number;
	logger?: Logger;
	upToLayer?: number;
}

function displayInputSummary(
	events: InputEvent[] | undefined,
	logger: Logger
): void {
	if (!events || events.length === 0) {
		return;
	}
	const sorted = [...events].sort((a, b) => a.id.localeCompare(b.id));
	logger.info(`\n${chalk.bold('=== Input Summary ===')}`);
	for (const event of sorted) {
		logger.info(
			`  • ${chalk.blue(event.id)}: ${formatInputValue(event.payload)}`
		);
	}
	logger.info('');
}

function formatInputValue(value: unknown): string {
	if (typeof value === 'string') {
		const compact = value.replace(/\s+/g, ' ').trim();
		return compact.length > 0 ? compact : '(empty string)';
	}
	if (value === null || value === undefined) {
		return String(value);
	}
	try {
		return JSON.stringify(value);
	} catch {
		return '[unserializable]';
	}
}

/**
 * Display a summary of the execution plan grouped by producer.
 */
function displayPlanSummary(plan: ExecutionPlan, logger: Logger): void {
	// Flatten all jobs from all layers
	const allJobs = plan.layers.flat();

	// Count jobs by producer
	const byProducer = new Map<string, number>();
	for (const job of allJobs) {
		byProducer.set(job.producer, (byProducer.get(job.producer) ?? 0) + 1);
	}

	logger.info(`\n${chalk.bold('=== Execution Plan Summary ===')}`);
	logger.info(`${chalk.bold('Revision')}: ${plan.revision}`);
	logger.info(`${chalk.bold('Total Jobs')}: ${allJobs.length}`);
	logger.info(`${chalk.bold('Layers')}: ${plan.layers.length}`);
	logger.info(`${chalk.bold('Jobs by Producer:')}`);

	for (const [producer, count] of byProducer) {
		const jobWord = count === 1 ? 'job' : 'jobs';
		logger.info(`  • ${chalk.blue(producer)}: ${chalk.bold(count)} ${jobWord}`);
	}

	logger.info('');
}

/**
 * Prompt user to confirm plan execution.
 * Returns true if user confirms, false otherwise.
 */
export async function confirmPlanExecution(
	plan: ExecutionPlan,
	options: PlanConfirmationOptions = {}
): Promise<boolean> {
	const logger = options.logger ?? globalThis.console;
	displayInputSummary(options.inputs, logger);
	displayPlanSummary(plan, logger);
	displayLayerBreakdown(
		plan,
		options.concurrency ?? 1,
		logger,
		options.upToLayer
	);

	if (typeof options.upToLayer === 'number') {
		logLayerLimit(plan, options.upToLayer, logger);
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question('\nProceed with execution? (y/n): ', (answer) => {
			rl.close();
			const normalized = answer.trim().toLowerCase();
			resolve(normalized === 'y' || normalized === 'yes');
		});
	});
}

function displayLayerBreakdown(
	plan: ExecutionPlan,
	concurrency: number,
	logger: Logger,
	upToLayer?: number
): void {
	const safeConcurrency =
		Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 1;
	logger.info(
		`${chalk.bold('Concurrency:')} ${safeConcurrency} job(s) in parallel per layer (where available)`
	);
	logger.info(`\n${chalk.bold('Execution Order (by layer):')}`);

	plan.layers.forEach((layer, index) => {
		const skipLayer = typeof upToLayer === 'number' && index > upToLayer;
		const willRun = !skipLayer;
		const concurrencyLabel =
			layer.length > 1 && safeConcurrency > 1
				? `parallel (up to ${Math.min(safeConcurrency, layer.length)} at once)`
				: 'sequential';
		const skippedLabel = skipLayer ? ' [Will Not Run]' : '';
		const layerLine = `  Layer ${index} (${layer.length} job${layer.length === 1 ? '' : 's'} - ${concurrencyLabel})${skippedLabel}:`;
		logger.info(colorLayer(lineColor(willRun), layerLine));
		if (layer.length === 0) {
			logger.info('');
			return;
		}
		for (const job of layer) {
			const producerLabel =
				typeof job.producer === 'string' ? job.producer : 'unknown-producer';
			const jobSuffix = skipLayer ? ' (Will Not Run)' : '';
			const jobLine = `    • ${job.jobId} [${producerLabel}]${jobSuffix}`;
			logger.info(colorLayer(lineColor(willRun), jobLine));
		}
		logger.info('');
	});
}

function logLayerLimit(
	plan: ExecutionPlan,
	requestedLimit: number,
	logger: Logger
): void {
	if (!Number.isFinite(requestedLimit)) {
		return;
	}
	const totalLayers = plan.layers.length;
	if (totalLayers === 0) {
		logger.info(
			`Layer limit set (--up-to-layer=${requestedLimit}), but this plan has no layers to execute.`
		);
		return;
	}
	const highestAvailable = totalLayers - 1;
	const normalizedLimit = Number.isInteger(requestedLimit)
		? requestedLimit
		: Math.floor(requestedLimit);
	const clamped = Math.min(Math.max(normalizedLimit, 0), highestAvailable);
	const runningLayers = clamped + 1;
	const skippedLayers = totalLayers - runningLayers;
	if (normalizedLimit >= highestAvailable) {
		logger.info(
			`Layer limit set (--up-to-layer=${requestedLimit}). Plan has ${totalLayers} layer${
				totalLayers === 1 ? '' : 's'
			}; all layers (0-${highestAvailable}) will run.`
		);
		return;
	}
	logger.info(
		`Layer limit set (--up-to-layer=${requestedLimit}). Running ${runningLayers} layer${
			runningLayers === 1 ? '' : 's'
		} (layers 0-${clamped}). ${skippedLayers} layer${skippedLayers === 1 ? '' : 's'} will not run.`
	);
}

function lineColor(willRun: boolean): 'run' | 'skip' {
	return willRun ? 'run' : 'skip';
}

function colorLayer(kind: 'run' | 'skip', text: string): string {
	return kind === 'run' ? chalk.green(text) : chalk.red(text);
}
