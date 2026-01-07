/**
 * Blueprint Validator
 *
 * Main orchestrator for validating blueprint trees.
 * Runs all validators and collects errors/warnings.
 */

import type { BlueprintTreeNode } from '../types.js';
import { SYSTEM_INPUTS } from '../types.js';
import {
  type ValidationIssue,
  type ValidationResult,
  type ValidatorOptions,
  ValidationErrorCode,
  buildValidationResult,
  createError,
  createWarning,
  VALID_INPUT_TYPES,
  VALID_ARTIFACT_TYPES,
  VALID_ITEM_TYPES,
} from './types.js';
import { parseDimensionSelector } from '../parsing/dimension-selectors.js';

/**
 * Well-known system input names that don't need to be declared
 */
const SYSTEM_INPUT_NAMES = new Set<string>(Object.values(SYSTEM_INPUTS));

/**
 * Validates a blueprint tree and returns all validation issues.
 *
 * @param tree - The root blueprint tree node to validate
 * @param options - Validation options
 * @returns ValidationResult with all errors and warnings
 */
export function validateBlueprintTree(
  tree: BlueprintTreeNode,
  options: ValidatorOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Run all hard error validators
  issues.push(...validateConnectionEndpoints(tree));
  issues.push(...validateProducerInputOutput(tree));
  issues.push(...validateLoopCountInputs(tree));
  issues.push(...validateArtifactCountInputs(tree));
  issues.push(...validateCollectors(tree));
  issues.push(...validateCollectorConnections(tree));
  issues.push(...validateConditionPaths(tree));
  issues.push(...validateTypes(tree));

  // Run soft warning validators (unless errorsOnly)
  if (!options.errorsOnly) {
    issues.push(...findUnusedInputs(tree));
    issues.push(...findUnusedArtifacts(tree));
    issues.push(...findUnreachableProducers(tree));
  }

  // Filter out skipped codes
  const filteredIssues = options.skipCodes
    ? issues.filter((issue) => !options.skipCodes!.includes(issue.code))
    : issues;

  return buildValidationResult(filteredIssues);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets all declared input names for a tree node, including system inputs
 */
function getDeclaredInputNames(tree: BlueprintTreeNode): Set<string> {
  const names = new Set<string>(tree.document.inputs.map((i) => i.name));
  // Add all system input names
  for (const name of SYSTEM_INPUT_NAMES) {
    names.add(name);
  }
  return names;
}

/**
 * Gets all declared artifact names for a tree node
 */
function getDeclaredArtifactNames(tree: BlueprintTreeNode): Set<string> {
  return new Set<string>(tree.document.artefacts.map((a) => a.name));
}

/**
 * Gets all producer import names for a tree node
 */
function getProducerImportNames(tree: BlueprintTreeNode): Set<string> {
  return new Set<string>(tree.document.producerImports.map((p) => p.name));
}

/**
 * Gets the names of inline producers (interface-only producer blueprints)
 */
function getInlineProducerNames(tree: BlueprintTreeNode): Set<string> {
  return new Set<string>(tree.document.producers.map((p) => p.name));
}

/**
 * Gets all loop names for a tree node
 */
function getLoopNames(tree: BlueprintTreeNode): Set<string> {
  return new Set<string>((tree.document.loops ?? []).map((l) => l.name));
}

/**
 * Parses a reference string into its components.
 * E.g., "DocProducer.VideoScript.Segments[segment].Script" ->
 * { segments: ["DocProducer", "VideoScript", "Segments[segment]", "Script"], first: "DocProducer", last: "Script" }
 */
function parseReference(reference: string): {
  segments: string[];
  first: string;
  last: string;
  baseName: string; // first segment without dimensions
} {
  const segments = reference.split('.');
  const first = segments[0] ?? '';
  const last = segments[segments.length - 1] ?? '';
  // Extract base name without dimension brackets
  const baseName = first.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1] ?? first;
  return { segments, first, last, baseName };
}

/**
 * Strips dimension brackets from a reference segment
 * E.g., "Segments[segment]" -> "Segments"
 */
function stripDimensions(segment: string): string {
  return segment.replace(/\[[^\]]*\]/g, '');
}

/**
 * Checks if a reference is a simple local reference (no dots)
 */
function isLocalReference(reference: string): boolean {
  return !reference.includes('.');
}

