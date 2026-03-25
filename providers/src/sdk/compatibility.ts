import type {
  BlueprintProducerSdkMappingField,
  MappingFieldDefinition,
} from '@gorenku/core';
import {
  applyMapping,
  setNestedValue,
  type TransformContext,
} from './transforms.js';

export interface CompatibilityIssue {
  field: string;
  requested: unknown;
  normalized?: unknown;
  source: 'schema-enum' | 'x-renku-constraints';
  confidence: 'high' | 'medium';
  severity: 'warning' | 'error';
  reason: 'normalized' | 'unsupported';
}

export interface CompatibilityEvaluationResult {
  payload: Record<string, unknown>;
  issues: CompatibilityIssue[];
}

interface RenkuEnumConstraint {
  values: unknown[];
  source?: string;
  confidence?: string;
}

interface RenkuFieldConstraint {
  enum?: RenkuEnumConstraint;
}

interface RenkuConstraintsDocument {
  fields?: Record<string, RenkuFieldConstraint>;
}

interface EnumNormalizationResult {
  status: 'exact' | 'normalized' | 'unsupported' | 'not-applicable';
  value: unknown;
  source: 'schema-enum' | 'x-renku-constraints';
  confidence: 'high' | 'medium';
}

export function parseInputSchema(
  inputSchema: string | undefined
): Record<string, unknown> | undefined {
  if (!inputSchema) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(inputSchema);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function readSchemaProperties(
  schema: Record<string, unknown>
): Record<string, Record<string, unknown>> | undefined {
  const rawProperties = schema.properties;
  if (
    !rawProperties ||
    typeof rawProperties !== 'object' ||
    Array.isArray(rawProperties)
  ) {
    return undefined;
  }

  const properties: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(rawProperties)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      properties[key] = value as Record<string, unknown>;
    }
  }

  return properties;
}

export function evaluateAndNormalizePayloadCompatibility(
  payload: Record<string, unknown>,
  schema: Record<string, unknown>
): CompatibilityEvaluationResult {
  const issues: CompatibilityIssue[] = [];
  const nextPayload = payload;
  const constraints = readRenkuConstraints(schema);
  coercePayloadEnumValues(nextPayload, schema, issues, '', constraints);
  return {
    payload: nextPayload,
    issues,
  };
}

export function buildMappedPayloadForCompatibility(args: {
  mapping:
    | Record<string, BlueprintProducerSdkMappingField | MappingFieldDefinition>
    | undefined;
  resolvedInputs: Record<string, unknown>;
  inputBindings: Record<string, string>;
}): Record<string, unknown> {
  if (!args.mapping) {
    return {};
  }

  const transformContext: TransformContext = {
    inputs: args.resolvedInputs,
    inputBindings: args.inputBindings,
  };

  const payload: Record<string, unknown> = {};
  for (const [alias, fieldDef] of Object.entries(args.mapping)) {
    const mapping = fieldDef as MappingFieldDefinition;
    const result = applyMapping(alias, mapping, transformContext);
    if (result === undefined) {
      continue;
    }

    if ('expand' in result) {
      Object.assign(payload, result.expand);
    } else {
      setNestedValue(payload, result.field, result.value);
    }
  }

  return payload;
}

function coercePayloadEnumValues(
  payload: Record<string, unknown>,
  schema: Record<string, unknown>,
  issues: CompatibilityIssue[],
  fieldPrefix = '',
  constraints?: RenkuConstraintsDocument
): void {
  const properties = readSchemaProperties(schema);
  if (!properties) {
    return;
  }

  for (const [fieldName, value] of Object.entries(payload)) {
    const propertySchema = properties[fieldName];
    if (!propertySchema) {
      continue;
    }

    const fieldPath = fieldPrefix ? `${fieldPrefix}.${fieldName}` : fieldName;
    const fieldConstraint = readFieldConstraint(
      constraints,
      fieldPath,
      fieldName
    );
    const normalized = normalizeEnumValue(
      value,
      propertySchema,
      fieldConstraint
    );

    if (normalized.status === 'normalized') {
      payload[fieldName] = normalized.value;
      issues.push({
        field: fieldPath,
        requested: value,
        normalized: normalized.value,
        source: normalized.source,
        confidence: normalized.confidence,
        severity:
          normalized.source === 'x-renku-constraints' &&
          normalized.confidence === 'medium'
            ? 'warning'
            : 'warning',
        reason: 'normalized',
      });
    }

    if (normalized.status === 'unsupported') {
      issues.push({
        field: fieldPath,
        requested: value,
        source: normalized.source,
        confidence: normalized.confidence,
        severity:
          normalized.source === 'x-renku-constraints' ? 'warning' : 'error',
        reason: 'unsupported',
      });
    }

    const currentValue = payload[fieldName];
    if (
      currentValue &&
      typeof currentValue === 'object' &&
      !Array.isArray(currentValue)
    ) {
      coercePayloadEnumValues(
        currentValue as Record<string, unknown>,
        propertySchema,
        issues,
        fieldPath,
        constraints
      );
    }
  }
}

