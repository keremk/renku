/**
 * Shared error types for the Renku error system.
 *
 * This module defines the common interfaces used across all error categories:
 * - P (Parser): Parsing errors
 * - V (Validation): Blueprint validation errors
 * - R (Runtime): Execution and planning errors
 * - S (SDK/Provider): Provider-level errors
 * - W (Warnings): Soft warnings across all layers
 */

/**
 * Error categories in the Renku system.
 */
export type ErrorCategory = 'parser' | 'validation' | 'runtime' | 'sdk';

/**
 * Severity level for issues.
 */
export type ErrorSeverity = 'error' | 'warning';

/**
 * Location information for an error.
 */
export interface ErrorLocation {
  /** File path (absolute) where the error occurred */
  filePath?: string;
  /** Namespace path for nested blueprints (e.g., ["ScriptProducer"]) */
  namespacePath?: string[];
  /** Element context (e.g., "connection from X to Y", "input 'Name'") */
  context?: string;
}

/**
 * Base interface for all Renku errors.
 *
 * All errors in the system should extend this interface to provide
 * consistent error information for logging, display, and debugging.
 */
export interface RenkuError extends Error {
  /** Unique error code (e.g., 'P001', 'V003', 'R010', 'S001') */
  code: string;
  /** Error category for routing and display */
  category: ErrorCategory;
  /** Severity level */
  severity: ErrorSeverity;
  /** Location information */
  location?: ErrorLocation;
  /** Suggested fix (optional) */
  suggestion?: string;
}

/**
 * Type guard to check if an error is a RenkuError.
 */
export function isRenkuError(error: unknown): error is RenkuError {
  return (
    error instanceof Error &&
    'code' in error &&
    'category' in error &&
    'severity' in error &&
    typeof (error as RenkuError).code === 'string' &&
    typeof (error as RenkuError).category === 'string' &&
    typeof (error as RenkuError).severity === 'string'
  );
}

// Note: SerializedError is defined in core/src/types.ts to avoid circular dependencies
