import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';
import { describe, it, expect } from 'vitest';
import type { JSONSchema7 } from 'ai';
import type {
  MappingCondition,
  MappingFieldDefinition,
  MappingValue,
} from '@gorenku/core';
import {
  loadModelCatalog,
  loadModelSchemaFile,
  lookupModel,
  resolveSchemaPath,
  type LoadedModelCatalog,
} from '../../src/model-catalog.js';
import { createProducerRuntime } from '../../src/sdk/runtime.js';
import { resolveSchemaRefs } from '../../src/sdk/unified/schema-file.js';
import type { ProviderJobContext } from '../../src/types.js';
import {
  CATALOG_MODELS_ROOT,
  CATALOG_PRODUCERS_ROOT,
  REPO_ROOT,
} from '../test-catalog-paths.js';

const REMOVE_INPUT = Symbol('remove-input');

const DEBUG_MODE =
  process.env.RENKU_VALIDATE_PRODUCERS_DEBUG === '1' ||
  process.env.RENKU_VALIDATE_PRODUCERS_DEBUG === 'true';

const DEBUG_DIR =
  process.env.RENKU_VALIDATE_PRODUCERS_DEBUG_DIR &&
  process.env.RENKU_VALIDATE_PRODUCERS_DEBUG_DIR.trim().length > 0
    ? resolve(process.env.RENKU_VALIDATE_PRODUCERS_DEBUG_DIR)
    : resolve(tmpdir(), 'renku-validate-producers-debug');

const SYSTEM_INPUT_NAMES = new Set([
  'Duration',
  'NumOfSegments',
  'Resolution',
  'SegmentDuration',
  'MovieId',
  'StorageRoot',
  'StorageBasePath',
]);

interface ProducerInputDeclaration {
  name: string;
  type: string;
  required?: boolean;
}

interface ProducerDocumentYaml {
  meta?: {
    id?: string;
    kind?: string;
  };
  inputs?: ProducerInputDeclaration[];
  mappings?: Record<string, Record<string, Record<string, MappingValue>>>;
}

interface ProducerModelCase {
  producerPath: string;
  producerId: string;
  provider: string;
  model: string;
  inputsByAlias: Map<string, ProducerInputDeclaration>;
  sdkMapping: Record<string, MappingFieldDefinition>;
}

interface ValidationScenario {
  name: string;
  overrides: Record<string, unknown | typeof REMOVE_INPUT>;
}

interface SchemaContext {
  schemaPath: string;
  inputSchema: JSONSchema7;
  inputSchemaText: string;
}

const schemaCache = new Map<string, SchemaContext>();
const validatorCache = new Map<string, ValidateFunction>();
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

