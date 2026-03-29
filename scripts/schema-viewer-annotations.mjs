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

    return stripEmptyKeys(annotation);
  }

  const type = getNodeType(effectiveNode);
  if (type === 'string') {
    if (isUriStringSchema(effectiveNode)) {
      annotation.component = 'file-uri';
    } else if (hasEnum(effectiveNode)) {
      annotation.component = 'string-enum';
    } else {
      annotation.component = 'string';
    }
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
      ? generatedInput
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

export function mergeExistingViewerAnnotations(existingSchema, nextSchema) {
  if (!isObjectRecord(existingSchema) || !isObjectRecord(nextSchema)) {
    return;
  }

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
