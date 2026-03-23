#!/usr/bin/env node

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const producersRoot = join(repoRoot, 'catalog', 'producers');
const modelCatalogRoot = join(repoRoot, 'catalog', 'models');
const outputPath = join(
  repoRoot,
  'plans',
  'resolution-transform-playground-data.js'
);

function walkYamlFiles(root, output = []) {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      walkYamlFiles(fullPath, output);
      continue;
    }
    if (entry.isFile() && ['.yaml', '.yml'].includes(extname(entry.name))) {
      output.push(fullPath);
    }
  }
  return output;
}

function modelNameToFilename(name) {
  return name.replace(/[/.]/g, '-');
}

function loadModelCatalogs() {
  const byProvider = new Map();
  const entries = readdirSync(modelCatalogRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const provider = entry.name;
    const catalogPath = join(modelCatalogRoot, provider, `${provider}.yaml`);
    let catalog;
    try {
      catalog = parseYaml(readFileSync(catalogPath, 'utf8'));
    } catch {
      continue;
    }
    const models = new Map();
    for (const modelDef of Array.isArray(catalog?.models)
      ? catalog.models
      : []) {
      if (!modelDef || typeof modelDef !== 'object') {
        continue;
      }
      if (typeof modelDef.name !== 'string') {
        continue;
      }
      models.set(modelDef.name, modelDef);
    }
    byProvider.set(provider, models);
  }
  return byProvider;
}

const modelCatalogs = loadModelCatalogs();
const schemaCache = new Map();

function resolveSchema(provider, model) {
  const cacheKey = `${provider}::${model}`;
  if (schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey);
  }

  const providerCatalog = modelCatalogs.get(provider);
  if (!providerCatalog) {
    const result = { status: 'PROVIDER_NOT_FOUND' };
    schemaCache.set(cacheKey, result);
    return result;
  }

  const modelDef = providerCatalog.get(model);
  if (!modelDef) {
    const result = { status: 'MODEL_NOT_FOUND' };
    schemaCache.set(cacheKey, result);
    return result;
  }

  if (['llm', 'internal', 'text'].includes(modelDef.type)) {
    const result = {
      status: 'NO_SCHEMA_FOR_MODEL_TYPE',
      modelType: modelDef.type,
    };
    schemaCache.set(cacheKey, result);
    return result;
  }

  let schemaPath;
  if (typeof modelDef.inputSchema === 'string' && modelDef.inputSchema) {
    schemaPath = join(modelCatalogRoot, provider, modelDef.inputSchema);
  } else if (typeof modelDef.schema === 'string' && modelDef.schema) {
    schemaPath = join(
      modelCatalogRoot,
      provider,
      modelDef.type,
      `${modelDef.schema}.json`
    );
  } else {
    schemaPath = join(
      modelCatalogRoot,
      provider,
      modelDef.type,
      `${modelNameToFilename(model)}.json`
    );
  }

  try {
    const raw = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const inputSchema =
      raw &&
      typeof raw === 'object' &&
      raw.input_schema &&
      typeof raw.input_schema === 'object'
        ? raw.input_schema
        : raw;
    const properties =
      inputSchema &&
      typeof inputSchema === 'object' &&
      inputSchema.properties &&
      typeof inputSchema.properties === 'object'
        ? inputSchema.properties
        : {};

    const result = {
      status: 'OK',
      schemaPath: relative(repoRoot, schemaPath),
      properties,
    };
    schemaCache.set(cacheKey, result);
    return result;
  } catch (error) {
    const result = {
      status: 'SCHEMA_READ_ERROR',
      schemaPath: relative(repoRoot, schemaPath),
      error: error instanceof Error ? error.message : String(error),
    };
    schemaCache.set(cacheKey, result);
    return result;
  }
}

function hasObjectCapability(prop) {
  if (!prop || typeof prop !== 'object') {
    return false;
  }
  if (prop.type === 'object' || typeof prop.$ref === 'string') {
    return true;
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (
      Array.isArray(prop[key]) &&
      prop[key].some(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          (entry.type === 'object' || typeof entry.$ref === 'string')
      )
    ) {
      return true;
    }
  }
  return false;
}

