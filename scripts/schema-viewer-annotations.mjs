import { readdir } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

export const BASE_VIEWER_COMPONENTS = Object.freeze([
  'string',
  'file-uri',
  'string-enum',
  'number',
  'integer',
  'boolean',
  'nullable',
  'union',
  'object',
  'array-scalar',
  'array-file-uri',
  'array-object-cards',
  'placeholder-to-be-annotated',
]);

export const VIEWER_COMPONENTS_SET = new Set(BASE_VIEWER_COMPONENTS);

const UNION_KEYWORDS = Object.freeze(['anyOf', 'oneOf']);

export function isObjectRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function modelNameToFilename(modelName) {
  return modelName.replace(/\//g, '-').replace(/\./g, '-') + '.json';
}

export async function listCatalogModelSchemaPaths(modelsRoot) {
  const entries = await readdir(modelsRoot, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = resolve(modelsRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listCatalogModelSchemaPaths(fullPath)));
      continue;
    }

    if (entry.isFile() && extname(entry.name).toLowerCase() === '.json') {
      files.push(fullPath);
    }
  }

  return files;
}

export function filterSchemaPathsByModel(paths, modelFilter) {
  if (!modelFilter || modelFilter.trim().length === 0) {
    return paths;
  }

  const requestedModels = modelFilter
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (requestedModels.length === 0) {
    return paths;
  }

  const expectedFiles = new Set(requestedModels.map(modelNameToFilename));
  return paths.filter((filePath) => expectedFiles.has(basename(filePath)));
}

function encodePointerToken(token) {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function decodePointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function joinPointer(base, segment) {
  return `${base}/${encodePointerToken(segment)}`;
}

function splitPointer(pointer) {
  if (pointer === '') {
    return [];
  }
  if (!pointer.startsWith('/')) {
    return [];
  }

  return pointer
    .slice(1)
    .split('/')
    .map((segment) => decodePointerToken(segment));
}

export function resolvePointer(root, pointer) {
  if (pointer === '') {
    return root;
  }

  if (!pointer.startsWith('/')) {
    return undefined;
  }

  const segments = splitPointer(pointer);
  let cursor = root;

  for (const segment of segments) {
    if (!isObjectRecord(cursor) && !Array.isArray(cursor)) {
      return undefined;
    }
    if (!(segment in cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }

  return cursor;
}

function resolveLocalRefPointer(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    return undefined;
  }

  const pointer = ref.slice(1);
  return pointer.startsWith('/') ? pointer : undefined;
}

function formatLabelFromPropertyName(name) {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function cloneObjectWithoutRef(value) {
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === '$ref') {
      continue;
    }
    next[key] = entry;
  }
  return next;
}

function cloneObjectWithoutKeys(value, keys) {
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (keys.has(key)) {
      continue;
    }
    next[key] = entry;
  }
  return next;
}

function mergeResolvedNodeWithSiblings(resolvedNode, siblings) {
  if (!isObjectRecord(resolvedNode)) {
    return siblings;
  }

  return {
    ...resolvedNode,
    ...siblings,
  };
}

function resolveSchemaNode(root, node, pointer, seenRefs = new Set()) {
  if (!isObjectRecord(node)) {
    return { node, schemaPointer: pointer, circularRef: false };
  }

  if (
    Array.isArray(node.allOf) &&
    node.allOf.length === 1 &&
    isObjectRecord(node.allOf[0])
  ) {
    const mergedPointer = joinPointer(joinPointer(pointer, 'allOf'), '0');
    const resolvedAllOfNode = resolveSchemaNode(
      root,
      node.allOf[0],
      mergedPointer,
      seenRefs
    );
    const siblingOverrides = cloneObjectWithoutKeys(node, new Set(['allOf']));
    return {
      node: mergeResolvedNodeWithSiblings(
        resolvedAllOfNode.node,
        siblingOverrides
      ),
      schemaPointer: resolvedAllOfNode.schemaPointer,
      circularRef: resolvedAllOfNode.circularRef,
    };
  }

  const refPointer = resolveLocalRefPointer(node.$ref);
  if (!refPointer) {
    return { node, schemaPointer: pointer, circularRef: false };
  }

  if (seenRefs.has(refPointer)) {
    return { node, schemaPointer: pointer, circularRef: true };
  }

  const target = resolvePointer(root, refPointer);
  if (!isObjectRecord(target)) {
    return { node, schemaPointer: pointer, circularRef: false };
  }

  const nextSeen = new Set(seenRefs);
  nextSeen.add(refPointer);
  const resolvedTarget = resolveSchemaNode(root, target, refPointer, nextSeen);

  const siblingOverrides = cloneObjectWithoutRef(node);
  if (Object.keys(siblingOverrides).length === 0) {
    return resolvedTarget;
  }

  return {
    node: mergeResolvedNodeWithSiblings(resolvedTarget.node, siblingOverrides),
    schemaPointer: resolvedTarget.schemaPointer,
    circularRef: resolvedTarget.circularRef,
  };
}

function getInputRoot(schemaFile) {
  if (isObjectRecord(schemaFile?.input_schema)) {
    return { node: schemaFile.input_schema, pointer: '/input_schema' };
  }

  if (
    isObjectRecord(schemaFile) &&
    (typeof schemaFile.type === 'string' ||
      isObjectRecord(schemaFile.properties))
  ) {
    return { node: schemaFile, pointer: '' };
  }

  return null;
}

function getNodeType(node) {
  if (!isObjectRecord(node)) {
    return undefined;
  }

  if (typeof node.type === 'string') {
    return node.type;
  }

  if (Array.isArray(node.type)) {
    const nonNull = node.type.filter((entry) => entry !== 'null');
    if (nonNull.length === 1 && typeof nonNull[0] === 'string') {
      return nonNull[0];
    }
  }

  return undefined;
}

function hasEnum(node) {
  return (
    isObjectRecord(node) && Array.isArray(node.enum) && node.enum.length > 0
  );
}

