/**
 * Browser-safe exports from @gorenku/core
 *
 * This module exports only pure TypeScript code with no Node.js dependencies.
 * Use this entry point for browser/Vite builds:
 *
 *   import { StageStatus, isValidStartStage } from '@gorenku/core/browser';
 */

// Stage range validation (pure TypeScript, no dependencies)
export {
  type StageStatus,
  type StageRange,
  type StageValidationContext,
  type StageValidationIssue,
  type StageValidationResult,
  validateStageRange,
  isValidStartStage,
  getValidStartStages,
  deriveStageStatuses,
  deriveStageStatusesFromDisplayInfo,
} from './validation/stage-range-validator.js';