describe('producer mapping contracts', () => {
  it('validates every producer mapping against model input schema', async () => {
    const catalog = await loadModelCatalog(CATALOG_MODELS_ROOT);
    const producerCases = await collectProducerModelCases();
    const failures: string[] = [];

    for (const producerCase of producerCases) {
      const casePrefix = `${producerCase.producerId} (${relative(REPO_ROOT, producerCase.producerPath)}) -> ${producerCase.provider}/${producerCase.model}`;

      const modelDef = lookupModel(
        catalog,
        producerCase.provider,
        producerCase.model
      );
      if (!modelDef) {
        failures.push(`${casePrefix}\n  Model not found in catalog.`);
        continue;
      }

      if (typeof modelDef.handler === 'string' && modelDef.handler.length > 0) {
        continue;
      }

      let schemaContext: SchemaContext;
      try {
        schemaContext = await getSchemaContext(
          catalog,
          producerCase.provider,
          producerCase.model
        );
      } catch (error) {
        failures.push(
          `${casePrefix}\n  Schema lookup failed: ${formatError(error)}`
        );
        await writeDebugSnapshot({
          producerCase,
          scenario: { name: 'schema-lookup', overrides: {} },
          stage: 'schema-lookup',
          error,
        });
        continue;
      }

      let contractValidator: ValidateFunction;
      try {
        contractValidator = getContractValidator(schemaContext.inputSchemaText);
      } catch (error) {
        failures.push(
          `${casePrefix}\n  Schema compilation failed: ${formatError(error)}`
        );
        await writeDebugSnapshot({
          producerCase,
          scenario: { name: 'schema-compile', overrides: {} },
          stage: 'schema-compile',
          inputSchemaPath: schemaContext.schemaPath,
          inputSchema: schemaContext.inputSchema,
          error,
        });
        continue;
      }

      const scenarios = buildValidationScenarios(producerCase.sdkMapping);
      const bindingAliases = collectInputBindingAliases(
        producerCase.sdkMapping
      );
      const mappedTopLevelFields = collectMappedTopLevelFields(
        producerCase.sdkMapping
      );
      const mappingSourceErrors = validateMappingSourcesDeclared(
        producerCase.sdkMapping,
        producerCase.inputsByAlias
      );
      if (mappingSourceErrors.length > 0) {
        const message = mappingSourceErrors.join('; ');
        failures.push(
          `${casePrefix}\n  Mapping source validation failed: ${message}`
        );
        await writeDebugSnapshot({
          producerCase,
          scenario: { name: 'mapping-source-validation', overrides: {} },
          stage: 'mapping-source-validation',
          inputSchemaPath: schemaContext.schemaPath,
          inputSchema: schemaContext.inputSchema,
          error: message,
        });
        continue;
      }

      const mappingTransformErrors = validateMappingTransformCompatibility(
        producerCase.sdkMapping,
        schemaContext.inputSchema
      );
      if (mappingTransformErrors.length > 0) {
        const message = mappingTransformErrors.join('; ');
        failures.push(
          `${casePrefix}\n  Mapping transform validation failed: ${message}`
        );
        await writeDebugSnapshot({
          producerCase,
          scenario: { name: 'mapping-transform-validation', overrides: {} },
          stage: 'mapping-transform-validation',
          inputSchemaPath: schemaContext.schemaPath,
          inputSchema: schemaContext.inputSchema,
          error: message,
        });
        continue;
      }

      const mappingTargetErrors = validateMappingTargetsAgainstSchema(
        producerCase.sdkMapping,
        schemaContext.inputSchema
      );
      if (mappingTargetErrors.length > 0) {
        const message = mappingTargetErrors.join('; ');
        failures.push(
          `${casePrefix}\n  Mapping target validation failed: ${message}`
        );
        await writeDebugSnapshot({
          producerCase,
          scenario: { name: 'mapping-target-validation', overrides: {} },
          stage: 'mapping-target-validation',
          inputSchemaPath: schemaContext.schemaPath,
          inputSchema: schemaContext.inputSchema,
          error: message,
        });
        continue;
      }

      const coverageTargets = collectCoverageTargetPaths(
        producerCase.sdkMapping
      );
      const coveredTargets = new Set<string>();

      for (const scenario of scenarios) {
        const resolvedInputs = buildResolvedInputs({
          producerCase,
          inputSchema: schemaContext.inputSchema,
          scenario,
        });

        const inputBindings = Object.fromEntries(
          [...bindingAliases].map((alias) => [alias, `Input:${alias}`])
        );

        const request: ProviderJobContext = {
          jobId: 'producer-mapping-contract',
          provider: producerCase.provider,
          model: producerCase.model,
          revision: 'rev-1',
          layerIndex: 0,
          attempt: 1,
          inputs: Object.values(inputBindings),
          produces: ['Artifact:Output[index=0]'],
          context: {
            providerConfig: {},
            extras: {
              resolvedInputs,
              jobContext: {
                inputBindings,
                sdkMapping: producerCase.sdkMapping,
              },
            },
          },
        };

        const runtime = createProducerRuntime({
          descriptor: {
            provider: producerCase.provider,
            model: producerCase.model,
            environment: 'local',
          },
          domain: 'media',
          request,
          mode: 'live',
        });

        let payload: Record<string, unknown>;
        try {
          payload = await runtime.sdk.buildPayload(
            undefined,
            schemaContext.inputSchemaText
          );
        } catch (error) {
          failures.push(
            `${casePrefix}\n  Scenario: ${scenario.name}\n  Payload build failed: ${formatError(error)}`
          );
          await writeDebugSnapshot({
            producerCase,
            scenario,
            stage: 'build-payload',
            resolvedInputs,
            inputSchemaPath: schemaContext.schemaPath,
            inputSchema: schemaContext.inputSchema,
            error,
          });
          continue;
        }

        const payloadWithPassThrough = addRequiredPassThroughFields({
          payload,
          inputSchema: schemaContext.inputSchema,
          mappedTopLevelFields,
        });

        markCoveredTargets(
          payloadWithPassThrough,
          coverageTargets,
          coveredTargets
        );

        try {
          const isValid = contractValidator(payloadWithPassThrough);
          if (isValid) {
            continue;
          }

          const errors = (contractValidator.errors ?? [])
            .map((entry) =>
              `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim()
            )
            .join('; ');
          failures.push(
            `${casePrefix}\n  Scenario: ${scenario.name}\n  Schema validation failed: ${errors}`
          );
          await writeDebugSnapshot({
            producerCase,
            scenario,
            stage: 'schema-validate',
            resolvedInputs,
            payload,
            payloadWithPassThrough,
            inputSchemaPath: schemaContext.schemaPath,
            inputSchema: schemaContext.inputSchema,
            error: errors,
          });
        } catch (error) {
          failures.push(
            `${casePrefix}\n  Scenario: ${scenario.name}\n  Schema validation failed: ${formatError(error)}`
          );
        }
      }

      const missingCoverage = [...coverageTargets].filter(
        (path) => !coveredTargets.has(path)
      );
      if (missingCoverage.length > 0) {
        const message = missingCoverage
          .map((path) => `target "${path}" never materialized in any scenario`)
          .join('; ');
        failures.push(`${casePrefix}\n  Mapping coverage failed: ${message}`);
        await writeDebugSnapshot({
          producerCase,
          scenario: { name: 'mapping-coverage', overrides: {} },
          stage: 'mapping-coverage',
          inputSchemaPath: schemaContext.schemaPath,
          inputSchema: schemaContext.inputSchema,
          error: message,
        });
      }
    }

    if (failures.length > 0) {
      const summary =
        `Producer mapping contract validation failed (${failures.length} issues).` +
        (DEBUG_MODE ? ` Debug snapshots: ${DEBUG_DIR}` : '');
      throw new Error(`${summary}\n\n${failures.join('\n\n')}`);
    }

    expect(failures).toHaveLength(0);
  });
});

async function collectProducerModelCases(): Promise<ProducerModelCase[]> {
  const producerPaths = await listYamlFiles(CATALOG_PRODUCERS_ROOT);
  const cases: ProducerModelCase[] = [];

  for (const producerPath of producerPaths) {
    const raw = await readFile(producerPath, 'utf8');
    const doc = parseYaml(raw) as ProducerDocumentYaml;
    const kind = doc.meta?.kind ?? 'blueprint';

    if (kind !== 'producer') {
      continue;
    }

    const producerId = doc.meta?.id;
    if (!producerId) {
      throw new Error(`Producer YAML missing meta.id: ${producerPath}`);
    }

    const mappings = doc.mappings;
    if (!mappings) {
      throw new Error(
        `Producer YAML missing mappings section: ${producerPath}`
      );
    }

    const inputsByAlias = new Map<string, ProducerInputDeclaration>();
    for (const input of doc.inputs ?? []) {
      if (typeof input.name === 'string' && input.name.length > 0) {
        inputsByAlias.set(input.name, input);
      }
    }

    for (const [provider, providerMappings] of Object.entries(mappings)) {
      for (const [model, rawMapping] of Object.entries(
        providerMappings ?? {}
      )) {
        cases.push({
          producerPath,
          producerId,
          provider,
          model,
          inputsByAlias,
          sdkMapping: normalizeSdkMapping(rawMapping),
        });
      }
    }
  }

  return cases.sort((left, right) => {
    const leftKey = `${left.producerPath}:${left.provider}:${left.model}`;
    const rightKey = `${right.producerPath}:${right.provider}:${right.model}`;
    return leftKey.localeCompare(rightKey);
  });
}

function normalizeSdkMapping(
  rawMapping: Record<string, MappingValue>
): Record<string, MappingFieldDefinition> {
  const sdkMapping: Record<string, MappingFieldDefinition> = {};
  for (const [alias, value] of Object.entries(rawMapping)) {
    sdkMapping[alias] = typeof value === 'string' ? { field: value } : value;
  }
  return sdkMapping;
}

async function getSchemaContext(
  catalog: LoadedModelCatalog,
  provider: string,
  model: string
): Promise<SchemaContext> {
  const cacheKey = `${provider}/${model}`;
  const cached = schemaCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const modelDef = lookupModel(catalog, provider, model);
  if (!modelDef) {
    throw new Error(
      `Model not found in catalog for mapping: ${provider}/${model}`
    );
  }

  const schemaFile = await loadModelSchemaFile(
    CATALOG_MODELS_ROOT,
    catalog,
    provider,
    model
  );
  if (!schemaFile) {
    throw new Error(`Input schema missing for model: ${provider}/${model}`);
  }

  const schemaPath = resolveSchemaPath(
    CATALOG_MODELS_ROOT,
    provider,
    model,
    modelDef
  );
  const inputSchema = normalizeSchemaForContractValidation(
    resolveSchemaRefs(schemaFile.inputSchema, schemaFile.definitions)
  );
  const inputSchemaText = JSON.stringify(inputSchema);

  const result: SchemaContext = {
    schemaPath,
    inputSchema,
    inputSchemaText,
  };
  schemaCache.set(cacheKey, result);
  return result;
}

function buildValidationScenarios(
  mapping: Record<string, MappingFieldDefinition>
): ValidationScenario[] {
  const scenarios: ValidationScenario[] = [{ name: 'base', overrides: {} }];
  const conditions = collectAllConditions(mapping);

  for (const condition of conditions) {
    const override = buildConditionOverride(condition);
    scenarios.push({
      name: `condition:${describeCondition(condition)}`,
      overrides: override,
    });
  }

  const deduped = new Map<string, ValidationScenario>();
  for (const scenario of scenarios) {
    const key = serializeScenarioOverrides(scenario.overrides);
    if (!deduped.has(key)) {
      deduped.set(key, scenario);
    }
  }

  return Array.from(deduped.values());
}

function collectAllConditions(
  mapping: Record<string, MappingFieldDefinition>
): MappingCondition[] {
  const entries: MappingCondition[] = [];

  const visit = (fieldDef: MappingFieldDefinition): void => {
    if (fieldDef.conditional) {
      entries.push(fieldDef.conditional.when);
      visit(fieldDef.conditional.then);
    }
  };

  for (const fieldDef of Object.values(mapping)) {
    visit(fieldDef);
  }

  const seen = new Set<string>();
  const unique: MappingCondition[] = [];
  for (const condition of entries) {
    const key = describeCondition(condition);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(condition);
    }
  }
  return unique;
}

function describeCondition(condition: MappingCondition): string {
  if (condition.equals !== undefined) {
    return `${condition.input}:equals:${String(condition.equals)}`;
  }
  if (condition.notEmpty) {
    return `${condition.input}:notEmpty:true`;
  }
  if (condition.empty) {
    return `${condition.input}:empty:true`;
  }
  return `${condition.input}:unknown`;
}

function buildConditionOverride(
  condition: MappingCondition
): Record<string, unknown | typeof REMOVE_INPUT> {
  if (condition.equals !== undefined) {
    return { [condition.input]: condition.equals };
  }
  if (condition.notEmpty) {
    return { [condition.input]: 'present-value' };
  }
  if (condition.empty) {
    return { [condition.input]: REMOVE_INPUT };
  }
  return {};
}

function serializeScenarioOverrides(
  overrides: Record<string, unknown | typeof REMOVE_INPUT>
): string {
  const normalized = Object.entries(overrides)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [
      key,
      value === REMOVE_INPUT ? '__REMOVE__' : value,
    ]);
  return JSON.stringify(normalized);
}

function buildResolvedInputs(args: {
  producerCase: ProducerModelCase;
  inputSchema: JSONSchema7;
  scenario: ValidationScenario;
}): Record<string, unknown> {
  const { producerCase, inputSchema, scenario } = args;
  const aliasValues: Record<string, unknown> = {};

  const conditionStats = collectConditionStats(producerCase.sdkMapping);

  for (const [alias, mapping] of Object.entries(producerCase.sdkMapping)) {
    seedAliasForMapping({
      alias,
      mapping,
      aliasValues,
      inputSchema,
      inputsByAlias: producerCase.inputsByAlias,
      scenarioOverrides: scenario.overrides,
      conditionStats,
    });
  }

  applyScenarioOverrides(
    aliasValues,
    scenario.overrides,
    producerCase.inputsByAlias
  );

  const resolvedInputs: Record<string, unknown> = {};
  for (const [alias, value] of Object.entries(aliasValues)) {
    resolvedInputs[`Input:${alias}`] = value;
  }

  return resolvedInputs;
}

function collectConditionStats(
  mapping: Record<string, MappingFieldDefinition>
): Map<string, { hasEmpty: boolean; hasNotEmptyOrEquals: boolean }> {
  const stats = new Map<
    string,
    { hasEmpty: boolean; hasNotEmptyOrEquals: boolean }
  >();

  const visit = (fieldDef: MappingFieldDefinition): void => {
    if (!fieldDef.conditional) {
      return;
    }

    const condition = fieldDef.conditional.when;
    const current = stats.get(condition.input) ?? {
      hasEmpty: false,
      hasNotEmptyOrEquals: false,
    };

    if (condition.empty) {
      current.hasEmpty = true;
    }
    if (condition.notEmpty || condition.equals !== undefined) {
      current.hasNotEmptyOrEquals = true;
    }

    stats.set(condition.input, current);
    visit(fieldDef.conditional.then);
  };

  for (const fieldDef of Object.values(mapping)) {
    visit(fieldDef);
  }

  return stats;
}

function seedAliasForMapping(args: {
  alias: string;
  mapping: MappingFieldDefinition;
  aliasValues: Record<string, unknown>;
  inputSchema: JSONSchema7;
  inputsByAlias: Map<string, ProducerInputDeclaration>;
  scenarioOverrides: Record<string, unknown | typeof REMOVE_INPUT>;
  conditionStats: Map<
    string,
    { hasEmpty: boolean; hasNotEmptyOrEquals: boolean }
  >;
}): void {
  const {
    alias,
    mapping,
    aliasValues,
    inputSchema,
    inputsByAlias,
    scenarioOverrides,
    conditionStats,
  } = args;

  if (mapping.conditional) {
    prepareConditionInput({
      condition: mapping.conditional.when,
      aliasValues,
      inputSchema,
      inputsByAlias,
      scenarioOverrides,
      conditionStats,
    });

    if (isConditionSatisfied(mapping.conditional.when, aliasValues)) {
      seedAliasForMapping({
        alias,
        mapping: mapping.conditional.then,
        aliasValues,
        inputSchema,
        inputsByAlias,
        scenarioOverrides,
        conditionStats,
      });
    }
    return;
  }

  if (mapping.combine) {
    seedCombineInputs({
      mapping,
      aliasValues,
      inputSchema,
      inputsByAlias,
      scenarioOverrides,
    });
    return;
  }

  const sourceAlias = mapping.input ?? alias;
  if (hasScenarioValue(sourceAlias, scenarioOverrides)) {
    return;
  }

  if (sourceAlias in aliasValues) {
    return;
  }

  const value = chooseSourceValue({
    sourceAlias,
    mapping,
    inputSchema,
    inputsByAlias,
  });
  if (value !== undefined) {
    aliasValues[sourceAlias] = value;
  }
}

function prepareConditionInput(args: {
  condition: MappingCondition;
  aliasValues: Record<string, unknown>;
  inputSchema: JSONSchema7;
  inputsByAlias: Map<string, ProducerInputDeclaration>;
  scenarioOverrides: Record<string, unknown | typeof REMOVE_INPUT>;
  conditionStats: Map<
    string,
    { hasEmpty: boolean; hasNotEmptyOrEquals: boolean }
  >;
}): void {
  const {
    condition,
    aliasValues,
    inputSchema,
    inputsByAlias,
    scenarioOverrides,
    conditionStats,
  } = args;

  if (hasScenarioValue(condition.input, scenarioOverrides)) {
    return;
  }

  const stats = conditionStats.get(condition.input);
  const preferEmpty = Boolean(stats?.hasEmpty && stats.hasNotEmptyOrEquals);

  if (condition.empty) {
    delete aliasValues[condition.input];
    return;
  }

  if (preferEmpty) {
    return;
  }

  if (condition.equals !== undefined) {
    aliasValues[condition.input] = condition.equals;
    return;
  }

  if (condition.notEmpty) {
    aliasValues[condition.input] = pickDefaultAliasValue({
      alias: condition.input,
      mapping: undefined,
      inputSchema,
      inputsByAlias,
    });
  }
}

function hasScenarioValue(
  alias: string,
  scenarioOverrides: Record<string, unknown | typeof REMOVE_INPUT>
): boolean {
  return Object.prototype.hasOwnProperty.call(scenarioOverrides, alias);
}

function isConditionSatisfied(
  condition: MappingCondition,
  aliasValues: Record<string, unknown>
): boolean {
  const value = aliasValues[condition.input];

  if (condition.equals !== undefined) {
    return value === condition.equals;
  }
  if (condition.notEmpty) {
    return value !== undefined && value !== null && value !== '';
  }
  if (condition.empty) {
    return value === undefined || value === null || value === '';
  }
  return false;
}

function seedCombineInputs(args: {
  mapping: MappingFieldDefinition;
  aliasValues: Record<string, unknown>;
  inputSchema: JSONSchema7;
  inputsByAlias: Map<string, ProducerInputDeclaration>;
  scenarioOverrides: Record<string, unknown | typeof REMOVE_INPUT>;
}): void {
  const {
    mapping,
    aliasValues,
    inputSchema,
    inputsByAlias,
    scenarioOverrides,
  } = args;

  const combine = mapping.combine;
  if (!combine) {
    return;
  }

  const fieldSchema =
    typeof mapping.field === 'string'
      ? getSchemaNodeAtPath(inputSchema, mapping.field)
      : undefined;

  const selected = selectBestTableEntry(
    combine.table,
    fieldSchema,
    inputSchema
  );
  if (!selected) {
    return;
  }

  const values = selected.key.split('+');

  for (let index = 0; index < combine.inputs.length; index += 1) {
    const inputAlias = combine.inputs[index]!;
    if (hasScenarioValue(inputAlias, scenarioOverrides)) {
      continue;
    }

    if (inputAlias in aliasValues) {
      continue;
    }

    const part = values[index] ?? '';
    if (part.length > 0) {
      aliasValues[inputAlias] = part;
      continue;
    }

    aliasValues[inputAlias] = pickDefaultAliasValue({
      alias: inputAlias,
      mapping: undefined,
      inputSchema,
      inputsByAlias,
    });
  }
}

function selectBestTableEntry(
  table: Record<string, unknown>,
  fieldSchema: JSONSchema7 | undefined,
  rootSchema: JSONSchema7
): { key: string; value: unknown } | null {
  const entries = Object.entries(table);
  if (entries.length === 0) {
    return null;
  }

  const sorted = [...entries].sort(([left], [right]) => {
    const leftScore = scoreTableKey(left);
    const rightScore = scoreTableKey(right);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return left.localeCompare(right);
  });

  if (!fieldSchema) {
    const [key, value] = sorted[0]!;
    return { key, value };
  }

  for (const [key, value] of sorted) {
    if (isSchemaCompatibleValue(value, fieldSchema, rootSchema)) {
      return { key, value };
    }
  }

  const [fallbackKey, fallbackValue] = sorted[0]!;
  return { key: fallbackKey, value: fallbackValue };
}

function scoreTableKey(key: string): number {
  return key
    .split('+')
    .reduce((score, part) => score + (part.length > 0 ? 1 : 0), 0);
}

function chooseSourceValue(args: {
  sourceAlias: string;
  mapping: MappingFieldDefinition;
  inputSchema: JSONSchema7;
  inputsByAlias: Map<string, ProducerInputDeclaration>;
}): unknown {
  const { sourceAlias, mapping, inputSchema, inputsByAlias } = args;

  if (mapping.resolution) {
    return { width: 1920, height: 1080 };
  }

  const fieldSchema =
    typeof mapping.field === 'string'
      ? getSchemaNodeAtPath(inputSchema, mapping.field)
      : undefined;

  if (mapping.transform && Object.keys(mapping.transform).length > 0) {
    const selected = selectBestTransformKey(
      mapping.transform,
      fieldSchema,
      inputSchema
    );
    if (selected !== undefined) {
      if (mapping.firstOf) {
        return [selected];
      }
      return coerceStringLiteral(selected);
    }
  }

  if (mapping.firstOf) {
    const scalar = pickDefaultAliasValue({
      alias: sourceAlias,
      mapping,
      inputSchema,
      inputsByAlias,
    });
    return [scalar];
  }

  if (
    mapping.intToString ||
    mapping.intToSecondsString ||
    mapping.durationToFrames
  ) {
    return 8;
  }

  return pickDefaultAliasValue({
    alias: sourceAlias,
    mapping,
    inputSchema,
    inputsByAlias,
  });
}

function selectBestTransformKey(
  transform: Record<string, unknown>,
  fieldSchema: JSONSchema7 | undefined,
  rootSchema: JSONSchema7
): string | undefined {
  const entries = Object.entries(transform);
  if (entries.length === 0) {
    return undefined;
  }

  if (!fieldSchema) {
    return entries[0]![0];
  }

  for (const [key, transformedValue] of entries) {
    if (isSchemaCompatibleValue(transformedValue, fieldSchema, rootSchema)) {
      return key;
    }
  }

  return entries[0]![0];
}

function pickDefaultAliasValue(args: {
  alias: string;
  mapping: MappingFieldDefinition | undefined;
  inputSchema: JSONSchema7;
  inputsByAlias: Map<string, ProducerInputDeclaration>;
}): unknown {
  const { alias, mapping, inputSchema, inputsByAlias } = args;
  const inputDecl = inputsByAlias.get(alias);

  if (mapping?.field) {
    const schemaNode = getSchemaNodeAtPath(inputSchema, mapping.field);
    if (schemaNode) {
      return generateValueFromSchemaNode(
        schemaNode,
        mapping.field,
        inputSchema
      );
    }
  }

  if (inputDecl) {
    return generateValueForProducerInputType(inputDecl.type, alias);
  }

  return generateValueForAliasHeuristic(alias);
}

function applyScenarioOverrides(
  aliasValues: Record<string, unknown>,
  overrides: Record<string, unknown | typeof REMOVE_INPUT>,
  inputsByAlias: Map<string, ProducerInputDeclaration>
): void {
  for (const [alias, value] of Object.entries(overrides)) {
    if (value === REMOVE_INPUT) {
      delete aliasValues[alias];
      continue;
    }
    if (value === 'present-value' && !inputsByAlias.has(alias)) {
      aliasValues[alias] = generateValueForAliasHeuristic(alias);
      continue;
    }
    if (value === 'present-value') {
      const type = inputsByAlias.get(alias)!.type;
      aliasValues[alias] = generateValueForProducerInputType(type, alias);
      continue;
    }
    aliasValues[alias] = value;
  }
}

function addRequiredPassThroughFields(args: {
  payload: Record<string, unknown>;
  inputSchema: JSONSchema7;
  mappedTopLevelFields: Set<string>;
}): Record<string, unknown> {
  const { payload, inputSchema, mappedTopLevelFields } = args;
  const result = { ...payload };

  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter(
        (entry): entry is string => typeof entry === 'string'
      )
    : [];

  const properties = getSchemaProperties(inputSchema);

  for (const requiredField of required) {
    if (requiredField in result) {
      continue;
    }

    const propertySchema = properties[requiredField];
    if (!propertySchema) {
      continue;
    }

    if ('default' in propertySchema) {
      continue;
    }

    if (mappedTopLevelFields.has(requiredField)) {
      continue;
    }

    result[requiredField] = generateValueFromSchemaNode(
      propertySchema,
      requiredField,
      inputSchema
    );
  }

  return result;
}

function collectMappedTopLevelFields(
  mapping: Record<string, MappingFieldDefinition>
): Set<string> {
  const fields = new Set<string>();

  const visit = (fieldDef: MappingFieldDefinition): void => {
    if (fieldDef.conditional) {
      visit(fieldDef.conditional.then);
      return;
    }

    if (typeof fieldDef.field === 'string' && fieldDef.field.length > 0) {
      fields.add(fieldDef.field.split('.')[0]!);
    }

    if (fieldDef.resolution?.mode === 'aspectRatioAndPresetObject') {
      if (fieldDef.resolution.aspectRatioField) {
        fields.add(fieldDef.resolution.aspectRatioField.split('.')[0]!);
      }
      if (fieldDef.resolution.presetField) {
        fields.add(fieldDef.resolution.presetField.split('.')[0]!);
      }
    }

    if (fieldDef.expand) {
      const candidateObjects: unknown[] = [];
      if (fieldDef.transform) {
        candidateObjects.push(...Object.values(fieldDef.transform));
      }
      if (fieldDef.combine) {
        candidateObjects.push(...Object.values(fieldDef.combine.table));
      }

      for (const candidate of candidateObjects) {
        if (
          !candidate ||
          typeof candidate !== 'object' ||
          Array.isArray(candidate)
        ) {
          continue;
        }
        for (const key of Object.keys(candidate as Record<string, unknown>)) {
          fields.add(key.split('.')[0]!);
        }
      }
    }
  };

  for (const fieldDef of Object.values(mapping)) {
    visit(fieldDef);
  }

  return fields;
}

function validateMappingSourcesDeclared(
  mapping: Record<string, MappingFieldDefinition>,
  inputsByAlias: Map<string, ProducerInputDeclaration>
): string[] {
  const declared = new Set(inputsByAlias.keys());
  const sourceRefs: Array<{ alias: string; source: string }> = [];

  const visit = (alias: string, fieldDef: MappingFieldDefinition): void => {
    if (fieldDef.input) {
      sourceRefs.push({ alias, source: fieldDef.input });
    }

    if (!fieldDef.combine && !fieldDef.conditional && !fieldDef.input) {
      sourceRefs.push({ alias, source: alias });
    }

    if (fieldDef.combine) {
      for (const input of fieldDef.combine.inputs) {
        sourceRefs.push({ alias, source: input });
      }
    }

    if (fieldDef.conditional) {
      sourceRefs.push({ alias, source: fieldDef.conditional.when.input });
      visit(alias, fieldDef.conditional.then);
    }
  };

  for (const [alias, fieldDef] of Object.entries(mapping)) {
    visit(alias, fieldDef);
  }

  const errors: string[] = [];
  const seen = new Set<string>();
  for (const reference of sourceRefs) {
    if (
      declared.has(reference.source) ||
      SYSTEM_INPUT_NAMES.has(reference.source)
    ) {
      continue;
    }
    const key = `${reference.alias}:${reference.source}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    errors.push(
      `alias "${reference.alias}" references undeclared source input "${reference.source}"`
    );
  }

  return errors;
}

function collectInputBindingAliases(
  mapping: Record<string, MappingFieldDefinition>
): Set<string> {
  const aliases = new Set<string>();

  const visit = (alias: string, fieldDef: MappingFieldDefinition): void => {
    aliases.add(alias);

    if (fieldDef.input) {
      aliases.add(fieldDef.input);
    }

    if (fieldDef.combine) {
      for (const input of fieldDef.combine.inputs) {
        aliases.add(input);
      }
    }

    if (fieldDef.conditional) {
      aliases.add(fieldDef.conditional.when.input);
      visit(alias, fieldDef.conditional.then);
    }
  };

  for (const [alias, fieldDef] of Object.entries(mapping)) {
    visit(alias, fieldDef);
  }

  return aliases;
}

function validateMappingTransformCompatibility(
  mapping: Record<string, MappingFieldDefinition>,
  inputSchema: JSONSchema7
): string[] {
  const errors: string[] = [];

  const validateFieldDef = (
    alias: string,
    fieldDef: MappingFieldDefinition,
    label: string
  ): void => {
    if (fieldDef.conditional) {
      validateFieldDef(alias, fieldDef.conditional.then, `${label}.then`);
      return;
    }

    const targetSchema =
      typeof fieldDef.field === 'string'
        ? getSchemaNodeAtPath(inputSchema, fieldDef.field)
        : undefined;

    if (fieldDef.transform && targetSchema) {
      for (const [key, value] of Object.entries(fieldDef.transform)) {
        if (!isSchemaCompatibleValue(value, targetSchema, inputSchema)) {
          errors.push(
            `${label} transform key "${key}" maps to incompatible value for target "${fieldDef.field}"`
          );
        }
      }
    }

    if (fieldDef.combine && targetSchema) {
      for (const [key, value] of Object.entries(fieldDef.combine.table)) {
        if (!isSchemaCompatibleValue(value, targetSchema, inputSchema)) {
          errors.push(
            `${label} combine key "${key}" maps to incompatible value for target "${fieldDef.field}"`
          );
        }
      }
    }

    if (fieldDef.intToString && targetSchema) {
      if (!schemaAcceptsType(targetSchema, inputSchema, 'string')) {
        errors.push(
          `${label} uses intToString but target "${fieldDef.field}" is not string-compatible`
        );
      }
    }

    if (fieldDef.intToSecondsString && targetSchema) {
      if (!schemaAcceptsType(targetSchema, inputSchema, 'string')) {
        errors.push(
          `${label} uses intToSecondsString but target "${fieldDef.field}" is not string-compatible`
        );
      }
    }

    if (fieldDef.durationToFrames && targetSchema) {
      if (
        !schemaAcceptsType(targetSchema, inputSchema, 'integer') &&
        !schemaAcceptsType(targetSchema, inputSchema, 'number') &&
        !schemaAcceptsType(targetSchema, inputSchema, 'string')
      ) {
        errors.push(
          `${label} uses durationToFrames but target "${fieldDef.field}" is not number/string-compatible`
        );
      }
    }

    if (fieldDef.asArray && targetSchema) {
      if (!schemaAcceptsType(targetSchema, inputSchema, 'array')) {
        errors.push(
          `${label} uses asArray but target "${fieldDef.field}" is not array-compatible`
        );
      }
    }

    if (fieldDef.resolution) {
      const mode = fieldDef.resolution.mode;
      const expectedValue =
        mode === 'width' || mode === 'height'
          ? 1920
          : mode === 'aspectRatioAndPresetObject'
            ? null
            : '16:9';

      if (expectedValue !== null && targetSchema) {
        if (
          (typeof expectedValue === 'string' &&
            !schemaAcceptsType(targetSchema, inputSchema, 'string')) ||
          (typeof expectedValue === 'number' &&
            !schemaAcceptsType(targetSchema, inputSchema, 'integer') &&
            !schemaAcceptsType(targetSchema, inputSchema, 'number'))
        ) {
          errors.push(
            `${label} resolution mode "${mode}" incompatible with target "${fieldDef.field}"`
          );
        }
      }

      if (mode === 'aspectRatioAndPresetObject') {
        if (fieldDef.resolution.aspectRatioField) {
          const aspectSchema = getSchemaNodeAtPath(
            inputSchema,
            fieldDef.resolution.aspectRatioField
          );
          if (
            aspectSchema &&
            !schemaAcceptsType(aspectSchema, inputSchema, 'string')
          ) {
            errors.push(
              `${label} resolution.aspectRatioField "${fieldDef.resolution.aspectRatioField}" is not string-compatible`
            );
          }
        }

        if (fieldDef.resolution.presetField) {
          const presetSchema = getSchemaNodeAtPath(
            inputSchema,
            fieldDef.resolution.presetField
          );
          if (
            presetSchema &&
            !schemaAcceptsType(presetSchema, inputSchema, 'string')
          ) {
            errors.push(
              `${label} resolution.presetField "${fieldDef.resolution.presetField}" is not string-compatible`
            );
          }
        }
      }
    }

    if (fieldDef.expand) {
      const candidateObjects: unknown[] = [];
      if (fieldDef.transform) {
        candidateObjects.push(...Object.values(fieldDef.transform));
      }
      if (fieldDef.combine) {
        candidateObjects.push(...Object.values(fieldDef.combine.table));
      }

      for (const candidate of candidateObjects) {
        if (
          !candidate ||
          typeof candidate !== 'object' ||
          Array.isArray(candidate)
        ) {
          continue;
        }
        for (const [expandedKey, expandedValue] of Object.entries(
          candidate as Record<string, unknown>
        )) {
          const expandedTargetSchema = getSchemaNodeAtPath(
            inputSchema,
            expandedKey
          );
          if (!expandedTargetSchema) {
            continue;
          }
          if (
            !isSchemaCompatibleValue(
              expandedValue,
              expandedTargetSchema,
              inputSchema
            )
          ) {
            errors.push(
              `${label} expand key "${expandedKey}" has incompatible value for schema target`
            );
          }
        }
      }
    }
  };

  for (const [alias, fieldDef] of Object.entries(mapping)) {
    validateFieldDef(alias, fieldDef, alias);
  }

  return errors;
}

function collectCoverageTargetPaths(
  mapping: Record<string, MappingFieldDefinition>
): Set<string> {
  const targets = new Set<string>();

  const visit = (fieldDef: MappingFieldDefinition): void => {
    if (fieldDef.conditional) {
      visit(fieldDef.conditional.then);
      return;
    }

    if (
      typeof fieldDef.field === 'string' &&
      fieldDef.field.trim().length > 0
    ) {
      targets.add(fieldDef.field.trim());
    }

    if (fieldDef.resolution?.mode === 'aspectRatioAndPresetObject') {
      if (fieldDef.resolution.aspectRatioField) {
        targets.add(fieldDef.resolution.aspectRatioField);
      }
      if (fieldDef.resolution.presetField) {
        targets.add(fieldDef.resolution.presetField);
      }
    }
  };

  for (const fieldDef of Object.values(mapping)) {
    visit(fieldDef);
  }

  return targets;
}

function markCoveredTargets(
  payload: Record<string, unknown>,
  targets: Set<string>,
  coveredTargets: Set<string>
): void {
  for (const target of targets) {
    if (hasObjectPath(payload, target)) {
      coveredTargets.add(target);
    }
  }
}

function hasObjectPath(obj: unknown, path: string): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }

  const segments = path.split('.').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return false;
  }

  let current: unknown = obj;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return false;
    }
    const record = current as Record<string, unknown>;
    if (!(segment in record)) {
      return false;
    }
    current = record[segment];
  }

  return true;
}

function validateMappingTargetsAgainstSchema(
  mapping: Record<string, MappingFieldDefinition>,
  inputSchema: JSONSchema7
): string[] {
  const targetPaths = collectMappingTargetPaths(mapping);
  const errors: string[] = [];

  for (const targetPath of targetPaths) {
    const node = getSchemaNodeAtPath(inputSchema, targetPath);
    if (!node) {
      errors.push(`target field "${targetPath}" is missing from input schema`);
    }
  }

  return errors;
}

function collectMappingTargetPaths(
  mapping: Record<string, MappingFieldDefinition>
): Set<string> {
  const paths = new Set<string>();

  const collectFromExpand = (fieldDef: MappingFieldDefinition): void => {
    if (!fieldDef.expand) {
      return;
    }

    const candidates: unknown[] = [];
    if (fieldDef.transform) {
      candidates.push(...Object.values(fieldDef.transform));
    }
    if (fieldDef.combine) {
      candidates.push(...Object.values(fieldDef.combine.table));
    }

    for (const candidate of candidates) {
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        continue;
      }
      for (const key of Object.keys(candidate as Record<string, unknown>)) {
        if (key.length > 0) {
          paths.add(key);
        }
      }
    }
  };

  const visit = (fieldDef: MappingFieldDefinition): void => {
    if (fieldDef.conditional) {
      visit(fieldDef.conditional.then);
      return;
    }

    if (
      typeof fieldDef.field === 'string' &&
      fieldDef.field.trim().length > 0
    ) {
      paths.add(fieldDef.field.trim());
    }

    if (fieldDef.resolution?.mode === 'aspectRatioAndPresetObject') {
      if (fieldDef.resolution.aspectRatioField) {
        paths.add(fieldDef.resolution.aspectRatioField);
      }
      if (fieldDef.resolution.presetField) {
        paths.add(fieldDef.resolution.presetField);
      }
    }

    collectFromExpand(fieldDef);
  };

  for (const fieldDef of Object.values(mapping)) {
    visit(fieldDef);
  }

  return paths;
}

