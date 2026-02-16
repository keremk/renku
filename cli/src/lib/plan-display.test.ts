import { describe, expect, it } from 'vitest';
import type {
	Logger,
	PlanExplanation,
	RecoveryPrepassSummary,
} from '@gorenku/core';
import { displayPlanExplanation } from './plan-display.js';

describe('displayPlanExplanation recovery section', () => {
	it('includes recovery summary details in explain output', () => {
		const lines: string[] = [];
		const logger: Logger = {
			info: (message: string) => {
				lines.push(message);
			},
			debug: () => {},
			warn: () => {},
			error: () => {},
		};

		const explanation: PlanExplanation = {
			movieId: 'movie-test',
			revision: 'rev-0002',
			dirtyInputs: [],
			dirtyArtefacts: ['Artifact:AudioProducer.GeneratedAudio[0]'],
			jobReasons: [
				{
					jobId: 'Producer:AudioProducer[0]',
					producer: 'AudioProducer',
					reason: 'latestAttemptFailed',
					failedArtifacts: ['Artifact:AudioProducer.GeneratedAudio[0]'],
				},
			],
			initialDirtyJobs: ['Producer:AudioProducer[0]'],
			propagatedJobs: [],
		};

		const recoverySummary: RecoveryPrepassSummary = {
			checkedArtifactIds: ['Artifact:AudioProducer.GeneratedAudio[0]'],
			recoveredArtifactIds: [],
			pendingArtifactIds: ['Artifact:AudioProducer.GeneratedAudio[0]'],
			failedArtifactIds: [],
			failedRecoveries: [],
		};

		displayPlanExplanation({
			explanation,
			recoverySummary,
			logger,
		});

		const output = lines.join('\n');
		expect(output).toContain('Recovery Prepass');
		expect(output).toContain('Checked artifacts (1)');
		expect(output).toContain('Pending artifacts (1)');
		expect(output).toContain('Failed recovery attempts (0)');
	});
});
