import type { MappingFieldDefinition } from '@gorenku/core';
import {
  ASPECT_RATIO_MATCH_TOLERANCE_PERCENT,
  projectAspectRatio,
  type TransformContext,
} from './transforms.js';
import { buildSdkPayload } from './payload-builder.js';
import { parseInputSchema } from './compatibility.js';

const SIZE_TOKEN_EDGES = new Set([1024, 2048, 3072, 4096]);

export type MappingPreviewStatus = 'ok' | 'warning' | 'error';

export interface MappingPreviewField {
  field: string;
  value: unknown;
  status: MappingPreviewStatus;
  warnings: string[];
  errors: string[];
  connected: boolean;
  sourceAliases: string[];
  schemaType?: string;
  enumOptions?: unknown[];
}

export interface MappingContractField {
  field: string;
  sourceAliases: string[];
}

export interface EvaluateResolutionMappingPreviewArgs {
  mapping: Record<string, MappingFieldDefinition>;
  context: TransformContext;
  connectedAliases: Set<string>;
  inputSchema?: string | Record<string, unknown>;
}

interface MutablePreviewField {
  field: string;
  value: unknown;
  warnings: Set<string>;
  errors: Set<string>;
  connected: boolean;
  sourceAliases: Set<string>;
  schemaType?: string;
  enumOptions?: unknown[];
}

