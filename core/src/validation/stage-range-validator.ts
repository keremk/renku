/**
 * Stage Range Validator
 *
 * Validates that stage ranges are valid for execution.
 * Enforces business rules:
 * - Ranges must be contiguous (start to end)
 * - Clean runs (no manifest) must start from stage 0
 * - Subsequent runs can start from stage N only if stage N-1 succeeded
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Status of a stage derived from producer/artifact statuses.
 */
export type StageStatus = 'succeeded' | 'failed' | 'not-run';

/**
 * A stage range for execution.
 */
export interface StageRange {
  /** Start stage index (0-indexed) */
  startStage: number;
  /** End stage index (0-indexed, inclusive) */
  endStage: number;
}

/**
 * Context for validating a stage range.
 */
export interface StageValidationContext {
  /** Total number of stages in the plan */
  totalStages: number;
  /** Array of stage statuses, or null for a clean run (no previous manifest) */
  stageStatuses: StageStatus[] | null;
}

/**
 * Issue found during stage range validation.
 */
export interface StageValidationIssue {
  /** Type of issue */
  type: 'bounds' | 'non-contiguous' | 'clean-run' | 'predecessor-not-succeeded';
  /** Human-readable message */
  message: string;
}

/**
 * Result of stage range validation.
 */
export interface StageValidationResult {
  /** Whether the range is valid */
  valid: boolean;
  /** Issues found (empty if valid) */
  issues: StageValidationIssue[];
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validates a proposed stage range against the validation context.
 *
 * @param range - The proposed stage range
 * @param context - The validation context (total stages and previous statuses)
 * @returns Validation result with any issues found
 */
export function validateStageRange(
  range: StageRange,
  context: StageValidationContext,
): StageValidationResult {
  const issues: StageValidationIssue[] = [];

  // Check bounds
  if (range.startStage < 0) {
    issues.push({
      type: 'bounds',
      message: `Start stage ${range.startStage} is negative`,
    });
  }

  if (range.endStage >= context.totalStages) {
    issues.push({
      type: 'bounds',
      message: `End stage ${range.endStage} exceeds total stages (${context.totalStages - 1} max)`,
    });
  }

  // Check contiguity (start <= end)
  if (range.startStage > range.endStage) {
    issues.push({
      type: 'non-contiguous',
      message: `Start stage ${range.startStage} is after end stage ${range.endStage}`,
    });
  }

  // If we already have issues, return early (basic validation failed)
  if (issues.length > 0) {
    return { valid: false, issues };
  }

  // Check clean run rule: must start from stage 0
  if (context.stageStatuses === null && range.startStage !== 0) {
    issues.push({
      type: 'clean-run',
      message: `Clean runs must start from stage 0 (requested: ${range.startStage})`,
    });
  }

  // Check predecessor rule: previous stage must have succeeded
  if (context.stageStatuses !== null && range.startStage > 0) {
    const predecessorStatus = context.stageStatuses[range.startStage - 1];
    if (predecessorStatus !== 'succeeded') {
      issues.push({
        type: 'predecessor-not-succeeded',
        message: `Cannot start from stage ${range.startStage}: previous stage ${range.startStage - 1} has status "${predecessorStatus}"`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Checks if a specific stage index is a valid start stage.
 *
 * @param stageIndex - The stage index to check
 * @param context - The validation context
 * @returns True if the stage can be used as a start stage
 */
export function isValidStartStage(
  stageIndex: number,
  context: StageValidationContext,
): boolean {
  // Bounds check
  if (stageIndex < 0 || stageIndex >= context.totalStages) {
    return false;
  }

  // Clean run: only stage 0 is valid
  if (context.stageStatuses === null) {
    return stageIndex === 0;
  }

  // Subsequent run: stage 0 is always valid, or previous stage must have succeeded
  if (stageIndex === 0) {
    return true;
  }

  return context.stageStatuses[stageIndex - 1] === 'succeeded';
}

/**
 * Gets all valid start stages for the given context.
 *
 * @param context - The validation context
 * @returns Set of valid start stage indices
 */
export function getValidStartStages(context: StageValidationContext): Set<number> {
  const validStages = new Set<number>();

  for (let i = 0; i < context.totalStages; i++) {
    if (isValidStartStage(i, context)) {
      validStages.add(i);
    }
  }

  return validStages;
}

/**
 * Derives stage statuses from layer breakdown and artifact statuses.
 *
 * Uses a conservative approach:
 * - A stage is 'succeeded' only if ALL producers in that layer completed successfully
 * - A stage is 'failed' if ANY producer in that layer failed
 * - A stage is 'not-run' if no producers have run yet
 *
 * @param producersByLayer - Array of producer name arrays, one per layer (from plan layerBreakdown)
 * @param artifactStatuses - Map of artifact/producer name to status (from manifest)
 * @returns Array of stage statuses, one per layer
 */
export function deriveStageStatuses(
  producersByLayer: string[][],
  artifactStatuses: Map<string, 'succeeded' | 'failed'>,
): StageStatus[] {
  return producersByLayer.map((producers) => {
    if (producers.length === 0) {
      // Empty layers are considered succeeded (nothing to run)
      return 'succeeded';
    }

    let hasAnyRun = false;
    let hasAnyFailed = false;
    let allSucceeded = true;

    for (const producer of producers) {
      const status = artifactStatuses.get(producer);

      if (status !== undefined) {
        hasAnyRun = true;

        if (status === 'failed') {
          hasAnyFailed = true;
          allSucceeded = false;
        } else if (status !== 'succeeded') {
          allSucceeded = false;
        }
      } else {
        // Producer hasn't run
        allSucceeded = false;
      }
    }

    if (!hasAnyRun) {
      return 'not-run';
    }

    if (hasAnyFailed) {
      return 'failed';
    }

    if (allSucceeded) {
      return 'succeeded';
    }

    // Some ran, some didn't, none failed -> partial run, treat as not-run for safety
    return 'not-run';
  });
}

/**
 * Derives stage statuses from layer display info and artifact info.
 * This is a convenience wrapper for UI consumption that works with
 * the types available in the viewer.
 *
 * @param layerBreakdown - Layer breakdown from plan display info
 * @param artifacts - Artifacts from manifest response
 * @returns Array of stage statuses, one per layer
 */
export function deriveStageStatusesFromDisplayInfo(
  layerBreakdown: Array<{ jobs: Array<{ producer: string }> }>,
  artifacts: Array<{ id: string; status: string }>,
): StageStatus[] {
  // Extract producers by layer
  const producersByLayer = layerBreakdown.map((layer) =>
    layer.jobs.map((job) => job.producer),
  );

  // Build artifact status map from producer names
  // Artifact ID format: "Artifact:ProducerName.OutputName[index]"
  const artifactStatuses = new Map<string, 'succeeded' | 'failed'>();

  for (const artifact of artifacts) {
    const match = artifact.id.match(/^Artifact:([^.]+)\./);
    if (match) {
      const producer = match[1];
      const status = artifact.status === 'succeeded' ? 'succeeded' : 'failed';

      // Keep worst status for producer (failed > succeeded)
      const existing = artifactStatuses.get(producer);
      if (!existing || status === 'failed') {
        artifactStatuses.set(producer, status);
      }
    }
  }

  return deriveStageStatuses(producersByLayer, artifactStatuses);
}
