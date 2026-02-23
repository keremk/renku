import { extname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  ConditionAnalysis,
  ConditionFieldInfo,
  VaryingFieldHint,
} from '../analysis/condition-analyzer.js';
import type { ExecutionPlan } from '../types.js';

export type BlueprintValidationConditionMode =
  | 'first-value'
  | 'alternating'
  | 'comprehensive';

export interface BlueprintValidationConditionHints {
  mode: BlueprintValidationConditionMode;
  varyingFields: VaryingFieldHint[];
}

export interface BlueprintValidationScenarioCase {
  id: string;
  conditionHints?: BlueprintValidationConditionHints;
}

export interface BlueprintValidationScenarioFile {
  version: 1;
  blueprint?: string;
  inputs?: string;
  generator?: {
    cases?: number;
    seed?: number;
  };
  cases?: BlueprintValidationScenarioCase[];
}

export interface BlueprintValidationFieldCoverage {
  field: string;
  operator: string;
  expectedValues: unknown[];
  matchedArtifacts: number;
  observedValues: unknown[];
  requiresDualOutcome: boolean;
  trueOutcomeObserved: boolean;
  falseOutcomeObserved: boolean;
  dimensions: string[];
  dimensionVariation: boolean[];
}

export interface BlueprintDryRunValidationCaseResult {
  id: string;
  movieId: string;
  status: 'succeeded' | 'failed';
  failedJobs: string[];
}

export interface BlueprintDryRunValidationResult {
  sourceTestFilePath?: string;
  generatedTestFilePath?: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  caseResults: BlueprintDryRunValidationCaseResult[];
  fieldCoverage: BlueprintValidationFieldCoverage[];
  failures: string[];
  warnings: string[];
}

export interface BlueprintValidationCaseExecution {
  movieId: string;
  failedJobs: string[];
  artifactIds: string[];
  readArtifactText(artifactId: string): Promise<string>;
  cleanup?(): Promise<void>;
}

export interface BuildBlueprintValidationCasesOptions {
  scenario?: BlueprintValidationScenarioFile;
  baseVaryingHints: VaryingFieldHint[];
  requestedCases?: number;
  requestedSeed?: number;
}

export interface RunBlueprintDryRunValidationOptions {
  conditionAnalysis: ConditionAnalysis;
  cases: BlueprintValidationScenarioCase[];
  sourceTestFilePath?: string;
  generatedTestFilePath?: string;
  executeCase(args: {
    caseDefinition: BlueprintValidationScenarioCase;
    caseIndex: number;
  }): Promise<BlueprintValidationCaseExecution>;
}

interface FieldObservation {
  caseId: string;
  artifactId: string;
  value: unknown;
  coordinates: number[];
}

interface FieldCoverageAccumulator {
  field: ConditionFieldInfo;
  matchedArtifacts: number;
  observations: FieldObservation[];
  trueOutcomeObserved: boolean;
  falseOutcomeObserved: boolean;
}

export function parseBlueprintValidationScenario(
  contents: string,
  sourcePath: string
): BlueprintValidationScenarioFile {
  const raw = parseScenarioContents(contents, sourcePath);
  return validateScenarioFile(raw, sourcePath);
}

export function stringifyBlueprintValidationScenario(
  scenario: BlueprintValidationScenarioFile,
  outputPath: string
): string {
  if (extname(outputPath).toLowerCase() === '.json') {
    return JSON.stringify(scenario, null, 2);
  }
  return stringifyYaml(scenario);
}

export function createBlueprintValidationScenarioFile(args: {
  blueprintPath: string;
  inputsPath?: string;
  cases: BlueprintValidationScenarioCase[];
  seed: number;
}): BlueprintValidationScenarioFile {
  return {
    version: 1,
    blueprint: args.blueprintPath,
    inputs: args.inputsPath,
    generator: {
      cases: args.cases.length,
      seed: args.seed,
    },
    cases: args.cases,
  };
}