export function evaluateResolutionMappingPreview(
  args: EvaluateResolutionMappingPreviewArgs
): MappingPreviewField[] {
  const schemaString =
    typeof args.inputSchema === 'string'
      ? args.inputSchema
      : args.inputSchema
        ? JSON.stringify(args.inputSchema)
        : undefined;
  const schema =
    typeof args.inputSchema === 'string'
      ? parseInputSchema(args.inputSchema)
      : args.inputSchema;

  const filteredMappingEntries = Object.entries(args.mapping);
  const filteredMapping = Object.fromEntries(filteredMappingEntries);

  const buildResult = buildSdkPayload({
    mapping: filteredMapping,
    resolvedInputs: args.context.inputs,
    inputBindings: args.context.inputBindings,
    inputSchema: schemaString,
    continueOnError: true,
  });

  const byField = new Map<string, MutablePreviewField>();
  const sourceAliasesByAlias = new Map<string, string[]>();
  for (const [alias, mapping] of filteredMappingEntries) {
    sourceAliasesByAlias.set(alias, collectRequiredAliases(alias, mapping));
  }

  for (const entry of buildResult.fieldResults) {
    const sourceAliases = sourceAliasesByAlias.get(entry.alias) ?? [];
    const connected =
      sourceAliases.length === 0
        ? true
        : sourceAliases.some((name) =>
            isAliasConnected(name, args.connectedAliases)
          );

    if (entry.status === 'ok') {
      if (entry.values) {
        for (const [field, value] of Object.entries(entry.values)) {
          upsertField(byField, field, {
            value,
            connected,
            sourceAliases,
          });
        }
      } else {
        for (const field of entry.fieldPaths) {
          upsertField(byField, field, {
            value: entry.value,
            connected,
            sourceAliases,
          });
        }
      }
      continue;
    }

    if (entry.status === 'error') {
      const fields =
        entry.fieldPaths.length > 0
          ? entry.fieldPaths
          : collectExpectedFields(filteredMapping[entry.alias]);
      if (fields.length === 0) {
        throw new Error(
          `Mapping preview error for alias "${entry.alias}" did not report any descriptor field paths.`
        );
      }
      for (const field of fields) {
        const preview = upsertField(byField, field, {
          value: undefined,
          connected,
          sourceAliases,
        });
        if (entry.error) {
          preview.errors.add(entry.error);
        }
      }
      continue;
    }

    for (const field of entry.fieldPaths) {
      upsertField(byField, field, {
        value: undefined,
        connected,
        sourceAliases,
      });
    }
  }

  for (const issue of buildResult.compatibilityIssues) {
    const preview = upsertField(byField, issue.field, {
      value: getNestedValue(buildResult.payload, issue.field),
      connected: true,
      sourceAliases: [],
    });

    if (issue.reason === 'normalized') {
      preview.warnings.add(
        `Normalized by model constraints (${JSON.stringify(issue.requested)} -> ${JSON.stringify(issue.normalized)}).`
      );
      continue;
    }

    if (issue.severity === 'error') {
      preview.errors.add(
        `Incompatible with model constraints: ${JSON.stringify(issue.requested)}.`
      );
      continue;
    }

    preview.warnings.add(
      `Potentially incompatible with model constraints: ${JSON.stringify(issue.requested)}.`
    );
  }

  for (const [alias, mapping] of filteredMappingEntries) {
    const resolutionConfig = findResolutionConfig(mapping);
    const sourceAlias = mapping.input ?? alias;
    const sourceValue = resolveSourceValue(sourceAlias, args.context);
    if (!isResolutionObject(sourceValue)) {
      continue;
    }

    if (resolutionConfig?.mode === 'sizeTokenNearest') {
      const longEdge = Math.max(sourceValue.width, sourceValue.height);
      if (!SIZE_TOKEN_EDGES.has(longEdge)) {
        const targetField = inferPrimaryField(mapping);
        if (targetField) {
          const preview = byField.get(targetField);
          if (preview) {
            preview.warnings.add(
              `Converted to nearest supported size token from long edge ${longEdge}.`
            );
          }
        }
      }
    }

    if (resolutionConfig?.mode === 'object' && resolutionConfig.fields) {
      const longEdge = Math.max(sourceValue.width, sourceValue.height);

      for (const [field, fieldConfig] of Object.entries(
        resolutionConfig.fields
      )) {
        if (
          fieldConfig.mode === 'sizeTokenNearest' &&
          !SIZE_TOKEN_EDGES.has(longEdge)
        ) {
          const preview = byField.get(field);
          if (preview) {
            preview.warnings.add(
              `Converted to nearest supported size token from long edge ${longEdge}.`
            );
          }
        }

        if (
          fieldConfig.mode === 'aspectRatio' ||
          fieldConfig.mode === 'aspectRatioAndPreset'
        ) {
          const projection = projectAspectRatio(
            sourceValue.width,
            sourceValue.height
          );
          if (projection.outsideTolerance) {
            const preview = byField.get(field);
            if (preview) {
              preview.warnings.add(
                `Aspect ratio mapped to nearest supported value (${projection.label}) outside ${ASPECT_RATIO_MATCH_TOLERANCE_PERCENT}% tolerance.`
              );
            }
          }
        }
      }
    }

    if (resolutionConfig?.mode === 'aspectRatioAndSizeTokenObject') {
      const longEdge = Math.max(sourceValue.width, sourceValue.height);
      if (!SIZE_TOKEN_EDGES.has(longEdge)) {
        const targetField =
          typeof resolutionConfig.sizeTokenField === 'string'
            ? resolutionConfig.sizeTokenField
            : undefined;
        if (targetField) {
          const preview = byField.get(targetField);
          if (preview) {
            preview.warnings.add(
              `Converted to nearest supported size token from long edge ${longEdge}.`
            );
          }
        }
      }
    }

    if (
      resolutionConfig?.mode === 'aspectRatio' ||
      resolutionConfig?.mode === 'aspectRatioAndPresetObject' ||
      resolutionConfig?.mode === 'aspectRatioAndSizeTokenObject'
    ) {
      const projection = projectAspectRatio(
        sourceValue.width,
        sourceValue.height
      );
      if (projection.outsideTolerance) {
        const targetField = inferAspectRatioField(mapping);
        if (targetField) {
          const preview = byField.get(targetField);
          if (preview) {
            preview.warnings.add(
              `Aspect ratio mapped to nearest supported value (${projection.label}) outside ${ASPECT_RATIO_MATCH_TOLERANCE_PERCENT}% tolerance.`
            );
          }
        }
      }
    }
  }

  for (const [field, preview] of byField.entries()) {
    if (preview.errors.size === 0) {
      const missingAliases = Array.from(preview.sourceAliases).filter(
        (alias) => !isAliasConnected(alias, args.connectedAliases)
      );

      if (missingAliases.length === preview.sourceAliases.size) {
        preview.warnings.add(
          `No graph connection provides values for this SDK field mapping.`
        );
      } else if (missingAliases.length > 0) {
        preview.warnings.add(
          `Missing graph connections for mapped source aliases: ${missingAliases.join(', ')}.`
        );
      }
    }

    if (schema) {
      const property = resolveSchemaPropertyForPath(schema, field);
      if (property) {
        const typeValue = property.type;
        if (typeof typeValue === 'string') {
          preview.schemaType = typeValue;
        }
        if (Array.isArray(property.enum)) {
          preview.enumOptions = [...property.enum];
        }
      }
    }

    if (preview.value === undefined) {
      preview.value = getNestedValue(buildResult.payload, field);
    }
  }

  return Array.from(byField.values())
    .map((preview) => {
      const status: MappingPreviewStatus =
        preview.errors.size > 0
          ? 'error'
          : preview.warnings.size > 0
            ? 'warning'
            : 'ok';
      return {
        field: preview.field,
        value: preview.value,
        status,
        warnings: Array.from(preview.warnings),
        errors: Array.from(preview.errors),
        connected: preview.connected,
        sourceAliases: Array.from(preview.sourceAliases),
        schemaType: preview.schemaType,
        enumOptions: preview.enumOptions,
      };
    })
    .sort((left, right) => left.field.localeCompare(right.field));
}

