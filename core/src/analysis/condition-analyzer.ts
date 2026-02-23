/**
 * Condition analyzer for blueprint dry-run simulation.
 *
 * Analyzes blueprint conditions to extract fields that affect conditional branches.
 * Used to generate varying mock data that exercises different code paths.
 */

import type {
  BlueprintDocument,
  EdgeConditionClause,
  EdgeConditionGroup,
  EdgeConditionDefinition,
  ConditionOperator,
} from '../types.js';

/**
 * Information about a field that affects conditional branches.
 */
export interface ConditionFieldInfo {
  /** Canonical field artifact ID (e.g., "Artifact:DocProducer.VideoScript.Segments[segment].NarrationType") */
  artifactId: string;
  /** Full artifact path (e.g., "DocProducer.VideoScript") */
  artifactPath: string;
  /** Path within the artifact to the field (e.g., ["Segments", "[segment]", "NarrationType"]) */
  fieldPath: string[];
  /** Values that trigger different branches */
  expectedValues: unknown[];
  /** The condition operator used */
  operator: ConditionOperator;
  /** Dimension symbols used in this field path (e.g., ["segment"]) */
  dimensions: string[];
}

/**
 * Result of analyzing conditions in a blueprint.
 */
export interface ConditionAnalysis {
  /** Fields that affect conditional branches */
  conditionFields: ConditionFieldInfo[];
  /** Producer names that have conditional inputs */
  conditionalProducers: string[];
  /** Named conditions from the blueprint's conditions block */
  namedConditions: string[];
}

/**
 * Analyzes a blueprint to extract condition-affecting fields.
 *
 * This information is used during dry-run simulation to generate
 * varying mock data that exercises different conditional branches.
 *
 * @param blueprint - The blueprint document to analyze
 * @returns Analysis of condition-affecting fields
 */
export function analyzeConditions(
  blueprint: BlueprintDocument
): ConditionAnalysis {
  const conditionFields: ConditionFieldInfo[] = [];
  const conditionalProducersSet = new Set<string>();
  const namedConditions: string[] = [];

  // Collect named conditions
  if (blueprint.conditions) {
    namedConditions.push(...Object.keys(blueprint.conditions));

    // Extract fields from named conditions
    for (const conditionDef of Object.values(blueprint.conditions)) {
      const fields = extractFieldsFromCondition(conditionDef);
      conditionFields.push(...fields);
    }
  }

  // Scan edges for inline conditions and track conditional producers
  for (const edge of blueprint.edges) {
    // Track producers that have conditional inputs
    if (edge.if || edge.conditions) {
      const producerName = extractProducerFromEdge(edge.to);
      if (producerName) {
        conditionalProducersSet.add(producerName);
      }
    }

    // Extract fields from inline conditions
    if (edge.conditions) {
      const fields = extractFieldsFromConditionDefinition(edge.conditions);
      conditionFields.push(...fields);
    }

    // Resolve named condition references
    if (edge.if && blueprint.conditions) {
      const namedCondition = blueprint.conditions[edge.if];
      if (namedCondition) {
        const fields = extractFieldsFromCondition(namedCondition);
        // Dedupe by checking if we already have this field+operator combo
        for (const field of fields) {
          if (!hasField(conditionFields, field)) {
            conditionFields.push(field);
          }
        }
      }
    }
  }

  // Dedupe condition fields by artifact path + field path + operator
  const deduped = dedupeFields(conditionFields);

  return {
    conditionFields: deduped,
    conditionalProducers: Array.from(conditionalProducersSet),
    namedConditions,
  };
}

/**
 * Extracts condition fields from a named condition definition.
 */
function extractFieldsFromCondition(
  condition: EdgeConditionClause | EdgeConditionGroup
): ConditionFieldInfo[] {
  if ('all' in condition || 'any' in condition) {
    return extractFieldsFromGroup(condition as EdgeConditionGroup);
  }
  return extractFieldsFromClause(condition as EdgeConditionClause);
}

/**
 * Extracts condition fields from a full condition definition (which can be an array).
 */
function extractFieldsFromConditionDefinition(
  definition: EdgeConditionDefinition
): ConditionFieldInfo[] {
  if (Array.isArray(definition)) {
    return definition.flatMap((item) => extractFieldsFromCondition(item));
  }
  return extractFieldsFromCondition(definition);
}

/**
 * Extracts condition fields from a condition group.
 */