export function buildBlueprintValidationCases(
  args: BuildBlueprintValidationCasesOptions
): BlueprintValidationScenarioCase[] {
  const scenario = args.scenario;
  if (scenario?.cases) {
    return scenario.cases;
  }

  const seedFromScenario = scenario?.generator?.seed;
  const caseCountFromScenario = scenario?.generator?.cases;

  const seed = args.requestedSeed ?? seedFromScenario ?? 0;
  const hasVaryingFields = args.baseVaryingHints.length > 0;
  const defaultCaseCount = hasVaryingFields ? 3 : 1;
  const caseCount =
    args.requestedCases ?? caseCountFromScenario ?? defaultCaseCount;

  if (!Number.isInteger(caseCount) || caseCount <= 0) {
    throw new Error(
      `Scenario case count must be a positive integer. Received ${caseCount}.`
    );
  }

  if (!hasVaryingFields) {
    if (args.requestedCases !== undefined && args.requestedCases > 1) {
      throw new Error(
        'Cannot generate multiple dry-run validation cases: no condition-varying fields were found in the blueprint.'
      );
    }
    return [{ id: 'case-1' }];
  }

  const cases: BlueprintValidationScenarioCase[] = [];
  for (let caseIndex = 0; caseIndex < caseCount; caseIndex += 1) {
    const varyingFields = args.baseVaryingHints.map((hint) => {
      if (hint.values.length === 0) {
        throw new Error(
          `Cannot generate validation cases because varying field ${hint.artifactId} has no values.`
        );
      }
      const shift = modulo(seed + caseIndex, hint.values.length);
      return {
        ...hint,
        values: rotateValues(hint.values, shift),
      };
    });

    cases.push({
      id: `case-${caseIndex + 1}`,
      conditionHints: {
        mode: 'alternating',
        varyingFields,
      },
    });
  }

  return cases;
}

export async function runBlueprintDryRunValidation(
  args: RunBlueprintDryRunValidationOptions
): Promise<BlueprintDryRunValidationResult> {
  const caseResults: BlueprintDryRunValidationCaseResult[] = [];
  const warnings: string[] = [];
  const failures: string[] = [];

  const fieldAccumulators = new Map<string, FieldCoverageAccumulator>();
  for (const field of args.conditionAnalysis.conditionFields) {
    fieldAccumulators.set(getFieldKey(field), {
      field,
      matchedArtifacts: 0,
      observations: [],
      trueOutcomeObserved: false,
      falseOutcomeObserved: false,
    });
  }

  if (fieldAccumulators.size === 0) {
    warnings.push(
      'No condition fields found in blueprint. Dry-run validation ran execution checks only.'
    );
  }

  for (let caseIndex = 0; caseIndex < args.cases.length; caseIndex += 1) {
    const caseDefinition = args.cases[caseIndex]!;
    const execution = await args.executeCase({ caseDefinition, caseIndex });
    try {
      const failedJobs = execution.failedJobs;

      caseResults.push({
        id: caseDefinition.id,
        movieId: execution.movieId,
        status: failedJobs.length > 0 ? 'failed' : 'succeeded',
        failedJobs,
      });

      if (failedJobs.length > 0) {
        failures.push(
          `Dry-run validation case "${caseDefinition.id}" failed jobs: ${failedJobs.join(', ')}.`
        );
        continue;
      }

      for (const accumulator of fieldAccumulators.values()) {
        const observations = await collectFieldObservationsFromExecution({
          execution,
          field: accumulator.field,
          caseId: caseDefinition.id,
        });

        accumulator.matchedArtifacts += observations.length;
        accumulator.observations.push(...observations);
        for (const observation of observations) {
          const outcome = evaluateConditionOutcome(
            accumulator.field,
            observation.value
          );
          if (outcome) {
            accumulator.trueOutcomeObserved = true;
          } else {
            accumulator.falseOutcomeObserved = true;
          }
        }
      }
    } finally {
      await execution.cleanup?.();
    }
  }

  const fieldCoverage: BlueprintValidationFieldCoverage[] = [];
  for (const accumulator of fieldAccumulators.values()) {
    const observedValues = dedupeObservedValues(
      accumulator.observations.map((item) => item.value)
    );
    const requiresDualOutcome =
      accumulator.field.operator === 'is' ||
      accumulator.field.operator === 'isNot';
    const dimensionVariation = accumulator.field.dimensions.map((_, dimIndex) =>
      hasVariationAcrossDimension(accumulator.observations, dimIndex)
    );

    fieldCoverage.push({
      field: formatConditionField(accumulator.field),
      operator: accumulator.field.operator,
      expectedValues: accumulator.field.expectedValues,
      matchedArtifacts: accumulator.matchedArtifacts,
      observedValues,
      requiresDualOutcome,
      trueOutcomeObserved: accumulator.trueOutcomeObserved,
      falseOutcomeObserved: accumulator.falseOutcomeObserved,
      dimensions: [...accumulator.field.dimensions],
      dimensionVariation,
    });

    if (accumulator.matchedArtifacts === 0) {
      failures.push(
        `No simulated artifacts matched condition field ${formatConditionField(accumulator.field)}.`
      );
      continue;
    }

    if (
      requiresDualOutcome &&
      (!accumulator.trueOutcomeObserved || !accumulator.falseOutcomeObserved)
    ) {
      failures.push(
        `Condition field ${formatConditionField(accumulator.field)} did not cover both branch outcomes across validation cases.`
      );
    }

    if (
      accumulator.field.dimensions.length > 1 &&
      !dimensionVariation.every((value) => value)
    ) {
      failures.push(
        `Condition field ${formatConditionField(accumulator.field)} did not vary across all indexed dimensions.`
      );
    }
  }

  const passedCases = caseResults.filter(
    (result) => result.status === 'succeeded'
  ).length;
  const failedCases = caseResults.length - passedCases;

  return {
    sourceTestFilePath: args.sourceTestFilePath,
    generatedTestFilePath: args.generatedTestFilePath,
    totalCases: caseResults.length,
    passedCases,
    failedCases,
    caseResults,
    fieldCoverage,
    failures,
    warnings,
  };
}

