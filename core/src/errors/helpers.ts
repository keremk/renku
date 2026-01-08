/**
 * Error creation helpers for the Renku error system.
 *
 * Provides factory functions for creating structured errors with
 * consistent formatting across all error categories.
 */

import type { ErrorLocation, ErrorSeverity, RenkuError } from './types.js';
import { getErrorCategory, getErrorSeverity } from './codes.js';

/**
 * Options for creating a Renku error.
 */
export interface CreateErrorOptions {
  /** Error code (e.g., 'P001', 'V003') */
  code: string;
  /** Error message */
  message: string;
  /** Location information */
  location?: ErrorLocation;
  /** Suggested fix */
  suggestion?: string;
  /** Original error that caused this error */
  cause?: unknown;
}

/**
 * Creates a RenkuError with the given options.
 *
 * The category and severity are automatically inferred from the error code.
 */
export function createRenkuError(options: CreateErrorOptions): RenkuError {
  const { code, message, location, suggestion, cause } = options;

  const error = new Error(message, { cause }) as RenkuError;
  error.name = 'RenkuError';
  error.code = code;
  error.category = getErrorCategory(code);
  error.severity = getErrorSeverity(code);
  error.location = location;
  error.suggestion = suggestion;

  return error;
}

/**
 * Creates a parser error (P-code).
 */
export function createParserError(
  code: string,
  message: string,
  options: {
    filePath?: string;
    context?: string;
    suggestion?: string;
    cause?: unknown;
  } = {},
): RenkuError {
  return createRenkuError({
    code,
    message,
    location: {
      filePath: options.filePath,
      context: options.context,
    },
    suggestion: options.suggestion,
    cause: options.cause,
  });
}

/**
 * Creates a validation error (V-code).
 */
export function createValidationError(
  code: string,
  message: string,
  options: {
    filePath?: string;
    namespacePath?: string[];
    context?: string;
    suggestion?: string;
  } = {},
): RenkuError {
  return createRenkuError({
    code,
    message,
    location: {
      filePath: options.filePath,
      namespacePath: options.namespacePath,
      context: options.context,
    },
    suggestion: options.suggestion,
  });
}

/**
 * Creates a runtime error (R-code).
 */
export function createRuntimeError(
  code: string,
  message: string,
  options: {
    filePath?: string;
    context?: string;
    suggestion?: string;
    cause?: unknown;
  } = {},
): RenkuError {
  return createRenkuError({
    code,
    message,
    location: {
      filePath: options.filePath,
      context: options.context,
    },
    suggestion: options.suggestion,
    cause: options.cause,
  });
}

// =============================================================================
// Validation Issue Types (for backward compatibility)
// =============================================================================

/**
 * A single validation issue (error or warning).
 * This maintains compatibility with the existing validation system.
 */
export interface ValidationIssue {
  /** Unique error code for programmatic handling (e.g., "V001", "W001") */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Severity level */
  severity: ErrorSeverity;
  /** Location information */
  location: {
    filePath?: string;
    namespacePath: string[];
    context: string;
  };
  /** Suggested fix (optional) */
  suggestion?: string;
}

/**
 * Result of validating a blueprint tree.
 */
export interface ValidationResult {
  /** True if there are no hard errors (warnings are allowed) */
  valid: boolean;
  /** All validation issues found */
  issues: ValidationIssue[];
  /** Convenience accessor for errors only */
  errors: ValidationIssue[];
  /** Convenience accessor for warnings only */
  warnings: ValidationIssue[];
}

/**
 * Creates a validation issue (for use in blueprint validation).
 */
export function createValidationIssue(
  code: string,
  message: string,
  severity: ErrorSeverity,
  location: { filePath?: string; namespacePath: string[]; context: string },
  suggestion?: string,
): ValidationIssue {
  return {
    code,
    message,
    severity,
    location,
    suggestion,
  };
}

/**
 * Creates a validation error issue.
 */
export function createErrorIssue(
  code: string,
  message: string,
  location: { filePath?: string; namespacePath: string[]; context: string },
  suggestion?: string,
): ValidationIssue {
  return createValidationIssue(code, message, 'error', location, suggestion);
}

/**
 * Creates a validation warning issue.
 */
export function createWarningIssue(
  code: string,
  message: string,
  location: { filePath?: string; namespacePath: string[]; context: string },
  suggestion?: string,
): ValidationIssue {
  return createValidationIssue(code, message, 'warning', location, suggestion);
}

/**
 * Builds a ValidationResult from a list of issues.
 */
export function buildValidationResult(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings,
  };
}

// =============================================================================
// Error Formatting
// =============================================================================

/**
 * Formats a RenkuError for display.
 */
export function formatError(error: RenkuError): string {
  const parts: string[] = [];

  // Code and message
  parts.push(`[${error.code}] ${error.message}`);

  // Location
  if (error.location) {
    const loc = error.location;
    if (loc.filePath) {
      parts.push(`  File: ${loc.filePath}`);
    }
    if (loc.namespacePath && loc.namespacePath.length > 0) {
      parts.push(`  Path: ${loc.namespacePath.join(' > ')}`);
    }
    if (loc.context) {
      parts.push(`  Context: ${loc.context}`);
    }
  }

  // Suggestion
  if (error.suggestion) {
    parts.push(`  Suggestion: ${error.suggestion}`);
  }

  return parts.join('\n');
}

/**
 * Formats a ValidationIssue for display.
 */
export function formatValidationIssue(issue: ValidationIssue): string {
  const prefix = issue.severity === 'error' ? 'ERROR' : 'WARNING';
  const parts: string[] = [];

  parts.push(`${prefix} [${issue.code}]: ${issue.message}`);

  if (issue.location.filePath) {
    parts.push(`  File: ${issue.location.filePath}`);
  }
  if (issue.location.namespacePath.length > 0) {
    parts.push(`  Path: ${issue.location.namespacePath.join(' > ')}`);
  }
  if (issue.location.context) {
    parts.push(`  Context: ${issue.location.context}`);
  }
  if (issue.suggestion) {
    parts.push(`  Suggestion: ${issue.suggestion}`);
  }

  return parts.join('\n');
}
