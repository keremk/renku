/**
 * Blueprint validation types
 *
 * Defines the types for validation results, issues, and error codes
 * used throughout the validation system.
 */

/**
 * Severity level for validation issues
 */
export type ValidationSeverity = 'error' | 'warning';

/**
 * Location information for a validation issue
 */
export interface ValidationLocation {
  /** File path (absolute) where the issue was found */
  filePath?: string;
  /** Namespace path for nested blueprints (e.g., ["ScriptProducer"]) */
  namespacePath: string[];
  /** Element context (e.g., "connection from X to Y", "input 'Name'") */
  context: string;
}

/**
 * A single validation issue (error or warning)
 */
export interface ValidationIssue {
  /** Unique error code for programmatic handling (e.g., "E001", "W001") */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Severity level */
  severity: ValidationSeverity;
  /** Location information */
  location: ValidationLocation;
  /** Suggested fix (optional) */
  suggestion?: string;
}

/**
 * Result of validating a blueprint tree
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
 * Options for the blueprint validator
 */
export interface ValidatorOptions {
  /** Skip warning-level validations */
  errorsOnly?: boolean;
  /** Skip specific error codes */
  skipCodes?: string[];
}

/**
 * Error codes for validation issues
 *
 * E-codes are hard errors that make the blueprint invalid.
 * W-codes are soft warnings that don't invalidate the blueprint.
 */
export const ValidationErrorCode = {
  // Connection endpoint errors (E001-E006)
  INVALID_CONNECTION_SOURCE: 'E001',
  INVALID_CONNECTION_TARGET: 'E002',
  PRODUCER_NOT_FOUND: 'E003',
  INPUT_NOT_FOUND: 'E004',
  ARTIFACT_NOT_FOUND: 'E005',
  INVALID_NESTED_PATH: 'E006',

  // Producer input/output matching errors (E010-E011)
  PRODUCER_INPUT_MISMATCH: 'E010',
  PRODUCER_OUTPUT_MISMATCH: 'E011',

  // Loop validation errors (E020)
  LOOP_COUNTINPUT_NOT_FOUND: 'E020',

  // Artifact validation errors (E030)
  ARTIFACT_COUNTINPUT_NOT_FOUND: 'E030',

  // Collector validation errors (E040-E042)
  COLLECTOR_SOURCE_INVALID: 'E040',
  COLLECTOR_TARGET_INVALID: 'E041',
  COLLECTOR_MISSING_CONNECTION: 'E042',

  // Condition validation errors (E050)
  CONDITION_PATH_INVALID: 'E050',

  // Type validation errors (E060-E062)
  INVALID_INPUT_TYPE: 'E060',
  INVALID_ARTIFACT_TYPE: 'E061',
  INVALID_ITEM_TYPE: 'E062',

  // Warnings (W001-W003)
  UNUSED_INPUT: 'W001',
  UNUSED_ARTIFACT: 'W002',
  UNREACHABLE_PRODUCER: 'W003',
} as const;

/**
 * Type for the error code values
 */
export type ValidationErrorCodeValue =
  (typeof ValidationErrorCode)[keyof typeof ValidationErrorCode];

/**
 * Known valid input types
 */
export const VALID_INPUT_TYPES = new Set([
  'string',
  'int',
  'integer',
  'number',
  'boolean',
  'array',
  'collection',
  // Media types (for producer inputs that accept media)
  'image',
  'video',
  'audio',
  'json',
]);

/**
 * Known valid artifact types
 */
export const VALID_ARTIFACT_TYPES = new Set([
  'string',
  'image',
  'video',
  'audio',
  'json',
  'array',
  'multiDimArray',
]);

/**
 * Known valid item types for arrays
 */
export const VALID_ITEM_TYPES = new Set([
  'string',
  'image',
  'video',
  'audio',
  'json',
  'number',
  'integer',
  'boolean',
]);

/**
 * Creates a validation issue with the given properties
 */
export function createIssue(
  code: string,
  message: string,
  severity: ValidationSeverity,
  location: ValidationLocation,
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
 * Creates a validation error
 */
export function createError(
  code: string,
  message: string,
  location: ValidationLocation,
  suggestion?: string,
): ValidationIssue {
  return createIssue(code, message, 'error', location, suggestion);
}

/**
 * Creates a validation warning
 */
export function createWarning(
  code: string,
  message: string,
  location: ValidationLocation,
  suggestion?: string,
): ValidationIssue {
  return createIssue(code, message, 'warning', location, suggestion);
}

/**
 * Builds a ValidationResult from a list of issues
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
