import {
  formatProducerScopedInputIdForCanonicalProducerId,
  isCanonicalId,
  type MappingFieldDefinition,
  type MappingCondition,
  type CombineTransform,
} from '@gorenku/core';
import { createProviderError, SdkErrorCode } from './errors.js';

interface KnownAspectRatio {
  label: string;
  value: number;
}

export interface AspectRatioProjection {
  label: string;
  errorPercent: number;
  outsideTolerance: boolean;
}

export const ASPECT_RATIO_MATCH_TOLERANCE_PERCENT = 2;

const KNOWN_ASPECT_RATIOS: KnownAspectRatio[] = [
  { label: '21:9', value: 21 / 9 },
  { label: '16:9', value: 16 / 9 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '1:1', value: 1 },
  { label: '2:3', value: 2 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:5', value: 4 / 5 },
  { label: '5:4', value: 5 / 4 },
  { label: '9:16', value: 9 / 16 },
];

/**
 * Context for applying transforms.
 * Contains all resolved inputs and their bindings.
 */
export interface TransformContext {
  /** All resolved input values keyed by canonical ID */
  inputs: Record<string, unknown>;
  /** Maps input aliases to canonical IDs */
  inputBindings: Record<string, string>;
  /** Canonical producer ID for producer-scoped input resolution. */
  producerId?: string;
}

/**
 * Result of applying a mapping transform.
 */
export type MappingResult =
  | { field: string; value: unknown }
  | { expand: Record<string, unknown> }
  | undefined;

/**
 * Applies a mapping transform to produce a field/value pair or expanded object.
 *
 * Transform application order:
 * 1. Check conditional -> skip if condition not met
 * 2. Apply combine -> merge multiple inputs
 * 3. Apply firstOf -> extract first from array
 * 4. Apply asArray -> wrap scalar as single-element array
 * 5. Apply flattenFanIn -> flatten grouped fan-in values into one array
 * 6. Apply invert -> flip boolean
 * 7. Apply intToString -> convert to string
 * 8. Apply durationToFrames -> multiply by fps
 * 9. Apply transform -> value lookup
 *
 * @param inputAlias - The producer input name (e.g., "AspectRatio")
 * @param mapping - The mapping field definition
 * @param context - Transform context with inputs and bindings
 * @returns The transformed field/value, expanded object, or undefined if skipped
 */
export function applyMapping(
  inputAlias: string,
  mapping: MappingFieldDefinition,
  context: TransformContext
): MappingResult {
  const sourceAlias = mapping.input ?? inputAlias;

  // 1. Check conditional - skip if condition not met
  if (mapping.conditional) {
    const conditionMet = evaluateCondition(mapping.conditional.when, context);
    if (!conditionMet) {
      return undefined;
    }
    // Recurse with the "then" mapping
    return applyMapping(sourceAlias, mapping.conditional.then, context);
  }

  // 2. Apply combine - merge multiple inputs into one value
  if (mapping.combine) {
    const combinedValue = applyCombineTransform(mapping.combine, context);
    if (combinedValue === undefined) {
      return undefined;
    }
    // Combined values may produce objects for expand
    if (
      mapping.expand &&
      typeof combinedValue === 'object' &&
      combinedValue !== null
    ) {
      return { expand: combinedValue as Record<string, unknown> };
    }
    if (!mapping.field) {
      throw createProviderError(
        SdkErrorCode.COMBINE_REQUIRES_FIELD,
        `Combine transform requires 'field' unless using 'expand'`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    return { field: mapping.field, value: combinedValue };
  }

  // Get the raw input value
  const canonicalId = resolveCanonicalBindingId(sourceAlias, context);
  let value: unknown;

  if (canonicalId) {
    assertCanonicalBindingId(sourceAlias, canonicalId);
    // Direct lookup succeeded - check if we have a resolved value
    value = resolveInputValue(canonicalId, context.inputs);
  }

  // If direct lookup didn't yield a value, check for element-level bindings
  // This handles cases where:
  // 1. Array inputs are bound element-by-element (e.g., ReferenceImages[0], ReferenceImages[1])
  // 2. Direct binding points to an unresolved Input node (e.g., "Input:VideoProducer.ReferenceImages[0]")
  if (value === undefined) {
    const elementBindings = collectElementBindings(
      sourceAlias,
      context.inputBindings
    );
    if (elementBindings.length > 0) {
      // Reconstruct array from element bindings, filtering out undefined values
      const elements = elementBindings.map((binding) =>
        resolveInputValue(binding.canonicalId, context.inputs)
      );
      // Only return if we have at least one valid element
      if (elements.some((element) => element !== undefined)) {
        value = elements;
      }
    }
  }

  if (value === undefined) {
    return undefined;
  }

  // 3. Apply firstOf - extract first element from array
  if (mapping.firstOf) {
    value = applyFirstOf(value);
    if (value === undefined) {
      return undefined;
    }
  }

  // 4. Apply asArray - wrap scalar values as single-element arrays
  if (mapping.asArray) {
    value = applyAsArray(value);
  }

  // 5. Apply flattenFanIn - flatten grouped fan-in values into one array
  if (mapping.flattenFanIn) {
    value = applyFlattenFanIn(value, context.inputs);
  }

  // 6. Apply invert - flip boolean value
  if (mapping.invert) {
    value = applyInvert(value);
  }

  // 7. Apply intToString - convert integer to string
  if (mapping.intToString) {
    value = applyIntToString(value);
  }

  // 7b. Apply intToSecondsString - convert integer to string with "s" suffix
  if (mapping.intToSecondsString) {
    value = applyIntToSecondsString(value);
  }

  // 8. Apply durationToFrames - convert seconds to frame count
  if (mapping.durationToFrames) {
    value = applyDurationToFrames(value, mapping.durationToFrames.fps);
  }

  // 8b. Apply resolution projection
  if (mapping.resolution) {
    value = applyResolutionTransform(value, mapping.resolution, sourceAlias);
  }

  // 9. Apply transform - value lookup table
  if (mapping.transform) {
    value = applyValueTransform(value, mapping.transform);
  }

  // Handle expand - spread object into payload
  if (mapping.expand) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return { expand: value as Record<string, unknown> };
    }
    throw createProviderError(
      SdkErrorCode.CANNOT_EXPAND_NON_OBJECT,
      `Cannot expand non-object value for "${inputAlias}". ` +
        `expand:true requires the value to be an object, got ${typeof value}.`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  // Regular field assignment
  if (!mapping.field) {
    throw createProviderError(
      SdkErrorCode.MISSING_FIELD_PROPERTY,
      `Mapping for "${inputAlias}" requires 'field' property`,
      { kind: 'user_input', causedByUser: true }
    );
  }
  return { field: mapping.field, value };
}

/**
 * Sets a value at a potentially nested path using dot notation.
 * Creates intermediate objects as needed.
 *
 * @example
 * setNestedValue(obj, "voice_setting.voice_id", "en-US")
 * // Results in: { voice_setting: { voice_id: "en-US" } }
 */
export function setNestedValue(
  payload: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = payload;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      !(part in current) ||
      typeof current[part] !== 'object' ||
      current[part] === null
    ) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const finalKey = parts[parts.length - 1];
  current[finalKey] = value;
}

/**
 * Evaluates a condition against the transform context.
 * @throws Error if condition has no valid operator (equals, notEmpty, empty)
 */
function evaluateCondition(
  condition: MappingCondition,
  context: TransformContext
): boolean {
  const canonicalId = resolveCanonicalBindingId(condition.input, context);
  if (canonicalId) {
    assertCanonicalBindingId(condition.input, canonicalId);
  }
  const value = canonicalId
    ? resolveInputValue(canonicalId, context.inputs)
    : undefined;

  // Check equals condition
  if ('equals' in condition) {
    return value === condition.equals;
  }

  // Check notEmpty condition
  if (condition.notEmpty) {
    return value !== undefined && value !== null && value !== '';
  }

  // Check empty condition
  if (condition.empty) {
    return value === undefined || value === null || value === '';
  }

  // No valid condition operator - this is likely a configuration error
  throw createProviderError(
    SdkErrorCode.INVALID_CONDITION_CONFIG,
    `Invalid condition for input "${condition.input}": ` +
      `must specify one of "equals", "notEmpty", or "empty".`,
    { kind: 'user_input', causedByUser: true }
  );
}

/**
 * Applies combine transform - merges multiple inputs using a lookup table.
 * Key format: "{value1}+{value2}" where empty values result in just "+" or "+{value2}"
 */
function applyCombineTransform(
  combine: CombineTransform,
  context: TransformContext
): unknown {
  // Build composite key from input values
  const keyParts: string[] = [];
  let hasAnyValue = false;

  for (const inputName of combine.inputs) {
    const canonicalId = resolveCanonicalBindingId(inputName, context);
    if (canonicalId) {
      assertCanonicalBindingId(inputName, canonicalId);
    }
    const value = canonicalId
      ? resolveInputValue(canonicalId, context.inputs)
      : undefined;

    if (value !== undefined && value !== null && value !== '') {
      keyParts.push(String(value));
      hasAnyValue = true;
    } else {
      keyParts.push('');
    }
  }

  // If no inputs have values, skip the combine
  if (!hasAnyValue) {
    return undefined;
  }

  const key = keyParts.join('+');

  // Look up the combined value
  if (key in combine.table) {
    return combine.table[key];
  }

  // No matching combination found
  return undefined;
}

/**
 * Applies firstOf transform - extracts first element from array.
 */
function applyFirstOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : undefined;
  }
  // If not an array, return as-is
  return value;
}

