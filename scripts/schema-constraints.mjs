const TARGET_FIELD_NAMES = new Set([
  'aspect_ratio',
  'resolution',
  'size',
  'target_resolution',
  'duration',
  'seconds',
  'image_size',
  'video_size',
  'megapixels',
]);

function isObjectRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function pushUnique(target, value) {
  if (value === undefined || value === null) {
    return;
  }
  if (!target.some((entry) => Object.is(entry, value))) {
    target.push(value);
  }
}

function collectEnumLikeValues(node, output) {
  if (!isObjectRecord(node)) {
    return;
  }

  if (Array.isArray(node.enum)) {
    for (const value of node.enum) {
      if (typeof value === 'string' || typeof value === 'number') {
        pushUnique(output, value);
      }
    }
  }

  if (node.const !== undefined) {
    const value = node.const;
    if (typeof value === 'string' || typeof value === 'number') {
      pushUnique(output, value);
    }
  }

  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    if (!Array.isArray(node[keyword])) {
      continue;
    }
    for (const child of node[keyword]) {
      collectEnumLikeValues(child, output);
    }
  }
}

function collectMatches(text, regex) {
  const values = [];
  let match = regex.exec(text);
  while (match) {
    const token = match[0];
    if (token) {
      pushUnique(values, token);
    }
    match = regex.exec(text);
  }
  return values;
}

function parseAspectRatios(description) {
  return collectMatches(description, /\b\d{1,2}:\d{1,2}\b/g);
}

function parseResolutionTokens(description) {
  const tokens = [];

  for (const token of collectMatches(description, /\b\d{3,4}p\b/gi)) {
    pushUnique(tokens, token.toLowerCase());
  }

  for (const token of collectMatches(description, /\b\d+(?:\.\d+)?k\b/gi)) {
    pushUnique(tokens, token.toUpperCase());
  }

  for (const token of collectMatches(description, /\b\d+(?:\.\d+)?\s*mp\b/gi)) {
    const compact = token.replace(/\s+/g, '').toUpperCase();
    pushUnique(tokens, compact);
  }

  for (const token of collectMatches(description, /\b\d{2,5}[x*]\d{2,5}\b/gi)) {
    pushUnique(tokens, token.toLowerCase());
  }

  return tokens;
}

function inferValuesFromDescription(fieldName, description) {
  if (typeof description !== 'string' || description.trim().length === 0) {
    return [];
  }

  const normalizedField = fieldName.toLowerCase();

  if (normalizedField === 'aspect_ratio') {
    return parseAspectRatios(description);
  }

  if (normalizedField === 'duration' || normalizedField === 'seconds') {
    return [];
  }

  if (
    normalizedField === 'resolution' ||
    normalizedField === 'size' ||
    normalizedField === 'target_resolution' ||
    normalizedField === 'image_size' ||
    normalizedField === 'video_size' ||
    normalizedField === 'megapixels'
  ) {
    const values = [
      ...parseResolutionTokens(description),
      ...parseAspectRatios(description),
    ];
    const unique = [];
    for (const value of values) {
      pushUnique(unique, value);
    }
    return unique;
  }

  return [];
}

function buildFieldConstraint(fieldName, schemaNode) {
  const explicitValues = [];
  collectEnumLikeValues(schemaNode, explicitValues);
  if (explicitValues.length > 0) {
    return {
      enum: {
        values: explicitValues,
        source: 'explicit',
        confidence: 'high',
      },
    };
  }

  const inferredValues = inferValuesFromDescription(
    fieldName,
    isObjectRecord(schemaNode) ? schemaNode.description : undefined
  );

  if (inferredValues.length > 0) {
    return {
      enum: {
        values: inferredValues,
        source: 'inferred',
        confidence: 'medium',
      },
    };
  }

  return undefined;
}

export function enrichSchemaWithRenkuConstraints(inputSchema) {
  if (!isObjectRecord(inputSchema)) {
    return inputSchema;
  }

  const properties = isObjectRecord(inputSchema.properties)
    ? inputSchema.properties
    : undefined;
  if (!properties) {
    return inputSchema;
  }

  const fields = {};

  for (const [fieldName, schemaNode] of Object.entries(properties)) {
    if (!TARGET_FIELD_NAMES.has(fieldName)) {
      continue;
    }
    const constraint = buildFieldConstraint(fieldName, schemaNode);
    if (constraint) {
      fields[fieldName] = constraint;
    }
  }

  if (Object.keys(fields).length === 0) {
    return inputSchema;
  }

  inputSchema['x-renku-constraints'] = {
    fields,
  };

  return inputSchema;
}