/**
 * Checks if a reference targets a producer (starts with a producer name)
 */
function targetsProducer(reference: string, producerNames: Set<string>): boolean {
  const { baseName } = parseReference(reference);
  return producerNames.has(baseName);
}

// ============================================================================
// Connection Endpoint Validation
// ============================================================================

/**
 * Validates all connection endpoints in a blueprint tree.
 *
 * Checks:
 * - Producer names exist in producerImports[]
 * - Input names exist in inputs[] or are system inputs
 * - Artifact names exist in artefacts[]
 */
export function validateConnectionEndpoints(tree: BlueprintTreeNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const inputNames = getDeclaredInputNames(node);
    const artifactNames = getDeclaredArtifactNames(node);
    const producerNames = getProducerImportNames(node);
    const inlineProducerNames = getInlineProducerNames(node);
    const loopNames = getLoopNames(node);

    for (const edge of node.document.edges) {
      // Validate 'from' reference
      issues.push(
        ...validateEndpoint(
          edge.from,
          'from',
          inputNames,
          artifactNames,
          producerNames,
          inlineProducerNames,
          loopNames,
          node,
          edge.to,
        ),
      );

      // Validate 'to' reference
      issues.push(
        ...validateEndpoint(
          edge.to,
          'to',
          inputNames,
          artifactNames,
          producerNames,
          inlineProducerNames,
          loopNames,
          node,
          edge.from,
        ),
      );
    }

    // Recursively validate children
    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}

/**
 * Validates a single endpoint reference
 */
function validateEndpoint(
  reference: string,
  direction: 'from' | 'to',
  inputNames: Set<string>,
  artifactNames: Set<string>,
  producerNames: Set<string>,
  inlineProducerNames: Set<string>,
  loopNames: Set<string>,
  tree: BlueprintTreeNode,
  otherEndpoint: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { segments, baseName } = parseReference(reference);
  const context = `connection ${direction === 'from' ? 'from' : 'to'} "${reference}" (${direction === 'from' ? `to ${otherEndpoint}` : `from ${otherEndpoint}`})`;

  if (isLocalReference(reference)) {
    // Local reference - check inputs, artifacts, or inline producers
    if (direction === 'from') {
      // 'from' can be an input, artifact, or inline producer (for interface-only blueprints)
      if (!inputNames.has(baseName) && !artifactNames.has(baseName) && !inlineProducerNames.has(baseName)) {
        issues.push(
          createError(
            ValidationErrorCode.INPUT_NOT_FOUND,
            `Input or artifact "${baseName}" not found`,
            {
              filePath: tree.sourcePath,
              namespacePath: tree.namespacePath,
              context,
            },
            `Check that "${baseName}" is declared in inputs[] or artifacts[], or is a system input (${Array.from(SYSTEM_INPUT_NAMES).join(', ')})`,
          ),
        );
      }
    } else {
      // 'to' can be an artifact, input (for fan-in), or inline producer (for interface-only blueprints)
      if (!artifactNames.has(baseName) && !inputNames.has(baseName) && !inlineProducerNames.has(baseName)) {
        issues.push(
          createError(
            ValidationErrorCode.ARTIFACT_NOT_FOUND,
            `Artifact or input "${baseName}" not found`,
            {
              filePath: tree.sourcePath,
              namespacePath: tree.namespacePath,
              context,
            },
            `Check that "${baseName}" is declared in artifacts[] or inputs[]`,
          ),
        );
      }
    }
  } else {
    // Cross-namespace reference - first segment should be a producer
    if (!producerNames.has(baseName)) {
      issues.push(
        createError(
          ValidationErrorCode.PRODUCER_NOT_FOUND,
          `Producer "${baseName}" not found`,
          {
            filePath: tree.sourcePath,
            namespacePath: tree.namespacePath,
            context,
          },
          `Check that "${baseName}" is listed in producers[] with a valid path or producer name`,
        ),
      );
    }

    // Validate dimension references in the path
    for (const segment of segments) {
      const dimMatches = segment.match(/\[([^\]]+)\]/g) ?? [];
      for (const match of dimMatches) {
        const dimContent = match.slice(1, -1).trim();
        try {
          const selector = parseDimensionSelector(dimContent);
          if (selector.kind === 'loop' && !loopNames.has(selector.symbol)) {
            issues.push(
              createError(
                ValidationErrorCode.INVALID_NESTED_PATH,
                `Unknown loop dimension "${selector.symbol}" in reference "${reference}"`,
                {
                  filePath: tree.sourcePath,
                  namespacePath: tree.namespacePath,
                  context,
                },
                `Declare "${selector.symbol}" in loops[] or fix the dimension name`,
              ),
            );
          }
        } catch {
          // parseDimensionSelector may throw on invalid syntax
          issues.push(
            createError(
              ValidationErrorCode.INVALID_NESTED_PATH,
              `Invalid dimension syntax "[${dimContent}]" in reference "${reference}"`,
              {
                filePath: tree.sourcePath,
                namespacePath: tree.namespacePath,
                context,
              },
              `Use valid dimension syntax like [segment], [0], or [segment+1]`,
            ),
          );
        }
      }
    }
  }

  return issues;
}

