import {
  createRuntimeError,
  RuntimeErrorCode,
  type MappingFieldDefinition,
} from '@gorenku/core';
import {
  deriveMappingContractFields,
  resolveViewerSchemaNode,
  type SchemaFile,
} from '@gorenku/providers';
import type { ProducerBindingSummary } from './mapping-binding-context.js';

export interface SchemaProperty {
  type?: string;
  description?: string;
  title?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  format?: string;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  oneOf?: SchemaProperty[];
  anyOf?: SchemaProperty[];
  allOf?: SchemaProperty[];
  $ref?: string;
}

export type ViewerComponent =
  | 'string'
  | 'file-uri'
  | 'string-enum'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'nullable'
  | 'union'
  | 'object'
  | 'array-scalar'
  | 'array-file-uri'
  | 'array-object-cards'
  | 'placeholder-to-be-annotated';

interface ViewerAnnotationNode {
  pointer: string;
  schemaPointer?: string;
  component: ViewerComponent;
  custom?: string;
  custom_config?: Record<string, unknown>;
  label?: string;
  visibility?: 'visible' | 'hidden';
  order?: string[];
  fields?: Record<string, ViewerAnnotationNode>;
  item?: ViewerAnnotationNode;
  variants?: ViewerAnnotationVariant[];
  value?: ViewerAnnotationNode;
  presentation?: string;
  unionEditor?: UnionEditorConfig;
}

interface ViewerAnnotationVariant extends ViewerAnnotationNode {
  id: string;
}

type UnionEditorConfig = EnumDimensionsUnionEditorConfig;

interface EnumDimensionsUnionEditorConfig {
  type: 'enum-dimensions';
  enumVariantId: string;
  customVariantId: string;
  customSelection?:
    | {
        source: 'enum-value';
        value: string;
      }
    | {
        source: 'virtual-option';
        label?: string;
      };
}

type SchemaFileWithViewer = SchemaFile & {
  viewer?: {
    input?: ViewerAnnotationNode;
  };
};

export type MappingSource = 'none' | 'input' | 'artifact' | 'mixed';

export interface ConfigFieldDescriptor {
  keyPath: string;
  component: ViewerComponent;
  custom?: string;
  customConfig?: Record<string, unknown>;
  label: string;
  required: boolean;
  description?: string;
  presentation?: string;
  unionEditor?: UnionEditorConfig;
  schema?: SchemaProperty;
  mappingSource: MappingSource;
  mappedAliases: string[];
  fields?: ConfigFieldDescriptor[];
  item?: ConfigFieldDescriptor;
  value?: ConfigFieldDescriptor;
  variants?: ConfigFieldVariantDescriptor[];
}

export interface ConfigFieldVariantDescriptor extends ConfigFieldDescriptor {
  id: string;
}

export interface ConfigProperty {
  key: string;
  schema: SchemaProperty;
  required: boolean;
}

interface FieldMappingMeta {
  source: MappingSource;
  aliases: string[];
}

export function deriveFieldMappingMeta(args: {
  schemaFile: SchemaFile;
  mapping: Record<string, MappingFieldDefinition>;
  bindingSummary: ProducerBindingSummary;
  producerId: string;
  provider: string;
  model: string;
}): Map<string, FieldMappingMeta> {
  const contractFields = deriveMappingContractFields(args.mapping);

  const byField = new Map<string, FieldMappingMeta>();

  for (const entry of contractFields) {
    const source = deriveMappingSource({
      aliases: entry.sourceAliases,
      aliasSources: args.bindingSummary.aliasSources,
      connectedAliases: args.bindingSummary.connectedAliases,
      producerId: args.producerId,
      provider: args.provider,
      model: args.model,
      field: entry.field,
    });
    byField.set(entry.field, {
      source,
      aliases: entry.sourceAliases,
    });
  }

  return byField;
}

function deriveMappingSource(args: {
  aliases: string[];
  aliasSources: Map<string, Set<'input' | 'artifact'>>;
  connectedAliases: Set<string>;
  producerId: string;
  provider: string;
  model: string;
  field: string;
}): MappingSource {
  let hasInput = false;
  let hasArtifact = false;

  for (const alias of args.aliases) {
    const sources = args.aliasSources.get(alias);
    if (!sources) {
      if (args.connectedAliases.has(alias)) {
        throw createRuntimeError(
          RuntimeErrorCode.MODELS_PANE_MISSING_BINDING_METADATA_ALIAS,
          `Missing binding metadata for alias "${alias}" while composing descriptor metadata for ${args.producerId} (${args.provider}/${args.model}) field "${args.field}".`
        );
      }
      continue;
    }
    if (sources.has('input')) {
      hasInput = true;
    }
    if (sources.has('artifact')) {
      hasArtifact = true;
    }
  }

  if (hasInput && hasArtifact) {
    return 'mixed';
  }
  if (hasArtifact) {
    return 'artifact';
  }
  if (hasInput) {
    return 'input';
  }
  return 'none';
}

