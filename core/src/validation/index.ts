/**
 * Blueprint Validation Module
 *
 * Provides comprehensive validation for blueprint trees,
 * detecting errors and warnings before graph building.
 */

// Types
export {
  type ValidationSeverity,
  type ValidationLocation,
  type ValidationIssue,
  type ValidationResult,
  type ValidatorOptions,
  type ValidationErrorCodeValue,
  ValidationErrorCode,
  VALID_INPUT_TYPES,
  VALID_ARTIFACT_TYPES,
  VALID_ITEM_TYPES,
  createIssue,
  createError,
  createWarning,
  buildValidationResult,
} from './types.js';

// Main validator
export {
  validateBlueprintTree,
  // Individual validators (exported for testing)
  validateConnectionEndpoints,
  validateProducerInputOutput,
  validateLoopCountInputs,
  validateArtifactCountInputs,
  validateCollectors,
  validateCollectorConnections,
  validateConditionPaths,
  validateTypes,
  validateProducerCycles,
  validateDimensionConsistency,
  findUnusedInputs,
  findUnusedArtifacts,
  findUnreachableProducers,
} from './blueprint-validator.js';