/**
 * Derives static mapping contract fields from mapping definitions.
 *
 * This is intentionally independent of runtime input values so descriptor
 * metadata stays stable even when a mapping preview row is skipped.
 */
export function deriveMappingContractFields(
  mapping: Record<string, MappingFieldDefinition>
): MappingContractField[] {
  const byField = new Map<string, Set<string>>();

  for (const [alias, fieldDef] of Object.entries(mapping)) {
    const sourceAliases = collectRequiredAliases(alias, fieldDef);
    const targetFields = collectMappedFields(alias, fieldDef);

    for (const field of targetFields) {
      const aliases = byField.get(field) ?? new Set<string>();
      for (const sourceAlias of sourceAliases) {
        aliases.add(sourceAlias);
      }
      byField.set(field, aliases);
    }
  }

  return Array.from(byField.entries())
    .map(([field, aliases]) => ({
      field,
      sourceAliases: Array.from(aliases),
    }))
    .sort((left, right) => left.field.localeCompare(right.field));
}

function upsertField(
  byField: Map<string, MutablePreviewField>,
  field: string,
  data: {
    value: unknown;
    connected: boolean;
    sourceAliases: string[];
  }
): MutablePreviewField {
  const existing = byField.get(field);
  if (existing) {
    if (data.value !== undefined) {
      existing.value = data.value;
    }
    if (data.connected) {
      existing.connected = true;
    }
    for (const alias of data.sourceAliases) {
      existing.sourceAliases.add(alias);
    }
    return existing;
  }

  const next: MutablePreviewField = {
    field,
    value: data.value,
    warnings: new Set<string>(),
    errors: new Set<string>(),
    connected: data.connected,
    sourceAliases: new Set(data.sourceAliases),
  };
  byField.set(field, next);
  return next;
}

function isResolutionRelatedMapping(
  alias: string,
  mapping: MappingFieldDefinition
): boolean {
  if (isResolutionKeyword(alias)) {
    return true;
  }

  if (mapping.input && isResolutionKeyword(mapping.input)) {
    return true;
  }

  if (mapping.field && isResolutionRelatedField(mapping.field)) {
    return true;
  }

  if (mapping.resolution) {
    return true;
  }

  if (mapping.combine?.inputs.some((name) => isResolutionKeyword(name))) {
    return true;
  }

  if (mapping.conditional) {
    return isResolutionRelatedMapping(alias, mapping.conditional.then);
  }

  return false;
}

function isResolutionRelatedField(field: string): boolean {
  return isResolutionKeyword(field);
}

function isResolutionKeyword(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('resolution') ||
    normalized.includes('aspect') ||
    normalized.includes('size') ||
    normalized.includes('width') ||
    normalized.includes('height') ||
    normalized.includes('megapixel')
  );
}

function collectRequiredAliases(
  alias: string,
  mapping: MappingFieldDefinition
): string[] {
  if (mapping.conditional) {
    return collectRequiredAliases(alias, mapping.conditional.then);
  }

  if (mapping.combine) {
    return [...new Set(mapping.combine.inputs)];
  }

  return [mapping.input ?? alias];
}

function collectMappedFields(
  alias: string,
  mapping: MappingFieldDefinition
): string[] {
  if (mapping.conditional) {
    return collectMappedFields(alias, mapping.conditional.then);
  }

  if (mapping.expand) {
    return collectExpandMappedFields(alias, mapping);
  }

  if (typeof mapping.field === 'string' && mapping.field.length > 0) {
    return [mapping.field];
  }

  throw new Error(
    `Mapping contract for alias "${alias}" is missing target field metadata.`
  );
}