// ============================================================================
// Producer Input/Output Validation
// ============================================================================

/**
 * Validates that producer input/output references match the producer's actual inputs/outputs.
 *
 * For connections like:
 * - `to: SomeProducer.SomeInput` - SomeInput must be an input in SomeProducer's blueprint
 * - `from: SomeProducer.SomeOutput` - SomeOutput must be an artifact in SomeProducer's blueprint
 */
export function validateProducerInputOutput(tree: BlueprintTreeNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const producerNames = getProducerImportNames(node);

    for (const edge of node.document.edges) {
      // Validate 'from' - if it references a producer, check the output exists
      if (!isLocalReference(edge.from) && targetsProducer(edge.from, producerNames)) {
        const { baseName, segments } = parseReference(edge.from);
        const producerChild = node.children.get(baseName);

        if (producerChild && segments.length >= 2) {
          // Get the immediate output/artifact name (second segment, stripped of dimensions)
          const outputName = stripDimensions(segments[1]!);
          const producerArtifacts = getDeclaredArtifactNames(producerChild);

          // Check if this is an artifact of the producer
          if (!producerArtifacts.has(outputName)) {
            // Could be a nested path into an artifact (e.g., VideoScript.Segments[segment].Script)
            // We only report an error if the first level isn't an artifact
            issues.push(
              createError(
                ValidationErrorCode.PRODUCER_OUTPUT_MISMATCH,
                `Producer "${baseName}" does not have artifact "${outputName}"`,
                {
                  filePath: node.sourcePath,
                  namespacePath: node.namespacePath,
                  context: `connection from "${edge.from}" to "${edge.to}"`,
                },
                `Available artifacts in ${baseName}: ${Array.from(producerArtifacts).join(', ') || '(none)'}`,
              ),
            );
          }
        }
      }

      // Validate 'to' - if it references a producer, check the input exists
      if (!isLocalReference(edge.to) && targetsProducer(edge.to, producerNames)) {
        const { baseName, segments } = parseReference(edge.to);
        const producerChild = node.children.get(baseName);

        if (producerChild && segments.length >= 2) {
          // Get the immediate input name (second segment, stripped of dimensions)
          const inputName = stripDimensions(segments[1]!);
          const producerInputs = getDeclaredInputNames(producerChild);

          // Check if this is an input of the producer
          if (!producerInputs.has(inputName)) {
            issues.push(
              createError(
                ValidationErrorCode.PRODUCER_INPUT_MISMATCH,
                `Producer "${baseName}" does not have input "${inputName}"`,
                {
                  filePath: node.sourcePath,
                  namespacePath: node.namespacePath,
                  context: `connection from "${edge.from}" to "${edge.to}"`,
                },
                `Available inputs in ${baseName}: ${Array.from(producerInputs).filter((n) => !SYSTEM_INPUT_NAMES.has(n)).join(', ') || '(none)'}`,
              ),
            );
          }
        }
      }
    }

    // Recursively validate children
    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}

// ============================================================================
// Loop countInput Validation
// ============================================================================

/**
 * Validates that loop countInput references exist as inputs or system inputs.
 */
