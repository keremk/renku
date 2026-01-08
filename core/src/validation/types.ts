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
  /** Unique error code for programmatic handling (e.g., "V001", "W001") */
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
 * V-codes are hard errors that make the blueprint invalid.
 * W-codes are soft warnings that don't invalidate the blueprint.
 */
export const ValidationErrorCode = {
  // Connection endpoint errors (V001-V007)
  INVALID_CONNECTION_SOURCE: 'V001',
  INVALID_CONNECTION_TARGET: 'V002',
  PRODUCER_NOT_FOUND: 'V003',
  INPUT_NOT_FOUND: 'V004',
  ARTIFACT_NOT_FOUND: 'V005',
  INVALID_NESTED_PATH: 'V006',
  DIMENSION_MISMATCH: 'V007',

  // Producer input/output matching errors (V010-V011)
  PRODUCER_INPUT_MISMATCH: 'V010',
  PRODUCER_OUTPUT_MISMATCH: 'V011',

  // Loop validation errors (V020-V021)
  LOOP_COUNTINPUT_NOT_FOUND: 'V020',
  PRODUCER_CYCLE: 'V021',

  // Artifact validation errors (V030)
  ARTIFACT_COUNTINPUT_NOT_FOUND: 'V030',

  // Collector validation errors (V040-V042)
  COLLECTOR_SOURCE_INVALID: 'V040',
  COLLECTOR_TARGET_INVALID: 'V041',
  COLLECTOR_MISSING_CONNECTION: 'V042',

  // Condition validation errors (V050)
  CONDITION_PATH_INVALID: 'V050',

  // Type validation errors (V060-V062)
  INVALID_INPUT_TYPE: 'V060',
  INVALID_ARTIFACT_TYPE: 'V061',
  INVALID_ITEM_TYPE: 'V062',

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