function readSchemaAtPointer(
  schemaFile: SchemaFile,
  pointer: string | undefined,
  schemaPointer?: string
): SchemaProperty | undefined {
  if (!pointer) {
    return undefined;
  }

  const merged = resolveViewerSchemaNode(schemaFile, {
    pointer,
    schemaPointer,
  });
  if (!merged || Array.isArray(merged) || typeof merged !== 'object') {
    return undefined;
  }

  return merged as SchemaProperty;
}

export function buildFieldDescriptors(args: {
  schemaFile: SchemaFileWithViewer;
  fieldMapping: Map<string, FieldMappingMeta>;
  forceArtifactFields?: Set<string>;
  producerId: string;
  provider: string;
  model: string;
}): ConfigFieldDescriptor[] {
  const viewerRoot = args.schemaFile.viewer?.input;
  if (!viewerRoot || viewerRoot.component !== 'object' || !viewerRoot.fields) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Model schema for ${args.producerId} (${args.provider}/${args.model}) is missing required x-renku-viewer.input object annotations.`
    );
  }
  if (!viewerRoot.order || viewerRoot.order.length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Model schema for ${args.producerId} (${args.provider}/${args.model}) is missing x-renku-viewer.input.order.`
    );
  }

  const rootSchema = args.schemaFile.inputSchema as SchemaProperty;
  const required = new Set(rootSchema.required ?? []);
  const descriptors: ConfigFieldDescriptor[] = [];

  for (const key of viewerRoot.order) {
    const child = viewerRoot.fields[key];
    if (!child) {
      throw createRuntimeError(
        RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
        `x-renku-viewer.input.order references missing field "${key}" for ${args.producerId} (${args.provider}/${args.model}).`
      );
    }
    const descriptor = buildNodeDescriptor({
      node: child,
      schemaFile: args.schemaFile,
      fieldMapping: args.fieldMapping,
      forceArtifactFields: args.forceArtifactFields,
      keyPath: key,
      required: required.has(key),
      producerId: args.producerId,
      provider: args.provider,
      model: args.model,
    });
    if (descriptor) {
      descriptors.push(descriptor);
    }
  }

  return descriptors;
}

