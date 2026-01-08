/**
 * Condition evaluator for runtime edge evaluation.
 *
 * Evaluates conditions against resolved artifact data to determine
 * whether edges should be active.
 */

import type {
  EdgeConditionClause,
  EdgeConditionDefinition,
  EdgeConditionGroup,
  ConditionOperator,
  InputConditionInfo,
} from './types.js';
import { formatCanonicalArtifactId } from './parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';

/**
 * Result of evaluating a condition.
 */
export interface ConditionEvaluationResult {
  satisfied: boolean;
  reason?: string;
}

/**
 * Context for condition evaluation.
 */
export interface ConditionEvaluationContext {
  /** Resolved artifact data (keyed by canonical artifact ID) */
  resolvedArtifacts: Record<string, unknown>;
}

/**
 * Evaluates input conditions for a producer job.
 * Returns a map of input IDs to whether they should be included.
 */
export function evaluateInputConditions(
  inputConditions: Record<string, InputConditionInfo> | undefined,
  context: ConditionEvaluationContext,
): Map<string, ConditionEvaluationResult> {
  const results = new Map<string, ConditionEvaluationResult>();

  if (!inputConditions) {
    return results;
  }

  for (const [inputId, conditionInfo] of Object.entries(inputConditions)) {
    const result = evaluateCondition(
      conditionInfo.condition,
      conditionInfo.indices,
      context,
    );
    results.set(inputId, result);
  }

  return results;
}

/**
 * Evaluates a condition definition against the context.
 */
export function evaluateCondition(
  condition: EdgeConditionDefinition,
  indices: Record<string, number>,
  context: ConditionEvaluationContext,
): ConditionEvaluationResult {
  // Handle array of conditions (implicit AND)
  if (Array.isArray(condition)) {
    for (const item of condition) {
      const result = evaluateConditionItem(item, indices, context);
      if (!result.satisfied) {
        return result;
      }
    }
    return { satisfied: true };
  }

  // Single condition clause or group
  return evaluateConditionItem(condition, indices, context);
}

/**
 * Evaluates a single condition item (clause or group).
 */
function evaluateConditionItem(
  item: EdgeConditionClause | EdgeConditionGroup,
  indices: Record<string, number>,
  context: ConditionEvaluationContext,
): ConditionEvaluationResult {
  // Check if it's a group (has 'all' or 'any')
  if ('all' in item || 'any' in item) {
    return evaluateConditionGroup(item as EdgeConditionGroup, indices, context);
  }

  // It's a clause
  return evaluateConditionClause(item as EdgeConditionClause, indices, context);
}

/**
 * Evaluates a condition group (AND/OR).
 */
function evaluateConditionGroup(
  group: EdgeConditionGroup,
  indices: Record<string, number>,
  context: ConditionEvaluationContext,
): ConditionEvaluationResult {
  // Handle 'all' (AND)
  if (group.all) {
    for (const clause of group.all) {
      const result = evaluateConditionClause(clause, indices, context);
      if (!result.satisfied) {
        return result;
      }
    }
  }

  // Handle 'any' (OR)
  if (group.any) {
    let anyReason = '';
    for (const clause of group.any) {
      const result = evaluateConditionClause(clause, indices, context);
      if (result.satisfied) {
        return { satisfied: true };
      }
      anyReason = result.reason ?? '';
    }
    // None of the 'any' conditions were satisfied
    if (group.any.length > 0 && !group.all) {
      return { satisfied: false, reason: `No 'any' conditions satisfied. Last: ${anyReason}` };
    }
  }

  return { satisfied: true };
}

/**
 * Evaluates a single condition clause.
 */
