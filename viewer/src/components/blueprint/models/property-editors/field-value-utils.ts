import type {
  ConfigFieldDescriptor,
  ConfigFieldVariantDescriptor,
  SdkPreviewField,
} from '@/types/blueprint-graph';
import { resolveObjectDefaults } from '../config-editors/schema-defaults';
import { getLeafKey, getPathValue, hasPath } from './path-utils';

export function resolveEffectiveFieldValue(args: {
  field: ConfigFieldDescriptor;
  values: Record<string, unknown>;
  preview?: SdkPreviewField;
}): { effectiveValue: unknown; hasExplicit: boolean } {
  const explicit = getPathValue(args.values, args.field.keyPath);
  const hasExplicitValue = hasPath(args.values, args.field.keyPath);
  const mappedValue =
    args.field.mappingSource === 'input' ? args.preview?.value : undefined;
  const schemaDefault = args.field.schema?.default;

  return {
    effectiveValue: hasExplicitValue
      ? explicit
      : mappedValue !== undefined
        ? mappedValue
        : schemaDefault,
    hasExplicit: hasExplicitValue,
  };
}

export function getStatusMessages(
  preview: SdkPreviewField | undefined
): string | undefined {
  if (!preview) {
    return undefined;
  }
  const messages = [...preview.errors, ...preview.warnings].join(' ');
  return messages.length > 0 ? messages : undefined;
}

export function getDefaultValueForComponent(
  component: ConfigFieldDescriptor['component']
): unknown {
  if (component === 'object') {
    return {};
  }
  if (
    component === 'array-file-uri' ||
    component === 'array-scalar' ||
    component === 'array-object-cards'
  ) {
    return [];
  }
  if (component === 'boolean') {
    return false;
  }
  return undefined;
}

export function resolveObjectInitialValue(
  field: ConfigFieldDescriptor
): Record<string, unknown> {
  if (field.component !== 'object') {
    throw new Error(
      `Expected object component for initial value resolution on field "${field.keyPath}".`
    );
  }

  const defaults = resolveObjectDefaults<Record<string, unknown>>(field.schema);

  for (const childField of field.fields ?? []) {
    const leafKey = getLeafKey(childField.keyPath);
    if (leafKey in defaults) {
      continue;
    }

    const childInitialValue = resolveFieldInitialValue(childField);
    if (childInitialValue !== undefined) {
      defaults[leafKey] = childInitialValue;
    }
  }

  return defaults;
}

function resolveFieldInitialValue(field: ConfigFieldDescriptor): unknown {
  if (field.schema?.default !== undefined) {
    return cloneDefault(field.schema.default);
  }

  if (field.component === 'integer' || field.component === 'number') {
    const minimum = field.schema?.minimum;
    if (typeof minimum === 'number' && Number.isFinite(minimum)) {
      return field.component === 'integer' ? Math.round(minimum) : minimum;
    }
  }

  if (field.component === 'object') {
    return resolveObjectInitialValue(field);
  }

  return undefined;
}

function cloneDefault<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function pickVariant(
  variants: ConfigFieldVariantDescriptor[],
  value: unknown
): ConfigFieldVariantDescriptor {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return (
      variants.find((variant) => variant.component === 'object') ?? variants[0]
    );
  }

  if (typeof value === 'string') {
    return (
      variants.find((variant) => variant.component === 'string-enum') ??
      variants.find((variant) => variant.component === 'string') ??
      variants[0]
    );
  }

  return variants[0];
}

export function isDimensionObject(
  value: unknown
): value is { width: number; height: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.width === 'number' &&
    Number.isFinite(candidate.width) &&
    typeof candidate.height === 'number' &&
    Number.isFinite(candidate.height)
  );
}

export function isDimensionsObjectVariant(
  variant: ConfigFieldVariantDescriptor
): boolean {
  if (variant.component !== 'object' || !variant.fields) {
    return false;
  }

  let hasWidth = false;
  let hasHeight = false;

  for (const field of variant.fields) {
    const leaf = getLeafKey(field.keyPath);
    if (
      leaf === 'width' &&
      (field.component === 'integer' || field.component === 'number')
    ) {
      hasWidth = true;
    }

    if (
      leaf === 'height' &&
      (field.component === 'integer' || field.component === 'number')
    ) {
      hasHeight = true;
    }
  }

  return hasWidth && hasHeight;
}

export function getDefaultDimensionsValue(
  variant: ConfigFieldVariantDescriptor
): {
  width: number;
  height: number;
} {
  const widthField = variant.fields?.find(
    (field) => getLeafKey(field.keyPath) === 'width'
  );
  const heightField = variant.fields?.find(
    (field) => getLeafKey(field.keyPath) === 'height'
  );

  const width = resolveDimensionInitialValue(widthField);
  const height = resolveDimensionInitialValue(heightField);

  if (width === undefined || height === undefined) {
    throw new Error(
      `Union field "${variant.keyPath}" is missing schema defaults/minimums for custom dimensions.`
    );
  }

  return {
    width,
    height,
  };
}

function resolveDimensionInitialValue(
  field: ConfigFieldDescriptor | undefined
): number | undefined {
  if (!field) {
    return undefined;
  }

  const schemaDefault = field.schema?.default;
  if (typeof schemaDefault === 'number' && Number.isFinite(schemaDefault)) {
    return Math.max(1, Math.round(schemaDefault));
  }

  const minimum = field.schema?.minimum;
  if (typeof minimum === 'number' && Number.isFinite(minimum)) {
    return Math.max(1, Math.round(minimum));
  }

  return undefined;
}
