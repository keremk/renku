import type { ExecutionPlan, InputEvent, Logger, BlobInput, PlanExplanation, SurgicalInfo } from '@gorenku/core';
import { isBlobInput } from '@gorenku/core';
import type { PlanCostSummary } from '@gorenku/providers';
import chalk from 'chalk';

export interface DisplayPlanOptions {
	plan: ExecutionPlan;
	inputs?: InputEvent[];
	costSummary?: PlanCostSummary;
	logger?: Logger;
}

/**
 * Display execution plan summary and costs (non-interactive, no confirmation).
 * Used by --costs-only flag.
 */
export function displayPlanAndCosts(options: DisplayPlanOptions): void {
	const logger = options.logger ?? globalThis.console;

	displayInputSummary(options.inputs, logger);
	displayPlanSummary(options.plan, logger);
	displayCostSummary(options.costSummary, logger);
}

/**
 * Display a summary of input events.
 */
export function displayInputSummary(
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

/**
 * Format an input value for display.
 */
export function formatInputValue(value: unknown): string {
	if (typeof value === 'string') {
		const compact = value.replace(/\s+/g, ' ').trim();
		return compact.length > 0 ? compact : '(empty string)';
	}
	if (value === null || value === undefined) {
		return String(value);
	}
	// Handle BlobInput - show summary instead of raw data
	if (isBlobInput(value)) {
		const blob = value as BlobInput;
		return `[blob: ${blob.mimeType}, ${blob.data.byteLength} bytes]`;
	}
	// Handle arrays that may contain blob inputs
	if (Array.isArray(value)) {
		const blobCount = value.filter((item) => isBlobInput(item)).length;
		if (blobCount > 0) {
			return `[array of ${value.length} items, ${blobCount} blob(s)]`;
		}
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
export function displayPlanSummary(plan: ExecutionPlan, logger: Logger): void {
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
 * Format a cost value for display.
 */
export function formatCost(cost: number): string {
	if (cost === 0) {
		return '$0.00';
	}
	if (cost < 0.01) {
		return `$${cost.toFixed(4)}`;
	}
	return `$${cost.toFixed(2)}`;
}

/**
 * Format a cost range for display.
 */
export function formatCostRange(minCost: number, maxCost: number): string {
	return `${formatCost(minCost)} - ${formatCost(maxCost)}`;
}

export interface SurgicalPlanDisplayOptions {
	plan: ExecutionPlan;
	targets: SurgicalInfo[];
	logger?: Logger;
}

/**
 * Display a surgical regeneration plan summary.
 * Shows the target artifacts, source jobs, and downstream dependencies.
 */
export function displaySurgicalPlanSummary(options: SurgicalPlanDisplayOptions): void {
	const logger = options.logger ?? globalThis.console;
	const allJobs = options.plan.layers.flat();
	const sourceJobIds = new Set(options.targets.map((t) => t.sourceJobId));

	logger.info(`\n${chalk.bold('=== Surgical Regeneration Plan ===')}`);

	// Show target artifacts
	if (options.targets.length === 1) {
		const target = options.targets[0];
		logger.info(`${chalk.bold('Target Artifact')}: ${chalk.cyan(target.targetArtifactId)}`);
		logger.info(`${chalk.bold('Source Job')}: ${chalk.blue(target.sourceJobId)}`);
	} else {
		logger.info(`${chalk.bold('Target Artifacts')}: ${options.targets.length}`);
		for (const target of options.targets) {
			logger.info(`  ${chalk.dim('•')} ${chalk.cyan(target.targetArtifactId)} (from ${chalk.blue(target.sourceJobId)})`);
		}
	}

	logger.info(`${chalk.bold('Revision')}: ${options.plan.revision}`);
	logger.info(`${chalk.bold('Total Jobs')}: ${allJobs.length}`);

	// List all jobs that will be run
	if (allJobs.length > 0) {
		logger.info(`\n${chalk.bold('Jobs to Execute:')}`);

		// Find source jobs first
		const sourceJobs = allJobs.filter((j) => sourceJobIds.has(j.jobId));
		for (const job of sourceJobs) {
			logger.info(`  ${chalk.green('→')} ${chalk.bold(job.jobId)} [${job.producer}] ${chalk.yellow('(source)')}`);
		}

		// Show downstream jobs
		const downstreamJobs = allJobs.filter((j) => !sourceJobIds.has(j.jobId));
		for (const job of downstreamJobs) {
			logger.info(`    ${chalk.dim('•')} ${job.jobId} [${job.producer}]`);
		}
	}

	logger.info('');
}

/**
 * Display cost summary for the execution plan.
 */
export function displayCostSummary(
	summary: PlanCostSummary | undefined,
	logger: Logger
): void {
	if (!summary) {
		return;
	}

	logger.info(`\n${chalk.bold('=== Estimated Costs ===')}`);

	// Show missing providers/models warning
	if (summary.missingProviders.length > 0) {
		for (const entry of summary.missingProviders) {
			if (entry.includes(':')) {
				// Provider:model format - model missing
				const [provider, model] = entry.split(':');
				logger.info(
					chalk.yellow(
						`  ! Model "${model}" not found in ${provider}.yaml pricing file`
					)
				);
			} else {
				// Just provider name - entire provider missing
				logger.info(
					chalk.yellow(
						`  ! Provider "${entry}" costs cannot be estimated (pricing file not found)`
					)
				);
			}
		}
	}

	// Show costs by producer
	logger.info(`${chalk.bold('By Producer:')}`);
	for (const [producer, data] of summary.byProducer) {
		const jobWord = data.count === 1 ? 'job' : 'jobs';

		// Show range if available, otherwise show single cost
		let costStr: string;
		let annotation = '';

		if (data.hasRanges && data.minCost !== data.maxCost) {
			costStr = formatCostRange(data.minCost, data.maxCost);
			annotation = chalk.cyan(' (input from artefact)');
		} else {
			costStr = formatCost(data.totalCost);
			if (data.hasPlaceholders) {
				annotation = chalk.yellow(' (estimate)');
			}
		}

		logger.info(
			`  • ${chalk.blue(producer)}: ${costStr}${annotation} (${data.count} ${jobWord})`
		);
	}

	// Show total with range if applicable
	let totalStr: string;
	let totalAnnotation = '';

	if (summary.hasRanges && summary.minTotalCost !== summary.maxTotalCost) {
		totalStr = formatCostRange(summary.minTotalCost, summary.maxTotalCost);
		totalAnnotation = chalk.cyan(' (some inputs from artefacts)');
	} else {
		totalStr = formatCost(summary.totalCost);
		if (summary.hasPlaceholders) {
			totalAnnotation = chalk.yellow(' (some estimates)');
		}
	}

	logger.info(
		`\n${chalk.bold('Total Estimated Cost:')} ${chalk.green(totalStr)}${totalAnnotation}`
	);
	logger.info('');
}

export interface DisplayExplanationOptions {
	explanation: PlanExplanation;
	logger?: Logger;
}

/**
 * Display plan explanation showing why each job was scheduled.
 * Used by --explain flag.
 */
export function displayPlanExplanation(options: DisplayExplanationOptions): void {
	const { explanation } = options;
	const logger = options.logger ?? globalThis.console;

	logger.info(`\n${chalk.bold('=== Plan Explanation ===')}`);
	logger.info(`${chalk.bold('Movie ID')}: ${explanation.movieId}`);
	logger.info(`${chalk.bold('Revision')}: ${explanation.revision}`);
	logger.info('');

	// Show surgical targets if present
	if (explanation.surgicalTargets && explanation.surgicalTargets.length > 0) {
		logger.info(`${chalk.bold('Surgical Targets')} (${explanation.surgicalTargets.length}):`);
		for (const target of explanation.surgicalTargets) {
			logger.info(`  ${chalk.dim('•')} ${chalk.cyan(target)}`);
		}
		logger.info('');
	}

	// Show dirty inputs
	logger.info(`${chalk.bold('Dirty Inputs')} (${explanation.dirtyInputs.length}):`);
	if (explanation.dirtyInputs.length === 0) {
		logger.info(`  ${chalk.dim('(none)')}`);
	} else {
		for (const input of explanation.dirtyInputs.slice(0, 20)) {
			logger.info(`  ${chalk.dim('•')} ${chalk.blue(input)}`);
		}
		if (explanation.dirtyInputs.length > 20) {
			logger.info(`  ${chalk.dim(`... and ${explanation.dirtyInputs.length - 20} more`)}`);
		}
	}
	logger.info('');

	// Show dirty artifacts
	logger.info(`${chalk.bold('Dirty Artifacts')} (${explanation.dirtyArtefacts.length}):`);
	if (explanation.dirtyArtefacts.length === 0) {
		logger.info(`  ${chalk.dim('(none)')}`);
	} else {
		for (const artifact of explanation.dirtyArtefacts.slice(0, 20)) {
			logger.info(`  ${chalk.dim('•')} ${chalk.magenta(artifact)}`);
		}
		if (explanation.dirtyArtefacts.length > 20) {
			logger.info(`  ${chalk.dim(`... and ${explanation.dirtyArtefacts.length - 20} more`)}`);
		}
	}
	logger.info('');

	// Show job scheduling reasons
	logger.info(`${chalk.bold('Job Scheduling Reasons:')}`);
	logger.info('');

	if (explanation.jobReasons.length === 0) {
		logger.info(`  ${chalk.dim('(no jobs scheduled)')}`);
	} else {
		for (const jobReason of explanation.jobReasons) {
			const reasonLabel = formatReasonLabel(jobReason.reason);
			logger.info(`  ${chalk.bold(jobReason.jobId)} - ${reasonLabel}`);

			// Show details based on reason
			switch (jobReason.reason) {
				case 'initial':
					logger.info(`    ${chalk.dim('Manifest has no inputs (initial run)')}`);
					break;
				case 'producesMissing':
					if (jobReason.missingArtifacts && jobReason.missingArtifacts.length > 0) {
						logger.info(`    ${chalk.dim('Missing:')}`);
						for (const artifact of jobReason.missingArtifacts.slice(0, 5)) {
							logger.info(`      ${chalk.dim('-')} ${chalk.magenta(artifact)}`);
						}
						if (jobReason.missingArtifacts.length > 5) {
							logger.info(`      ${chalk.dim(`... and ${jobReason.missingArtifacts.length - 5} more`)}`);
						}
					}
					break;
				case 'touchesDirtyInput':
					if (jobReason.dirtyInputs && jobReason.dirtyInputs.length > 0) {
						const inputsList = jobReason.dirtyInputs.slice(0, 3).join(', ');
						const more = jobReason.dirtyInputs.length > 3 ? ` (+${jobReason.dirtyInputs.length - 3} more)` : '';
						logger.info(`    ${chalk.dim('Dirty inputs:')} ${inputsList}${more}`);
					}
					break;
				case 'touchesDirtyArtefact':
					if (jobReason.dirtyArtefacts && jobReason.dirtyArtefacts.length > 0) {
						const artifactsList = jobReason.dirtyArtefacts.slice(0, 3).join(', ');
						const more = jobReason.dirtyArtefacts.length > 3 ? ` (+${jobReason.dirtyArtefacts.length - 3} more)` : '';
						logger.info(`    ${chalk.dim('Dirty artifacts:')} ${artifactsList}${more}`);
					}
					break;
				case 'propagated':
					if (jobReason.propagatedFrom) {
						logger.info(`    ${chalk.dim('Propagated from:')} ${chalk.blue(jobReason.propagatedFrom)}`);
					}
					break;
			}
			logger.info('');
		}
	}

	// Show summary
	logger.info(`${chalk.bold('Summary:')}`);
	logger.info(`  Initial dirty jobs: ${explanation.initialDirtyJobs.length}`);
	logger.info(`  Propagated jobs: ${explanation.propagatedJobs.length}`);
	logger.info(`  Total jobs in plan: ${explanation.jobReasons.length}`);
	logger.info('');
}

/**
 * Format a reason code as a human-readable label.
 */
function formatReasonLabel(reason: string): string {
	switch (reason) {
		case 'initial':
			return chalk.yellow('INITIAL RUN');
		case 'producesMissing':
			return chalk.red('PRODUCES MISSING ARTIFACTS');
		case 'touchesDirtyInput':
			return chalk.cyan('TOUCHES DIRTY INPUTS');
		case 'touchesDirtyArtefact':
			return chalk.magenta('TOUCHES DIRTY ARTIFACTS');
		case 'propagated':
			return chalk.blue('PROPAGATED FROM UPSTREAM');
		default:
			return reason;
	}
}