export function validateLoopCountInputs(tree: BlueprintTreeNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const inputNames = getDeclaredInputNames(node);

    for (const loop of node.document.loops ?? []) {
      if (!inputNames.has(loop.countInput)) {
        issues.push(
          createError(
            ValidationErrorCode.LOOP_COUNTINPUT_NOT_FOUND,
            `Loop "${loop.name}" references unknown countInput "${loop.countInput}"`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `loop "${loop.name}"`,
            },
            `Declare "${loop.countInput}" in inputs[] or use a system input (${Array.from(SYSTEM_INPUT_NAMES).join(', ')})`,
          ),
        );
      }
    }

    // Recursively validate children
    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}

// ============================================================================
// Artifact countInput Validation
// ============================================================================

/**
 * Validates that artifact countInput references exist as inputs or system inputs.
 */
export function validateArtifactCountInputs(tree: BlueprintTreeNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const inputNames = getDeclaredInputNames(node);

    for (const artifact of node.document.artefacts) {
      // Check countInput
      if (artifact.countInput && !inputNames.has(artifact.countInput)) {
        issues.push(
          createError(
            ValidationErrorCode.ARTIFACT_COUNTINPUT_NOT_FOUND,
            `Artifact "${artifact.name}" references unknown countInput "${artifact.countInput}"`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `artifact "${artifact.name}"`,
            },
            `Declare "${artifact.countInput}" in inputs[] or use a system input (${Array.from(SYSTEM_INPUT_NAMES).join(', ')})`,
          ),
        );
      }

      // Check arrays[].countInput for JSON artifacts
      if (artifact.arrays) {
        for (const arrayMapping of artifact.arrays) {
          if (!inputNames.has(arrayMapping.countInput)) {
            issues.push(
              createError(
                ValidationErrorCode.ARTIFACT_COUNTINPUT_NOT_FOUND,
                `Artifact "${artifact.name}" array path "${arrayMapping.path}" references unknown countInput "${arrayMapping.countInput}"`,
                {
                  filePath: node.sourcePath,
                  namespacePath: node.namespacePath,
                  context: `artifact "${artifact.name}" arrays[].countInput`,
                },
                `Declare "${arrayMapping.countInput}" in inputs[] or use a system input`,
              ),
            );
          }
        }
      }
    }

    // Recursively validate children
    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}

// ============================================================================
// Collector Validation
// ============================================================================

/**
 * Validates collector from/into references.
 */
export function validateCollectors(tree: BlueprintTreeNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const producerNames = getProducerImportNames(node);

    for (const collector of node.document.collectors ?? []) {
      // Validate 'from' - should reference a producer output
      if (!isLocalReference(collector.from)) {
        const { baseName } = parseReference(collector.from);
        if (!producerNames.has(baseName)) {
          issues.push(
            createError(
              ValidationErrorCode.COLLECTOR_SOURCE_INVALID,
              `Collector "${collector.name}" references unknown producer "${baseName}" in from: "${collector.from}"`,
              {
                filePath: node.sourcePath,
                namespacePath: node.namespacePath,
                context: `collector "${collector.name}"`,
              },
              `Check that "${baseName}" is listed in producers[]`,
            ),
          );
        }
      }

      // Validate 'into' - should reference a producer input
      if (!isLocalReference(collector.into)) {
        const { baseName } = parseReference(collector.into);
        if (!producerNames.has(baseName)) {
          issues.push(
            createError(
              ValidationErrorCode.COLLECTOR_TARGET_INVALID,
              `Collector "${collector.name}" references unknown producer "${baseName}" in into: "${collector.into}"`,
              {
                filePath: node.sourcePath,
                namespacePath: node.namespacePath,
                context: `collector "${collector.name}"`,
              },
              `Check that "${baseName}" is listed in producers[]`,
            ),
          );
        }
      }
    }

    // Recursively validate children
    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}

// ============================================================================
// Collector Connection Validation
// ============================================================================

/**
 * Validates that each collector has a corresponding connection.
 *
 * A common mistake is to define only a collector without a connection.
 * Fan-in inputs require BOTH:
 * 1. A connection from the source artifact to the fan-in input (creates data flow)
 * 2. A collector that defines how to group and order the items
 *
 * Without the connection, the fan-in input will be empty at runtime.
 */