function evaluateConditionClause(
  clause: EdgeConditionClause,
  indices: Record<string, number>,
  context: ConditionEvaluationContext,
): ConditionEvaluationResult {
  // Resolve the artifact path and get the value
  const { artifactId, fieldPath } = resolveConditionPath(clause.when, indices);
  const artifactData = context.resolvedArtifacts[artifactId];

  if (artifactData === undefined) {
    // If the artifact doesn't exist yet, we can't evaluate
    return { satisfied: false, reason: `Artifact ${artifactId} not found` };
  }

  const value = getValueAtPath(artifactData, fieldPath);

  // Evaluate each operator
  if (clause.is !== undefined) {
    const result = evaluateOperator('is', value, clause.is);
    if (!result.satisfied) {
      return result;
    }
  }

  if (clause.isNot !== undefined) {
    const result = evaluateOperator('isNot', value, clause.isNot);
    if (!result.satisfied) {
      return result;
    }
  }

  if (clause.contains !== undefined) {
    const result = evaluateOperator('contains', value, clause.contains);
    if (!result.satisfied) {
      return result;
    }
  }

  if (clause.greaterThan !== undefined) {
    const result = evaluateOperator('greaterThan', value, clause.greaterThan);
    if (!result.satisfied) {
      return result;
    }
  }

  if (clause.lessThan !== undefined) {
    const result = evaluateOperator('lessThan', value, clause.lessThan);
    if (!result.satisfied) {
      return result;
    }
  }

  if (clause.greaterOrEqual !== undefined) {
    const result = evaluateOperator('greaterOrEqual', value, clause.greaterOrEqual);
    if (!result.satisfied) {
      return result;
    }
  }

  if (clause.lessOrEqual !== undefined) {
    const result = evaluateOperator('lessOrEqual', value, clause.lessOrEqual);
    if (!result.satisfied) {
      return result;
    }
  }

  if (clause.exists !== undefined) {
    const result = evaluateOperator('exists', value, clause.exists);
    if (!result.satisfied) {
      return result;
    }
  }

  if (clause.matches !== undefined) {
    const result = evaluateOperator('matches', value, clause.matches);
    if (!result.satisfied) {
      return result;
    }
  }

  return { satisfied: true };
}

/**
 * Resolves a condition path to an artifact ID and field path.
 *
 * The condition path format is: "Producer.ArtifactName.FieldPath"
 * where Producer.ArtifactName identifies the artifact and FieldPath is
 * the path within the artifact's JSON content.
 *
 * Example: "DocProducer.VideoScript.Segments[segment].NarrationType"
 * with indices { segment: 2 } becomes:
 * - artifactId: "Artifact:DocProducer.VideoScript"
 * - fieldPath: ["Segments", "[2]", "NarrationType"]
 *
 * The artifact ID is always the first two segments (Producer.ArtifactName).
 * Everything after is the field path within that artifact.
 */
function resolveConditionPath(
  whenPath: string,
  indices: Record<string, number>,
): { artifactId: string; fieldPath: string[] } {
  // Replace dimension placeholders with indices
  let resolvedPath = whenPath;
  for (const [symbol, index] of Object.entries(indices)) {
    // Extract the dimension label from the full symbol
    const label = extractDimensionLabel(symbol);
    // Replace [label] with [index]
    resolvedPath = resolvedPath.replace(
      new RegExp(`\\[${escapeRegex(label)}\\]`, 'g'),
      `[${index}]`,
    );
  }

  // Split the path, keeping bracket indices as separate segments
  // e.g., "DocProducer.VideoScript.Segments[1].NarrationType"
  // becomes ["DocProducer", "VideoScript", "Segments", "[1]", "NarrationType"]
  const segments = splitPathWithIndices(resolvedPath);

  // The artifact ID is the first two segments (Producer.ArtifactName)
  // Everything after is the field path
  if (segments.length < 2) {
    // Not enough segments - treat whole thing as artifact
    const artifactId = formatCanonicalArtifactId([], segments.join('.'));
    return { artifactId, fieldPath: [] };
  }

  const artifactPath = segments.slice(0, 2).join('.');
  const fieldPath = segments.slice(2);

  // Format as canonical artifact ID
  const artifactId = formatCanonicalArtifactId([], artifactPath);

  return { artifactId, fieldPath };
}

/**
 * Splits a path into segments, extracting bracket indices as separate segments.
 * e.g., "Foo.Bar[1].Baz" => ["Foo", "Bar", "[1]", "Baz"]
 */
function splitPathWithIndices(path: string): string[] {
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
      // Find matching ]
      let bracketContent = '[';
      i++;
      while (i < path.length && path[i] !== ']') {
        bracketContent += path[i];
        i++;
      }
      bracketContent += ']';
      segments.push(bracketContent);
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
 * Gets a value at a nested path within an object.
 * Handles both property names and bracket indices (e.g., "[1]").
 */
function getValueAtPath(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;

  for (const segment of path) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current !== 'object') {
      return undefined;
    }

    // Check if this is a bracket index like "[1]"
    const bracketMatch = /^\[(\d+)\]$/.exec(segment);
    if (bracketMatch) {
      const index = parseInt(bracketMatch[1]!, 10);
      if (Array.isArray(current)) {
        current = current[index];
      } else {
        return undefined;
      }
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }

  return current;
}