function extractFieldsFromGroup(
  group: EdgeConditionGroup
): ConditionFieldInfo[] {
  const fields: ConditionFieldInfo[] = [];

  if (group.all) {
    for (const clause of group.all) {
      fields.push(...extractFieldsFromClause(clause));
    }
  }

  if (group.any) {
    for (const clause of group.any) {
      fields.push(...extractFieldsFromClause(clause));
    }
  }

  return fields;
}

/**
 * Extracts condition field info from a single clause.
 */
function extractFieldsFromClause(
  clause: EdgeConditionClause
): ConditionFieldInfo[] {
  const { artifactPath, fieldPath, dimensions } = parseConditionPath(
    clause.when
  );
  const { operator, values } = extractOperatorAndValues(clause);
  const artifactId = formatConditionFieldArtifactId({
    artifactPath,
    fieldPath,
  });

  return [
    {
      artifactId,
      artifactPath,
      fieldPath,
      expectedValues: values,
      operator,
      dimensions,
    },
  ];
}

/**
 * Parses a condition path into artifact path, field path, and dimensions.
 *
 * Example: "DocProducer.VideoScript.Segments[segment].NarrationType"
 * Returns:
 *   artifactPath: "DocProducer.VideoScript"
 *   fieldPath: ["Segments", "[segment]", "NarrationType"]
 *   dimensions: ["segment"]
 */
function parseConditionPath(whenPath: string): {
  artifactPath: string;
  fieldPath: string[];
  dimensions: string[];
} {
  const segments = splitPathWithBrackets(whenPath);
  const dimensions: string[] = [];

  // Extract dimension symbols from bracket segments
  for (const segment of segments) {
    const bracketMatch = /^\[([^\d][^\]]*)\]$/.exec(segment);
    if (bracketMatch) {
      dimensions.push(bracketMatch[1]!);
    }
  }

  // First two segments form the artifact path (Producer.ArtifactName)
  if (segments.length < 2) {
    return {
      artifactPath: segments.join('.'),
      fieldPath: [],
      dimensions,
    };
  }

  const artifactPath = segments.slice(0, 2).join('.');
  const fieldPath = segments.slice(2);

  return { artifactPath, fieldPath, dimensions };
}

/**
 * Splits a path into segments, keeping bracket expressions intact.
 */
function splitPathWithBrackets(path: string): string[] {
  const segments: string[] = [];
  let current = '';

  for (let i = 0; i < path.length; i++) {
    const char = path[i];

    if (char === '.') {
      if (current) {
        segments.push(current);
        current = '';
      }
    } else if (char === '[') {
      if (current) {
        segments.push(current);
        current = '';
      }
      // Read until closing bracket
      let bracket = '[';
      i++;
      while (i < path.length && path[i] !== ']') {
        bracket += path[i];
        i++;
      }
      bracket += ']';
      segments.push(bracket);
    } else {
      current += char;
    }
  }

  if (current) {
    segments.push(current);
  }

  return segments;
}

/**
 * Extracts the operator and expected values from a clause.
 */
function extractOperatorAndValues(clause: EdgeConditionClause): {
  operator: ConditionOperator;
  values: unknown[];
} {
  if (clause.is !== undefined) {
    return { operator: 'is', values: [clause.is] };
  }
  if (clause.isNot !== undefined) {
    return { operator: 'isNot', values: [clause.isNot] };
  }
  if (clause.contains !== undefined) {
    return { operator: 'contains', values: [clause.contains] };
  }
  if (clause.greaterThan !== undefined) {
    return { operator: 'greaterThan', values: [clause.greaterThan] };
  }
  if (clause.lessThan !== undefined) {
    return { operator: 'lessThan', values: [clause.lessThan] };
  }
  if (clause.greaterOrEqual !== undefined) {
    return { operator: 'greaterOrEqual', values: [clause.greaterOrEqual] };
  }
  if (clause.lessOrEqual !== undefined) {
    return { operator: 'lessOrEqual', values: [clause.lessOrEqual] };
  }
  if (clause.exists !== undefined) {
    return { operator: 'exists', values: [clause.exists] };
  }
  if (clause.matches !== undefined) {
    return { operator: 'matches', values: [clause.matches] };
  }

  // Default to exists check
  return { operator: 'exists', values: [true] };
}

/**
 * Extracts producer name from an edge target string.
 */