function readRenkuConstraints(
  schema: Record<string, unknown>
): RenkuConstraintsDocument | undefined {
  const raw = schema['x-renku-constraints'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const document = raw as RenkuConstraintsDocument;
  if (!document.fields || typeof document.fields !== 'object') {
    return undefined;
  }

  return document;
}

function readFieldConstraint(
  constraints: RenkuConstraintsDocument | undefined,
  fieldPath: string,
  fieldName: string
): RenkuFieldConstraint | undefined {
  const fields = constraints?.fields;
  if (!fields) {
    return undefined;
  }
  if (fields[fieldPath]) {
    return fields[fieldPath];
  }
  return fields[fieldName];
}

function normalizeEnumValue(
  value: unknown,
  schema: Record<string, unknown>,
  constraint?: RenkuFieldConstraint
): EnumNormalizationResult {
  const schemaEnumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  const constraintEnumValues = Array.isArray(constraint?.enum?.values)
    ? constraint?.enum?.values
    : undefined;
  const enumValues = schemaEnumValues ?? constraintEnumValues;
  const source = schemaEnumValues
    ? 'schema-enum'
    : ('x-renku-constraints' as const);
  const confidence = schemaEnumValues
    ? 'high'
    : constraint?.enum?.confidence === 'high'
      ? 'high'
      : 'medium';

  if (source === 'x-renku-constraints' && isComplexValue(value)) {
    return { status: 'not-applicable', value, source, confidence };
  }

  if (!enumValues || enumValues.length === 0) {
    return { status: 'not-applicable', value, source, confidence };
  }

  if (enumValues.some((enumValue) => Object.is(enumValue, value))) {
    return { status: 'exact', value, source, confidence };
  }

  if (typeof value === 'number') {
    const asStringMatch = enumValues.find(
      (enumValue) =>
        typeof enumValue === 'string' && enumValue === String(value)
    );
    if (asStringMatch !== undefined) {
      return buildNormalizedResult(
        value,
        asStringMatch,
        schema,
        source,
        confidence
      );
    }
  }

  if (typeof value === 'string') {
    const incomingAspectRatio = parseAspectRatioEnumValue(value);
    if (incomingAspectRatio !== undefined) {
      const aspectRatioCandidates: Array<{ raw: unknown; numeric: number }> =
        [];
      for (const enumValue of enumValues) {
        if (typeof enumValue !== 'string') {
          continue;
        }
        const parsed = parseAspectRatioEnumValue(enumValue);
        if (parsed === undefined) {
          continue;
        }
        aspectRatioCandidates.push({
          raw: enumValue,
          numeric: parsed,
        });
      }

      if (aspectRatioCandidates.length > 0) {
        const nearestAspectRatio = pickNearestEnumCandidate(
          incomingAspectRatio,
          aspectRatioCandidates
        );
        if (nearestAspectRatio !== undefined) {
          return buildNormalizedResult(
            value,
            nearestAspectRatio.raw,
            schema,
            source,
            confidence
          );
        }
      }
    }

    const parsedNumericValue = Number(value);
    if (Number.isFinite(parsedNumericValue)) {
      const numericMatch = enumValues.find(
        (enumValue) =>
          typeof enumValue === 'number' &&
          Object.is(enumValue, parsedNumericValue)
      );
      if (numericMatch !== undefined) {
        return buildNormalizedResult(
          value,
          numericMatch,
          schema,
          source,
          confidence
        );
      }
    }
  }

  const incomingNumeric = parseNumericEnumValue(value);
  if (incomingNumeric === undefined) {
    return { status: 'unsupported', value, source, confidence };
  }

  const numericCandidates = enumValues
    .map((enumValue) => {
      const parsed = parseNumericEnumValue(enumValue);
      if (parsed === undefined) {
        return undefined;
      }
      return {
        raw: enumValue,
        numeric: parsed,
      };
    })
    .filter(
      (
        candidate
      ): candidate is {
        raw: unknown;
        numeric: number;
      } => candidate !== undefined
    );

  if (numericCandidates.length === 0) {
    return { status: 'unsupported', value, source, confidence };
  }

  const nearestCandidate = pickNearestEnumCandidate(
    incomingNumeric,
    numericCandidates
  );
  if (nearestCandidate === undefined) {
    return { status: 'unsupported', value, source, confidence };
  }

  return buildNormalizedResult(
    value,
    nearestCandidate.raw,
    schema,
    source,
    confidence
  );
}

function buildNormalizedResult(
  originalValue: unknown,
  candidateValue: unknown,
  schema: Record<string, unknown>,
  source: 'schema-enum' | 'x-renku-constraints',
  confidence: 'high' | 'medium'
): EnumNormalizationResult {
  if (
    source === 'x-renku-constraints' &&
    !isConstraintNormalizationApplicable(originalValue, candidateValue, schema)
  ) {
    return {
      status: 'not-applicable',
      value: originalValue,
      source,
      confidence,
    };
  }

  return {
    status: 'normalized',
    value: candidateValue,
    source,
    confidence,
  };
}

function isConstraintNormalizationApplicable(
  originalValue: unknown,
  candidateValue: unknown,
  schema: Record<string, unknown>
): boolean {
  const declaredTypes = readDeclaredTypes(schema);
  if (declaredTypes.size > 0) {
    return valueMatchesDeclaredTypes(candidateValue, declaredTypes);
  }

  return valuesShareRuntimeType(originalValue, candidateValue);
}

function readDeclaredTypes(schema: Record<string, unknown>): Set<string> {
  const types = new Set<string>();
  const rawType = schema.type;

  if (typeof rawType === 'string') {
    types.add(rawType);
    return types;
  }

  if (Array.isArray(rawType)) {
    for (const entry of rawType) {
      if (typeof entry === 'string') {
        types.add(entry);
      }
    }
  }

  return types;
}

function valueMatchesDeclaredTypes(
  value: unknown,
  types: Set<string>
): boolean {
  if (value === null) {
    return types.has('null');
  }

  if (typeof value === 'string') {
    return types.has('string');
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value) && types.has('integer')) {
      return true;
    }
    return types.has('number');
  }

  if (typeof value === 'boolean') {
    return types.has('boolean');
  }

  if (Array.isArray(value)) {
    return types.has('array');
  }

  if (value && typeof value === 'object') {
    return types.has('object');
  }

  return false;
}

