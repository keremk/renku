function isObjectRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function propertyNameLooksLikeUrl(propertyName) {
  return (
    typeof propertyName === 'string' &&
    propertyName.toLowerCase().includes('url')
  );
}

function applyUriHintToNode(node, context) {
  if (Array.isArray(node)) {
    return node.map((entry) => applyUriHintToNode(entry, context));
  }

  if (!isObjectRecord(node)) {
    return node;
  }

  const result = {};

  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && isObjectRecord(value)) {
      const nextProperties = {};
      for (const [propertyName, propertySchema] of Object.entries(value)) {
        nextProperties[propertyName] = applyUriHintToNode(propertySchema, {
          urlHint: propertyNameLooksLikeUrl(propertyName),
        });
      }
      result[key] = nextProperties;
      continue;
    }

    if (
      (key === 'anyOf' || key === 'oneOf' || key === 'allOf') &&
      Array.isArray(value)
    ) {
      result[key] = value.map((variant) =>
        applyUriHintToNode(variant, context)
      );
      continue;
    }

    result[key] = applyUriHintToNode(value, context);
  }

  if (
    context.urlHint &&
    result.type === 'string' &&
    typeof result.format !== 'string'
  ) {
    result.format = 'uri';
  }

  if (
    context.urlHint &&
    result.type === 'array' &&
    isObjectRecord(result.items) &&
    result.items.type === 'string' &&
    typeof result.items.format !== 'string'
  ) {
    result.items = {
      ...result.items,
      format: 'uri',
    };
  }

  return result;
}

/**
 * Adds `format: "uri"` hints for URL-like schema fields.
 *
 * - URL-like means the source property name contains "url" (case-insensitive).
 * - The hint is propagated through anyOf/oneOf/allOf branches so nullable URL
 *   fields also receive URI typing on their concrete variants.
 */
export function normalizeSchemaUriFormats(schemaFile) {
  return applyUriHintToNode(schemaFile, { urlHint: false });
}