function getEnumStringValues(node) {
  if (!hasEnum(node)) {
    return [];
  }
  return node.enum.filter((value) => typeof value === 'string');
}

function getExampleStringValues(node) {
  if (!isObjectRecord(node) || !Array.isArray(node.examples)) {
    return [];
  }

  return node.examples.filter((value) => typeof value === 'string');
}

function getExtensionValue(node, key) {
  if (!isObjectRecord(node)) {
    return undefined;
  }

  if (!Object.prototype.hasOwnProperty.call(node, key)) {
    return undefined;
  }

  return node[key];
}

function readVoiceFieldHints(node, pointer) {
  const voiceMarker = getExtensionValue(node, 'x-voice-id');
  const voicesFile = getExtensionValue(node, 'x-voices-file');

  if (voicesFile !== undefined && voiceMarker !== true) {
    throw new Error(
      `Schema node "${pointer}" declares x-voices-file without x-voice-id: true.`
    );
  }

  if (voiceMarker !== undefined && voiceMarker !== true) {
    throw new Error(
      `Schema node "${pointer}" must set x-voice-id to boolean true when provided.`
    );
  }

  if (voiceMarker !== true) {
    return {
      isVoiceId: false,
      voicesFile: undefined,
    };
  }

  if (voicesFile === undefined) {
    return {
      isVoiceId: true,
      voicesFile: undefined,
    };
  }

  if (typeof voicesFile !== 'string' || voicesFile.trim().length === 0) {
    throw new Error(
      `Schema node "${pointer}" has invalid x-voices-file. Expected non-empty string.`
    );
  }

  return {
    isVoiceId: true,
    voicesFile,
  };
}

function buildVoiceOptionLabel(value) {
  const normalized = formatLabelFromPropertyName(value);
  return normalized.length > 0 ? normalized : value;
}

function buildVoiceOptions(values) {
  const seen = new Set();
  const options = [];

  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    options.push({
      value,
      label: buildVoiceOptionLabel(value),
    });
  }

  return options;
}

function buildVoiceCustomConfig(args) {
  const { node, pointer, voicesFile } = args;

  if (typeof voicesFile === 'string') {
    return {
      allow_custom: true,
      options_file: voicesFile,
    };
  }

  const enumValues = getEnumStringValues(node);
  if (enumValues.length > 0) {
    const options = buildVoiceOptions(enumValues);
    if (options.length === 0) {
      throw new Error(
        `Schema node "${pointer}" has enum values for x-voice-id but none can be used as string options.`
      );
    }

    return {
      allow_custom: true,
      options,
    };
  }

  const exampleValues = getExampleStringValues(node);
  if (exampleValues.length > 0) {
    const options = buildVoiceOptions(exampleValues);
    if (options.length === 0) {
      throw new Error(
        `Schema node "${pointer}" has examples for x-voice-id but none can be used as string options.`
      );
    }

    return {
      allow_custom: true,
      options,
    };
  }

  return {
    allow_custom: true,
  };
}

function applyVoiceIdViewerAnnotation(args) {
  const { annotation, node, pointer, voiceHints } = args;
  if (!voiceHints.isVoiceId) {
    return;
  }

  annotation.custom = 'voice-id-selector';
  annotation.custom_config = buildVoiceCustomConfig({
    node,
    pointer,
    voicesFile: voiceHints.voicesFile,
  });
}

function isUriStringSchema(node) {
  return (
    isObjectRecord(node) && node.type === 'string' && node.format === 'uri'
  );
}

function getUnionVariants(node, root, pointer) {
  if (!isObjectRecord(node)) {
    return null;
  }

  for (const keyword of UNION_KEYWORDS) {
    if (!Array.isArray(node[keyword]) || node[keyword].length === 0) {
      continue;
    }

    return node[keyword].map((variantNode, index) => {
      const variantPointer = joinPointer(
        joinPointer(pointer, keyword),
        String(index)
      );
      const resolved = resolveSchemaNode(root, variantNode, variantPointer);
      return {
        rawNode: variantNode,
        resolvedNode: resolved.node,
        pointer: variantPointer,
        schemaPointer: resolved.schemaPointer,
        circularRef: resolved.circularRef,
      };
    });
  }

  if (Array.isArray(node.allOf) && node.allOf.length > 1) {
    return node.allOf.map((variantNode, index) => {
      const variantPointer = joinPointer(
        joinPointer(pointer, 'allOf'),
        String(index)
      );
      const resolved = resolveSchemaNode(root, variantNode, variantPointer);
      return {
        rawNode: variantNode,
        resolvedNode: resolved.node,
        pointer: variantPointer,
        schemaPointer: resolved.schemaPointer,
        circularRef: resolved.circularRef,
      };
    });
  }

  return null;
}

function isNullableUnion(variants) {
  if (!Array.isArray(variants) || variants.length !== 2) {
    return false;
  }

  const nullCount = variants.filter((variant) => {
    const type = getNodeType(variant.resolvedNode);
    return type === 'null';
  }).length;

  return nullCount === 1;
}

function getNonNullVariant(variants) {
  for (const variant of variants) {
    if (getNodeType(variant.resolvedNode) !== 'null') {
      return variant;
    }
  }
  return undefined;
}

function classifyUnionPresentation(variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return undefined;
  }

  let hasEnumVariant = false;
  let hasDimensionsVariant = false;

  for (const variant of variants) {
    const variantNode = variant.resolvedNode;
    if (hasEnum(variantNode)) {
      hasEnumVariant = true;
    }

    if (isObjectRecord(variantNode) && getNodeType(variantNode) === 'object') {
      const props = isObjectRecord(variantNode.properties)
        ? variantNode.properties
        : {};
      const widthNode = props.width;
      const heightNode = props.height;
      const widthType = getNodeType(widthNode);
      const heightType = getNodeType(heightNode);
      if (
        (widthType === 'integer' || widthType === 'number') &&
        (heightType === 'integer' || heightType === 'number')
      ) {
        hasDimensionsVariant = true;
      }
    }
  }

  if (hasEnumVariant && hasDimensionsVariant) {
    return 'enum-or-dimensions';
  }

  return undefined;
}

