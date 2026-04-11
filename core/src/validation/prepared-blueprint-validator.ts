import { parseDimensionSelector } from '../parsing/dimension-selectors.js';
import {
  formatParsedGraphReferenceSegment,
  parseGraphReference,
} from '../resolution/reference-parser.js';
import type { BlueprintGraph } from '../resolution/canonical-graph.js';
import {
  prepareBlueprintResolutionContext,
  type BlueprintResolutionContext,
  type ResolutionSchemaSource,
} from '../resolution/blueprint-resolution-context.js';
import type { BlueprintTreeNode } from '../types.js';
import { validateBlueprintTree } from './blueprint-validator.js';
import {
  type ValidationIssue,
  type ValidationResult,
  type ValidatorOptions,
  ValidationErrorCode,
  buildValidationResult,
  createError,
} from './types.js';

export interface BlueprintValidationPreparationArgs {
  root: BlueprintTreeNode;
  schemaSource: ResolutionSchemaSource;
  options?: ValidatorOptions;
}

export interface PreparedBlueprintValidationResult {
  context?: BlueprintResolutionContext;
  validation: ValidationResult;
}

export async function validatePreparedBlueprintTree(
  args: BlueprintValidationPreparationArgs
): Promise<PreparedBlueprintValidationResult> {
  try {
    const context = await prepareBlueprintResolutionContext({
      root: args.root,
      schemaSource: args.schemaSource,
    });
    const baseValidation = validateBlueprintTree(args.root, {
      errorsOnly: args.options?.errorsOnly,
    });
    let issues = [
      ...baseValidation.issues,
      ...validatePreparedGraphReferences(context.root, context.graph),
    ];

    if (args.options?.skipCodes) {
      const skippedCodes = new Set(args.options.skipCodes);
      issues = issues.filter((issue) => !skippedCodes.has(issue.code));
    }

    return {
      context,
      validation: buildValidationResult(issues),
    };
  } catch (error) {
    return {
      validation: buildValidationResult([
        createError(
          ValidationErrorCode.BLUEPRINT_VALIDATION_FAILED,
          error instanceof Error ? error.message : String(error),
          {
            filePath: args.root.sourcePath,
            namespacePath: args.root.namespacePath,
            context: 'prepared blueprint validation',
          }
        ),
      ]),
    };
  }
}

function validatePreparedGraphReferences(
  root: BlueprintTreeNode,
  graph: BlueprintGraph
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const validNodeIds = new Set(graph.nodes.map((node) => node.id));
  let graphEdgeIndex = 0;

  function validateTree(node: BlueprintTreeNode): void {
    const producerNames = new Set(
      node.document.producerImports.map((producer) => producer.name)
    );

    for (const [conditionName, condition] of Object.entries(
      node.document.conditions ?? {}
    )) {
      issues.push(
        ...validatePreparedConditionDefinition(
          condition,
          conditionName,
          producerNames,
          node,
          validNodeIds
        )
      );
    }

    for (const edge of node.document.edges) {
      const graphEdge = graph.edges[graphEdgeIndex];
      graphEdgeIndex += 1;

      if (!graphEdge) {
        throw new Error(
          `Prepared graph edge resolution is out of sync for "${edge.from}" -> "${edge.to}".`
        );
      }

      if (
        shouldValidatePreparedProducerOutputReference(edge.from, producerNames) &&
        !validNodeIds.has(graphEdge.from.nodeId)
      ) {
        issues.push(
          createError(
            ValidationErrorCode.INVALID_NESTED_PATH,
            `Connection source "${edge.from}" does not resolve to a prepared graph artifact.`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `connection from "${edge.from}" to "${edge.to}"`,
            },
            'Check the schema-derived field path and the producer output schema.'
          )
        );
      }

      if (edge.conditions) {
        issues.push(
          ...validatePreparedConditionDefinition(
            edge.conditions,
            `inline condition on edge ${edge.from} -> ${edge.to}`,
            producerNames,
            node,
            validNodeIds
          )
        );
      }
    }

    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(root);
  return issues;
}

function validatePreparedConditionDefinition(
  condition: unknown,
  name: string,
  producerNames: Set<string>,
  node: BlueprintTreeNode,
  validNodeIds: Set<string>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!condition || typeof condition !== 'object') {
    return issues;
  }

  const conditionRecord = condition as Record<string, unknown>;
  if (typeof conditionRecord.when === 'string') {
    const normalizedWhen = normalizeConditionReference(conditionRecord.when);
    if (
      normalizedWhen &&
      !isLocalReference(normalizedWhen) &&
      targetsProducer(normalizedWhen, producerNames) &&
      !referenceResolvesToPreparedNode(normalizedWhen, validNodeIds)
    ) {
      issues.push(
        createError(
          ValidationErrorCode.CONDITION_PATH_INVALID,
          `Condition "${name}" references "${conditionRecord.when}" which does not resolve to a prepared graph artifact.`,
          {
            filePath: node.sourcePath,
            namespacePath: node.namespacePath,
            context: `condition "${name}"`,
          },
          'Check the condition path against the schema-derived artifact fields.'
        )
      );
    }
  }

  if (Array.isArray(conditionRecord.all)) {
    for (const clause of conditionRecord.all) {
      issues.push(
        ...validatePreparedConditionDefinition(
          clause,
          name,
          producerNames,
          node,
          validNodeIds
        )
      );
    }
  }

  if (Array.isArray(conditionRecord.any)) {
    for (const clause of conditionRecord.any) {
      issues.push(
        ...validatePreparedConditionDefinition(
          clause,
          name,
          producerNames,
          node,
          validNodeIds
        )
      );
    }
  }

  return issues;
}

function shouldValidatePreparedProducerOutputReference(
  reference: string,
  producerNames: Set<string>
): boolean {
  if (isLocalReference(reference) || !targetsProducer(reference, producerNames)) {
    return false;
  }

  const { segments } = parseReference(reference);
  const artifactSegment = segments[1];
  if (!artifactSegment) {
    return false;
  }

  return segments.length > 2 || artifactSegment.includes('[');
}

function referenceResolvesToPreparedNode(
  reference: string,
  validNodeIds: Set<string>
): boolean {
  if (validNodeIds.has(reference)) {
    return true;
  }

  const normalizedReference = stripLoopDimensionsFromFinalSegment(reference);
  return (
    normalizedReference !== reference && validNodeIds.has(normalizedReference)
  );
}

function stripLoopDimensionsFromFinalSegment(reference: string): string {
  const parsed = parseGraphReference(reference);
  const normalizedNode = {
    ...parsed.node,
    dimensions: parsed.node.dimensions.filter(
      (dimension) => parseDimensionSelector(dimension).kind === 'const'
    ),
  };

  return [...parsed.namespaceSegments, normalizedNode]
    .map((segment) => formatParsedGraphReferenceSegment(segment))
    .join('.');
}

function normalizeConditionReference(reference: string): string | null {
  if (reference.startsWith('Input:')) {
    return null;
  }
  if (reference.startsWith('Artifact:')) {
    return reference.slice('Artifact:'.length);
  }
  return reference;
}

function parseReference(reference: string): {
  segments: string[];
  baseName: string;
} {
  const segments = reference.split('.');
  const firstSegment = segments[0] ?? '';
  const baseName =
    firstSegment.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1] ?? firstSegment;
  return { segments, baseName };
}

function isLocalReference(reference: string): boolean {
  return !reference.includes('.');
}

function targetsProducer(
  reference: string,
  producerNames: Set<string>
): boolean {
  return producerNames.has(parseReference(reference).baseName);
}