export function deriveConditionalUpToLayer(
  plan: ExecutionPlan
): number | undefined {
  let maxConditionalLayer = -1;
  for (let layerIndex = 0; layerIndex < plan.layers.length; layerIndex += 1) {
    const layer = plan.layers[layerIndex] ?? [];
    const hasConditionalJobs = layer.some((job) => {
      const inputConditions = job.context?.inputConditions;
      return Boolean(
        inputConditions && Object.keys(inputConditions).length > 0
      );
    });
    if (hasConditionalJobs) {
      maxConditionalLayer = layerIndex;
    }
  }

  return maxConditionalLayer >= 0 ? maxConditionalLayer : undefined;
}

function parseScenarioContents(contents: string, path: string): unknown {
  if (extname(path).toLowerCase() === '.json') {
    return JSON.parse(contents);
  }
  return parseYaml(contents);
}

function validateScenarioFile(
  raw: unknown,
  scenarioPath: string
): BlueprintValidationScenarioFile {
  if (!isRecord(raw)) {
    throw new Error(
      `Scenario file ${scenarioPath} must contain a root object.`
    );
  }

  const version = raw.version;
  if (version !== 1) {
    throw new Error(
      `Scenario file ${scenarioPath} has unsupported version ${String(version)}. Expected version 1.`
    );
  }

  const blueprint = readOptionalString(
    raw.blueprint,
    'blueprint',
    scenarioPath
  );
  const inputs = readOptionalString(raw.inputs, 'inputs', scenarioPath);

  const generatorRaw = raw.generator;
  let generator: BlueprintValidationScenarioFile['generator'];
  if (generatorRaw !== undefined) {
    if (!isRecord(generatorRaw)) {
      throw new Error(
        `Scenario file ${scenarioPath} field "generator" must be an object.`
      );
    }
    generator = {
      cases: readOptionalPositiveInteger(
        generatorRaw.cases,
        'generator.cases',
        scenarioPath
      ),
      seed: readOptionalInteger(
        generatorRaw.seed,
        'generator.seed',
        scenarioPath
      ),
    };
  }

  const casesRaw = raw.cases;
  let cases: BlueprintValidationScenarioFile['cases'];
  if (casesRaw !== undefined) {
    if (!Array.isArray(casesRaw)) {
      throw new Error(
        `Scenario file ${scenarioPath} field "cases" must be an array.`
      );
    }
    if (casesRaw.length === 0) {
      throw new Error(
        `Scenario file ${scenarioPath} field "cases" cannot be empty.`
      );
    }
    cases = casesRaw.map((entry, index) =>
      validateScenarioCase(entry, scenarioPath, index)
    );
  }

  return {
    version: 1,
    blueprint,
    inputs,
    generator,
    cases,
  };
}