function hasNumericDimensionProperties(node) {
  if (!isObjectRecord(node) || getNodeType(node) !== 'object') {
    return false;
  }

  const properties = isObjectRecord(node.properties) ? node.properties : {};
  const widthType = getNodeType(properties.width);
  const heightType = getNodeType(properties.height);

  return (
    (widthType === 'integer' || widthType === 'number') &&
    (heightType === 'integer' || heightType === 'number')
  );
}

function annotationHasNumericDimensionControls(annotation) {
  if (!isObjectRecord(annotation) || annotation.component !== 'object') {
    return false;
  }

  if (!isObjectRecord(annotation.fields)) {
    return false;
  }

  const widthAnnotation = annotation.fields.width;
  const heightAnnotation = annotation.fields.height;

  const widthComponent =
    isObjectRecord(widthAnnotation) &&
    typeof widthAnnotation.component === 'string'
      ? widthAnnotation.component
      : undefined;
  const heightComponent =
    isObjectRecord(heightAnnotation) &&
    typeof heightAnnotation.component === 'string'
      ? heightAnnotation.component
      : undefined;

  const widthNumeric =
    widthComponent === 'integer' || widthComponent === 'number';
  const heightNumeric =
    heightComponent === 'integer' || heightComponent === 'number';

  return widthNumeric && heightNumeric;
}

function validateUnionPresentationContract(args) {
  const { unionVariants, annotation, pointer, errors } = args;

  const hasEnumVariant = unionVariants.some((variant) =>
    hasEnum(variant.resolvedNode)
  );
  const hasDimensionsVariant = unionVariants.some((variant) =>
    hasNumericDimensionProperties(variant.resolvedNode)
  );
  const expectedPresentation =
    hasEnumVariant && hasDimensionsVariant ? 'enum-or-dimensions' : undefined;

  const actualPresentation =
    typeof annotation.presentation === 'string'
      ? annotation.presentation
      : undefined;

  if (expectedPresentation && actualPresentation !== expectedPresentation) {
    errors.push(
      `Union at "${pointer}" must declare presentation "${expectedPresentation}".`
    );
  }

  if (!expectedPresentation && actualPresentation) {
    errors.push(
      `Union at "${pointer}" declares unsupported presentation "${actualPresentation}" for its schema variants.`
    );
    return;
  }

  if (actualPresentation !== 'enum-or-dimensions') {
    return;
  }

  if (!Array.isArray(annotation.variants)) {
    return;
  }

  if (!isObjectRecord(annotation.unionEditor)) {
    errors.push(
      `Union at "${pointer}" must declare x-renku-viewer.unionEditor for presentation "enum-or-dimensions".`
    );
    return;
  }

  if (annotation.unionEditor.type !== 'enum-dimensions') {
    errors.push(
      `Union at "${pointer}" must set x-renku-viewer.unionEditor.type to "enum-dimensions" for presentation "enum-or-dimensions".`
    );
    return;
  }

  if (
    typeof annotation.unionEditor.enumVariantId !== 'string' ||
    annotation.unionEditor.enumVariantId.length === 0
  ) {
    errors.push(
      `Union at "${pointer}" is missing x-renku-viewer.unionEditor.enumVariantId.`
    );
    return;
  }

  if (
    typeof annotation.unionEditor.customVariantId !== 'string' ||
    annotation.unionEditor.customVariantId.length === 0
  ) {
    errors.push(
      `Union at "${pointer}" is missing x-renku-viewer.unionEditor.customVariantId.`
    );
    return;
  }

  const enumVariantIndex = annotation.variants.findIndex(
    (variant) =>
      isObjectRecord(variant) &&
      variant.id === annotation.unionEditor.enumVariantId
  );
  const customVariantIndex = annotation.variants.findIndex(
    (variant) =>
      isObjectRecord(variant) &&
      variant.id === annotation.unionEditor.customVariantId
  );

  if (enumVariantIndex < 0) {
    errors.push(
      `Union at "${pointer}" references unknown enumVariantId "${annotation.unionEditor.enumVariantId}".`
    );
    return;
  }

  if (customVariantIndex < 0) {
    errors.push(
      `Union at "${pointer}" references unknown customVariantId "${annotation.unionEditor.customVariantId}".`
    );
    return;
  }

  let hasEnumAnnotation = false;
  let hasDimensionsAnnotation = false;

  unionVariants.forEach((variant, index) => {
    const variantAnnotation = annotation.variants[index];
    if (!isObjectRecord(variantAnnotation)) {
      return;
    }

    if (hasEnum(variant.resolvedNode)) {
      if (variantAnnotation.component !== 'string-enum') {
        errors.push(
          `Union variant ${index + 1} at "${pointer}" must use component "string-enum" for enum-backed options.`
        );
      } else {
        hasEnumAnnotation = true;
      }
      return;
    }

    if (hasNumericDimensionProperties(variant.resolvedNode)) {
      if (!annotationHasNumericDimensionControls(variantAnnotation)) {
        errors.push(
          `Union variant ${index + 1} at "${pointer}" must expose numeric width/height controls for custom dimensions.`
        );
      } else {
        hasDimensionsAnnotation = true;
      }
    }
  });

  if (!hasEnumAnnotation) {
    errors.push(
      `Union at "${pointer}" is missing a string-enum variant required by presentation "enum-or-dimensions".`
    );
  }

  if (!hasDimensionsAnnotation) {
    errors.push(
      `Union at "${pointer}" is missing a typed width/height custom variant required by presentation "enum-or-dimensions".`
    );
  }

  if (!hasEnum(unionVariants[enumVariantIndex]?.resolvedNode)) {
    errors.push(
      `Union at "${pointer}" unionEditor.enumVariantId must reference a schema enum variant.`
    );
  }

  if (
    !hasNumericDimensionProperties(
      unionVariants[customVariantIndex]?.resolvedNode
    )
  ) {
    errors.push(
      `Union at "${pointer}" unionEditor.customVariantId must reference a typed width/height object variant.`
    );
  }

  const selection = annotation.unionEditor.customSelection;
  if (!isObjectRecord(selection)) {
    errors.push(
      `Union at "${pointer}" must declare x-renku-viewer.unionEditor.customSelection.`
    );
    return;
  }

  if (selection.source === 'enum-value') {
    if (typeof selection.value !== 'string' || selection.value.length === 0) {
      errors.push(
        `Union at "${pointer}" enum-value customSelection must provide a non-empty value.`
      );
      return;
    }

    const enumValues = getEnumStringValues(
      unionVariants[enumVariantIndex]?.resolvedNode
    );
    if (!enumValues.includes(selection.value)) {
      errors.push(
        `Union at "${pointer}" customSelection enum token "${selection.value}" is missing from enum values.`
      );
    }
    return;
  }

  if (selection.source === 'virtual-option') {
    if (
      'label' in selection &&
      selection.label !== undefined &&
      typeof selection.label !== 'string'
    ) {
      errors.push(
        `Union at "${pointer}" virtual-option customSelection label must be a string when provided.`
      );
    }
    return;
  }

  errors.push(
    `Union at "${pointer}" has unsupported customSelection source "${selection.source}".`
  );
}