function hasOnlyRefAllOf(prop) {
  return Boolean(
    prop &&
      typeof prop === 'object' &&
      Array.isArray(prop.allOf) &&
      prop.allOf.length > 0 &&
      prop.allOf.every(
        (entry) =>
          entry && typeof entry === 'object' && typeof entry.$ref === 'string'
      )
  );
}

function sizeRelatedFields(properties) {
  const regex =
    /(^|_)(resolution|aspect|size|width|height)(_|$)|aspectRatio|video_size|image_size/i;
  return Object.keys(properties).filter((key) => regex.test(key));
}

function collectStringEnums(prop) {
  const output = [];
  const seen = new Set();
  const push = (value) => {
    if (typeof value !== 'string') {
      return;
    }
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    output.push(value);
  };

  const walk = (node) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node.enum)) {
      for (const value of node.enum) {
        push(value);
      }
    }
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(node[key])) {
        for (const entry of node[key]) {
          walk(entry);
        }
      }
    }
  };

  walk(prop);
  return output;
}

function readNumericConstraint(prop, key) {
  if (!prop || typeof prop !== 'object') {
    return undefined;
  }
  if (typeof prop[key] === 'number') {
    return prop[key];
  }
  for (const compositionKey of ['anyOf', 'oneOf', 'allOf']) {
    if (!Array.isArray(prop[compositionKey])) {
      continue;
    }
    for (const entry of prop[compositionKey]) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof entry[key] === 'number'
      ) {
        return entry[key];
      }
    }
  }
  return undefined;
}

function classifyCase(properties) {
  const sizeFields = sizeRelatedFields(properties);
  if (sizeFields.length === 0) {
    return {
      id: 'CASE_H_NO_SIZE_FIELD',
      summary: 'Schema has no size/aspect fields.',
    };
  }

  const has = (field) =>
    Object.prototype.hasOwnProperty.call(properties, field);
  const hasAspect = has('aspect_ratio');
  const hasResolution = has('resolution');
  const hasImageSize = has('image_size');
  const hasVideoSize = has('video_size');
  const hasWidth = has('width');
  const hasHeight = has('height');
  const hasSize = has('size');
  const hasMegapixels = has('megapixels');

  if (hasVideoSize && hasObjectCapability(properties.video_size)) {
    return {
      id: 'CASE_C_SIZE_OBJECT',
      summary: 'Model accepts object size via video_size.',
    };
  }

  if (hasImageSize) {
    const imageSize = properties.image_size;
    if (imageSize?.type === 'integer') {
      return {
        id: 'CASE_K_LONGEST_SIDE_INTEGER',
        summary: 'Model expects integer image_size field.',
      };
    }
    if (hasObjectCapability(imageSize)) {
      return {
        id: 'CASE_C_SIZE_OBJECT',
        summary: 'Model accepts object size via image_size.',
      };
    }
    return {
      id: 'CASE_D_IMAGE_SIZE_TOKEN',
      summary: 'Model expects image_size token/string.',
    };
  }

  const resolutionDescription =
    hasResolution && typeof properties.resolution?.description === 'string'
      ? properties.resolution.description.toLowerCase()
      : '';

  if (hasMegapixels || resolutionDescription.includes('megapixel')) {
    if (hasAspect) {
      return {
        id: 'CASE_J_MEGAPIXELS_WITH_ASPECT',
        summary: 'Model expects megapixels plus aspect ratio.',
      };
    }
    return {
      id: 'CASE_J_MEGAPIXELS_ONLY',
      summary: 'Model expects megapixel value.',
    };
  }

  if (hasWidth && hasHeight) {
    return {
      id: 'CASE_F_WIDTH_HEIGHT_FIELDS',
      summary: 'Model expects explicit width and height fields.',
    };
  }

  if (hasAspect && hasResolution) {
    return {
      id: 'CASE_A_ASPECT_PLUS_PRESET',
      summary: 'Model expects aspect_ratio and resolution fields.',
    };
  }

  if (hasResolution) {
    return {
      id: 'CASE_B_RESOLUTION_PRESET_ONLY',
      summary: 'Model expects resolution preset field.',
    };
  }

  if (hasSize) {
    const sizeDescription =
      typeof properties.size?.description === 'string'
        ? properties.size.description.toLowerCase()
        : '';
    const sizeDefault =
      typeof properties.size?.default === 'string'
        ? properties.size.default
        : '';
    if (
      sizeDefault.includes('x') ||
      sizeDefault.includes('*') ||
      sizeDescription.includes('width and height') ||
      sizeDescription.includes('pixel')
    ) {
      return {
        id: 'CASE_E_SIZE_DIMENSION_STRING',
        summary: 'Model expects size dimension string.',
      };
    }
    return {
      id: 'CASE_E_SIZE_TOKEN_OR_DIM_UNRESOLVED',
      summary: 'Model has size field with unresolved enum/token references.',
    };
  }

  if (hasAspect) {
    return {
      id: 'CASE_G_ASPECT_ONLY',
      summary: 'Model expects aspect ratio only.',
    };
  }

  return {
    id: 'CASE_Z_UNCLASSIFIED',
    summary: `Unclassified size fields: ${sizeFields.join(', ')}`,
  };
}