/**
 * Applies asArray transform - wraps scalar values as single-element arrays.
 */
function applyAsArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

function applyFlattenFanIn(
  value: unknown,
  resolvedInputs: Record<string, unknown>
): unknown {
  if (!isFanInResolvedValue(value)) {
    return value;
  }
  return value.groups.flat().flatMap((memberId) => {
    if (typeof memberId !== 'string') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Fan-in member IDs must be strings before flattenFanIn mapping.`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    if (!(memberId in resolvedInputs)) {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Fan-in member "${memberId}" was not resolved before SDK payload mapping.`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    const resolved = resolvedInputs[memberId];
    return Array.isArray(resolved) ? resolved : [resolved];
  });
}

function isFanInResolvedValue(
  value: unknown
): value is { groups: unknown[][] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const groups = (value as { groups?: unknown }).groups;
  return Array.isArray(groups) && groups.every((group) => Array.isArray(group));
}

/**
 * Applies invert transform - flips boolean value.
 */
function applyInvert(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return !value;
  }
  // For non-boolean values, treat truthy as true
  return !value;
}

/**
 * Applies intToString transform - converts integer to string.
 */
function applyIntToString(value: unknown): unknown {
  if (typeof value === 'number') {
    return String(value);
  }
  return value;
}

/**
 * Applies intToSecondsString transform - converts integer to string with "s" suffix.
 * Example: 8 → "8s"
 */