function buildUnionVariantLabel(variant, index) {
  const variantType = getNodeType(variant.resolvedNode);
  if (variantType === 'object') {
    const props = isObjectRecord(variant.resolvedNode.properties)
      ? variant.resolvedNode.properties
      : {};
    if (props.width && props.height) {
      return 'Custom Size';
    }
    return `Object ${index + 1}`;
  }

  if (hasEnum(variant.resolvedNode)) {
    return 'Preset';
  }

  if (variantType === 'null') {
    return 'None';
  }

  if (variantType === 'string') {
    return `Text ${index + 1}`;
  }
  if (variantType === 'integer' || variantType === 'number') {
    return `Number ${index + 1}`;
  }
  if (variantType === 'boolean') {
    return `Boolean ${index + 1}`;
  }

  return `Variant ${index + 1}`;
}

function classifyArrayComponent(node, root, pointer) {
  if (!isObjectRecord(node) || !isObjectRecord(node.items)) {
    return {
      component: 'placeholder-to-be-annotated',
      itemNode: undefined,
      itemPointer: joinPointer(pointer, 'items'),
      itemSchemaPointer: joinPointer(pointer, 'items'),
    };
  }

  const itemPointer = joinPointer(pointer, 'items');
  const resolvedItem = resolveSchemaNode(root, node.items, itemPointer);
  const itemNode = resolvedItem.node;

  if (!isObjectRecord(itemNode)) {
    return {
      component: 'placeholder-to-be-annotated',
      itemNode,
      itemPointer,
      itemSchemaPointer: resolvedItem.schemaPointer,
    };
  }

  const unionVariants = getUnionVariants(
    itemNode,
    root,
    resolvedItem.schemaPointer
  );
  if (unionVariants) {
    return {
      component: 'array-object-cards',
      itemNode,
      itemPointer,
      itemSchemaPointer: resolvedItem.schemaPointer,
    };
  }

  const itemType = getNodeType(itemNode);
  if (itemType === 'string' && isUriStringSchema(itemNode)) {
    return {
      component: 'array-file-uri',
      itemNode,
      itemPointer,
      itemSchemaPointer: resolvedItem.schemaPointer,
    };
  }

  if (
    itemType === 'string' ||
    itemType === 'number' ||
    itemType === 'integer' ||
    itemType === 'boolean' ||
    hasEnum(itemNode)
  ) {
    return {
      component: 'array-scalar',
      itemNode,
      itemPointer,
      itemSchemaPointer: resolvedItem.schemaPointer,
    };
  }

  return {
    component: 'array-object-cards',
    itemNode,
    itemPointer,
    itemSchemaPointer: resolvedItem.schemaPointer,
  };
}

function stripEmptyKeys(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stripEmptyKeys(entry));
  }

  if (!isObjectRecord(value)) {
    return value;
  }

  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }
    if (isObjectRecord(entry) && Object.keys(entry).length === 0) {
      continue;
    }
    if (Array.isArray(entry) && entry.length === 0) {
      continue;
    }
    next[key] = stripEmptyKeys(entry);
  }
  return next;
}