function collectExpandMappedFields(
  alias: string,
  mapping: MappingFieldDefinition
): string[] {
  const resolution = mapping.resolution;
  if (resolution?.mode === 'aspectRatioAndPresetObject') {
    if (
      typeof resolution.aspectRatioField !== 'string' ||
      resolution.aspectRatioField.length === 0 ||
      typeof resolution.presetField !== 'string' ||
      resolution.presetField.length === 0
    ) {
      throw new Error(
        `Mapping contract for alias "${alias}" with resolution mode "aspectRatioAndPresetObject" requires aspectRatioField and presetField.`
      );
    }
    return [resolution.aspectRatioField, resolution.presetField];
  }

  if (resolution?.mode === 'aspectRatioAndSizeTokenObject') {
    if (
      typeof resolution.aspectRatioField !== 'string' ||
      resolution.aspectRatioField.length === 0 ||
      typeof resolution.sizeTokenField !== 'string' ||
      resolution.sizeTokenField.length === 0
    ) {
      throw new Error(
        `Mapping contract for alias "${alias}" with resolution mode "aspectRatioAndSizeTokenObject" requires aspectRatioField and sizeTokenField.`
      );
    }
    return [resolution.aspectRatioField, resolution.sizeTokenField];
  }

  if (resolution?.mode === 'object') {
    if (!resolution.fields || Object.keys(resolution.fields).length === 0) {
      throw new Error(
        `Mapping contract for alias "${alias}" with resolution mode "object" requires a non-empty fields map.`
      );
    }
    return Object.keys(resolution.fields);
  }

  if (mapping.combine) {
    return collectExpandFieldsFromCombineTable(alias, mapping.combine.table);
  }

  throw new Error(
    `Mapping contract for alias "${alias}" uses expand:true without a supported field declaration.`
  );
}

function collectExpandFieldsFromCombineTable(
  alias: string,
  table: Record<string, unknown>
): string[] {
  const fieldKeys = new Set<string>();

  for (const [tableKey, tableValue] of Object.entries(table)) {
    if (
      !tableValue ||
      typeof tableValue !== 'object' ||
      Array.isArray(tableValue)
    ) {
      throw new Error(
        `Mapping contract for alias "${alias}" expects combine table entry "${tableKey}" to be an object when expand:true is set.`
      );
    }

    for (const key of Object.keys(tableValue as Record<string, unknown>)) {
      fieldKeys.add(key);
    }
  }

  if (fieldKeys.size === 0) {
    throw new Error(
      `Mapping contract for alias "${alias}" has expand:true combine mapping with no object fields.`
    );
  }

  return Array.from(fieldKeys);
}

function isAliasConnected(
  alias: string,
  connectedAliases: Set<string>
): boolean {
  return connectedAliases.has(alias);
}

function collectExpectedFields(mapping?: MappingFieldDefinition): string[] {
  if (!mapping) {
    return [];
  }
  if (mapping.conditional) {
    return collectExpectedFields(mapping.conditional.then);
  }

  const fields = new Set<string>();
  if (mapping.field && isResolutionRelatedField(mapping.field)) {
    fields.add(mapping.field);
  }
  if (mapping.resolution?.mode === 'aspectRatioAndPresetObject') {
    if (
      typeof mapping.resolution.aspectRatioField === 'string' &&
      isResolutionRelatedField(mapping.resolution.aspectRatioField)
    ) {
      fields.add(mapping.resolution.aspectRatioField);
    }
    if (
      typeof mapping.resolution.presetField === 'string' &&
      isResolutionRelatedField(mapping.resolution.presetField)
    ) {
      fields.add(mapping.resolution.presetField);
    }
  }
  if (mapping.resolution?.mode === 'aspectRatioAndSizeTokenObject') {
    if (
      typeof mapping.resolution.aspectRatioField === 'string' &&
      isResolutionRelatedField(mapping.resolution.aspectRatioField)
    ) {
      fields.add(mapping.resolution.aspectRatioField);
    }
    if (
      typeof mapping.resolution.sizeTokenField === 'string' &&
      isResolutionRelatedField(mapping.resolution.sizeTokenField)
    ) {
      fields.add(mapping.resolution.sizeTokenField);
    }
  }
  if (mapping.resolution?.mode === 'object' && mapping.resolution.fields) {
    for (const key of Object.keys(mapping.resolution.fields)) {
      if (isResolutionRelatedField(key)) {
        fields.add(key);
      }
    }
  }
  return Array.from(fields);
}