export function validateCollectorConnections(tree: BlueprintTreeNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const collectors = node.document.collectors ?? [];
    const edges = node.document.edges;

    for (const collector of collectors) {
      // Normalize collector references (strip dimension brackets for comparison)
      const collectorFrom = normalizeReference(collector.from);
      const collectorInto = normalizeReference(collector.into);

      // Look for a matching connection
      // A connection matches if:
      // - connection.from matches collector.from (same source)
      // - connection.to matches collector.into (same target)
      const hasMatchingConnection = edges.some((edge) => {
        const edgeFrom = normalizeReference(edge.from);
        const edgeTo = normalizeReference(edge.to);
        return edgeFrom === collectorFrom && edgeTo === collectorInto;
      });

      if (!hasMatchingConnection) {
        issues.push(
          createError(
            ValidationErrorCode.COLLECTOR_MISSING_CONNECTION,
            `Collector "${collector.name}" has no corresponding connection. Fan-in inputs require both a connection AND a collector.`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `collector "${collector.name}" (from: ${collector.from}, into: ${collector.into})`,
            },
            `Add a connection: { from: "${collector.from}", to: "${collector.into}" }`,
          ),
        );
      }
    }

    // Recursively validate children
    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}

/**
 * Normalizes a reference by stripping dimension brackets for comparison.
 * This allows matching references with different dimension selectors.
 *
 * Examples:
 * - "ImageProducer[segment][image].GeneratedImage" -> "ImageProducer.GeneratedImage"
 * - "TimelineComposer.ImageSegments" -> "TimelineComposer.ImageSegments"
 */
function normalizeReference(reference: string): string {
  return reference.replace(/\[[^\]]*\]/g, '');
}

// ============================================================================
// Condition Path Validation
// ============================================================================

/**
 * Validates condition 'when' paths reference valid artifacts.
 */
export function validateConditionPaths(tree: BlueprintTreeNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const producerNames = getProducerImportNames(node);

    // Validate named conditions
    for (const [name, condition] of Object.entries(node.document.conditions ?? {})) {
      issues.push(...validateConditionDef(condition, name, producerNames, node));
    }

    // Validate inline conditions on edges
    for (const edge of node.document.edges) {
      if (edge.conditions) {
        issues.push(
          ...validateConditionDef(
            edge.conditions,
            `inline condition on edge ${edge.from} -> ${edge.to}`,
            producerNames,
            node,
          ),
        );
      }
    }

    // Recursively validate children
    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}

/**
 * Validates a condition definition
 */
function validateConditionDef(
  condition: unknown,
  name: string,
  producerNames: Set<string>,
  node: BlueprintTreeNode,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!condition || typeof condition !== 'object') {
    return issues;
  }

  const cond = condition as Record<string, unknown>;

  // Check 'when' path
  if (typeof cond.when === 'string') {
    const { baseName } = parseReference(cond.when);
    if (!isLocalReference(cond.when) && !producerNames.has(baseName)) {
      issues.push(
        createError(
          ValidationErrorCode.CONDITION_PATH_INVALID,
          `Condition "${name}" references unknown producer "${baseName}" in when: "${cond.when}"`,
          {
            filePath: node.sourcePath,
            namespacePath: node.namespacePath,
            context: `condition "${name}"`,
          },
          `Check that "${baseName}" is listed in producers[]`,
        ),
      );
    }
  }

  // Check 'all' group
  if (Array.isArray(cond.all)) {
    for (const clause of cond.all) {
      issues.push(...validateConditionDef(clause, name, producerNames, node));
    }
  }

  // Check 'any' group
  if (Array.isArray(cond.any)) {
    for (const clause of cond.any) {
      issues.push(...validateConditionDef(clause, name, producerNames, node));
    }
  }

  return issues;
}

// ============================================================================
// Type Validation
// ============================================================================

/**
 * Validates input and artifact types against known valid types.
 */