function buildFieldAnnotation(args) {
  const {
    root,
    node,
    pointer,
    propertyName,
    forcedLabel,
    variantIndex,
    visitedRefs,
  } = args;

  const resolved = resolveSchemaNode(root, node, pointer, visitedRefs);
  const effectiveNode = resolved.node;

  const annotation = {
    pointer,
    schemaPointer:
      resolved.schemaPointer !== pointer ? resolved.schemaPointer : undefined,
    component: 'placeholder-to-be-annotated',
    label:
      forcedLabel ??
      (typeof propertyName === 'string'
        ? formatLabelFromPropertyName(propertyName)
        : undefined),
  };

  if (!isObjectRecord(effectiveNode) || resolved.circularRef) {
    return stripEmptyKeys(annotation);
  }

  const unionVariants = getUnionVariants(
    effectiveNode,
    root,
    resolved.schemaPointer
  );

  if (unionVariants && isNullableUnion(unionVariants)) {
    const nonNullVariant = getNonNullVariant(unionVariants);
    annotation.component = 'nullable';
    if (nonNullVariant) {
      annotation.value = buildFieldAnnotation({
        root,
        node: nonNullVariant.rawNode,
        pointer: nonNullVariant.pointer,
        forcedLabel: annotation.label,
        visitedRefs,
      });
    }
    return stripEmptyKeys(annotation);
  }

  if (unionVariants) {
    annotation.component = 'union';
    const presentation = classifyUnionPresentation(unionVariants);
    if (presentation) {
      annotation.presentation = presentation;
    }

    annotation.variants = unionVariants.map((variant, index) => {
      const variantLabel = buildUnionVariantLabel(variant, index);
      const variantAnnotation = buildFieldAnnotation({
        root,
        node: variant.rawNode,
        pointer: variant.pointer,
        forcedLabel: variantLabel,
        variantIndex: index,
        visitedRefs,
      });

      return {
        id: `variant-${index + 1}`,
        ...variantAnnotation,
      };
    });

    if (presentation === 'enum-or-dimensions') {
      const enumVariantIndex = unionVariants.findIndex((variant) =>
        hasEnum(variant.resolvedNode)
      );
      const dimensionsVariantIndex = unionVariants.findIndex((variant) =>
        hasNumericDimensionProperties(variant.resolvedNode)
      );

      if (enumVariantIndex >= 0 && dimensionsVariantIndex >= 0) {
        const enumVariant = unionVariants[enumVariantIndex];
        const enumValues = getEnumStringValues(enumVariant.resolvedNode);
        const customSelection = enumValues.includes('custom')
          ? { source: 'enum-value', value: 'custom' }
          : {
              source: 'virtual-option',
              label: annotation.variants[dimensionsVariantIndex]?.label,
            };

        annotation.unionEditor = {
          type: 'enum-dimensions',
          enumVariantId: annotation.variants[enumVariantIndex]?.id,
          customVariantId: annotation.variants[dimensionsVariantIndex]?.id,
          customSelection,
        };
      }
    }

    return stripEmptyKeys(annotation);
  }

  const type = getNodeType(effectiveNode);
  const voiceHints = readVoiceFieldHints(effectiveNode, resolved.schemaPointer);

  if (voiceHints.isVoiceId && type !== 'string') {
    throw new Error(
      `Schema node "${resolved.schemaPointer}" is marked with x-voice-id but has type "${type ?? 'unknown'}". Voice-id fields must be string.`
    );
  }

  if (type === 'string') {
    if (isUriStringSchema(effectiveNode)) {
      annotation.component = 'file-uri';
    } else if (hasEnum(effectiveNode)) {
      annotation.component = 'string-enum';
    } else {
      annotation.component = 'string';
    }

    applyVoiceIdViewerAnnotation({
      annotation,
      node: effectiveNode,
      pointer: resolved.schemaPointer,
      voiceHints,
    });

    return stripEmptyKeys(annotation);
  }

  if (type === 'number') {
    annotation.component = 'number';
    return stripEmptyKeys(annotation);
  }

  if (type === 'integer') {
    annotation.component = 'integer';
    return stripEmptyKeys(annotation);
  }

  if (type === 'boolean') {
    annotation.component = 'boolean';
    return stripEmptyKeys(annotation);
  }

  if (type === 'null') {
    annotation.component = 'nullable';
    return stripEmptyKeys(annotation);
  }

  if (type === 'array') {
    const arrayInfo = classifyArrayComponent(
      effectiveNode,
      root,
      resolved.schemaPointer
    );
    annotation.component = arrayInfo.component;
    annotation.item = buildFieldAnnotation({
      root,
      node: arrayInfo.itemNode,
      pointer: arrayInfo.itemPointer,
      forcedLabel: variantIndex === undefined ? 'Item' : undefined,
      visitedRefs,
    });
    return stripEmptyKeys(annotation);
  }

  if (type === 'object') {
    annotation.component = 'object';
    const properties = isObjectRecord(effectiveNode.properties)
      ? effectiveNode.properties
      : {};
    const order = Object.keys(properties);
    annotation.order = order;
    annotation.fields = {};

    for (const key of order) {
      const childPointer = joinPointer(
        joinPointer(resolved.schemaPointer, 'properties'),
        key
      );

      annotation.fields[key] = buildFieldAnnotation({
        root,
        node: properties[key],
        pointer: childPointer,
        propertyName: key,
        visitedRefs,
      });
    }

    return stripEmptyKeys(annotation);
  }

  return stripEmptyKeys(annotation);
}

function collectPlaceholderPointers(annotation, output) {
  if (!isObjectRecord(annotation)) {
    return;
  }

  if (annotation.component === 'placeholder-to-be-annotated') {
    output.push(annotation.pointer ?? '<unknown>');
  }

  if (isObjectRecord(annotation.value)) {
    collectPlaceholderPointers(annotation.value, output);
  }

  if (Array.isArray(annotation.variants)) {
    for (const variant of annotation.variants) {
      collectPlaceholderPointers(variant, output);
    }
  }

  if (isObjectRecord(annotation.item)) {
    collectPlaceholderPointers(annotation.item, output);
  }

  if (isObjectRecord(annotation.fields)) {
    for (const value of Object.values(annotation.fields)) {
      collectPlaceholderPointers(value, output);
    }
  }
}

function countAnnotatedFields(annotation) {
  if (!isObjectRecord(annotation)) {
    return 0;
  }

  let count = 1;

  if (isObjectRecord(annotation.value)) {
    count += countAnnotatedFields(annotation.value);
  }

  if (Array.isArray(annotation.variants)) {
    for (const variant of annotation.variants) {
      count += countAnnotatedFields(variant);
    }
  }

  if (isObjectRecord(annotation.item)) {
    count += countAnnotatedFields(annotation.item);
  }

  if (isObjectRecord(annotation.fields)) {
    for (const value of Object.values(annotation.fields)) {
      count += countAnnotatedFields(value);
    }
  }

  return count;
}

