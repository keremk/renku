/**
 * Unified error code constants for the Renku system.
 *
 * Code format: {Category}{Number}
 * - P: Parser errors (P001-P099)
 * - V: Validation errors (V001-V099)
 * - R: Runtime errors (R001-R099)
 * - S: SDK/Provider errors (S001-S099)
 * - W: Warnings (W001-W099)
 */

// =============================================================================
// Parser Error Codes (P001-P099)
// =============================================================================

export const ParserErrorCode = {
  // P001-P009: Document Structure
  INVALID_YAML_DOCUMENT: 'P001',
  MISSING_REQUIRED_SECTION: 'P002',
  CIRCULAR_BLUEPRINT_REFERENCE: 'P003',

  // P010-P019: Loop Parsing
  INVALID_LOOP_ENTRY: 'P010',
  DUPLICATE_LOOP_NAME: 'P011',
  INVALID_LOOP_COUNTINPUT: 'P012',
  INVALID_LOOP_PARENT: 'P013',

  // P020-P029: Input/Artifact Parsing
  INVALID_INPUT_ENTRY: 'P020',
  INVALID_ARTIFACT_ENTRY: 'P021',
  MISSING_REQUIRED_FIELD: 'P022',
  INVALID_COUNTINPUT_CONFIG: 'P023',
  INVALID_ARRAYS_CONFIG: 'P024',

  // P030-P039: Producer Parsing
  INVALID_PRODUCER_ENTRY: 'P030',
  PRODUCER_PATH_AND_NAME_CONFLICT: 'P031',
  MISSING_CATALOG_ROOT: 'P032',
  UNKNOWN_PRODUCER_REFERENCE: 'P033',
  INVALID_PRODUCER_LOOP: 'P034',

  // P040-P049: Connection/Edge Parsing
  INVALID_CONNECTION_ENTRY: 'P040',
  INVALID_ENDPOINT_REFERENCE: 'P041',
  INVALID_DIMENSION_SELECTOR: 'P042',
  INVALID_INLINE_PRODUCER: 'P043',

  // P050-P059: Collector Parsing
  INVALID_COLLECTOR_ENTRY: 'P050',
  DUPLICATE_COLLECTOR_NAME: 'P051',
  UNKNOWN_LOOP_IN_COLLECTOR: 'P052',

  // P060-P069: Condition Parsing
  INVALID_CONDITION_ENTRY: 'P060',
  MISSING_CONDITION_OPERATOR: 'P061',
  INVALID_CONDITION_VALUE_TYPE: 'P062',
  INVALID_CONDITION_GROUP: 'P063',

  // P070-P079: Mapping Parsing
  INVALID_MAPPING_TRANSFORM: 'P070',
  INVALID_DURATION_TO_FRAMES: 'P071',
  INVALID_CONDITIONAL_MAPPING: 'P072',
  INVALID_COMBINE_TRANSFORM: 'P073',
  INVALID_SDK_MAPPING: 'P074',
  INVALID_OUTPUT_ENTRY: 'P075',
  INVALID_MAPPING_VALUE: 'P076',
  PATH_ESCAPES_ROOT: 'P077',

  // P080-P089: Input File Parsing
  INVALID_INPUT_FILE_EXTENSION: 'P080',
  MISSING_INPUTS_MAPPING: 'P081',
  DUPLICATE_INPUT_KEY: 'P082',
  UNKNOWN_PRODUCER_IN_MODELS: 'P083',
  INVALID_MODEL_ENTRY: 'P084',
  INVALID_ARTIFACT_OVERRIDE: 'P085',
  FILE_LOAD_FAILED: 'P086',

  // P090-P099: Canonical ID Parsing
  INVALID_CANONICAL_ID: 'P090',
  EMPTY_CANONICAL_ID_BODY: 'P091',
  UNKNOWN_CANONICAL_ID: 'P092',
  INVALID_PRODUCER_NAME: 'P093',
  INVALID_INPUT_KEY: 'P094',
} as const;

export type ParserErrorCodeValue = (typeof ParserErrorCode)[keyof typeof ParserErrorCode];

// =============================================================================
// Validation Error Codes (V001-V099)
// =============================================================================