function getSchemaNodeAtPath(
  schema: JSONSchema7,
  path: string
): JSONSchema7 | undefined {
  const segments = path.split('.').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return undefined;
  }

  let current: JSONSchema7 | undefined = schema;
  for (const segment of segments) {
    if (!current) {
      return undefined;
    }

    current = resolveSchemaNode(current, schema);

    if (!current) {
      return undefined;
    }

    const branch = chooseSchemaBranchForProperty(current, segment, schema);
    if (branch) {
      current = branch;
    }

    const properties = getSchemaProperties(current);
    current = properties[segment];
  }

  return current ? resolveSchemaNode(current, schema) : undefined;
}

function resolveSchemaNode(
  node: JSONSchema7,
  rootSchema: JSONSchema7
): JSONSchema7 {
  if (typeof node.$ref === 'string') {
    const resolved = resolveRefFromRoot(rootSchema, node.$ref);
    if (resolved) {
      return resolveSchemaNode(resolved, rootSchema);
    }
  }

  return node;
}

function chooseSchemaBranchForProperty(
  schemaNode: JSONSchema7,
  property: string,
  rootSchema: JSONSchema7
): JSONSchema7 | undefined {
  const candidates: JSONSchema7[] = [];

  for (const entry of schemaNode.allOf ?? []) {
    const candidate = toSchemaObject(entry);
    if (candidate) {
      candidates.push(resolveSchemaNode(candidate, rootSchema));
    }
  }
  for (const entry of schemaNode.anyOf ?? []) {
    const candidate = toSchemaObject(entry);
    if (candidate) {
      candidates.push(resolveSchemaNode(candidate, rootSchema));
    }
  }
  for (const entry of schemaNode.oneOf ?? []) {
    const candidate = toSchemaObject(entry);
    if (candidate) {
      candidates.push(resolveSchemaNode(candidate, rootSchema));
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  for (const candidate of candidates) {
    const properties = getSchemaProperties(candidate);
    if (property in properties) {
      return candidate;
    }
  }

  return candidates[0];
}

function resolveRefFromRoot(
  rootSchema: JSONSchema7,
  ref: string
): JSONSchema7 | undefined {
  const defsMatch = ref.match(/^#\/\$defs\/([^/]+)$/);
  if (defsMatch) {
    const defs =
      rootSchema.$defs && typeof rootSchema.$defs === 'object'
        ? (rootSchema.$defs as Record<string, JSONSchema7>)
        : {};
    return defs[defsMatch[1]];
  }

  const localMatch = ref.match(/^#\/([^/]+)$/);
  if (localMatch) {
    const defs =
      rootSchema.$defs && typeof rootSchema.$defs === 'object'
        ? (rootSchema.$defs as Record<string, JSONSchema7>)
        : {};
    return defs[localMatch[1]];
  }

  return undefined;
}

function toSchemaObject(definition: unknown): JSONSchema7 | undefined {
  if (
    !definition ||
    typeof definition !== 'object' ||
    Array.isArray(definition)
  ) {
    return undefined;
  }
  return definition as JSONSchema7;
}

function getSchemaProperties(schema: JSONSchema7): Record<string, JSONSchema7> {
  if (
    !schema.properties ||
    typeof schema.properties !== 'object' ||
    Array.isArray(schema.properties)
  ) {
    return {};
  }

  const result: Record<string, JSONSchema7> = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = value as JSONSchema7;
    }
  }
  return result;
}

function isSchemaCompatibleValue(
  value: unknown,
  schema: JSONSchema7,
  rootSchema: JSONSchema7
): boolean {
  const resolvedSchema = resolveSchemaNode(schema, rootSchema);

  if (resolvedSchema.allOf && resolvedSchema.allOf.length > 0) {
    return resolvedSchema.allOf.every((candidate) => {
      const schemaCandidate = toSchemaObject(candidate);
      return schemaCandidate
        ? isSchemaCompatibleValue(value, schemaCandidate, rootSchema)
        : true;
    });
  }

  if (resolvedSchema.anyOf && resolvedSchema.anyOf.length > 0) {
    return resolvedSchema.anyOf.some((candidate) => {
      const schemaCandidate = toSchemaObject(candidate);
      return schemaCandidate
        ? isSchemaCompatibleValue(value, schemaCandidate, rootSchema)
        : false;
    });
  }
  if (resolvedSchema.oneOf && resolvedSchema.oneOf.length > 0) {
    return resolvedSchema.oneOf.some((candidate) => {
      const schemaCandidate = toSchemaObject(candidate);
      return schemaCandidate
        ? isSchemaCompatibleValue(value, schemaCandidate, rootSchema)
        : false;
    });
  }
  if (resolvedSchema.enum && Array.isArray(resolvedSchema.enum)) {
    return resolvedSchema.enum.some((entry) => Object.is(entry, value));
  }

  const type = resolvedSchema.type;
  if (!type) {
    return true;
  }

  if (Array.isArray(type)) {
    return type.some((entry) =>
      isSchemaCompatibleValue(
        value,
        { ...resolvedSchema, type: entry },
        rootSchema
      )
    );
  }

  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
    default:
      return true;
  }
}

function schemaAcceptsType(
  schema: JSONSchema7,
  rootSchema: JSONSchema7,
  expectedType: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object'
): boolean {
  const resolved = resolveSchemaNode(schema, rootSchema);

  if (resolved.allOf && resolved.allOf.length > 0) {
    return resolved.allOf.every((entry) => {
      const candidate = toSchemaObject(entry);
      return candidate
        ? schemaAcceptsType(candidate, rootSchema, expectedType)
        : true;
    });
  }

  if (resolved.anyOf && resolved.anyOf.length > 0) {
    return resolved.anyOf.some((entry) => {
      const candidate = toSchemaObject(entry);
      return candidate
        ? schemaAcceptsType(candidate, rootSchema, expectedType)
        : false;
    });
  }

  if (resolved.oneOf && resolved.oneOf.length > 0) {
    return resolved.oneOf.some((entry) => {
      const candidate = toSchemaObject(entry);
      return candidate
        ? schemaAcceptsType(candidate, rootSchema, expectedType)
        : false;
    });
  }

  const type = resolved.type;
  if (!type) {
    return true;
  }

  const values = Array.isArray(type) ? type : [type];
  if (expectedType === 'number') {
    return values.includes('number') || values.includes('integer');
  }
  return values.includes(expectedType);
}

function generateValueFromSchemaNode(
  schema: JSONSchema7,
  keyHint: string,
  rootSchema: JSONSchema7
): unknown {
  const resolvedSchema = resolveSchemaNode(schema, rootSchema);

  if (resolvedSchema.default !== undefined) {
    return resolvedSchema.default;
  }

  if (resolvedSchema.const !== undefined) {
    return resolvedSchema.const;
  }

  if (resolvedSchema.enum && resolvedSchema.enum.length > 0) {
    return resolvedSchema.enum[0];
  }

  if (resolvedSchema.format === 'uri') {
    return 'https://example.com/resource';
  }

  if (resolvedSchema.anyOf && resolvedSchema.anyOf.length > 0) {
    const candidate = toSchemaObject(resolvedSchema.anyOf[0]);
    if (candidate) {
      return generateValueFromSchemaNode(candidate, keyHint, rootSchema);
    }
  }

  if (resolvedSchema.oneOf && resolvedSchema.oneOf.length > 0) {
    const candidate = toSchemaObject(resolvedSchema.oneOf[0]);
    if (candidate) {
      return generateValueFromSchemaNode(candidate, keyHint, rootSchema);
    }
  }

  if (resolvedSchema.allOf && resolvedSchema.allOf.length > 0) {
    const candidate = toSchemaObject(resolvedSchema.allOf[0]);
    if (candidate) {
      return generateValueFromSchemaNode(candidate, keyHint, rootSchema);
    }
  }

  const type = Array.isArray(resolvedSchema.type)
    ? resolvedSchema.type[0]
    : resolvedSchema.type;

  switch (type) {
    case 'string':
      return generateStringFromSchema(resolvedSchema, keyHint);
    case 'integer':
      return generateIntegerFromSchema(resolvedSchema);
    case 'number':
      return generateNumberFromSchema(resolvedSchema);
    case 'boolean':
      return true;
    case 'array': {
      const itemSchema =
        resolvedSchema.items && !Array.isArray(resolvedSchema.items)
          ? (resolvedSchema.items as JSONSchema7)
          : ({ type: 'string' } as JSONSchema7);
      return [generateValueFromSchemaNode(itemSchema, keyHint, rootSchema)];
    }
    case 'object': {
      const obj: Record<string, unknown> = {};
      const properties = getSchemaProperties(resolvedSchema);
      const required = Array.isArray(resolvedSchema.required)
        ? resolvedSchema.required.filter(
            (entry): entry is string => typeof entry === 'string'
          )
        : [];

      for (const requiredKey of required) {
        const propertySchema = properties[requiredKey];
        if (!propertySchema) {
          continue;
        }
        obj[requiredKey] = generateValueFromSchemaNode(
          propertySchema,
          requiredKey,
          rootSchema
        );
      }

      if (required.length === 0 && Object.keys(properties).length > 0) {
        const firstKey = Object.keys(properties).sort()[0]!;
        obj[firstKey] = generateValueFromSchemaNode(
          properties[firstKey]!,
          firstKey,
          rootSchema
        );
      }

      return obj;
    }
    default:
      return generateValueForAliasHeuristic(keyHint);
  }
}

function generateStringFromSchema(
  schema: JSONSchema7,
  keyHint: string
): string {
  if (schema.format === 'uri' || keyHint.toLowerCase().includes('url')) {
    return 'https://example.com/resource';
  }

  if (typeof schema.pattern === 'string') {
    if (schema.pattern === '^\\d+k$') {
      return '192k';
    }
    if (
      schema.pattern === '^[0-9A-Fa-f]{6}$' ||
      schema.pattern === '^#[0-9A-Fa-f]{6}$'
    ) {
      return '#ffffff';
    }
  }

  if (typeof schema.minLength === 'number' && schema.minLength > 1) {
    return 'x'.repeat(schema.minLength);
  }

  return 'sample-text';
}

function generateIntegerFromSchema(schema: JSONSchema7): number {
  if (typeof schema.minimum === 'number') {
    return Math.ceil(schema.minimum);
  }
  if (typeof schema.exclusiveMinimum === 'number') {
    return Math.floor(schema.exclusiveMinimum) + 1;
  }
  return 1;
}

function generateNumberFromSchema(schema: JSONSchema7): number {
  if (typeof schema.minimum === 'number') {
    return schema.minimum;
  }
  if (typeof schema.exclusiveMinimum === 'number') {
    return schema.exclusiveMinimum + 0.1;
  }
  return 1;
}

function generateValueForProducerInputType(
  type: string,
  alias: string
): unknown {
  switch (type) {
    case 'string':
      return generateValueForAliasHeuristic(alias);
    case 'integer':
    case 'int':
      return 8;
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'array':
      return ['sample-item'];
    case 'collection':
      return ['https://example.com/resource'];
    case 'json':
      return { value: 'sample' };
    case 'resolution':
      return { width: 1920, height: 1080 };
    case 'image':
    case 'video':
    case 'audio':
      return 'https://example.com/resource';
    default:
      return generateValueForAliasHeuristic(alias);
  }
}

function generateValueForAliasHeuristic(alias: string): unknown {
  const lower = alias.toLowerCase();

  if (
    lower.includes('duration') ||
    lower.includes('frames') ||
    lower.includes('seed')
  ) {
    return 8;
  }
  if (lower.includes('width')) {
    return 1024;
  }
  if (lower.includes('height')) {
    return 1024;
  }
  if (lower.includes('ratio')) {
    return '16:9';
  }
  if (lower.includes('resolution')) {
    return '720p';
  }
  if (
    lower.includes('url') ||
    lower.includes('image') ||
    lower.includes('audio') ||
    lower.includes('video')
  ) {
    return 'https://example.com/resource';
  }
  if (lower.includes('voice')) {
    return 'voice-1';
  }
  if (lower.includes('language')) {
    return 'en';
  }
  if (lower.includes('emotion')) {
    return 'neutral';
  }
  if (
    lower.includes('multishot') ||
    lower.includes('generateaudio') ||
    lower.includes('camerafixed')
  ) {
    return true;
  }

  return 'sample-text';
}

function coerceStringLiteral(value: string): unknown {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return Number.parseFloat(value);
  }
  return value;
}

