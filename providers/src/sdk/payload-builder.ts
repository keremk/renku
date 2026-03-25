import type {
  BlueprintProducerSdkMappingField,
  MappingFieldDefinition,
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
          const canonicalId = args.inputBindings[alias] ?? alias;
          const message = `Missing required input "${canonicalId}" for field "${fieldName}" (requested "${alias}"). No schema default available.`;
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

      applyMappingResultToPayload(result, payload);
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

function applyMappingResultToPayload(
  result: Exclude<MappingResult, undefined>,
  payload: Record<string, unknown>
): void {
  if ('expand' in result) {
    Object.assign(payload, result.expand);
    return;
  }
  setNestedValue(payload, result.field, result.value);
}
