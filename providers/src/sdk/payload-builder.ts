import {
  isCanonicalId,
  isCanonicalInputId,
  type BlueprintProducerSdkMappingField,
  type MappingFieldDefinition,
} from '@gorenku/core';
import {
  applyMapping,
  setNestedValue,
  type MappingResult,
  type TransformContext,
} from './transforms.js';
import { createProviderError, SdkErrorCode } from './errors.js';
import type { ProviderLogger } from '../types.js';
import {
  evaluateAndNormalizePayloadCompatibility,
  parseInputSchema,
  readSchemaProperties,
  type CompatibilityIssue,
} from './compatibility.js';

export interface SdkPayloadBuildArgs {
  mapping:
    | Record<string, BlueprintProducerSdkMappingField | MappingFieldDefinition>
    | undefined;
  resolvedInputs: Record<string, unknown>;
  inputBindings: Record<string, string>;
  producerId?: string;
  inputSchema?: string;
  logger?: ProviderLogger;
  continueOnError?: boolean;
}

export interface SdkPayloadFieldResult {
  alias: string;
  sourceAlias: string;
  status: 'ok' | 'skipped' | 'error';
  fieldPaths: string[];
  value?: unknown;
  values?: Record<string, unknown>;
  error?: string;
}

export interface SdkPayloadBuildResult {
  payload: Record<string, unknown>;
  fieldResults: SdkPayloadFieldResult[];
  compatibilityIssues: CompatibilityIssue[];
}

interface FanInResolvedValue {
  groupBy: string;
  orderBy?: string;
  groups: string[][];
}

interface SchemaPathResolution {
  schema: Record<string, unknown> | undefined;
  schemaRoot: Record<string, unknown> | undefined;
  rootField: string;
  arrayField?: string;
  itemField?: string;
}