function applyIntToSecondsString(value: unknown): unknown {
  if (typeof value === 'number') {
    return `${value}s`;
  }
  return value;
}

/**
 * Applies durationToFrames transform - converts seconds to frame count.
 */
function applyDurationToFrames(value: unknown, fps: number): unknown {
  if (typeof value === 'number') {
    return Math.round(value * fps);
  }
  return value;
}

/**
 * Applies value transform - looks up value in transform table.
 */
function applyValueTransform(
  value: unknown,
  transform: Record<string, unknown>
): unknown {
  // Convert value to string for lookup (supports numbers, booleans, strings)
  const key = String(value);
  if (key in transform) {
    return transform[key];
  }
  // No matching transform, return original value
  return value;
}

function applyResolutionTransform(
  value: unknown,
  config: NonNullable<MappingFieldDefinition['resolution']>,
  inputAlias: string
): unknown {
  const resolution = parseResolutionValue(value, inputAlias);

  switch (config.mode) {
    case 'aspectRatio':
      return toAspectRatio(resolution.width, resolution.height);
    case 'preset':
      return toPreset(resolution.width, resolution.height, inputAlias);
    case 'sizeToken':
      return toSizeToken(resolution.width, resolution.height, inputAlias);
    case 'sizeTokenNearest':
      return toSizeTokenNearest(resolution.width, resolution.height);
    case 'aspectRatioAndPreset':
      return `${toAspectRatio(resolution.width, resolution.height)}+${toPreset(
        resolution.width,
        resolution.height,
        inputAlias
      )}`;
    case 'megapixelsNearest':
      return toMegapixelsNearest(
        resolution.width,
        resolution.height,
        config.megapixelCandidates,
        inputAlias,
        config.megapixelSuffix
      );
    case 'aspectRatioAndPresetObject':
      return toAspectRatioAndPresetObject(resolution, config, inputAlias);
    case 'aspectRatioAndSizeTokenObject':
      return toAspectRatioAndSizeTokenObject(resolution, config, inputAlias);
    case 'object':
      return toResolutionObject(resolution, config, inputAlias);
    case 'width':
      return resolution.width;
    case 'height':
      return resolution.height;
  }
}