function findResolutionConfig(
  mapping: MappingFieldDefinition
): MappingFieldDefinition['resolution'] | undefined {
  if (mapping.conditional) {
    return findResolutionConfig(mapping.conditional.then);
  }
  return mapping.resolution;
}

function inferPrimaryField(
  mapping?: MappingFieldDefinition
): string | undefined {
  if (!mapping) {
    return undefined;
  }
  if (mapping.conditional) {
    return inferPrimaryField(mapping.conditional.then);
  }
  if (mapping.field && isResolutionRelatedField(mapping.field)) {
    return mapping.field;
  }
  if (
    mapping.resolution?.mode === 'aspectRatioAndPresetObject' &&
    typeof mapping.resolution.aspectRatioField === 'string'
  ) {
    return mapping.resolution.aspectRatioField;
  }
  if (
    mapping.resolution?.mode === 'aspectRatioAndSizeTokenObject' &&
    typeof mapping.resolution.aspectRatioField === 'string'
  ) {
    return mapping.resolution.aspectRatioField;
  }

  if (mapping.resolution?.mode === 'object' && mapping.resolution.fields) {
    const candidates = Object.keys(mapping.resolution.fields).filter((field) =>
      isResolutionRelatedField(field)
    );
    return candidates[0];
  }
  return undefined;
}

function inferAspectRatioField(
  mapping?: MappingFieldDefinition
): string | undefined {
  if (!mapping) {
    return undefined;
  }
  if (mapping.conditional) {
    return inferAspectRatioField(mapping.conditional.then);
  }

  if (mapping.resolution?.mode === 'aspectRatio' && mapping.field) {
    return mapping.field;
  }

  if (
    mapping.resolution?.mode === 'aspectRatioAndPresetObject' &&
    typeof mapping.resolution.aspectRatioField === 'string'
  ) {
    return mapping.resolution.aspectRatioField;
  }

  if (
    mapping.resolution?.mode === 'aspectRatioAndSizeTokenObject' &&
    typeof mapping.resolution.aspectRatioField === 'string'
  ) {
    return mapping.resolution.aspectRatioField;
  }

  if (mapping.resolution?.mode === 'object' && mapping.resolution.fields) {
    for (const [field, fieldConfig] of Object.entries(
      mapping.resolution.fields
    )) {
      if (
        (fieldConfig.mode === 'aspectRatio' ||
          fieldConfig.mode === 'aspectRatioAndPreset') &&
        isResolutionRelatedField(field)
      ) {
        return field;
      }
    }
  }

  return undefined;
}

function resolveSourceValue(alias: string, context: TransformContext): unknown {
  const canonicalId = context.inputBindings[alias];
  if (canonicalId !== undefined) {
    return context.inputs[canonicalId];
  }

  const elementBindings = Object.entries(context.inputBindings)
    .filter(([key]) => key.startsWith(`${alias}[`))
    .map(([, id]) => context.inputs[id]);
  if (elementBindings.length > 0) {
    return elementBindings;
  }

  return undefined;
}

function isResolutionObject(
  value: unknown
): value is { width: number; height: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.width === 'number' &&
    Number.isInteger(candidate.width) &&
    candidate.width > 0 &&
    typeof candidate.height === 'number' &&
    Number.isInteger(candidate.height) &&
    candidate.height > 0
  );
}

function resolveSchemaPropertyForPath(
  schema: Record<string, unknown>,
  fieldPath: string
): Record<string, unknown> | undefined {
  const parts = fieldPath.split('.');
  let cursor: Record<string, unknown> | undefined = schema;

  for (const part of parts) {
    const rawProperties = cursor?.properties;
    if (
      !rawProperties ||
      typeof rawProperties !== 'object' ||
      Array.isArray(rawProperties)
    ) {
      return undefined;
    }
    const properties = rawProperties as Record<string, unknown>;
    const property = properties[part];
    if (!property || typeof property !== 'object' || Array.isArray(property)) {
      return undefined;
    }
    cursor = property as Record<string, unknown>;
  }

  return cursor;
}

function getNestedValue(
  payload: Record<string, unknown>,
  path: string
): unknown {
  const parts = path.split('.');
  let current: unknown = payload;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