export const ValidationErrorCode = {
  // V001-V009: Connection Endpoints
  INVALID_CONNECTION_SOURCE: 'V001',
  INVALID_CONNECTION_TARGET: 'V002',
  PRODUCER_NOT_FOUND: 'V003',
  INPUT_NOT_FOUND: 'V004',
  ARTIFACT_NOT_FOUND: 'V005',
  INVALID_NESTED_PATH: 'V006',
  DIMENSION_MISMATCH: 'V007',

  // V010-V019: Producer Matching
  PRODUCER_INPUT_MISMATCH: 'V010',
  PRODUCER_OUTPUT_MISMATCH: 'V011',

  // V020-V029: Loop & Cycle Validation
  LOOP_COUNTINPUT_NOT_FOUND: 'V020',
  PRODUCER_CYCLE: 'V021',

  // V030-V039: Artifact Validation
  ARTIFACT_COUNTINPUT_NOT_FOUND: 'V030',

  // V040-V049: Collector Validation
  COLLECTOR_SOURCE_INVALID: 'V040',
  COLLECTOR_TARGET_INVALID: 'V041',
  COLLECTOR_MISSING_CONNECTION: 'V042',

  // V050-V059: Condition Validation
  CONDITION_PATH_INVALID: 'V050',

  // V060-V069: Type Validation
  INVALID_INPUT_TYPE: 'V060',
  INVALID_ARTIFACT_TYPE: 'V061',
  INVALID_ITEM_TYPE: 'V062',
} as const;

export type ValidationErrorCodeValue = (typeof ValidationErrorCode)[keyof typeof ValidationErrorCode];

// =============================================================================
// Runtime Error Codes (R001-R099)
// =============================================================================

export const RuntimeErrorCode = {
  // R001-R009: Manifest
  MANIFEST_NOT_FOUND: 'R001',
  MANIFEST_HASH_CONFLICT: 'R002',
  CORRUPTED_POINTER_FILE: 'R003',

  // R010-R019: Planning
  CYCLIC_DEPENDENCY: 'R010',
  MISSING_PRODUCER_CATALOG_ENTRY: 'R011',
  MULTIPLE_UPSTREAM_INPUTS: 'R012',
  NON_INPUT_UPSTREAM: 'R013',

  // R020-R029: Execution
  MISSING_BLOB_PAYLOAD: 'R020',
  ARTIFACT_RESOLUTION_FAILED: 'R021',
  INVALID_JSON_ARTIFACT: 'R022',
  INVALID_RERUN_FROM_VALUE: 'R023',
  RERUN_FROM_EXCEEDS_LAYERS: 'R024',
  RERUN_FROM_GREATER_THAN_UPTO: 'R025',

  // R030-R039: Model Configuration
  MISSING_OUTPUT_SCHEMA: 'R030',
  INVALID_OUTPUT_SCHEMA_JSON: 'R031',
  NO_PRODUCER_OPTIONS: 'R032',
  FAILED_SCHEMA_PARSING: 'R033',
  AMBIGUOUS_MODEL_SELECTION: 'R034',

  // R040-R049: Input Validation
  NON_CANONICAL_INPUT_ID: 'R040',
  INVALID_INPUT_BINDING: 'R041',
  MISSING_REQUIRED_INPUT: 'R042',
  INVALID_INPUT_VALUE: 'R043',

  // R050-R059: JSON Path
  INVALID_JSON_PATH: 'R050',

  // R060-R069: Infrastructure
  NOTIFICATION_BUS_COMPLETED: 'R060',
  STORAGE_PATH_ESCAPE: 'R061',
  UNSUPPORTED_STORAGE_CONFIG: 'R062',

  // R070-R079: Graph Expansion
  GRAPH_EXPANSION_ERROR: 'R070',
  MISSING_DIMENSION_SIZE: 'R071',
  MISSING_DIMENSION_INDEX: 'R072',
  ALIAS_CYCLE_DETECTED: 'R073',
  MISSING_INPUT_SOURCE: 'R074',
  UNKNOWN_NODE_KIND: 'R075',

  // R080-R089: Graph Building
  GRAPH_BUILD_ERROR: 'R080',
  INVALID_REFERENCE: 'R081',
  UNKNOWN_NAMESPACE: 'R082',
  INVALID_DIMENSION_SELECTOR: 'R083',

  // R090-R099: Condition Evaluation
  CONDITION_EVALUATION_ERROR: 'R090',
} as const;