function buildNodeDescriptor(args: {
  node: ViewerAnnotationNode;
  schemaFile: SchemaFileWithViewer;
  fieldMapping: Map<string, FieldMappingMeta>;
  forceArtifactFields?: Set<string>;
  keyPath: string;
  required: boolean;
  producerId: string;
  provider: string;
  model: string;
}): ConfigFieldDescriptor | null {
  if (args.node.visibility === 'hidden') {
    return null;
  }

  const forcedArtifact = args.forceArtifactFields?.has(args.keyPath) ?? false;
  const mapped = args.fieldMapping.get(args.keyPath);
  const mappingSource = forcedArtifact
    ? 'artifact'
    : (mapped?.source ?? 'none');
  if (mappingSource === 'artifact') {
    return null;
  }

  const schemaPointer = args.node.schemaPointer ?? args.node.pointer;
  const schema = readSchemaAtPointer(
    args.schemaFile,
    args.node.pointer,
    args.node.schemaPointer
  );
  if (!schema) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Unable to resolve schema pointer "${schemaPointer}" for ${args.producerId} (${args.provider}/${args.model}) field "${args.keyPath}".`
    );
  }

  const base: ConfigFieldDescriptor = {
    keyPath: args.keyPath,
    component: args.node.component,
    custom: args.node.custom,
    customConfig: args.node.custom_config,
    label: args.node.label ?? args.keyPath,
    required: args.required,
    description: schema.description,
    presentation: args.node.presentation,
    unionEditor: args.node.unionEditor,
    schema,
    mappingSource,
    mappedAliases: mapped?.aliases ?? [],
  };

  if (args.node.component === 'object') {
    if (!args.node.fields) {
      throw createRuntimeError(
        RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
        `Object descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.keyPath}" is missing x-renku-viewer.fields.`
      );
    }
    if (!args.node.order || args.node.order.length === 0) {
      throw createRuntimeError(
        RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
        `Object descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.keyPath}" is missing x-renku-viewer.order.`
      );
    }

    const required = new Set(schema.required ?? []);
    const children: ConfigFieldDescriptor[] = [];
    for (const key of args.node.order) {
      const child = args.node.fields[key];
      if (!child) {
        throw createRuntimeError(
          RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
          `x-renku-viewer.order references missing child "${key}" for ${args.producerId} (${args.provider}/${args.model}) field "${args.keyPath}".`
        );
      }
      const descriptor = buildNodeDescriptor({
        node: child,
        schemaFile: args.schemaFile,
        fieldMapping: args.fieldMapping,
        forceArtifactFields: args.forceArtifactFields,
        keyPath: `${args.keyPath}.${key}`,
        required: required.has(key),
        producerId: args.producerId,
        provider: args.provider,
        model: args.model,
      });
      if (descriptor) {
        children.push(descriptor);
      }
    }
    base.fields = children;
  }

  if (args.node.item) {
    const item = buildNodeDescriptor({
      node: args.node.item,
      schemaFile: args.schemaFile,
      fieldMapping: args.fieldMapping,
      forceArtifactFields: args.forceArtifactFields,
      keyPath: args.keyPath,
      required: false,
      producerId: args.producerId,
      provider: args.provider,
      model: args.model,
    });
    if (item) {
      base.item = item;
    }
  }

  if (args.node.value) {
    const value = buildNodeDescriptor({
      node: args.node.value,
      schemaFile: args.schemaFile,
      fieldMapping: args.fieldMapping,
      forceArtifactFields: args.forceArtifactFields,
      keyPath: args.keyPath,
      required: args.required,
      producerId: args.producerId,
      provider: args.provider,
      model: args.model,
    });
    if (value) {
      base.value = value;
    }
  }

  if (args.node.variants) {
    const variants: ConfigFieldVariantDescriptor[] = [];
    const seenVariantIds = new Set<string>();

    for (const variant of args.node.variants) {
      if (seenVariantIds.has(variant.id)) {
        throw createRuntimeError(
          RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
          `Duplicate union variant id "${variant.id}" for ${args.producerId} (${args.provider}/${args.model}) field "${args.keyPath}".`
        );
      }
      seenVariantIds.add(variant.id);

      const descriptor = buildVariantDescriptor({
        node: variant,
        schemaFile: args.schemaFile,
        fieldMapping: args.fieldMapping,
        forceArtifactFields: args.forceArtifactFields,
        keyPath: args.keyPath,
        producerId: args.producerId,
        provider: args.provider,
        model: args.model,
      });
      if (descriptor) {
        variants.push(descriptor);
      }
    }

    if (variants.length === 0) {
      throw createRuntimeError(
        RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
        `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.keyPath}" has no renderable variants.`
      );
    }

    base.variants = variants;
    validateUnionDescriptorContract({
      field: base,
      producerId: args.producerId,
      provider: args.provider,
      model: args.model,
    });
  }

  return base;
}

function buildVariantDescriptor(args: {
  node: ViewerAnnotationVariant;
  schemaFile: SchemaFileWithViewer;
  fieldMapping: Map<string, FieldMappingMeta>;
  forceArtifactFields?: Set<string>;
  keyPath: string;
  producerId: string;
  provider: string;
  model: string;
}): ConfigFieldVariantDescriptor | null {
  const descriptor = buildNodeDescriptor({
    node: args.node,
    schemaFile: args.schemaFile,
    fieldMapping: args.fieldMapping,
    forceArtifactFields: args.forceArtifactFields,
    keyPath: args.keyPath,
    required: false,
    producerId: args.producerId,
    provider: args.provider,
    model: args.model,
  });
  if (!descriptor) {
    return null;
  }
  return {
    ...descriptor,
    id: args.node.id,
  };
}