function toResolutionObject(
  resolution: { width: number; height: number },
  config: NonNullable<MappingFieldDefinition['resolution']>,
  inputAlias: string
): Record<string, unknown> {
  if (!config.fields || Object.keys(config.fields).length === 0) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Resolution transform mode "object" for "${inputAlias}" requires a non-empty fields map.`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  const projected: Record<string, unknown> = {};

  for (const [field, fieldConfig] of Object.entries(config.fields)) {
    let value = projectObjectFieldResolutionValue(
      resolution,
      fieldConfig,
      inputAlias,
      field
    );
    if (fieldConfig.transform) {
      value = applyValueTransform(value, fieldConfig.transform);
    }
    projected[field] = value;
  }

  return projected;
}

function projectObjectFieldResolutionValue(
  resolution: { width: number; height: number },
  fieldConfig: NonNullable<
    NonNullable<MappingFieldDefinition['resolution']>['fields']
  >[string],
  inputAlias: string,
  field: string
): unknown {
  switch (fieldConfig.mode) {
    case 'aspectRatio':
      return toAspectRatio(resolution.width, resolution.height);
    case 'preset':
      return toPreset(resolution.width, resolution.height, inputAlias);
    case 'sizeToken':
      return toSizeToken(resolution.width, resolution.height, inputAlias);
    case 'sizeTokenNearest':
      return toSizeTokenNearest(resolution.width, resolution.height);
    case 'aspectRatioAndPreset':
      return `${toAspectRatio(resolution.width, resolution.height)}+${toPreset(
        resolution.width,
        resolution.height,
        inputAlias
      )}`;
    case 'width':
      return resolution.width;
    case 'height':
      return resolution.height;
    case 'megapixelsNearest':
      return toMegapixelsNearest(
        resolution.width,
        resolution.height,
        fieldConfig.megapixelCandidates,
        `${inputAlias}.${field}`,
        fieldConfig.megapixelSuffix
      );
    default:
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Resolution object field mode "${fieldConfig.mode}" for "${inputAlias}.${field}" is not supported.`,
        { kind: 'user_input', causedByUser: true }
      );
  }
}

function toAspectRatioAndPresetObject(
  resolution: { width: number; height: number },
  config: NonNullable<MappingFieldDefinition['resolution']>,
  inputAlias: string
): Record<string, string> {
  if (
    typeof config.aspectRatioField !== 'string' ||
    typeof config.presetField !== 'string'
  ) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Resolution transform mode "aspectRatioAndPresetObject" for "${inputAlias}" requires aspectRatioField and presetField.`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  return {
    [config.aspectRatioField]: toAspectRatio(
      resolution.width,
      resolution.height
    ),
    [config.presetField]: toPreset(
      resolution.width,
      resolution.height,
      inputAlias
    ),
  };
}

function toAspectRatioAndSizeTokenObject(
  resolution: { width: number; height: number },
  config: NonNullable<MappingFieldDefinition['resolution']>,
  inputAlias: string
): Record<string, string> {
  if (
    typeof config.aspectRatioField !== 'string' ||
    typeof config.sizeTokenField !== 'string'
  ) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Resolution transform mode "aspectRatioAndSizeTokenObject" for "${inputAlias}" requires aspectRatioField and sizeTokenField.`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  return {
    [config.aspectRatioField]: toAspectRatio(
      resolution.width,
      resolution.height
    ),
    [config.sizeTokenField]: toSizeTokenNearest(
      resolution.width,
      resolution.height
    ),
  };
}

function parseResolutionValue(
  value: unknown,
  inputAlias: string
): { width: number; height: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Resolution transform for "${inputAlias}" requires an object with width and height.`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  const record = value as Record<string, unknown>;
  const width = record.width;
  const height = record.height;

  if (
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Resolution transform for "${inputAlias}" requires positive integer width and height.`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  return { width, height };
}

function toAspectRatio(width: number, height: number): string {
  return projectAspectRatio(width, height).label;
}

