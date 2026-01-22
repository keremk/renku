import process from 'node:process';
import * as readline from 'node:readline';
import type { ExecutionPlan, InputEvent, Logger } from '@gorenku/core';
import type { PlanCostSummary } from '@gorenku/providers';
import chalk from 'chalk';
import {
	displayInputSummary,
	displayPlanSummary,
	displayCostSummary,
	displaySurgicalPlanSummary,
	type SurgicalTargetInfo,
} from './plan-display.js';

// Re-export for backward compatibility
export { displayCostSummary } from './plan-display.js';

interface PlanConfirmationOptions {
	inputs?: InputEvent[];
	concurrency?: number;
	logger?: Logger;
	upToLayer?: number;
	costSummary?: PlanCostSummary;
	/** Surgical regeneration info. When provided, uses surgical plan display. */
	surgicalMode?: SurgicalTargetInfo[];
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

	// Use surgical display mode if surgicalMode is provided
	if (options.surgicalMode && options.surgicalMode.length > 0) {
		displaySurgicalPlanSummary({
			plan,
			targets: options.surgicalMode,
			logger,
		});
	} else {
		displayPlanSummary(plan, logger);
	}

	displayCostSummary(options.costSummary, logger);

	// Skip layer breakdown for surgical mode (not layer-based)
	if (!options.surgicalMode || options.surgicalMode.length === 0) {
		displayLayerBreakdown(
			plan,
			options.concurrency ?? 1,
			logger,
			options.upToLayer
		);

		if (typeof options.upToLayer === 'number') {
			logLayerLimit(plan, options.upToLayer, logger);
		}
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