export function validateTypes(tree: BlueprintTreeNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    // Validate input types
    for (const input of node.document.inputs) {
      if (!VALID_INPUT_TYPES.has(input.type)) {
        issues.push(
          createError(
            ValidationErrorCode.INVALID_INPUT_TYPE,
            `Input "${input.name}" has unknown type "${input.type}"`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `input "${input.name}"`,
            },
            `Valid input types: ${Array.from(VALID_INPUT_TYPES).join(', ')}`,
          ),
        );
      }
    }

    // Validate artifact types
    for (const artifact of node.document.artefacts) {
      if (!VALID_ARTIFACT_TYPES.has(artifact.type)) {
        issues.push(
          createError(
            ValidationErrorCode.INVALID_ARTIFACT_TYPE,
            `Artifact "${artifact.name}" has unknown type "${artifact.type}"`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `artifact "${artifact.name}"`,
            },
            `Valid artifact types: ${Array.from(VALID_ARTIFACT_TYPES).join(', ')}`,
          ),
        );
      }

      // Validate itemType for arrays
      if (artifact.itemType && !VALID_ITEM_TYPES.has(artifact.itemType)) {
        issues.push(
          createError(
            ValidationErrorCode.INVALID_ITEM_TYPE,
            `Artifact "${artifact.name}" has unknown itemType "${artifact.itemType}"`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `artifact "${artifact.name}"`,
            },
            `Valid item types: ${Array.from(VALID_ITEM_TYPES).join(', ')}`,
          ),
        );
      }
    }

    // Recursively validate children
    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}

// ============================================================================
// Unused Element Warnings
// ============================================================================

/**
 * Finds inputs that are declared but never referenced.
 */
export function findUnusedInputs(tree: BlueprintTreeNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const usedInputs = new Set<string>();

    // Collect input references from edges
    for (const edge of node.document.edges) {
      if (isLocalReference(edge.from)) {
        const { baseName } = parseReference(edge.from);
        usedInputs.add(baseName);
      }
    }

    // Collect from loop countInputs
    for (const loop of node.document.loops ?? []) {
      usedInputs.add(loop.countInput);
    }

    // Collect from artifact countInputs
    for (const artifact of node.document.artefacts) {
      if (artifact.countInput) {
        usedInputs.add(artifact.countInput);
      }
      for (const arrayMapping of artifact.arrays ?? []) {
        usedInputs.add(arrayMapping.countInput);
      }
    }

    // Find unused inputs
    for (const input of node.document.inputs) {
      if (!usedInputs.has(input.name) && !SYSTEM_INPUT_NAMES.has(input.name)) {
        issues.push(
          createWarning(
            ValidationErrorCode.UNUSED_INPUT,
            `Input "${input.name}" is declared but never referenced`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `input "${input.name}"`,
            },
            `Remove the input declaration or add a connection using it`,
          ),
        );
      }
    }

    // Recursively validate children
    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}

/**
 * Finds artifacts that are declared but never connected to.
 */
export function findUnusedArtifacts(tree: BlueprintTreeNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const usedArtifacts = new Set<string>();

    // Collect artifact references from edges (as 'to' targets)
    for (const edge of node.document.edges) {
      if (isLocalReference(edge.to)) {
        const { baseName } = parseReference(edge.to);
        usedArtifacts.add(baseName);
      }
    }

    // Find unused artifacts
    for (const artifact of node.document.artefacts) {
      if (!usedArtifacts.has(artifact.name)) {
        issues.push(
          createWarning(
            ValidationErrorCode.UNUSED_ARTIFACT,
            `Artifact "${artifact.name}" is declared but nothing is connected to it`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `artifact "${artifact.name}"`,
            },
            `Remove the artifact declaration or add a connection to it`,
          ),
        );
      }
    }

    // Recursively validate children
    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}

/**
 * Finds producers that have no incoming connections.
 */
export function findUnreachableProducers(tree: BlueprintTreeNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const reachedProducers = new Set<string>();

    // Collect producers that receive data from edges
    for (const edge of node.document.edges) {
      if (!isLocalReference(edge.to)) {
        const { baseName } = parseReference(edge.to);
        reachedProducers.add(baseName);
      }
    }

    // Also check collectors
    for (const collector of node.document.collectors ?? []) {
      if (!isLocalReference(collector.into)) {
        const { baseName } = parseReference(collector.into);
        reachedProducers.add(baseName);
      }
    }

    // Find unreachable producers
    for (const producerImport of node.document.producerImports) {
      if (!reachedProducers.has(producerImport.name)) {
        issues.push(
          createWarning(
            ValidationErrorCode.UNREACHABLE_PRODUCER,
            `Producer "${producerImport.name}" has no incoming connections`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `producer "${producerImport.name}"`,
            },
            `Add connections to "${producerImport.name}" or remove it from producers[]`,
          ),
        );
      }
    }

    // Recursively validate children
    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}