export function projectAspectRatio(
  width: number,
  height: number
): AspectRatioProjection {
  const ratio = width / height;
  let best = KNOWN_ASPECT_RATIOS[0];
  let bestError = percentError(ratio, best.value);

  for (const candidate of KNOWN_ASPECT_RATIOS) {
    const error = percentError(ratio, candidate.value);
    if (error < bestError) {
      best = candidate;
      bestError = error;
    }
  }

  return {
    label: best.label,
    errorPercent: bestError,
    outsideTolerance: bestError > ASPECT_RATIO_MATCH_TOLERANCE_PERCENT,
  };
}

function percentError(actual: number, expected: number): number {
  return (Math.abs(actual - expected) / expected) * 100;
}

function toPreset(width: number, height: number, inputAlias: string): string {
  const shortEdge = Math.min(width, height);
  const presets = new Map<number, string>([
    [480, '480p'],
    [720, '720p'],
    [1080, '1080p'],
    [1440, '1440p'],
    [2160, '2160p'],
  ]);

  const preset = presets.get(shortEdge);
  if (!preset) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Resolution preset transform for "${inputAlias}" does not support short edge ${shortEdge}.`,
      { kind: 'user_input', causedByUser: true }
    );
  }
  return preset;
}

function toSizeToken(
  width: number,
  height: number,
  inputAlias: string
): string {
  const longEdge = Math.max(width, height);
  const tokens = new Map<number, string>([
    [1024, '1K'],
    [2048, '2K'],
    [3072, '3K'],
    [4096, '4K'],
  ]);

  const token = tokens.get(longEdge);
  if (!token) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Resolution sizeToken transform for "${inputAlias}" does not support long edge ${longEdge}.`,
      { kind: 'user_input', causedByUser: true }
    );
  }
  return token;
}

function toSizeTokenNearest(width: number, height: number): string {
  const longEdge = Math.max(width, height);
  const tokens: Array<{ edge: number; token: string }> = [
    { edge: 1024, token: '1K' },
    { edge: 2048, token: '2K' },
    { edge: 3072, token: '3K' },
    { edge: 4096, token: '4K' },
  ];

  let nearest = tokens[0]!;
  let nearestDistance = Math.abs(longEdge - nearest.edge);

  for (const candidate of tokens.slice(1)) {
    const candidateDistance = Math.abs(longEdge - candidate.edge);
    if (candidateDistance < nearestDistance) {
      nearest = candidate;
      nearestDistance = candidateDistance;
      continue;
    }

    if (
      candidateDistance === nearestDistance &&
      candidate.edge < nearest.edge
    ) {
      nearest = candidate;
    }
  }

  return nearest.token;
}

function toMegapixelsNearest(
  width: number,
  height: number,
  candidates: number[] | undefined,
  inputAlias: string,
  suffix?: string
): string {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Resolution transform mode "megapixelsNearest" for "${inputAlias}" requires megapixelCandidates.`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  const normalizedCandidates = candidates.map((candidate) => Number(candidate));
  for (const candidate of normalizedCandidates) {
    if (!Number.isFinite(candidate) || candidate <= 0) {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Resolution transform mode "megapixelsNearest" for "${inputAlias}" requires positive numeric megapixelCandidates.`,
        { kind: 'user_input', causedByUser: true }
      );
    }
  }

  const megapixels = (width * height) / 1_000_000;
  let nearest = normalizedCandidates[0]!;
  let nearestDistance = Math.abs(megapixels - nearest);

  for (const candidate of normalizedCandidates.slice(1)) {
    const candidateDistance = Math.abs(megapixels - candidate);
    if (candidateDistance < nearestDistance) {
      nearest = candidate;
      nearestDistance = candidateDistance;
      continue;
    }
    if (candidateDistance === nearestDistance && candidate < nearest) {
      nearest = candidate;
    }
  }

  const formatted = formatMegapixelCandidate(nearest);
  return suffix ? `${formatted}${suffix}` : formatted;
}

function formatMegapixelCandidate(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toString();
}