function mappingConsumesResolution(alias, value) {
  if (alias === 'Resolution') {
    return true;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if (value.input === 'Resolution') {
    return true;
  }
  if (
    value.combine &&
    Array.isArray(value.combine.inputs) &&
    value.combine.inputs.includes('Resolution')
  ) {
    return true;
  }
  if (value.conditional?.when?.input === 'Resolution') {
    return true;
  }
  if (value.conditional?.then) {
    return mappingConsumesResolution(alias, value.conditional.then);
  }
  return false;
}

function sanitizeMappingRule(alias, value) {
  if (typeof value === 'string') {
    return {
      alias,
      ruleType: 'direct',
      source: alias,
      field: value,
      text: `\`${alias}\` -> \`${value}\``,
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      alias,
      ruleType: 'unknown',
      source: alias,
      field: null,
      text: `\`${alias}\` -> unsupported shape`,
    };
  }

  const source = typeof value.input === 'string' ? value.input : alias;
  const transformTable =
    value.transform &&
    typeof value.transform === 'object' &&
    !Array.isArray(value.transform)
      ? value.transform
      : null;
  const combineInputs =
    value.combine && Array.isArray(value.combine.inputs)
      ? value.combine.inputs
      : null;
  const combineTable =
    value.combine &&
    typeof value.combine === 'object' &&
    value.combine.table &&
    typeof value.combine.table === 'object' &&
    !Array.isArray(value.combine.table)
      ? value.combine.table
      : null;

  const textParts = [`source=\`${source}\``];
  if (typeof value.field === 'string' && value.field) {
    textParts.push(`field=\`${value.field}\``);
  }
  if (value.expand === true) {
    textParts.push('expand=true');
  }
  if (value.resolution?.mode) {
    const extras = [];
    if (typeof value.resolution.aspectRatioField === 'string') {
      extras.push(`aspectRatioField=\`${value.resolution.aspectRatioField}\``);
    }
    if (typeof value.resolution.presetField === 'string') {
      extras.push(`presetField=\`${value.resolution.presetField}\``);
    }
    textParts.push(
      `resolution.mode=\`${value.resolution.mode}\`${extras.length ? ` (${extras.join(', ')})` : ''}`
    );
  }
  if (combineInputs) {
    textParts.push(`combine.inputs=[${combineInputs.join(', ')}]`);
  }
  if (transformTable) {
    textParts.push(`transform.entries=${Object.keys(transformTable).length}`);
  }
  if (value.conditional) {
    textParts.push('conditional=true');
  }

  return {
    alias,
    ruleType: 'object',
    source,
    field: typeof value.field === 'string' ? value.field : null,
    expand: value.expand === true,
    resolutionMode:
      value.resolution &&
      typeof value.resolution === 'object' &&
      typeof value.resolution.mode === 'string'
        ? value.resolution.mode
        : null,
    aspectRatioField:
      value.resolution && typeof value.resolution.aspectRatioField === 'string'
        ? value.resolution.aspectRatioField
        : null,
    presetField:
      value.resolution && typeof value.resolution.presetField === 'string'
        ? value.resolution.presetField
        : null,
    combineInputs,
    combineTable,
    transformTable,
    text: `\`${alias}\`: ${textParts.join(', ')}`,
  };
}

function buildData() {
  const producerFiles = walkYamlFiles(producersRoot).sort();
  const producers = [];

  for (const producerPath of producerFiles) {
    const producerDoc = parseYaml(readFileSync(producerPath, 'utf8'));
    const hasResolutionInput = Array.isArray(producerDoc?.inputs)
      ? producerDoc.inputs.some(
          (entry) =>
            entry && typeof entry === 'object' && entry.name === 'Resolution'
        )
      : false;

    if (!hasResolutionInput) {
      continue;
    }

    const mappings =
      producerDoc &&
      typeof producerDoc === 'object' &&
      producerDoc.mappings &&
      typeof producerDoc.mappings === 'object'
        ? producerDoc.mappings
        : {};

    const rows = [];
    for (const provider of Object.keys(mappings).sort()) {
      const providerMappings = mappings[provider];
      if (!providerMappings || typeof providerMappings !== 'object') {
        continue;
      }

      for (const model of Object.keys(providerMappings).sort()) {
        const mappingTable = providerMappings[model];
        if (!mappingTable || typeof mappingTable !== 'object') {
          continue;
        }

        const schemaInfo = resolveSchema(provider, model);
        const caseInfo =
          schemaInfo.status === 'OK'
            ? classifyCase(schemaInfo.properties)
            : {
                id: 'CASE_I_SCHEMA_UNRESOLVED',
                summary: schemaInfo.status,
              };

        const mappingRules = Object.entries(mappingTable)
          .filter(([alias, value]) => mappingConsumesResolution(alias, value))
          .map(([alias, value]) => sanitizeMappingRule(alias, value));

        const sizeFields = {};
        const unresolvedRefFields = [];
        if (schemaInfo.status === 'OK') {
          for (const fieldName of sizeRelatedFields(
            schemaInfo.properties
          ).sort()) {
            const prop = schemaInfo.properties[fieldName];
            const fieldMeta = {
              type: typeof prop?.type === 'string' ? prop.type : null,
              description:
                typeof prop?.description === 'string' ? prop.description : null,
              default: prop?.default ?? null,
              stringEnums: collectStringEnums(prop),
              minimum: readNumericConstraint(prop, 'minimum') ?? null,
              maximum: readNumericConstraint(prop, 'maximum') ?? null,
              exclusiveMinimum:
                readNumericConstraint(prop, 'exclusiveMinimum') ?? null,
              exclusiveMaximum:
                readNumericConstraint(prop, 'exclusiveMaximum') ?? null,
              multipleOf: readNumericConstraint(prop, 'multipleOf') ?? null,
              hasObjectCapability: hasObjectCapability(prop),
              unresolvedRefAllOf: hasOnlyRefAllOf(prop),
            };
            sizeFields[fieldName] = fieldMeta;
            if (fieldMeta.unresolvedRefAllOf) {
              unresolvedRefFields.push(fieldName);
            }
          }
        }

        rows.push({
          provider,
          model,
          id: `${provider}/${model}`,
          caseId: caseInfo.id,
          caseSummary: caseInfo.summary,
          schemaStatus: schemaInfo.status,
          schemaPath: schemaInfo.schemaPath ?? null,
          sizeFields,
          unresolvedRefFields,
          mappingRules,
        });
      }
    }

    if (rows.length === 0) {
      continue;
    }

    producers.push({
      id: relative(repoRoot, producerPath),
      name:
        producerDoc &&
        typeof producerDoc === 'object' &&
        producerDoc.meta &&
        typeof producerDoc.meta === 'object' &&
        typeof producerDoc.meta.name === 'string'
          ? producerDoc.meta.name
          : relative(repoRoot, producerPath),
      rows,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    producers,
  };
}

const data = buildData();
const payload = `window.RESOLUTION_TOOL_DATA = ${JSON.stringify(data, null, 2)};\n`;
writeFileSync(outputPath, payload, 'utf8');

console.log(
  `Wrote ${relative(repoRoot, outputPath)} (${data.producers.length} producers, ${data.producers.reduce((sum, producer) => sum + producer.rows.length, 0)} rows)`
);