function getContractValidator(inputSchemaText: string): ValidateFunction {
  const cached = validatorCache.get(inputSchemaText);
  if (cached) {
    return cached;
  }

  const schema = JSON.parse(inputSchemaText) as JSONSchema7;
  const validator = ajv.compile(schema);
  validatorCache.set(inputSchemaText, validator);
  return validator;
}

function normalizeSchemaForContractValidation(
  schema: JSONSchema7
): JSONSchema7 {
  const clone = JSON.parse(JSON.stringify(schema)) as JSONSchema7;
  const defs: Record<string, JSONSchema7> = {
    ...(clone.$defs && typeof clone.$defs === 'object'
      ? (clone.$defs as Record<string, JSONSchema7>)
      : {}),
    ...(clone.definitions && typeof clone.definitions === 'object'
      ? (clone.definitions as Record<string, JSONSchema7>)
      : {}),
  };

  const components = (clone as Record<string, unknown>).components;
  if (components && typeof components === 'object') {
    const schemas = (components as Record<string, unknown>).schemas;
    if (schemas && typeof schemas === 'object' && !Array.isArray(schemas)) {
      Object.assign(defs, schemas as Record<string, JSONSchema7>);
    }
  }

  clone.$defs = defs;
  delete clone.definitions;
  delete (clone as Record<string, unknown>).components;

  sanitizeSchemaNode(clone, defs);
  return clone;
}