function mergeAnnotation(generated, existing) {
  if (!isObjectRecord(generated) || !isObjectRecord(existing)) {
    return generated;
  }

  const merged = structuredClone(generated);

  if (
    typeof existing.custom === 'string' &&
    existing.custom.trim().length > 0
  ) {
    merged.custom = existing.custom;
  }

  if (
    isObjectRecord(existing.custom_config) &&
    !isObjectRecord(merged.custom_config)
  ) {
    merged.custom_config = structuredClone(existing.custom_config);
  }

  if (typeof existing.component === 'string') {
    merged.component = existing.component;
  }

  if (typeof existing.label === 'string' && existing.label.trim().length > 0) {
    merged.label = existing.label;
  }

  if (Array.isArray(existing.order) && Array.isArray(merged.order)) {
    const expectedSet = new Set(merged.order);
    const existingFiltered = existing.order.filter((key) =>
      expectedSet.has(key)
    );
    if (existingFiltered.length === merged.order.length) {
      merged.order = existingFiltered;
    }
  }

  if (typeof existing.presentation === 'string') {
    merged.presentation = existing.presentation;
  }

  if (isObjectRecord(existing.unionEditor)) {
    merged.unionEditor = structuredClone(existing.unionEditor);
  }

  if (existing.visibility === 'hidden' || existing.visibility === 'visible') {
    merged.visibility = existing.visibility;
  }

  if (isObjectRecord(merged.value) && isObjectRecord(existing.value)) {
    merged.value = mergeAnnotation(merged.value, existing.value);
  }

  if (Array.isArray(merged.variants) && Array.isArray(existing.variants)) {
    merged.variants = merged.variants.map((variant, index) =>
      mergeAnnotation(variant, existing.variants[index] ?? {})
    );
  }

  if (isObjectRecord(merged.item) && isObjectRecord(existing.item)) {
    merged.item = mergeAnnotation(merged.item, existing.item);
  }

  if (isObjectRecord(merged.fields) && isObjectRecord(existing.fields)) {
    for (const key of Object.keys(merged.fields)) {
      if (isObjectRecord(existing.fields[key])) {
        merged.fields[key] = mergeAnnotation(
          merged.fields[key],
          existing.fields[key]
        );
      }
    }
  }

  return stripEmptyKeys(merged);
}

function mergeCustomOnly(generated, existing) {
  if (!isObjectRecord(generated) || !isObjectRecord(existing)) {
    return generated;
  }

  const merged = structuredClone(generated);

  if (
    typeof existing.custom === 'string' &&
    existing.custom.trim().length > 0
  ) {
    merged.custom = existing.custom;
  }

  if (
    isObjectRecord(existing.custom_config) &&
    !isObjectRecord(merged.custom_config)
  ) {
    merged.custom_config = structuredClone(existing.custom_config);
  }

  if (isObjectRecord(merged.value) && isObjectRecord(existing.value)) {
    merged.value = mergeCustomOnly(merged.value, existing.value);
  }

  if (Array.isArray(merged.variants) && Array.isArray(existing.variants)) {
    merged.variants = merged.variants.map((variant, index) =>
      mergeCustomOnly(variant, existing.variants[index] ?? {})
    );
  }

  if (isObjectRecord(merged.item) && isObjectRecord(existing.item)) {
    merged.item = mergeCustomOnly(merged.item, existing.item);
  }

  if (isObjectRecord(merged.fields) && isObjectRecord(existing.fields)) {
    for (const key of Object.keys(merged.fields)) {
      if (isObjectRecord(existing.fields[key])) {
        merged.fields[key] = mergeCustomOnly(
          merged.fields[key],
          existing.fields[key]
        );
      }
    }
  }

  return stripEmptyKeys(merged);
}

function validateVoiceIdCustomConfig(annotation, pointer, errors) {
  if (annotation.custom !== 'voice-id-selector') {
    return;
  }

  if (!isObjectRecord(annotation.custom_config)) {
    errors.push(
      `Voice-id field at "${pointer}" must declare object x-renku-viewer.custom_config.`
    );
    return;
  }

  const config = annotation.custom_config;
  if (config.allow_custom !== true) {
    errors.push(
      `Voice-id field at "${pointer}" must set custom_config.allow_custom to true.`
    );
  }

  const hasOptions = Array.isArray(config.options);
  const hasOptionsFile =
    typeof config.options_file === 'string' &&
    config.options_file.trim().length > 0;

  if (hasOptions && hasOptionsFile) {
    errors.push(
      `Voice-id field at "${pointer}" must declare either custom_config.options or custom_config.options_file, not both.`
    );
    return;
  }

  if ('options_file' in config && !hasOptionsFile) {
    errors.push(
      `Voice-id field at "${pointer}" has invalid custom_config.options_file. Expected non-empty string.`
    );
  }

  if (!hasOptions) {
    return;
  }

  if (config.options.length === 0) {
    errors.push(
      `Voice-id field at "${pointer}" has empty custom_config.options. Provide at least one option.`
    );
    return;
  }

  for (const [index, option] of config.options.entries()) {
    if (!isObjectRecord(option)) {
      errors.push(
        `Voice-id field at "${pointer}" has invalid custom_config.options[${index}]. Expected object.`
      );
      continue;
    }

    if (typeof option.value !== 'string' || option.value.length === 0) {
      errors.push(
        `Voice-id field at "${pointer}" has invalid custom_config.options[${index}].value. Expected non-empty string.`
      );
    }

    if (typeof option.label !== 'string' || option.label.length === 0) {
      errors.push(
        `Voice-id field at "${pointer}" has invalid custom_config.options[${index}].label. Expected non-empty string.`
      );
    }
  }
}

export function collectInputSchemaCoverage(schemaFile) {
  const inputRoot = getInputRoot(schemaFile);
  if (!inputRoot) {
    return {
      errors: [
        'Schema file has neither "input_schema" object nor legacy root schema shape.',
      ],
      inputRoot: null,
    };
  }

  return {
    errors: [],
    inputRoot,
  };
}