function validateScenarioCase(
  rawCase: unknown,
  scenarioPath: string,
  index: number
): BlueprintValidationScenarioCase {
  if (!isRecord(rawCase)) {
    throw new Error(
      `Scenario file ${scenarioPath} case at index ${index} must be an object.`
    );
  }
  if (typeof rawCase.id !== 'string' || rawCase.id.trim().length === 0) {
    throw new Error(
      `Scenario file ${scenarioPath} case at index ${index} must include a non-empty string id.`
    );
  }

  let conditionHints: BlueprintValidationConditionHints | undefined;
  if (rawCase.conditionHints !== undefined) {
    conditionHints = validateConditionHints(
      rawCase.conditionHints,
      `${scenarioPath} case ${rawCase.id}`
    );
  }

  return {
    id: rawCase.id,
    conditionHints,
  };
}

function validateConditionHints(
  rawHints: unknown,
  context: string
): BlueprintValidationConditionHints {
  if (!isRecord(rawHints)) {
    throw new Error(`Condition hints in ${context} must be an object.`);
  }

  const mode = rawHints.mode;
  if (
    mode !== 'first-value' &&
    mode !== 'alternating' &&
    mode !== 'comprehensive'
  ) {
    throw new Error(
      `Condition hints in ${context} must define mode as one of: first-value, alternating, comprehensive.`
    );
  }

  const varyingFieldsRaw = rawHints.varyingFields;
  if (!Array.isArray(varyingFieldsRaw)) {
    throw new Error(
      `Condition hints in ${context} must define varyingFields as an array.`
    );
  }

  const varyingFields: VaryingFieldHint[] = varyingFieldsRaw.map(
    (entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(
          `Condition hints in ${context} varyingFields[${index}] must be an object.`
        );
      }
      if (
        typeof entry.artifactId !== 'string' ||
        entry.artifactId.trim().length === 0
      ) {
        throw new Error(
          `Condition hints in ${context} varyingFields[${index}] must define artifactId.`
        );
      }
      if (!entry.artifactId.startsWith('Artifact:')) {
        throw new Error(
          `Condition hints in ${context} varyingFields[${index}] artifactId must be canonical (Artifact:...).`
        );
      }
      if (!Array.isArray(entry.values) || entry.values.length === 0) {
        throw new Error(
          `Condition hints in ${context} varyingFields[${index}] must define a non-empty values array.`
        );
      }
      if (
        entry.dimension !== undefined &&
        (typeof entry.dimension !== 'string' ||
          entry.dimension.trim().length === 0)
      ) {
        throw new Error(
          `Condition hints in ${context} varyingFields[${index}] dimension must be a non-empty string when provided.`
        );
      }

      return {
        artifactId: entry.artifactId,
        values: entry.values,
        dimension: entry.dimension,
      };
    }
  );

  return {
    mode,
    varyingFields,
  };
}

async function collectFieldObservationsFromExecution(args: {
  execution: BlueprintValidationCaseExecution;
  field: ConditionFieldInfo;
  caseId: string;
}): Promise<FieldObservation[]> {
  const matcher = buildFieldMatcher(args.field);
  const observations: FieldObservation[] = [];

  for (const artifactId of args.execution.artifactIds) {
    const match = matcher.regex.exec(artifactId);
    if (!match) {
      continue;
    }

    const text = await args.execution.readArtifactText(artifactId);
    const value = parseScalarValue(text);
    const coordinates = match.slice(1).map((segment) => parseInt(segment, 10));

    observations.push({
      caseId: args.caseId,
      artifactId,
      value,
      coordinates,
    });
  }

  return observations;
}

function buildFieldMatcher(field: ConditionFieldInfo): { regex: RegExp } {
  let pattern = `^Artifact:${escapeRegExp(field.artifactPath)}`;

  for (const segment of field.fieldPath) {
    const bracketMatch = /^\[(.+)]$/.exec(segment);
    if (bracketMatch) {
      const bracketContent = bracketMatch[1]!;
      if (/^\d+$/.test(bracketContent)) {
        pattern += `\\[${bracketContent}\\]`;
      } else {
        pattern += '\\[(\\d+)\\]';
      }
      continue;
    }
    pattern += `\\.${escapeRegExp(segment)}`;
  }

  pattern += '$';
  return {
    regex: new RegExp(pattern),
  };
}