function validateUnionDescriptorContract(args: {
  field: ConfigFieldDescriptor;
  producerId: string;
  provider: string;
  model: string;
}): void {
  if (args.field.component !== 'union') {
    return;
  }

  const variants = args.field.variants ?? [];
  if (variants.length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" is missing variants.`
    );
  }

  const enumVariant = variants.find(
    (variant) => variant.component === 'string-enum'
  );
  const objectVariant = variants.find(
    (variant) => variant.component === 'object'
  );

  if (enumVariant && objectVariant && !args.field.presentation) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" must declare x-renku-viewer.presentation when mixing enum and object variants.`
    );
  }

  if (args.field.presentation !== 'enum-or-dimensions') {
    return;
  }

  if (
    !args.field.unionEditor ||
    args.field.unionEditor.type !== 'enum-dimensions'
  ) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" must declare x-renku-viewer.unionEditor.type = "enum-dimensions" for presentation "enum-or-dimensions".`
    );
  }

  const configuredEnumVariant = variants.find(
    (variant) => variant.id === args.field.unionEditor?.enumVariantId
  );
  const configuredCustomVariant = variants.find(
    (variant) => variant.id === args.field.unionEditor?.customVariantId
  );

  if (!configuredEnumVariant) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" references missing enum variant id "${args.field.unionEditor.enumVariantId}".`
    );
  }

  if (!configuredCustomVariant) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" references missing custom variant id "${args.field.unionEditor.customVariantId}".`
    );
  }

  if (configuredEnumVariant.component !== 'string-enum') {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" must map unionEditor.enumVariantId to a "string-enum" variant.`
    );
  }

  if (!enumVariant) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" is missing a string-enum variant required by presentation "enum-or-dimensions".`
    );
  }
  if (
    !Array.isArray(enumVariant.schema?.enum) ||
    enumVariant.schema.enum.length === 0
  ) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" must expose explicit enum options for presentation "enum-or-dimensions".`
    );
  }

  if (
    !objectVariant ||
    !objectVariant.fields ||
    objectVariant.fields.length === 0
  ) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" is missing a typed custom-object variant required by presentation "enum-or-dimensions".`
    );
  }

  if (configuredCustomVariant.component !== 'object') {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" must map unionEditor.customVariantId to an "object" variant.`
    );
  }

  if (!args.field.unionEditor.customSelection) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" must declare x-renku-viewer.unionEditor.customSelection.`
    );
  }

  if (
    configuredEnumVariant.schema?.enum &&
    args.field.unionEditor.customSelection?.source === 'enum-value' &&
    !configuredEnumVariant.schema.enum.includes(
      args.field.unionEditor.customSelection.value
    )
  ) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" references custom enum token "${args.field.unionEditor.customSelection.value}" that is missing from enum options.`
    );
  }

  const widthField = configuredCustomVariant.fields?.find((field) =>
    field.keyPath.endsWith('.width')
  );
  const heightField = configuredCustomVariant.fields?.find((field) =>
    field.keyPath.endsWith('.height')
  );

  const isWidthNumeric =
    widthField?.component === 'integer' || widthField?.component === 'number';
  const isHeightNumeric =
    heightField?.component === 'integer' || heightField?.component === 'number';

  if (!isWidthNumeric || !isHeightNumeric) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" must declare numeric width/height controls for the custom variant.`
    );
  }

  const widthInitializer = getDimensionInitializer(widthField);
  const heightInitializer = getDimensionInitializer(heightField);

  if (widthInitializer === undefined || heightInitializer === undefined) {
    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_MISSING_VIEWER_ANNOTATION,
      `Union descriptor for ${args.producerId} (${args.provider}/${args.model}) field "${args.field.keyPath}" must provide schema default or minimum for custom width/height controls.`
    );
  }
}

function getDimensionInitializer(
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

export function flattenProperties(
  fields: ConfigFieldDescriptor[]
): ConfigProperty[] {
  const result: ConfigProperty[] = [];

  const visit = (field: ConfigFieldDescriptor): void => {
    if (field.schema) {
      result.push({
        key: field.keyPath,
        schema: field.schema,
        required: field.required,
      });
    }
    for (const child of field.fields ?? []) {
      visit(child);
    }
  };

  for (const field of fields) {
    visit(field);
  }

  return result;
}

export function collectDescriptorFieldPaths(
  fields: ConfigFieldDescriptor[]
): Set<string> {
  const paths = new Set<string>();

  const visit = (field: ConfigFieldDescriptor): void => {
    paths.add(field.keyPath);
    for (const child of field.fields ?? []) {
      visit(child);
    }
    if (field.item) {
      visit(field.item);
    }
    if (field.value) {
      visit(field.value);
    }
    for (const variant of field.variants ?? []) {
      visit(variant);
    }
  };

  for (const field of fields) {
    visit(field);
  }

  return paths;
}

export function assertPreviewSubsetOfDescriptors(args: {
  producerId: string;
  provider: string;
  model: string;
  descriptorFields: ConfigFieldDescriptor[];
  previewFields: Array<{ field: string }>;
}): void {
  const descriptorPaths = collectDescriptorFieldPaths(args.descriptorFields);

  for (const previewField of args.previewFields) {
    if (descriptorPaths.has(previewField.field)) {
      continue;
    }

    throw createRuntimeError(
      RuntimeErrorCode.MODELS_PANE_PREVIEW_FIELD_OUTSIDE_DESCRIPTOR,
      `Preview field "${previewField.field}" for ${args.producerId} (${args.provider}/${args.model}) is outside the descriptor contract.`
    );
  }
}