/**
 * Collects element-level bindings for an array input.
 *
 * When an array input like "ReferenceImages" is bound element-by-element
 * (e.g., ReferenceImages[0], ReferenceImages[1]), this function finds all
 * matching element bindings and returns them sorted by index.
 *
 * @param baseAlias - The base input alias (e.g., "ReferenceImages")
 * @param inputBindings - The input bindings map
 * @returns Array of element bindings sorted by index
 *
 * @example
 * // Given bindings: { "Foo[0]": "Artifact:Media.Image[0]", "Foo[1]": "Artifact:Media.Image[1]", "Bar": "Artifact:Media.Audio[0]" }
 * collectElementBindings("Foo", bindings)
 * // Returns: [{ index: 0, canonicalId: "Artifact:Media.Image[0]" }, { index: 1, canonicalId: "Artifact:Media.Image[1]" }]
 */
export function collectElementBindings(
  baseAlias: string,
  inputBindings: Record<string, string>
): Array<{ index: number; canonicalId: string }> {
  // Escape special regex characters in the base alias
  const escapedAlias = baseAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedAlias}\\[(\\d+)\\]$`);
  const elements: Array<{ index: number; canonicalId: string }> = [];

  for (const [key, canonicalId] of Object.entries(inputBindings)) {
    const match = key.match(pattern);
    if (match) {
      assertCanonicalBindingId(key, canonicalId);
      elements.push({ index: parseInt(match[1]!, 10), canonicalId });
    }
  }

  // Sort by index to ensure correct array order
  return elements.sort((a, b) => a.index - b.index);
}

function assertCanonicalBindingId(alias: string, canonicalId: string): void {
  if (isCanonicalId(canonicalId)) {
    return;
  }
  throw createProviderError(
    SdkErrorCode.INVALID_CONFIG,
    `Input binding for alias "${alias}" must be canonical. Received "${canonicalId}".`,
    { kind: 'user_input', causedByUser: true }
  );
}

interface IndexedInputAccess {
  baseId: string;
  indices: number[];
}

function resolveInputValue(
  canonicalId: string,
  inputs: Record<string, unknown>
): unknown {
  if (canonicalId in inputs) {
    return inputs[canonicalId];
  }

  const indexedAccess = parseIndexedInputAccess(canonicalId);
  if (!indexedAccess) {
    return undefined;
  }

  const baseValue = inputs[indexedAccess.baseId];
  if (baseValue === undefined) {
    return undefined;
  }

  let currentValue: unknown = baseValue;
  let currentPath = indexedAccess.baseId;

  for (let i = 0; i < indexedAccess.indices.length; i += 1) {
    const index = indexedAccess.indices[i]!;
    if (!Array.isArray(currentValue)) {
      throw createProviderError(
        SdkErrorCode.INVALID_INDEXED_INPUT_ACCESS,
        `Invalid indexed input access "${canonicalId}": "${currentPath}" is not an array.`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    if (index >= currentValue.length) {
      throw createProviderError(
        SdkErrorCode.INVALID_INDEXED_INPUT_ACCESS,
        `Invalid indexed input access "${canonicalId}": index ${index} is out of bounds for "${currentPath}" (length ${currentValue.length}).`,
        { kind: 'user_input', causedByUser: true }
      );
    }

    currentValue = currentValue[index];
    currentPath = `${currentPath}[${index}]`;

    if (currentValue === undefined && i < indexedAccess.indices.length - 1) {
      throw createProviderError(
        SdkErrorCode.INVALID_INDEXED_INPUT_ACCESS,
        `Invalid indexed input access "${canonicalId}": "${currentPath}" cannot be indexed further because it is undefined.`,
        { kind: 'user_input', causedByUser: true }
      );
    }
  }

  return currentValue;
}

function resolveCanonicalBindingId(
  inputAlias: string,
  context: TransformContext,
): string | undefined {
  const directBinding = context.inputBindings[inputAlias];
  if (directBinding) {
    return directBinding;
  }
  if (!context.producerId) {
    return undefined;
  }
  return formatProducerScopedInputIdForCanonicalProducerId(
    context.producerId,
    inputAlias,
  );
}

function parseIndexedInputAccess(
  canonicalId: string
): IndexedInputAccess | undefined {
  if (!canonicalId.startsWith('Input:')) {
    return undefined;
  }

  const indices: number[] = [];
  let baseId = canonicalId;

  let match = baseId.match(/^(.*)\[(\d+)\]$/);
  while (match) {
    indices.unshift(parseInt(match[2]!, 10));
    baseId = match[1]!;
    match = baseId.match(/^(.*)\[(\d+)\]$/);
  }

  if (indices.length === 0 || baseId === canonicalId) {
    return undefined;
  }

  return { baseId, indices };
}