/**
 * Evaluates a single operator.
 */
function evaluateOperator(
  operator: ConditionOperator,
  value: unknown,
  compareValue: unknown,
): ConditionEvaluationResult {
  switch (operator) {
    case 'is':
      return deepEqual(value, compareValue)
        ? { satisfied: true }
        : { satisfied: false, reason: `${JSON.stringify(value)} !== ${JSON.stringify(compareValue)}` };

    case 'isNot':
      return !deepEqual(value, compareValue)
        ? { satisfied: true }
        : { satisfied: false, reason: `${JSON.stringify(value)} === ${JSON.stringify(compareValue)}` };

    case 'contains':
      return checkContains(value, compareValue)
        ? { satisfied: true }
        : { satisfied: false, reason: `${JSON.stringify(value)} does not contain ${JSON.stringify(compareValue)}` };

    case 'greaterThan':
      if (typeof value !== 'number' || typeof compareValue !== 'number') {
        return { satisfied: false, reason: 'greaterThan requires numeric values' };
      }
      return value > compareValue
        ? { satisfied: true }
        : { satisfied: false, reason: `${value} is not > ${compareValue}` };

    case 'lessThan':
      if (typeof value !== 'number' || typeof compareValue !== 'number') {
        return { satisfied: false, reason: 'lessThan requires numeric values' };
      }
      return value < compareValue
        ? { satisfied: true }
        : { satisfied: false, reason: `${value} is not < ${compareValue}` };

    case 'greaterOrEqual':
      if (typeof value !== 'number' || typeof compareValue !== 'number') {
        return { satisfied: false, reason: 'greaterOrEqual requires numeric values' };
      }
      return value >= compareValue
        ? { satisfied: true }
        : { satisfied: false, reason: `${value} is not >= ${compareValue}` };

    case 'lessOrEqual':
      if (typeof value !== 'number' || typeof compareValue !== 'number') {
        return { satisfied: false, reason: 'lessOrEqual requires numeric values' };
      }
      return value <= compareValue
        ? { satisfied: true }
        : { satisfied: false, reason: `${value} is not <= ${compareValue}` };

    case 'exists': {
      const shouldExist = compareValue === true;
      const doesExist = value !== null && value !== undefined;
      return shouldExist === doesExist
        ? { satisfied: true }
        : { satisfied: false, reason: shouldExist ? 'value does not exist' : 'value exists but should not' };
    }

    case 'matches':
      if (typeof value !== 'string' || typeof compareValue !== 'string') {
        return { satisfied: false, reason: 'matches requires string values' };
      }
      try {
        const regex = new RegExp(compareValue);
        return regex.test(value)
          ? { satisfied: true }
          : { satisfied: false, reason: `"${value}" does not match /${compareValue}/` };
      } catch {
        throw createRuntimeError(
          RuntimeErrorCode.CONDITION_EVALUATION_ERROR,
          `Invalid regex pattern "${compareValue}" in condition. ` +
            `Please fix the regex syntax in your blueprint.`,
        );
      }

    default:
      return { satisfied: false, reason: `Unknown operator: ${operator}` };
  }
}

/**
 * Deep equality check.
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

  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);

  if (keysA.length !== keysB.length) {
    return false;
  }

  return keysA.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}

/**
 * Check if value contains compareValue.
 */
function checkContains(value: unknown, compareValue: unknown): boolean {
  if (typeof value === 'string' && typeof compareValue === 'string') {
    return value.includes(compareValue);
  }

  if (Array.isArray(value)) {
    return value.some((item) => deepEqual(item, compareValue));
  }

  return false;
}

/**
 * Extracts the dimension label from a qualified symbol.
 */
function extractDimensionLabel(symbol: string): string {
  const parts = symbol.split(':');
  return parts.length > 0 ? parts[parts.length - 1] ?? symbol : symbol;
}

/**
 * Escapes special regex characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
