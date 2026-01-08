/**
 * Renku Error System
 *
 * This module provides a unified error handling system across all layers:
 * - P (Parser): Parsing errors
 * - V (Validation): Blueprint validation errors
 * - R (Runtime): Execution and planning errors
 * - S (SDK/Provider): Provider-level errors
 * - W (Warnings): Soft warnings across all layers
 */

// Types
export type {
  ErrorCategory,
  ErrorLocation,
  ErrorSeverity,
  RenkuError,
} from './types.js';
export { isRenkuError } from './types.js';

// Error Codes
// Note: ValidationErrorCode is still exported from validation/types.ts for now
// During migration, we'll update validation to use these new V-codes
export {
  ParserErrorCode,
  RuntimeErrorCode,
  SdkErrorCode,
  WarningCode,
  ERROR_CODE_CATEGORIES,
  getErrorCategory,
  getErrorSeverity,
} from './codes.js';
export type {
  ParserErrorCodeValue,
  RuntimeErrorCodeValue,
  SdkErrorCodeValue,
  WarningCodeValue,
  ErrorCode,
} from './codes.js';

// Internal exports for validation migration (not re-exported from core)
export { ValidationErrorCode as NewValidationErrorCode } from './codes.js';
export type { ValidationErrorCodeValue as NewValidationErrorCodeValue } from './codes.js';

// Helpers
export type { CreateErrorOptions } from './helpers.js';
export {
  createRenkuError,
  createParserError,
  createValidationError,
  createRuntimeError,
  formatError,
} from './helpers.js';

// Validation helpers (these don't conflict - validation uses createError/createWarning)
export {
  createValidationIssue,
  createErrorIssue,
  createWarningIssue,
  formatValidationIssue,
} from './helpers.js';
