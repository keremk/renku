import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

function isObjectRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function decodeJsonPointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function parseJsonPointer(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error(
      `Patch path must be an absolute JSON pointer (start with "/"), got "${String(path)}".`
    );
  }

  if (path === '/') {
    return [''];
  }

  return path
    .slice(1)
    .split('/')
    .map((token) => decodeJsonPointerToken(token));
}

function cloneJsonValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function describeContainer(container) {
  if (Array.isArray(container)) {
    return 'array';
  }
  if (isObjectRecord(container)) {
    return 'object';
  }
  return typeof container;
}

function resolveParentForPath(root, tokens, context) {
  if (tokens.length === 0) {
    throw new Error(
      `[schema-overrides] ${context}: patch path must not target the root document.`
    );
  }

  let cursor = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const traversedPath = `/${tokens.slice(0, index + 1).join('/')}`;

    if (Array.isArray(cursor)) {
      const arrayIndex = Number.parseInt(token, 10);
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0) {
        throw new Error(
          `[schema-overrides] ${context}: invalid array index "${token}" at "${traversedPath}".`
        );
      }
      if (arrayIndex >= cursor.length) {
        throw new Error(
          `[schema-overrides] ${context}: path "${traversedPath}" is missing in target schema.`
        );
      }
      cursor = cursor[arrayIndex];
      continue;
    }

    if (!isObjectRecord(cursor)) {
      throw new Error(
        `[schema-overrides] ${context}: cannot traverse "${traversedPath}" because current node is ${describeContainer(cursor)}.`
      );
    }

    if (!(token in cursor)) {
      throw new Error(
        `[schema-overrides] ${context}: path "${traversedPath}" is missing in target schema.`
      );
    }

    cursor = cursor[token];
  }

  const lastToken = tokens[tokens.length - 1];
  return { parent: cursor, lastToken };
}

function applyAddOperation(parent, token, value, context, fullPath) {
  if (Array.isArray(parent)) {
    if (token === '-') {
      parent.push(cloneJsonValue(value));
      return;
    }

    const index = Number.parseInt(token, 10);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) {
      throw new Error(
        `[schema-overrides] ${context}: cannot add at "${fullPath}" because array index "${token}" is invalid.`
      );
    }

    parent.splice(index, 0, cloneJsonValue(value));
    return;
  }

  if (!isObjectRecord(parent)) {
    throw new Error(
      `[schema-overrides] ${context}: cannot add at "${fullPath}" because parent is ${describeContainer(parent)}.`
    );
  }

  parent[token] = cloneJsonValue(value);
}

function applyReplaceOperation(parent, token, value, context, fullPath) {
  if (Array.isArray(parent)) {
    const index = Number.parseInt(token, 10);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error(
        `[schema-overrides] ${context}: cannot replace "${fullPath}" because array index "${token}" does not exist.`
      );
    }

    parent[index] = cloneJsonValue(value);
    return;
  }

  if (!isObjectRecord(parent)) {
    throw new Error(
      `[schema-overrides] ${context}: cannot replace "${fullPath}" because parent is ${describeContainer(parent)}.`
    );
  }

  if (!(token in parent)) {
    throw new Error(
      `[schema-overrides] ${context}: cannot replace "${fullPath}" because target path does not exist.`
    );
  }

  parent[token] = cloneJsonValue(value);
}

function applyRemoveOperation(parent, token, context, fullPath) {
  if (Array.isArray(parent)) {
    const index = Number.parseInt(token, 10);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error(
        `[schema-overrides] ${context}: cannot remove "${fullPath}" because array index "${token}" does not exist.`
      );
    }

    parent.splice(index, 1);
    return;
  }

  if (!isObjectRecord(parent)) {
    throw new Error(
      `[schema-overrides] ${context}: cannot remove "${fullPath}" because parent is ${describeContainer(parent)}.`
    );
  }

  if (!(token in parent)) {
    throw new Error(
      `[schema-overrides] ${context}: cannot remove "${fullPath}" because target path does not exist.`
    );
  }

  delete parent[token];
}

function applySinglePatch(targetSchema, patch, context) {
  if (!isObjectRecord(patch)) {
    throw new Error(`[schema-overrides] ${context}: patch entry must be object.`);
  }

  const op = patch.op;
  const path = patch.path;
  const value = patch.value;

  if (op !== 'add' && op !== 'replace' && op !== 'remove') {
    throw new Error(
      `[schema-overrides] ${context}: unsupported op "${String(op)}". Expected add|replace|remove.`
    );
  }

  const tokens = parseJsonPointer(path);
  const { parent, lastToken } = resolveParentForPath(targetSchema, tokens, context);

  if (op === 'add') {
    applyAddOperation(parent, lastToken, value, context, path);
    return;
  }

  if (op === 'replace') {
    applyReplaceOperation(parent, lastToken, value, context, path);
    return;
  }

  applyRemoveOperation(parent, lastToken, context, path);
}

function validateManifestStructure(manifest, manifestPath) {
  if (!isObjectRecord(manifest)) {
    throw new Error(
      `[schema-overrides] ${manifestPath}: manifest must be a top-level object.`
    );
  }

  const models = manifest.models;
  if (!Array.isArray(models)) {
    throw new Error(
      `[schema-overrides] ${manifestPath}: manifest must include "models" array.`
    );
  }

  for (const [index, entry] of models.entries()) {
    if (!isObjectRecord(entry)) {
      throw new Error(
        `[schema-overrides] ${manifestPath}: models[${index}] must be object.`
      );
    }
    if (typeof entry.name !== 'string' || entry.name.trim().length === 0) {
      throw new Error(
        `[schema-overrides] ${manifestPath}: models[${index}].name must be non-empty string.`
      );
    }
    if (typeof entry.type !== 'string' || entry.type.trim().length === 0) {
      throw new Error(
        `[schema-overrides] ${manifestPath}: models[${index}].type must be non-empty string.`
      );
    }
    if (!Array.isArray(entry.patches)) {
      throw new Error(
        `[schema-overrides] ${manifestPath}: models[${index}].patches must be array.`
      );
    }
  }
}

export async function loadSchemaOverrideManifest(manifestPath) {
  const raw = await readFile(manifestPath, 'utf8');
  const parsed = parseYaml(raw);
  validateManifestStructure(parsed, manifestPath);
  return parsed;
}

function getModelPatches(manifest, modelName, schemaType) {
  const matches = manifest.models.filter(
    (entry) => entry.name === modelName && entry.type === schemaType
  );

  if (matches.length === 0) {
    return [];
  }

  if (matches.length > 1) {
    throw new Error(
      `[schema-overrides] Duplicate override entries found for model "${modelName}" with type "${schemaType}".`
    );
  }

  return matches[0].patches;
}

export function applySchemaOverrides(args) {
  const {
    targetSchema,
    manifest,
    modelName,
    schemaType,
    manifestPath,
  } = args;

  if (!schemaType) {
    return { applied: 0 };
  }

  const patches = getModelPatches(manifest, modelName, schemaType);
  if (patches.length === 0) {
    return { applied: 0 };
  }

  const contextBase = `model=${modelName} type=${schemaType} manifest=${manifestPath}`;
  for (const [index, patch] of patches.entries()) {
    const context = `${contextBase} patchIndex=${index}`;
    applySinglePatch(targetSchema, patch, context);
  }

  return { applied: patches.length };
}