export type RuntimeErrorCodeValue = (typeof RuntimeErrorCode)[keyof typeof RuntimeErrorCode];

// =============================================================================
// SDK/Provider Error Codes (S001-S099)
// =============================================================================

export const SdkErrorCode = {
  // S001-S009: Configuration
  INVALID_CONFIG: 'S001',
  MISSING_REQUIRED_INPUT: 'S002',
  MISSING_INPUT_SCHEMA: 'S003',
  UNKNOWN_ARTEFACT: 'S004',

  // S010-S019: Timeline Producer
  MISSING_SEGMENTS: 'S010',
  MISSING_FANIN_DATA: 'S011',
  MISSING_STORAGE_ROOT: 'S012',
  UNSUPPORTED_CLIP_KIND: 'S013',
  MISSING_ASSET: 'S014',
  MISSING_DURATION: 'S015',
  ASSET_DURATION_FAILED: 'S016',
  MISSING_ASSET_PAYLOAD: 'S017',

  // S020-S029: Export Producer
  MISSING_MANIFEST: 'S020',
  MISSING_TIMELINE: 'S021',
  INVALID_TIMELINE_PAYLOAD: 'S022',
  FFMPEG_NOT_FOUND: 'S023',
  RENDER_FAILED: 'S024',
  MISSING_TIMELINE_BLOB: 'S025',

  // S030-S039: API Errors
  RATE_LIMITED: 'S030',
  PROVIDER_PREDICTION_FAILED: 'S031',
  SCHEMA_VALIDATION_FAILED: 'S032',
  CLOUD_STORAGE_URL_FAILED: 'S033',
  QUOTA_EXCEEDED: 'S034',
  INVALID_API_KEY: 'S035',
  INVALID_VOICE: 'S036',
  SUBSCRIPTION_REQUIRED: 'S037',
  CHARACTER_LIMIT_EXCEEDED: 'S038',
  SYSTEM_BUSY: 'S039',

  // S040-S049: Mapping/Transform Errors
  MISSING_FIELD_PROPERTY: 'S040',
  CANNOT_EXPAND_NON_OBJECT: 'S041',
  INVALID_CONDITION_CONFIG: 'S042',
  BLOB_INPUT_NO_STORAGE: 'S043',
  COMBINE_REQUIRES_FIELD: 'S044',

  // S050-S059: FFmpeg Video Extraction
  FFMPEG_EXTRACTION_FAILED: 'S050',
  FFMPEG_NO_AUDIO_STREAM: 'S051',
  FFMPEG_TEMP_FILE_ERROR: 'S052',
} as const;

export type SdkErrorCodeValue = (typeof SdkErrorCode)[keyof typeof SdkErrorCode];

// =============================================================================
// Warning Codes (W001-W099)
// =============================================================================

export const WarningCode = {
  // W001-W009: Validation Warnings
  UNUSED_INPUT: 'W001',
  UNUSED_ARTIFACT: 'W002',
  UNREACHABLE_PRODUCER: 'W003',
} as const;

export type WarningCodeValue = (typeof WarningCode)[keyof typeof WarningCode];

// =============================================================================
// Combined Types
// =============================================================================

/**
 * All error codes in the system.
 */
export type ErrorCode =
  | ParserErrorCodeValue
  | ValidationErrorCodeValue
  | RuntimeErrorCodeValue
  | SdkErrorCodeValue
  | WarningCodeValue;

/**
 * Maps error code prefixes to their categories.
 */
export const ERROR_CODE_CATEGORIES = {
  P: 'parser',
  V: 'validation',
  R: 'runtime',
  S: 'sdk',
  W: 'validation', // Warnings are typically from validation
} as const;

/**
 * Gets the category for an error code.
 */
export function getErrorCategory(code: string): 'parser' | 'validation' | 'runtime' | 'sdk' {
  const prefix = code.charAt(0) as keyof typeof ERROR_CODE_CATEGORIES;
  return ERROR_CODE_CATEGORIES[prefix] ?? 'runtime';
}

/**
 * Gets the severity for an error code.
 */
export function getErrorSeverity(code: string): 'error' | 'warning' {
  return code.startsWith('W') ? 'warning' : 'error';
}