function extractProducerFromEdge(to: string): string | null {
  // Edge format: "ProducerName[dimension].InputName" or "ProducerName.InputName"
  const match = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(to);
  return match ? match[1]! : null;
}

/**
 * Checks if a field already exists in the array.
 */
function hasField(
  fields: ConditionFieldInfo[],
  field: ConditionFieldInfo
): boolean {
  return fields.some(
    (f) => f.artifactId === field.artifactId && f.operator === field.operator
  );
}

/**
 * Deduplicates fields by artifact path + field path + operator.
 */
function dedupeFields(fields: ConditionFieldInfo[]): ConditionFieldInfo[] {
  const seen = new Map<string, ConditionFieldInfo>();

  for (const field of fields) {
    const key = `${field.artifactId}|${field.operator}`;
    const existing = seen.get(key);
    if (existing) {
      // Merge expected values
      for (const value of field.expectedValues) {
        if (!existing.expectedValues.some((v) => deepEqual(v, value))) {
          existing.expectedValues.push(value);
        }
      }
      // Merge dimensions
      for (const dim of field.dimensions) {
        if (!existing.dimensions.includes(dim)) {
          existing.dimensions.push(dim);
        }
      }
    } else {
      seen.set(key, { ...field });
    }
  }

  return Array.from(seen.values());
}

/**
 * Simple deep equality check.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null) {
    return a === b;
  }
  if (typeof a !== 'object') {
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    return false;
  }

  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) {
    return false;
  }

  return keysA.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key]
    )
  );
}

/**
 * Converts condition analysis into simulation hints for varying field generation.
 *
 * @param analysis - The condition analysis result
 * @returns Hints for varying field values during simulation
 */
export function conditionAnalysisToVaryingHints(
  analysis: ConditionAnalysis
): VaryingFieldHint[] {
  const hints: VaryingFieldHint[] = [];

  for (const field of analysis.conditionFields) {
    const artifactId = field.artifactId;

    // For 'is' conditions, we want to alternate between the expected value
    // and something different to test both branches
    if (field.operator === 'is' && field.expectedValues.length > 0) {
      const primaryValue = field.expectedValues[0];

      // Generate alternative values based on type
      const alternativeValues = generateAlternatives(
        primaryValue,
        field.expectedValues
      );

      hints.push({
        artifactId,
        values: [primaryValue, ...alternativeValues],
        dimension: field.dimensions[0],
      });
    } else if (field.operator === 'isNot' && field.expectedValues.length > 0) {
      // For isNot, we want to sometimes use the forbidden value to skip
      const forbiddenValue = field.expectedValues[0];
      hints.push({
        artifactId,
        values: [forbiddenValue, generateDifferent(forbiddenValue)],
        dimension: field.dimensions[0],
      });
    }
  }

  return hints;
}

/**
 * Varying field hint for simulation.
 */
export interface VaryingFieldHint {
  /** Canonical field artifact ID (e.g., "Artifact:DocProducer.VideoScript.Segments[segment].NarrationType") */
  artifactId: string;
  /** Values to cycle through */
  values: unknown[];
  /** Dimension to vary on (e.g., "segment") */
  dimension?: string;
}

function formatConditionFieldArtifactId(field: {
  artifactPath: string;
  fieldPath: string[];
}): string {
  const suffix = joinFieldPathSegments(field.fieldPath);
  return suffix.length > 0
    ? `Artifact:${field.artifactPath}.${suffix}`
    : `Artifact:${field.artifactPath}`;
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

/**
 * Generates alternative values different from the primary value.
 */
function generateAlternatives(
  primaryValue: unknown,
  expectedValues: unknown[]
): unknown[] {
  if (typeof primaryValue === 'boolean') {
    return [!primaryValue];
  }

  if (typeof primaryValue === 'string') {
    // If there are other expected values, use those
    const others = expectedValues.filter((v) => v !== primaryValue);
    if (others.length > 0) {
      return others;
    }
    // Otherwise generate a different string
    return [`NOT_${primaryValue}`];
  }

  if (typeof primaryValue === 'number') {
    return [primaryValue + 1];
  }

  // For complex types, just return empty array (won't vary)
  return [];
}

/**
 * Generates a value different from the given value.
 */
function generateDifferent(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return !value;
  }
  if (typeof value === 'string') {
    return `NOT_${value}`;
  }
  if (typeof value === 'number') {
    return value + 1;
  }
  return null;
}