function parseScalarValue(rawValue: string): unknown {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return '';
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function evaluateConditionOutcome(
  field: ConditionFieldInfo,
  value: unknown
): boolean {
  const [firstExpected] = field.expectedValues;

  switch (field.operator) {
    case 'is':
      return field.expectedValues.some((expected) =>
        deepEqual(value, expected)
      );
    case 'isNot':
      return field.expectedValues.every(
        (expected) => !deepEqual(value, expected)
      );
    case 'contains': {
      if (typeof value === 'string' && typeof firstExpected === 'string') {
        return value.includes(firstExpected);
      }
      if (Array.isArray(value)) {
        return value.some((item) => deepEqual(item, firstExpected));
      }
      return false;
    }
    case 'greaterThan':
      return compareNumeric(
        value,
        firstExpected,
        (left, right) => left > right
      );
    case 'lessThan':
      return compareNumeric(
        value,
        firstExpected,
        (left, right) => left < right
      );
    case 'greaterOrEqual':
      return compareNumeric(
        value,
        firstExpected,
        (left, right) => left >= right
      );
    case 'lessOrEqual':
      return compareNumeric(
        value,
        firstExpected,
        (left, right) => left <= right
      );
    case 'exists': {
      const shouldExist = Boolean(firstExpected);
      const exists = value !== undefined && value !== null;
      return shouldExist ? exists : !exists;
    }
    case 'matches': {
      if (typeof value !== 'string' || typeof firstExpected !== 'string') {
        return false;
      }
      return new RegExp(firstExpected).test(value);
    }
    default:
      throw new Error(`Unsupported condition operator: ${field.operator}`);
  }
}

function compareNumeric(
  left: unknown,
  right: unknown,
  comparator: (left: number, right: number) => boolean
): boolean {
  if (typeof left !== 'number' || typeof right !== 'number') {
    return false;
  }
  return comparator(left, right);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (left === null || right === null) {
    return left === right;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return false;
  }

  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (!deepEqual(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

function dedupeObservedValues(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const deduped: unknown[] = [];

  for (const value of values) {
    const serialized = serializeValue(value);
    if (seen.has(serialized)) {
      continue;
    }
    seen.add(serialized);
    deduped.push(value);
  }

  return deduped;
}

function serializeValue(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hasVariationAcrossDimension(
  observations: FieldObservation[],
  dimensionIndex: number
): boolean {
  for (let leftIndex = 0; leftIndex < observations.length; leftIndex += 1) {
    const left = observations[leftIndex]!;
    const leftCoordinate = left.coordinates[dimensionIndex];
    if (leftCoordinate === undefined) {
      continue;
    }

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < observations.length;
      rightIndex += 1
    ) {
      const right = observations[rightIndex]!;
      const rightCoordinate = right.coordinates[dimensionIndex];
      if (rightCoordinate === undefined) {
        continue;
      }
      if (leftCoordinate === rightCoordinate) {
        continue;
      }
      if (!deepEqual(left.value, right.value)) {
        return true;
      }
    }
  }

  return false;
}

function formatConditionField(field: ConditionFieldInfo): string {
  if (field.fieldPath.length === 0) {
    return `Artifact:${field.artifactPath}`;
  }
  const suffix = joinFieldPathSegments(field.fieldPath);
  return `Artifact:${field.artifactPath}.${suffix}`;
}

function getFieldKey(field: ConditionFieldInfo): string {
  return `${formatConditionField(field)}|${field.operator}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function joinFieldPathSegments(segments: string[]): string {
  let result = '';
  for (const segment of segments) {
    if (segment.startsWith('[') && segment.endsWith(']')) {
      result += segment;
      continue;
    }
    if (result.length > 0) {
      result += '.';
    }
    result += segment;
  }
  return result;
}

function rotateValues(values: unknown[], offset: number): unknown[] {
  if (values.length === 0) {
    return [];
  }
  if (offset === 0) {
    return [...values];
  }
  const start = modulo(offset, values.length);
  return [...values.slice(start), ...values.slice(0, start)];
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(
  value: unknown,
  field: string,
  scenarioPath: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `Scenario file ${scenarioPath} field "${field}" must be a non-empty string when provided.`
    );
  }
  return value;
}

function readOptionalPositiveInteger(
  value: unknown,
  field: string,
  scenarioPath: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(
      `Scenario file ${scenarioPath} field "${field}" must be a positive integer when provided.`
    );
  }
  return value as number;
}

function readOptionalInteger(
  value: unknown,
  field: string,
  scenarioPath: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value)) {
    throw new Error(
      `Scenario file ${scenarioPath} field "${field}" must be an integer when provided.`
    );
  }
  return value as number;
}