export function buildSdkPayload(
  args: SdkPayloadBuildArgs
): SdkPayloadBuildResult {
  const effectiveMapping = args.mapping;
  if (!effectiveMapping) {
    return {
      payload: {},
      fieldResults: [],
      compatibilityIssues: [],
    };
  }

  const schemaRequired = new Set<string>();
  const schemaDefaults = new Set<string>();
  const parsedInputSchema = parseInputSchema(args.inputSchema);
  if (parsedInputSchema) {
    const required = parsedInputSchema.required;
    if (Array.isArray(required)) {
      for (const value of required) {
        if (typeof value === 'string') {
          schemaRequired.add(value);
        }
      }
    }

    const properties = readSchemaProperties(parsedInputSchema);
    if (properties) {
      for (const [field, propertySchema] of Object.entries(properties)) {
        if ('default' in propertySchema) {
          schemaDefaults.add(field);
        }
      }
    }
  }

  const transformContext: TransformContext = {
    inputs: args.resolvedInputs,
    inputBindings: args.inputBindings,
    producerId: args.producerId,
  };

  const payload: Record<string, unknown> = {};
  const fieldResults: SdkPayloadFieldResult[] = [];

  for (const [alias, fieldDef] of Object.entries(effectiveMapping)) {
    const mapping = fieldDef as MappingFieldDefinition;
    const sourceAlias = mapping.input ?? alias;

    try {
      const result = applyMapping(alias, mapping, transformContext);
      if (result === undefined) {
        const isExpandField = mapping.expand === true;
        const fieldName = mapping.field ?? '';
        const isRequiredBySchema =
          args.inputSchema && !isExpandField && schemaRequired.has(fieldName);
        const hasSchemaDefault = schemaDefaults.has(fieldName);

        if (isRequiredBySchema && !hasSchemaDefault) {
          const canonicalId = args.inputBindings[sourceAlias];
          if (!canonicalId) {
            const message = `Missing input binding metadata for required alias "${sourceAlias}" while building field "${fieldName}".`;
            if (!args.continueOnError) {
              throw createProviderError(
                SdkErrorCode.MISSING_REQUIRED_INPUT,
                message,
                {
                  kind: 'user_input',
                  causedByUser: true,
                }
              );
            }

            fieldResults.push({
              alias,
              sourceAlias,
              status: 'error',
              fieldPaths: fieldName ? [fieldName] : [],
              error: message,
            });
            continue;
          }

          if (!isCanonicalId(canonicalId)) {
            const message = `Input binding for alias "${sourceAlias}" must be canonical. Received "${canonicalId}".`;
            if (!args.continueOnError) {
              throw createProviderError(
                SdkErrorCode.INVALID_CONFIG,
                message,
                {
                  kind: 'user_input',
                  causedByUser: true,
                }
              );
            }

            fieldResults.push({
              alias,
              sourceAlias,
              status: 'error',
              fieldPaths: fieldName ? [fieldName] : [],
              error: message,
            });
            continue;
          }

          const message = `Missing required input "${canonicalId}" for field "${fieldName}" (requested "${sourceAlias}"). No schema default available.`;
          if (!args.continueOnError) {
            throw createProviderError(
              SdkErrorCode.MISSING_REQUIRED_INPUT,
              message,
              {
                kind: 'user_input',
                causedByUser: true,
              }
            );
          }

          fieldResults.push({
            alias,
            sourceAlias,
            status: 'error',
            fieldPaths: fieldName ? [fieldName] : [],
            error: message,
          });
          continue;
        }

        fieldResults.push({
          alias,
          sourceAlias,
          status: 'skipped',
          fieldPaths: mapping.field ? [mapping.field] : [],
        });
        continue;
      }

      applyMappingResultToPayload({
        result,
        mapping,
        payload,
        parsedInputSchema,
        resolvedInputs: args.resolvedInputs,
      });
      if ('expand' in result) {
        fieldResults.push({
          alias,
          sourceAlias,
          status: 'ok',
          fieldPaths: Object.keys(result.expand),
          values: result.expand,
        });
      } else {
        fieldResults.push({
          alias,
          sourceAlias,
          status: 'ok',
          fieldPaths: [result.field],
          value: result.value,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!args.continueOnError) {
        throw error;
      }
      fieldResults.push({
        alias,
        sourceAlias,
        status: 'error',
        fieldPaths: mapping.field ? [mapping.field] : [],
        error: message,
      });
    }
  }

  let compatibilityIssues: CompatibilityIssue[] = [];
  if (parsedInputSchema) {
    const compatibility = evaluateAndNormalizePayloadCompatibility(
      payload,
      parsedInputSchema
    );
    compatibilityIssues = compatibility.issues;

    for (const issue of compatibility.issues) {
      if (issue.reason === 'normalized') {
        args.logger?.debug?.('providers.sdk.payload.enum-normalized', {
          field: issue.field,
          requested: issue.requested,
          normalized: issue.normalized,
          source: issue.source,
        });
        if (
          issue.source === 'x-renku-constraints' &&
          issue.confidence === 'medium'
        ) {
          args.logger?.warn?.('providers.sdk.payload.constraint-normalized', {
            field: issue.field,
            requested: issue.requested,
            normalized: issue.normalized,
            source: issue.source,
            confidence: issue.confidence,
          });
        }
        continue;
      }

      if (issue.severity === 'error') {
        if (!args.continueOnError) {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            `Input for field "${issue.field}" is incompatible with model constraints and cannot be normalized safely. Requested value: ${JSON.stringify(issue.requested)}.`,
            { kind: 'user_input', causedByUser: true }
          );
        }
        continue;
      }

      args.logger?.warn?.('providers.sdk.payload.constraint-unsupported', {
        field: issue.field,
        requested: issue.requested,
        source: issue.source,
        confidence: issue.confidence,
      });
    }
  }

  return {
    payload,
    fieldResults,
    compatibilityIssues,
  };
}

function applyMappingResultToPayload(args: {
  result: Exclude<MappingResult, undefined>;
  mapping: MappingFieldDefinition;
  payload: Record<string, unknown>;
  parsedInputSchema: Record<string, unknown> | undefined;
  resolvedInputs: Record<string, unknown>;
}): void {
  const { result, mapping, payload, parsedInputSchema, resolvedInputs } = args;
  if ('expand' in result) {
    Object.assign(payload, result.expand);
    return;
  }

  projectFieldValue({
    payload,
    fieldPath: result.field,
    value: result.value,
    mapping,
    schema: parsedInputSchema,
    resolvedInputs,
  });
}

function projectFieldValue(args: {
  payload: Record<string, unknown>;
  fieldPath: string;
  value: unknown;
  mapping: MappingFieldDefinition;
  schema: Record<string, unknown> | undefined;
  resolvedInputs: Record<string, unknown>;
}): void {
  const fieldSchema = resolveSchemaPath(args.schema, args.fieldPath);
  if (!isFanInResolvedValue(args.value)) {
    setNestedValue(args.payload, args.fieldPath, args.value);
    return;
  }

  if (fieldSchema?.schema?.['x-renku-shape'] === 'fanIn') {
    setNestedValue(
      args.payload,
      args.fieldPath,
      projectRenkuFanIn(args.value, args.resolvedInputs)
    );
    return;
  }

  if (fieldSchema?.arrayField && fieldSchema.itemField) {
    projectFanInToObjectArray({
      payload: args.payload,
      fieldPath: args.fieldPath,
      fanIn: args.value,
      path: fieldSchema,
      resolvedInputs: args.resolvedInputs,
    });
    return;
  }

  if (args.mapping.firstOf) {
    const values = collectFanInValues(args.value, args.resolvedInputs);
    if (values.length === 0) {
      return;
    }
    setNestedValue(args.payload, args.fieldPath, values[0]);
    return;
  }

  if (isArraySchema(fieldSchema?.schema)) {
    const values = collectFanInValues(args.value, args.resolvedInputs);
    if (values.length === 0) {
      return;
    }
    setNestedValue(args.payload, args.fieldPath, values);
    return;
  }

  throw createProviderError(
    SdkErrorCode.INVALID_CONFIG,
    `Fan-in input mapped to scalar field "${args.fieldPath}". Map it to an array field, a nested object-array field, an x-renku-shape fanIn field, or use firstOf explicitly.`,
    { kind: 'user_input', causedByUser: true }
  );
}

function projectFanInToObjectArray(args: {
  payload: Record<string, unknown>;
  fieldPath: string;
  fanIn: FanInResolvedValue;
  path: SchemaPathResolution;
  resolvedInputs: Record<string, unknown>;
}): void {
  const arrayField = args.path.arrayField!;
  const itemField = args.path.itemField!;
  const itemSchema = args.path.schema;
  const isTargetArray = isArraySchema(itemSchema);
  const existing = args.payload[arrayField];
  const elements = Array.isArray(existing)
    ? (existing as Record<string, unknown>[])
    : [];

  args.fanIn.groups.forEach((group, groupIndex) => {
    const values = resolveFanInGroup(group, args.resolvedInputs);
    if (values.length === 0) {
      return;
    }

    const element = elements[groupIndex] ?? {};
    if (!isRecord(element)) {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Cannot merge nested fan-in mapping "${args.fieldPath}" because "${arrayField}[${groupIndex}]" is not an object.`,
        { kind: 'user_input', causedByUser: true }
      );
    }

    if (isTargetArray) {
      element[itemField] = values;
    } else {
      if (values.length !== 1) {
        throw createProviderError(
          SdkErrorCode.INVALID_CONFIG,
          `Nested fan-in mapping "${args.fieldPath}" requires exactly one value per group for scalar field "${itemField}". Group ${groupIndex} resolved ${values.length} values.`,
          { kind: 'user_input', causedByUser: true }
        );
      }
      element[itemField] = values[0];
    }
    elements[groupIndex] = element;
  });

  const compactElements = elements.filter(
    (element): element is Record<string, unknown> => element !== undefined
  );

  validateObjectArrayRequiredFields(arrayField, compactElements, args.path);
  if (compactElements.length > 0) {
    args.payload[arrayField] = compactElements;
  }
}

function validateObjectArrayRequiredFields(
  arrayField: string,
  elements: Record<string, unknown>[],
  path: SchemaPathResolution
): void {
  const itemSchema = resolveArrayItemSchema(path.schemaRoot, arrayField);
  const required = Array.isArray(itemSchema?.required)
    ? itemSchema.required.filter(
        (value): value is string => typeof value === 'string'
      )
    : [];
  if (required.length === 0) {
    return;
  }

  elements.forEach((element, index) => {
    for (const field of required) {
      if (element[field] === undefined) {
        throw createProviderError(
          SdkErrorCode.INVALID_CONFIG,
          `Missing required field "${arrayField}[${index}].${field}" after nested fan-in projection.`,
          { kind: 'user_input', causedByUser: true }
        );
      }
    }
  });
}

function resolveSchemaPath(
  schemaRoot: Record<string, unknown> | undefined,
  fieldPath: string
): SchemaPathResolution | undefined {
  if (!schemaRoot) {
    return undefined;
  }

  const arrayPath = parseObjectArrayPath(fieldPath);
  if (arrayPath) {
    const itemSchema = resolveArrayItemSchema(schemaRoot, arrayPath.arrayField);
    const properties = itemSchema ? readSchemaProperties(itemSchema) : undefined;
    return {
      schema: properties?.[arrayPath.itemField],
      schemaRoot,
      rootField: arrayPath.arrayField,
      arrayField: arrayPath.arrayField,
      itemField: arrayPath.itemField,
    };
  }

  const parts = fieldPath.split('.');
  let current: Record<string, unknown> | undefined = schemaRoot;
  for (const part of parts) {
    const properties: Record<string, Record<string, unknown>> | undefined =
      current ? readSchemaProperties(current) : undefined;
    current = properties?.[part];
  }

  return {
    schema: current,
    schemaRoot,
    rootField: parts[0] ?? fieldPath,
  };
}

function parseObjectArrayPath(
  fieldPath: string
): { arrayField: string; itemField: string } | undefined {
  const match = /^([A-Za-z0-9_]+)\[\]\.([A-Za-z0-9_]+)$/.exec(fieldPath);
  if (!match) {
    return undefined;
  }
  return {
    arrayField: match[1]!,
    itemField: match[2]!,
  };
}

function resolveArrayItemSchema(
  schemaRoot: Record<string, unknown> | undefined,
  arrayField: string
): Record<string, unknown> | undefined {
  if (!schemaRoot) {
    return undefined;
  }

  const properties = readSchemaProperties(schemaRoot);
  const arraySchema = properties?.[arrayField];
  const resolvedArraySchema = resolveArraySchema(arraySchema);
  const rawItems = resolvedArraySchema?.items;
  if (!isRecord(rawItems)) {
    return undefined;
  }
  return resolveSchemaReference(rawItems, schemaRoot) ?? rawItems;
}

function resolveArraySchema(schema: unknown): Record<string, unknown> | undefined {
  if (!isRecord(schema)) {
    return undefined;
  }
  if (schema.type === 'array' || isRecord(schema.items)) {
    return schema;
  }

  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const variants = schema[key];
    if (!Array.isArray(variants)) {
      continue;
    }
    for (const variant of variants) {
      const resolved = resolveArraySchema(variant);
      if (resolved) {
        return resolved;
      }
    }
  }

  return undefined;
}

function resolveSchemaReference(
  schema: Record<string, unknown>,
  schemaRoot: Record<string, unknown>
): Record<string, unknown> | undefined {
  const ref = schema.$ref;
  if (typeof ref !== 'string') {
    return undefined;
  }

  const prefix = '#/$defs/';
  if (!ref.startsWith(prefix)) {
    return undefined;
  }

  const name = ref.slice(prefix.length);
  const defs = schemaRoot.$defs;
  if (!isRecord(defs)) {
    return undefined;
  }

  const definition = defs[name];
  return isRecord(definition) ? definition : undefined;
}

function collectFanInValues(
  fanIn: FanInResolvedValue,
  resolvedInputs: Record<string, unknown>
): unknown[] {
  return fanIn.groups.flatMap((group) => resolveFanInGroup(group, resolvedInputs));
}

function resolveFanInGroup(
  group: string[],
  resolvedInputs: Record<string, unknown>
): unknown[] {
  return group.flatMap((memberId) => {
    if (typeof memberId !== 'string') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        'Fan-in member IDs must be strings before SDK payload projection.',
        { kind: 'user_input', causedByUser: true }
      );
    }
    if (!(memberId in resolvedInputs)) {
      if (isCanonicalInputId(memberId)) {
        return [];
      }
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Fan-in member "${memberId}" was not resolved before SDK payload projection.`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    const resolved = resolvedInputs[memberId];
    return Array.isArray(resolved) ? resolved : [resolved];
  });
}

function projectRenkuFanIn(
  fanIn: FanInResolvedValue,
  resolvedInputs: Record<string, unknown>
): {
  groupBy: string;
  orderBy?: string;
  groups: Array<Array<{ id: string; value: unknown }>>;
} {
  return {
    groupBy: fanIn.groupBy,
    orderBy: fanIn.orderBy,
    groups: fanIn.groups.map((group) =>
      group.map((memberId) => {
        if (!(memberId in resolvedInputs)) {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            `Fan-in member "${memberId}" was not resolved before Renku fan-in projection.`,
            { kind: 'user_input', causedByUser: true }
          );
        }
        return {
          id: memberId,
          value: resolvedInputs[memberId],
        };
      })
    ),
  };
}

function isFanInResolvedValue(value: unknown): value is FanInResolvedValue {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.groupBy === 'string' &&
    Array.isArray(value.groups) &&
    value.groups.every(
      (group) =>
        Array.isArray(group) &&
        group.every((memberId) => typeof memberId === 'string')
    )
  );
}

function isArraySchema(schema: unknown): boolean {
  if (!isRecord(schema)) {
    return false;
  }
  if (schema.type === 'array' || isRecord(schema.items)) {
    return true;
  }

  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const variants = schema[key];
    if (Array.isArray(variants) && variants.some((variant) => isArraySchema(variant))) {
      return true;
    }
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