function sanitizeSchemaNode(
  node: unknown,
  defs: Record<string, JSONSchema7>
): void {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      sanitizeSchemaNode(entry, defs);
    }
    return;
  }

  const record = node as Record<string, unknown>;

  if (typeof record.$ref === 'string') {
    const ref = record.$ref;
    const componentMatch = ref.match(/^#\/components\/schemas\/([^/]+)$/);
    if (componentMatch) {
      const refName = componentMatch[1]!;
      if (defs[refName]) {
        record.$ref = `#/$defs/${refName}`;
      } else {
        delete record.$ref;
      }
    }

    const definitionsMatch = ref.match(/^#\/definitions\/([^/]+)$/);
    if (definitionsMatch) {
      const refName = definitionsMatch[1]!;
      if (defs[refName]) {
        record.$ref = `#/$defs/${refName}`;
      } else {
        delete record.$ref;
      }
    }
  }

  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    const value = record[keyword];
    if (Array.isArray(value) && value.length === 0) {
      delete record[keyword];
    }
  }

  for (const value of Object.values(record)) {
    sanitizeSchemaNode(value, defs);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listYamlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await listYamlFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && extname(entry.name).toLowerCase() === '.yaml') {
      paths.push(fullPath);
    }
  }

  return paths;
}

async function writeDebugSnapshot(args: {
  producerCase: ProducerModelCase;
  scenario: ValidationScenario;
  stage: string;
  resolvedInputs?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  payloadWithPassThrough?: Record<string, unknown>;
  inputSchema?: JSONSchema7;
  inputSchemaPath?: string;
  error: unknown;
}): Promise<void> {
  if (!DEBUG_MODE) {
    return;
  }

  const {
    producerCase,
    scenario,
    stage,
    resolvedInputs,
    payload,
    payloadWithPassThrough,
    inputSchema,
    inputSchemaPath,
    error,
  } = args;

  await mkdir(DEBUG_DIR, { recursive: true });

  const baseName = [
    producerCase.producerId,
    producerCase.provider,
    producerCase.model,
    scenario.name,
    stage,
  ]
    .join('__')
    .replace(/[^a-zA-Z0-9_.-]+/g, '_')
    .slice(0, 220);

  const filePath = resolve(DEBUG_DIR, `${baseName}.json`);
  const payloadToWrite = {
    producerPath: relative(REPO_ROOT, producerCase.producerPath),
    producerId: producerCase.producerId,
    provider: producerCase.provider,
    model: producerCase.model,
    scenario,
    stage,
    resolvedInputs,
    payload,
    payloadWithPassThrough,
    inputSchemaPath,
    inputSchema,
    error: formatError(error),
  };

  await writeFile(
    filePath,
    `${JSON.stringify(payloadToWrite, null, 2)}\n`,
    'utf8'
  );
}