export function annotateSchemaFileForViewer(schemaFile, options = {}) {
  const { rewrite = false } = options;
  const coverage = collectInputSchemaCoverage(schemaFile);
  if (coverage.errors.length > 0) {
    return {
      schemaFile,
      changed: false,
      errors: coverage.errors,
      placeholderPointers: [],
      annotatedPointers: 0,
    };
  }

  const previousViewer = JSON.stringify(schemaFile['x-renku-viewer'] ?? null);
  const generatedInput = buildFieldAnnotation({
    root: schemaFile,
    node: coverage.inputRoot.node,
    pointer: coverage.inputRoot.pointer,
    forcedLabel: 'Input',
    visitedRefs: new Set(),
  });

  const existingViewer = isObjectRecord(schemaFile['x-renku-viewer'])
    ? schemaFile['x-renku-viewer']
    : {};

  const nextViewer = {
    version: 1,
    input: rewrite
      ? mergeCustomOnly(generatedInput, existingViewer.input ?? {})
      : mergeAnnotation(generatedInput, existingViewer.input ?? {}),
  };

  schemaFile['x-renku-viewer'] = nextViewer;

  const placeholderPointers = [];
  collectPlaceholderPointers(nextViewer.input, placeholderPointers);
  const annotatedPointers = countAnnotatedFields(nextViewer.input);

  return {
    schemaFile,
    changed: previousViewer !== JSON.stringify(nextViewer),
    errors: [],
    placeholderPointers,
    annotatedPointers,
  };
}

function validateAnnotationAgainstSchema(args) {
  const {
    root,
    node,
    pointer,
    annotation,
    propertyName,
    errors,
    placeholderPointers,
  } = args;

  if (!isObjectRecord(annotation)) {
    errors.push(`Missing annotation object for schema pointer "${pointer}".`);
    return 0;
  }

  let checkedCount = 1;

  if (
    typeof annotation.component !== 'string' ||
    annotation.component.length === 0
  ) {
    errors.push(`Missing component for schema pointer "${pointer}".`);
    return checkedCount;
  }

  if (!VIEWER_COMPONENTS_SET.has(annotation.component)) {
    errors.push(
      `Unknown component "${annotation.component}" for schema pointer "${pointer}".`
    );
  }

  if (typeof propertyName === 'string') {
    if (
      typeof annotation.label !== 'string' ||
      annotation.label.trim().length === 0
    ) {
      errors.push(
        `Missing label for property "${propertyName}" at "${pointer}".`
      );
    }
  }

  if (
    'custom' in annotation &&
    annotation.custom !== undefined &&
    (typeof annotation.custom !== 'string' ||
      annotation.custom.trim().length === 0)
  ) {
    errors.push(
      `Invalid custom renderer at "${pointer}". Expected non-empty string when provided.`
    );
  }

  if (
    'custom_config' in annotation &&
    annotation.custom_config !== undefined &&
    !isObjectRecord(annotation.custom_config)
  ) {
    errors.push(
      `Invalid custom_config at "${pointer}". Expected object when provided.`
    );
  }

  validateVoiceIdCustomConfig(annotation, pointer, errors);

  if (annotation.component === 'placeholder-to-be-annotated') {
    placeholderPointers.push(annotation.pointer ?? pointer);
  }

  const resolved = resolveSchemaNode(root, node, pointer);
  const effectiveNode = resolved.node;
  if (!isObjectRecord(effectiveNode)) {
    return checkedCount;
  }

  const unionVariants = getUnionVariants(
    effectiveNode,
    root,
    resolved.schemaPointer
  );

  if (unionVariants && isNullableUnion(unionVariants)) {
    if (
      annotation.component !== 'nullable' &&
      annotation.component !== 'placeholder-to-be-annotated'
    ) {
      errors.push(
        `Expected component "nullable" for nullable union at "${pointer}", received "${annotation.component}".`
      );
      return checkedCount;
    }

    if (annotation.component === 'nullable') {
      const nonNullVariant = getNonNullVariant(unionVariants);
      if (!isObjectRecord(annotation.value)) {
        errors.push(`Missing nullable "value" annotation at "${pointer}".`);
      } else if (nonNullVariant) {
        checkedCount += validateAnnotationAgainstSchema({
          root,
          node: nonNullVariant.rawNode,
          pointer: nonNullVariant.pointer,
          annotation: annotation.value,
          propertyName: undefined,
          errors,
          placeholderPointers,
        });
      }
    }

    return checkedCount;
  }

  if (unionVariants) {
    if (
      annotation.component !== 'union' &&
      annotation.component !== 'placeholder-to-be-annotated'
    ) {
      errors.push(
        `Expected component "union" for schema union at "${pointer}", received "${annotation.component}".`
      );
      return checkedCount;
    }

    if (annotation.component === 'union') {
      validateUnionPresentationContract({
        unionVariants,
        annotation,
        pointer,
        errors,
      });

      if (!Array.isArray(annotation.variants)) {
        errors.push(
          `Missing "variants" annotations for union at "${pointer}".`
        );
      } else if (annotation.variants.length !== unionVariants.length) {
        errors.push(
          `Union variant count mismatch at "${pointer}": expected ${unionVariants.length}, received ${annotation.variants.length}.`
        );
      } else {
        unionVariants.forEach((variant, index) => {
          checkedCount += validateAnnotationAgainstSchema({
            root,
            node: variant.rawNode,
            pointer: variant.pointer,
            annotation: annotation.variants[index],
            propertyName: undefined,
            errors,
            placeholderPointers,
          });
        });
      }
    }

    return checkedCount;
  }

  const type = getNodeType(effectiveNode);
  if (type === 'object') {
    const properties = isObjectRecord(effectiveNode.properties)
      ? effectiveNode.properties
      : {};
    const keys = Object.keys(properties);

    if (
      annotation.component !== 'object' &&
      annotation.component !== 'placeholder-to-be-annotated'
    ) {
      errors.push(
        `Expected component "object" for schema object at "${pointer}", received "${annotation.component}".`
      );
      return checkedCount;
    }

    if (annotation.component === 'object') {
      if (!Array.isArray(annotation.order)) {
        errors.push(`Missing order for object annotation at "${pointer}".`);
      } else {
        const seen = new Set();
        for (const key of annotation.order) {
          if (typeof key !== 'string' || key.length === 0) {
            errors.push(
              `Invalid order key in "${pointer}"; expected non-empty strings.`
            );
            continue;
          }
          if (seen.has(key)) {
            errors.push(`Duplicate order key "${key}" at "${pointer}".`);
          }
          seen.add(key);
        }

        for (const key of keys) {
          if (!seen.has(key)) {
            errors.push(
              `Object order at "${pointer}" is missing key "${key}".`
            );
          }
        }
      }

      if (!isObjectRecord(annotation.fields)) {
        errors.push(
          `Missing fields map for object annotation at "${pointer}".`
        );
      } else {
        for (const key of keys) {
          if (!isObjectRecord(annotation.fields[key])) {
            errors.push(
              `Missing field annotation for "${key}" at "${pointer}".`
            );
            continue;
          }

          const childPointer = joinPointer(
            joinPointer(resolved.schemaPointer, 'properties'),
            key
          );

          checkedCount += validateAnnotationAgainstSchema({
            root,
            node: properties[key],
            pointer: childPointer,
            annotation: annotation.fields[key],
            propertyName: key,
            errors,
            placeholderPointers,
          });
        }
      }
    }

    return checkedCount;
  }

  if (type === 'array') {
    if (
      annotation.component !== 'array-scalar' &&
      annotation.component !== 'array-file-uri' &&
      annotation.component !== 'array-object-cards' &&
      annotation.component !== 'placeholder-to-be-annotated'
    ) {
      errors.push(
        `Invalid array component "${annotation.component}" at "${pointer}".`
      );
      return checkedCount;
    }

    if (!isObjectRecord(annotation.item)) {
      errors.push(`Missing array item annotation at "${pointer}".`);
      return checkedCount;
    }

    const itemNode = isObjectRecord(effectiveNode.items)
      ? effectiveNode.items
      : undefined;
    const itemPointer = joinPointer(resolved.schemaPointer, 'items');

    checkedCount += validateAnnotationAgainstSchema({
      root,
      node: itemNode,
      pointer: itemPointer,
      annotation: annotation.item,
      propertyName: undefined,
      errors,
      placeholderPointers,
    });

    return checkedCount;
  }

  return checkedCount;
}