function valuesShareRuntimeType(left: unknown, right: unknown): boolean {
  if (left === null || right === null) {
    return left === null && right === null;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right);
  }

  if (typeof left === 'number' && typeof right === 'number') {
    return true;
  }

  if (left && typeof left === 'object') {
    return false;
  }

  if (right && typeof right === 'object') {
    return false;
  }

  return typeof left === typeof right;
}

function isComplexValue(value: unknown): boolean {
  return Boolean(value && typeof value === 'object');
}

function parseNumericEnumValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)(?:[a-zA-Z%]*)$/);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseAspectRatioEnumValue(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const match = value.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) {
    return undefined;
  }

  const left = Number.parseFloat(match[1]);
  const right = Number.parseFloat(match[2]);
  if (!Number.isFinite(left) || !Number.isFinite(right) || right === 0) {
    return undefined;
  }

  return left / right;
}

function pickNearestEnumCandidate(
  target: number,
  candidates: Array<{ raw: unknown; numeric: number }>
): { raw: unknown; numeric: number } | undefined {
  let nearest: { raw: unknown; numeric: number } | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = Math.abs(candidate.numeric - target);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
      continue;
    }

    if (
      distance === nearestDistance &&
      nearest &&
      candidate.numeric < nearest.numeric
    ) {
      nearest = candidate;
    }
  }

  return nearest;
}