export function validateSchemaFileViewerAnnotations(schemaFile) {
  const coverage = collectInputSchemaCoverage(schemaFile);
  const errors = [...coverage.errors];
  const placeholderPointers = [];

  if (coverage.errors.length > 0) {
    return { errors, placeholderPointers, checkedPointers: 0 };
  }

  if (!isObjectRecord(schemaFile['x-renku-viewer'])) {
    errors.push('Missing required top-level object "x-renku-viewer".');
    return { errors, placeholderPointers, checkedPointers: 0 };
  }

  const viewer = schemaFile['x-renku-viewer'];
  if (!isObjectRecord(viewer.input)) {
    errors.push('Missing required object "x-renku-viewer.input".');
    return { errors, placeholderPointers, checkedPointers: 0 };
  }

  const checkedPointers = validateAnnotationAgainstSchema({
    root: schemaFile,
    node: coverage.inputRoot.node,
    pointer: coverage.inputRoot.pointer,
    annotation: viewer.input,
    propertyName: undefined,
    errors,
    placeholderPointers,
  });

  return {
    errors,
    placeholderPointers,
    checkedPointers,
  };
}

function collectVoiceSchemaExtensions(node, pointer, output) {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => {
      collectVoiceSchemaExtensions(
        entry,
        joinPointer(pointer, String(index)),
        output
      );
    });
    return;
  }

  if (!isObjectRecord(node)) {
    return;
  }

  if (pointer === '/x-renku-viewer' || pointer.startsWith('/x-renku-viewer/')) {
    return;
  }

  const hasVoiceId = Object.prototype.hasOwnProperty.call(node, 'x-voice-id');
  const hasVoicesFile = Object.prototype.hasOwnProperty.call(
    node,
    'x-voices-file'
  );
  if (hasVoiceId || hasVoicesFile) {
    output.push({
      pointer,
      hasVoiceId,
      hasVoicesFile,
      voiceId: node['x-voice-id'],
      voicesFile: node['x-voices-file'],
    });
  }

  for (const [key, value] of Object.entries(node)) {
    collectVoiceSchemaExtensions(value, joinPointer(pointer, key), output);
  }
}

function mergeExistingVoiceSchemaExtensions(existingSchema, nextSchema) {
  const entries = [];
  collectVoiceSchemaExtensions(existingSchema, '', entries);

  for (const entry of entries) {
    const target = resolvePointer(nextSchema, entry.pointer);
    if (!isObjectRecord(target)) {
      throw new Error(
        `Unable to preserve schema voice annotations at "${entry.pointer}" during schema refresh. Target pointer is missing.`
      );
    }

    if (entry.hasVoiceId) {
      target['x-voice-id'] = entry.voiceId;
    }

    if (entry.hasVoicesFile) {
      target['x-voices-file'] = entry.voicesFile;
    }
  }
}

export function mergeExistingViewerAnnotations(existingSchema, nextSchema) {
  if (!isObjectRecord(existingSchema) || !isObjectRecord(nextSchema)) {
    return;
  }

  mergeExistingVoiceSchemaExtensions(existingSchema, nextSchema);

  const existingViewer = existingSchema['x-renku-viewer'];
  if (!isObjectRecord(existingViewer)) {
    return;
  }

  nextSchema['x-renku-viewer'] = structuredClone(existingViewer);
}

export function applyViewerAnnotationsOrThrow(schemaFile, options = {}) {
  const annotation = annotateSchemaFileForViewer(schemaFile, options);
  if (annotation.errors.length > 0) {
    throw new Error(annotation.errors.join(' '));
  }

  const validation = validateSchemaFileViewerAnnotations(schemaFile);
  if (validation.errors.length > 0) {
    throw new Error(validation.errors.join(' '));
  }

  return {
    placeholderPointers: validation.placeholderPointers,
    annotatedPointers: annotation.annotatedPointers,
  };
}
