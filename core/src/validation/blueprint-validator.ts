/**
 * Blueprint Validator
 *
 * Main orchestrator for validating blueprint trees.
 * Runs all validators and collects errors/warnings.
 */

import type {
  BlueprintEdgeDefinition,
  BlueprintTreeNode,
  EdgeConditionClause,
  EdgeConditionDefinition,
  EdgeConditionGroup,
} from '../types.js';
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
  options: ValidatorOptions = {}
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Run all hard error validators
  issues.push(...validateConnectionEndpoints(tree));
  issues.push(...validateProducerInputOutput(tree));
  issues.push(...validateMediaProducerDurationContract(tree));
  issues.push(...validateSegmentDurationContract(tree));
  issues.push(...validateInputCountInputs(tree));
  issues.push(...validateLoopCountInputs(tree));
  issues.push(...validateArtifactCountInputs(tree));
  issues.push(...validateConditionPaths(tree));
  issues.push(...validatePublishedOutputsAreTerminal(tree));
  issues.push(...validateSemanticRules(tree));
  issues.push(...validateTypes(tree));
  issues.push(...validateProducerCycles(tree));
  issues.push(...validateDimensionConsistency(tree));

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
  return new Set<string>(tree.document.outputs.map((a) => a.name));
}

/**
 * Gets all imported blueprint alias names for a tree node.
 */
function getProducerImportNames(tree: BlueprintTreeNode): Set<string> {
  return new Set<string>(tree.document.imports.map((p) => p.name));
}

/**
 * Gets producer names declared directly on this blueprint node.
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

function getDeclaredInput(
  tree: BlueprintTreeNode,
  inputName: string
) {
  return tree.document.inputs.find((input) => input.name === inputName);
}

function extractSimpleReferenceName(reference: string): string | undefined {
  if (!isLocalReference(reference)) {
    return undefined;
  }
  return stripDimensions(reference);
}

function isOrchestrationBlueprint(node: BlueprintTreeNode): boolean {
  return node.document.imports.length > 0 || node.children.size > 0;
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
function targetsProducer(
  reference: string,
  producerNames: Set<string>
): boolean {
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
 * - Imported blueprint aliases exist in imports[]
 * - Input names exist in inputs[] or are system inputs
 * - Output names exist in outputs[]
 */
export function validateConnectionEndpoints(
  tree: BlueprintTreeNode
): ValidationIssue[] {
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
          edge.to
        )
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
          edge.from
        )
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
  otherEndpoint: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { segments, baseName } = parseReference(reference);
  const context = `connection ${direction === 'from' ? 'from' : 'to'} "${reference}" (${direction === 'from' ? `to ${otherEndpoint}` : `from ${otherEndpoint}`})`;

  if (isLocalReference(reference)) {
    // Local reference - check inputs, artifacts, or local producer names.
    if (direction === 'from') {
      // 'from' can be an input, artifact, or local producer name.
      if (
        !inputNames.has(baseName) &&
        !artifactNames.has(baseName) &&
        !inlineProducerNames.has(baseName)
      ) {
        issues.push(
          createError(
            ValidationErrorCode.INPUT_NOT_FOUND,
            `Input or artifact "${baseName}" not found`,
            {
              filePath: tree.sourcePath,
              namespacePath: tree.namespacePath,
              context,
            },
            `Check that "${baseName}" is declared in inputs[] or outputs[], or is a system input (${Array.from(SYSTEM_INPUT_NAMES).join(', ')})`
          )
        );
      }
    } else {
      // 'to' can be an artifact, input (for fan-in), or local producer name.
      if (
        !artifactNames.has(baseName) &&
        !inputNames.has(baseName) &&
        !inlineProducerNames.has(baseName)
      ) {
        issues.push(
          createError(
            ValidationErrorCode.ARTIFACT_NOT_FOUND,
            `Artifact or input "${baseName}" not found`,
            {
              filePath: tree.sourcePath,
              namespacePath: tree.namespacePath,
              context,
            },
            `Check that "${baseName}" is declared in outputs[] or inputs[]`
          )
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
          `Check that "${baseName}" is listed in imports[] with a valid path or producer reference`
        )
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
                `Declare "${selector.symbol}" in loops[] or fix the dimension name`
              )
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
              `Use valid dimension syntax like [segment], [0], or [segment+1]`
            )
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
 * - `from: SomeProducer.SomeOutput` - SomeOutput must be an output in SomeProducer's blueprint
 */
export function validateProducerInputOutput(
  tree: BlueprintTreeNode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const producerNames = getProducerImportNames(node);

    for (const edge of node.document.edges) {
      // Validate 'from' - if it references a producer, check the output exists
      if (
        !isLocalReference(edge.from) &&
        targetsProducer(edge.from, producerNames)
      ) {
        const { baseName, segments } = parseReference(edge.from);
        const producerChild = node.children.get(baseName);

        if (producerChild && segments.length >= 2) {
          // Get the immediate output/artifact name (second segment, stripped of dimensions)
          const outputName = stripDimensions(segments[1]!);
          const producerOutputs = getDeclaredArtifactNames(producerChild);

          // Check if this is an output of the imported blueprint
          if (!producerOutputs.has(outputName)) {
            issues.push(
              createError(
                ValidationErrorCode.PRODUCER_OUTPUT_MISMATCH,
                `Imported blueprint "${baseName}" does not expose output "${outputName}" in its public contract.`,
                {
                  filePath: node.sourcePath,
                  namespacePath: node.namespacePath,
                  context: `connection from "${edge.from}" to "${edge.to}"`,
                },
                `Connect only to top-level outputs exposed by "${baseName}". Available outputs: ${Array.from(producerOutputs).join(', ') || '(none)'}`
              )
            );
          }
        }
      }

      // Validate 'to' - if it references a producer, check the input exists
      if (
        !isLocalReference(edge.to) &&
        targetsProducer(edge.to, producerNames)
      ) {
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
                `Imported blueprint "${baseName}" does not expose input "${inputName}" in its public contract.`,
                {
                  filePath: node.sourcePath,
                  namespacePath: node.namespacePath,
                  context: `connection from "${edge.from}" to "${edge.to}"`,
                },
                `Connect only to top-level inputs exposed by "${baseName}". Available inputs: ${
                  Array.from(producerInputs)
                    .filter((n) => !SYSTEM_INPUT_NAMES.has(n))
                    .join(', ') || '(none)'
                }`
              )
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

/**
 * Validates the explicit Duration contract for audio/video producers.
 *
 * Media producers must:
 * - declare a required `Duration` input in their own interface
 * - receive an explicit incoming edge to `ProducerAlias.Duration`
 */
export function validateMediaProducerDurationContract(
  tree: BlueprintTreeNode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateMediaProducerNode(
    node: BlueprintTreeNode,
    producerName: string,
    producerSourcePath: string,
    producerNamespacePath: string[]
  ): void {
    const durationInput = node.document.inputs.find(
      (input) => input.name === 'Duration'
    );
    if (!durationInput || durationInput.required !== true) {
      issues.push(
        createError(
          ValidationErrorCode.MEDIA_PRODUCER_MISSING_DURATION_INPUT,
          `Media producer "${producerName}" must declare a required "Duration" input.`,
          {
            filePath: producerSourcePath,
            namespacePath: producerNamespacePath,
            context: `producer "${producerName}"`,
          },
          'Add `Duration` to the producer inputs and mark it as required.'
        )
      );
    }
  }

  function validateTree(node: BlueprintTreeNode): void {
    if (isLeafMediaProducerBlueprint(node)) {
      const producerName =
        node.namespacePath[node.namespacePath.length - 1] ?? node.document.meta.id;
      validateMediaProducerNode(
        node,
        producerName,
        node.sourcePath,
        node.namespacePath
      );
    }

    const producerNames = getProducerImportNames(node);

    for (const producerName of producerNames) {
      const producerChild = node.children.get(producerName);
      if (!producerChild || !isMediaProducerBlueprint(producerChild)) {
        continue;
      }

      validateMediaProducerNode(
        producerChild,
        producerName,
        producerChild.sourcePath,
        producerChild.namespacePath
      );

      const hasDurationBinding = node.document.edges.some((edge) =>
        referencesProducerInput(edge.to, producerName, 'Duration')
      );
      if (!hasDurationBinding) {
        issues.push(
          createError(
            ValidationErrorCode.MEDIA_PRODUCER_MISSING_DURATION_BINDING,
            `Media producer "${producerName}" must have an explicit incoming binding to "${producerName}.Duration".`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `producer "${producerName}"`,
            },
            `Add a blueprint edge that targets "${producerName}.Duration".`
          )
        );
      }
    }

    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}

/**
 * Validates SegmentDuration usage for orchestration blueprints.
 *
 * SegmentDuration is a derived system property:
 * - orchestration blueprints must not declare it as a user-facing input
 * - if they use it in graph wiring, they must explicitly declare required
 *   Duration and NumOfSegments inputs so SegmentDuration can be derived
 */
export function validateSegmentDurationContract(
  tree: BlueprintTreeNode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    if (isOrchestrationBlueprint(node)) {
      const declaredSegmentDuration = getDeclaredInput(
        node,
        SYSTEM_INPUTS.SEGMENT_DURATION
      );
      if (declaredSegmentDuration) {
        issues.push(
          createError(
            ValidationErrorCode.SEGMENT_DURATION_INPUT_DECLARED,
            'Orchestration blueprints must not declare "SegmentDuration" in inputs[]. It is a derived system value.',
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: 'input "SegmentDuration"',
            },
            'Remove `SegmentDuration` from inputs[] and derive it from required `Duration` and `NumOfSegments`.'
          )
        );
      }

      const usesSegmentDuration =
        node.document.edges.some(
          (edge) =>
            extractSimpleReferenceName(edge.from) ===
            SYSTEM_INPUTS.SEGMENT_DURATION
        ) ||
        node.document.loops?.some(
          (loop) => loop.countInput === SYSTEM_INPUTS.SEGMENT_DURATION
        ) ||
        node.document.inputs.some(
          (input) => input.countInput === SYSTEM_INPUTS.SEGMENT_DURATION
        ) ||
        node.document.outputs.some(
          (artifact) =>
            artifact.countInput === SYSTEM_INPUTS.SEGMENT_DURATION ||
            artifact.arrays?.some(
              (arrayMapping) =>
                arrayMapping.countInput === SYSTEM_INPUTS.SEGMENT_DURATION
            ) === true
        );

      if (usesSegmentDuration) {
        const durationInput = getDeclaredInput(node, SYSTEM_INPUTS.DURATION);
        if (!durationInput || durationInput.required !== true) {
          issues.push(
            createError(
              ValidationErrorCode.SEGMENT_DURATION_REQUIRES_DURATION_INPUT,
              'Blueprints that use "SegmentDuration" must declare a required "Duration" input.',
              {
                filePath: node.sourcePath,
                namespacePath: node.namespacePath,
                context: 'derived input "SegmentDuration"',
              },
              'Add `Duration` to inputs[] and mark it as required.'
            )
          );
        }

        const numOfSegmentsInput = getDeclaredInput(
          node,
          SYSTEM_INPUTS.NUM_OF_SEGMENTS
        );
        if (!numOfSegmentsInput || numOfSegmentsInput.required !== true) {
          issues.push(
            createError(
              ValidationErrorCode.SEGMENT_DURATION_REQUIRES_NUM_SEGMENTS_INPUT,
              'Blueprints that use "SegmentDuration" must declare a required "NumOfSegments" input.',
              {
                filePath: node.sourcePath,
                namespacePath: node.namespacePath,
                context: 'derived input "SegmentDuration"',
              },
              'Add `NumOfSegments` to inputs[] and mark it as required.'
            )
          );
        }
      }
    }

    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}

function isMediaProducerBlueprint(node: BlueprintTreeNode): boolean {
  return node.document.outputs.some((artifact) =>
    isMediaArtifactType(artifact.type, artifact.itemType)
  );
}

function isLeafMediaProducerBlueprint(node: BlueprintTreeNode): boolean {
  return isMediaProducerBlueprint(node) && !isOrchestrationBlueprint(node);
}

function isMediaArtifactType(type: string, itemType?: string): boolean {
  return (
    type === 'video' ||
    type === 'audio' ||
    ((type === 'array' || type === 'multiDimArray') &&
      (itemType === 'video' || itemType === 'audio'))
  );
}

function referencesProducerInput(
  reference: string,
  producerName: string,
  inputName: string
): boolean {
  if (isLocalReference(reference)) {
    return false;
  }

  const { baseName, segments } = parseReference(reference);
  return (
    baseName === producerName &&
    segments.length >= 2 &&
    stripDimensions(segments[1] ?? '') === inputName
  );
}

// ============================================================================
// Input countInput Validation
// ============================================================================

/**
 * Validates that input countInput references exist as inputs or system inputs.
 */
export function validateInputCountInputs(
  tree: BlueprintTreeNode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const inputNames = getDeclaredInputNames(node);

    for (const input of node.document.inputs) {
      if (!input.countInput) {
        continue;
      }
      if (!inputNames.has(input.countInput)) {
        issues.push(
          createError(
            ValidationErrorCode.INPUT_COUNTINPUT_NOT_FOUND,
            `Input "${input.name}" references unknown countInput "${input.countInput}"`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `input "${input.name}"`,
            },
            `Declare "${input.countInput}" in inputs[] or use a system input (${Array.from(SYSTEM_INPUT_NAMES).join(', ')})`
          )
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
// Loop countInput Validation
// ============================================================================

/**
 * Validates that loop countInput references exist as inputs or system inputs.
 */
export function validateLoopCountInputs(
  tree: BlueprintTreeNode
): ValidationIssue[] {
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
            `Declare "${loop.countInput}" in inputs[] or use a system input (${Array.from(SYSTEM_INPUT_NAMES).join(', ')})`
          )
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
export function validateArtifactCountInputs(
  tree: BlueprintTreeNode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const inputNames = getDeclaredInputNames(node);

    for (const artifact of node.document.outputs) {
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
            `Declare "${artifact.countInput}" in inputs[] or use a system input (${Array.from(SYSTEM_INPUT_NAMES).join(', ')})`
          )
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
                `Declare "${arrayMapping.countInput}" in inputs[] or use a system input`
              )
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
// Condition Path Validation
// ============================================================================

/**
 * Validates condition `when` paths reference valid imported blueprint outputs or canonical inputs.
 */
export function validateConditionPaths(
  tree: BlueprintTreeNode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const producerNames = getProducerImportNames(node);

    // Validate named conditions
    for (const [name, condition] of Object.entries(
      node.document.conditions ?? {}
    )) {
      issues.push(
        ...validateConditionDef(condition, name, producerNames, node)
      );
    }

    // Validate inline conditions on edges
    for (const edge of node.document.edges) {
      if (edge.conditions) {
        issues.push(
          ...validateConditionDef(
            edge.conditions,
            `inline condition on edge ${edge.from} -> ${edge.to}`,
            producerNames,
            node
          )
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
  node: BlueprintTreeNode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!condition || typeof condition !== 'object') {
    return issues;
  }

  const cond = condition as Record<string, unknown>;

  // Check 'when' path
  if (typeof cond.when === 'string') {
    const when = cond.when.trim();

    // Input conditions do not reference producer artifact paths.
    if (when.startsWith('Input:')) {
      // no-op
    } else {
      const normalizedWhen = when.startsWith('Artifact:')
        ? when.slice('Artifact:'.length)
        : when;
      const { baseName } = parseReference(normalizedWhen);
      if (!isLocalReference(normalizedWhen) && !producerNames.has(baseName)) {
        issues.push(
          createError(
            ValidationErrorCode.CONDITION_PATH_INVALID,
            `Condition "${name}" references unknown producer "${baseName}" in when: "${cond.when}"`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `condition "${name}"`,
            },
            `Check that "${baseName}" is listed in imports[]`
          )
        );
      }
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

export function validatePublishedOutputsAreTerminal(
  tree: BlueprintTreeNode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const outputNames = getDeclaredArtifactNames(node);
    const producerNames = getProducerImportNames(node);

    for (const edge of node.document.edges) {
      if (!isLocalReference(edge.from) || isLocalReference(edge.to)) {
        continue;
      }
      const sourceName = extractSimpleReferenceName(edge.from);
      if (!sourceName || !outputNames.has(sourceName)) {
        continue;
      }
      if (!targetsProducer(edge.to, producerNames)) {
        continue;
      }

      issues.push(
        createError(
          ValidationErrorCode.PUBLISHED_OUTPUT_USED_AS_INTERNAL_SOURCE,
          `Published output "${edge.from}" cannot be used as an internal source for producer input "${edge.to}".`,
          {
            filePath: node.sourcePath,
            namespacePath: node.namespacePath,
            context: `connection from "${edge.from}" to "${edge.to}"`,
          },
          'Connect the downstream producer directly to the producer output that feeds this published output. Top-level outputs are publication endpoints, not internal routing nodes.'
        )
      );
    }

    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
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
            `Valid input types: ${Array.from(VALID_INPUT_TYPES).join(', ')}`
          )
        );
      }
    }

    // Validate artifact types
    for (const artifact of node.document.outputs) {
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
            `Valid artifact types: ${Array.from(VALID_ARTIFACT_TYPES).join(', ')}`
          )
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
            `Valid item types: ${Array.from(VALID_ITEM_TYPES).join(', ')}`
          )
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
// Cycle Detection
// ============================================================================

/**
 * Validates that the producer dependency graph has no cycles.
 *
 * A cycle occurs when producers form a circular dependency chain,
 * e.g., A -> B -> C -> A. This makes execution impossible.
 */
export function validateProducerCycles(
  tree: BlueprintTreeNode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const producerNames = getProducerImportNames(node);
    const inlineProducerNames = getInlineProducerNames(node);
    const allProducerNames = new Set([
      ...producerNames,
      ...inlineProducerNames,
    ]);

    // Build adjacency list from edges (producer -> producer connections)
    const adjacency = new Map<string, Set<string>>();
    for (const name of allProducerNames) {
      adjacency.set(name, new Set());
    }

    for (const edge of node.document.edges) {
      const fromProducer = extractProducerFromReference(
        edge.from,
        allProducerNames
      );
      const toProducer = extractProducerFromReference(
        edge.to,
        allProducerNames
      );

      if (fromProducer && toProducer && fromProducer !== toProducer) {
        adjacency.get(fromProducer)?.add(toProducer);
      }
    }

    // DFS cycle detection with path tracking
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    function findCycle(current: string, path: string[]): string[] | null {
      visited.add(current);
      recursionStack.add(current);
      path.push(current);

      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          const cycle = findCycle(neighbor, path);
          if (cycle) {
            return cycle;
          }
        } else if (recursionStack.has(neighbor)) {
          // Found a cycle - extract just the cycle portion
          const cycleStart = path.indexOf(neighbor);
          return [...path.slice(cycleStart), neighbor];
        }
      }

      recursionStack.delete(current);
      path.pop();
      return null;
    }

    for (const producer of allProducerNames) {
      if (!visited.has(producer)) {
        const cycle = findCycle(producer, []);
        if (cycle) {
          issues.push(
            createError(
              ValidationErrorCode.PRODUCER_CYCLE,
              `Producer graph contains a cycle: ${cycle.join(' -> ')}`,
              {
                filePath: node.sourcePath,
                namespacePath: node.namespacePath,
                context: 'producer dependencies',
              },
              'Remove one of the connections to break the cycle'
            )
          );
          break; // Report first cycle found
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

/**
 * Extracts the producer name from a reference if it targets a producer.
 */
function extractProducerFromReference(
  reference: string,
  producerNames: Set<string>
): string | null {
  const { baseName } = parseReference(reference);
  return producerNames.has(baseName) ? baseName : null;
}

// ============================================================================
// Dimension Consistency Validation
// ============================================================================

/**
 * Validates that connection dimensions are consistent.
 *
 * Checks for:
 * - Dimension loss: source has dimensions that target doesn't have
 * - Dimension mismatch: source and target use different loop variables
 */
export function validateDimensionConsistency(
  tree: BlueprintTreeNode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    const producerNames = getProducerImportNames(node);
    const inlineProducerNames = getInlineProducerNames(node);
    const allProducerNames = new Set([
      ...producerNames,
      ...inlineProducerNames,
    ]);

    for (const edge of node.document.edges) {
      const fromDims = extractLoopDimensions(edge.from);
      const toDims = extractLoopDimensions(edge.to);

      // Check if source references a producer (has output with dimensions)
      const fromIsProducer =
        !isLocalReference(edge.from) &&
        extractProducerFromReference(edge.from, allProducerNames) !== null;
      const toIsProducer =
        !isLocalReference(edge.to) &&
        extractProducerFromReference(edge.to, allProducerNames) !== null;
      const targetIsFanIn = targetsFanInInput(edge.to, node, allProducerNames);

      if ((edge.groupBy || edge.orderBy) && !targetIsFanIn) {
        issues.push(
          createError(
            ValidationErrorCode.DIMENSION_MISMATCH,
            `Connection "${edge.from}" -> "${edge.to}" declares groupBy/orderBy, but the target is not a fanIn input.`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `connection from "${edge.from}" to "${edge.to}"`,
            },
            'Use groupBy/orderBy only on connections targeting inputs declared with fanIn: true'
          )
        );
      }

      // Only check producer-to-producer connections for dimension loss
      // (more dimensions on source than target)
      // Cross-dimension patterns (e.g., [image] -> [segment]) are intentionally allowed
      // as they're used for sliding window and other valid patterns.
      if (
        fromIsProducer &&
        toIsProducer &&
        !targetIsFanIn &&
        fromDims.length > toDims.length
      ) {
        issues.push(
          createError(
            ValidationErrorCode.DIMENSION_MISMATCH,
            `Dimension mismatch: "${edge.from}" has ${fromDims.length} dimension(s) [${fromDims.join(', ')}] but target "${edge.to}" has ${toDims.length}`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `connection from "${edge.from}" to "${edge.to}"`,
            },
            toDims.length === 0
              ? 'Target input must either declare fanIn: true or use matching dimensions'
              : 'Ensure source and target have consistent dimensions'
          )
        );
      }

      if (targetIsFanIn && !edge.groupBy && fromDims.length > 2) {
        issues.push(
          createError(
            ValidationErrorCode.DIMENSION_MISMATCH,
            `Connection "${edge.from}" -> "${edge.to}" uses ${fromDims.length} dimensions. Fan-in inference supports up to two dimensions without explicit metadata.`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `connection from "${edge.from}" to "${edge.to}"`,
            },
            'Provide groupBy/orderBy on the connection for higher-dimensional fan-in.'
          )
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
 * Extracts loop dimension names from a reference.
 * Only includes symbolic loop references, not numeric indices or offset expressions.
 */
function extractLoopDimensions(reference: string): string[] {
  const dims: string[] = [];
  const matches = reference.matchAll(/\[([^\]]+)\]/g);
  for (const match of matches) {
    const content = match[1]!.trim();
    // Only include simple loop references (no numbers, no +/- operators)
    if (!/^\d+$/.test(content) && !/[+-]/.test(content)) {
      dims.push(content);
    }
  }
  return dims;
}

function targetsFanInInput(
  reference: string,
  node: BlueprintTreeNode,
  producerNames: Set<string>
): boolean {
  if (
    isLocalReference(reference) ||
    !targetsProducer(reference, producerNames)
  ) {
    return false;
  }
  const { baseName, segments } = parseReference(reference);
  if (segments.length < 2) {
    return false;
  }
  const inputName = stripDimensions(segments[1]!);
  const producerChild = node.children.get(baseName);
  if (!producerChild) {
    return false;
  }
  return producerChild.document.inputs.some(
    (input) => input.name === inputName && input.fanIn === true
  );
}

// ============================================================================
// Explicit Condition Comparison Helpers
// ============================================================================

type SimpleConditionAtom = string;
type SimpleConditionConjunction = Set<SimpleConditionAtom>;
type SimpleConditionDnf = SimpleConditionConjunction[];

const TRUE_CONDITION_DNF: SimpleConditionDnf = [new Set()];

export function validateSemanticRules(
  tree: BlueprintTreeNode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    for (const rule of node.document.validation?.semanticRules ?? []) {
      const namedCondition = node.document.conditions?.[rule.condition];
      if (!namedCondition) {
        issues.push(
          createError(
            ValidationErrorCode.SEMANTIC_VALIDATION_RULE_FAILED,
            `Semantic validation rule "${rule.name}" references unknown condition "${rule.condition}".`,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `semantic validation rule "${rule.name}"`,
            },
            `Define condition "${rule.condition}" under conditions: or update the semantic rule.`
          )
        );
        continue;
      }

      const requiredCondition = conditionItemToDnf(namedCondition);
      for (const requiredConnection of rule.requireGuardedConnections ?? []) {
        const matchingEdges = node.document.edges.filter((edge) =>
          guardedConnectionMatches(edge, requiredConnection)
        );

        if (matchingEdges.length === 0) {
          issues.push(
            createError(
              ValidationErrorCode.SEMANTIC_VALIDATION_RULE_FAILED,
              `Semantic validation rule "${rule.name}" expected a matching connection, but none was found.`,
              {
                filePath: node.sourcePath,
                namespacePath: node.namespacePath,
                context: `semantic validation rule "${rule.name}"`,
              },
              `Add the required connection or remove it from validation.semanticRules[].requireGuardedConnections.`
            )
          );
          continue;
        }

        for (const edge of matchingEdges) {
          const edgeCondition = resolveEdgeConditionDnf(node, edge);
          if (conditionImplies(edgeCondition, requiredCondition)) {
            continue;
          }

          issues.push(
            createError(
              ValidationErrorCode.SEMANTIC_VALIDATION_RULE_FAILED,
              `Connection "${edge.from}" -> "${edge.to}" does not satisfy semantic validation rule "${rule.name}".`,
              {
                filePath: node.sourcePath,
                namespacePath: node.namespacePath,
                context: `connection from "${edge.from}" to "${edge.to}"`,
              },
              `Guard this connection with condition "${rule.condition}" or a stricter condition that implies it.`
            )
          );
        }
      }
    }

    for (const child of node.children.values()) {
      validateTree(child);
    }
  }

  validateTree(tree);
  return issues;
}

function guardedConnectionMatches(
  edge: BlueprintEdgeDefinition,
  requiredConnection: { from?: string; to?: string }
): boolean {
  if (requiredConnection.from !== undefined && edge.from !== requiredConnection.from) {
    return false;
  }
  if (requiredConnection.to !== undefined && edge.to !== requiredConnection.to) {
    return false;
  }
  return true;
}

function resolveEdgeConditionDnf(
  node: BlueprintTreeNode,
  edge: BlueprintEdgeDefinition
): SimpleConditionDnf {
  if (edge.conditions) {
    return conditionDefinitionToDnf(edge.conditions);
  }
  if (edge.if) {
    const namedCondition = node.document.conditions?.[edge.if];
    if (!namedCondition) {
      return TRUE_CONDITION_DNF;
    }
    return conditionItemToDnf(namedCondition);
  }
  return TRUE_CONDITION_DNF;
}

function conditionDefinitionToDnf(
  definition: EdgeConditionDefinition
): SimpleConditionDnf {
  if (Array.isArray(definition)) {
    return andConditions(definition.map((item) => conditionItemToDnf(item)));
  }
  return conditionItemToDnf(definition);
}

function conditionItemToDnf(
  item: EdgeConditionClause | EdgeConditionGroup
): SimpleConditionDnf {
  if ('when' in item) {
    const atom = conditionClauseToAtom(item);
    return atom ? [new Set([atom])] : TRUE_CONDITION_DNF;
  }

  const groups: SimpleConditionDnf[] = [];
  if (item.all) {
    groups.push(
      andConditions(item.all.map((clause) => conditionItemToDnf(clause)))
    );
  }
  if (item.any) {
    groups.push(
      orConditions(item.any.map((clause) => conditionItemToDnf(clause)))
    );
  }
  if (groups.length === 0) {
    return TRUE_CONDITION_DNF;
  }
  return andConditions(groups);
}

function conditionClauseToAtom(clause: EdgeConditionClause): string | undefined {
  if ('is' in clause) {
    return `${clause.when}::is::${JSON.stringify(clause.is)}`;
  }
  if ('isNot' in clause) {
    return `${clause.when}::isNot::${JSON.stringify(clause.isNot)}`;
  }
  if ('contains' in clause) {
    return `${clause.when}::contains::${JSON.stringify(clause.contains)}`;
  }
  if ('greaterThan' in clause) {
    return `${clause.when}::greaterThan::${JSON.stringify(clause.greaterThan)}`;
  }
  if ('lessThan' in clause) {
    return `${clause.when}::lessThan::${JSON.stringify(clause.lessThan)}`;
  }
  if ('greaterOrEqual' in clause) {
    return `${clause.when}::greaterOrEqual::${JSON.stringify(clause.greaterOrEqual)}`;
  }
  if ('lessOrEqual' in clause) {
    return `${clause.when}::lessOrEqual::${JSON.stringify(clause.lessOrEqual)}`;
  }
  if ('exists' in clause) {
    return `${clause.when}::exists::${JSON.stringify(clause.exists)}`;
  }
  if ('matches' in clause) {
    return `${clause.when}::matches::${JSON.stringify(clause.matches)}`;
  }
  return undefined;
}

function andConditions(conditions: SimpleConditionDnf[]): SimpleConditionDnf {
  let result: SimpleConditionDnf = TRUE_CONDITION_DNF;
  for (const condition of conditions) {
    const next: SimpleConditionDnf = [];
    for (const left of result) {
      for (const right of condition) {
        next.push(new Set([...left, ...right]));
      }
    }
    result = next;
  }
  return result;
}

function orConditions(conditions: SimpleConditionDnf[]): SimpleConditionDnf {
  if (conditions.length === 0) {
    return TRUE_CONDITION_DNF;
  }
  return conditions.flatMap((condition) => condition);
}

function conditionImplies(
  antecedent: SimpleConditionDnf,
  consequent: SimpleConditionDnf
): boolean {
  return antecedent.every((antecedentBranch) =>
    consequent.some((consequentBranch) =>
      setContainsAll(antecedentBranch, consequentBranch)
    )
  );
}

function setContainsAll(
  superset: SimpleConditionConjunction,
  subset: SimpleConditionConjunction
): boolean {
  for (const item of subset) {
    if (!superset.has(item)) {
      return false;
    }
  }
  return true;
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
    if (node.document.meta.kind === 'producer') {
      for (const child of node.children.values()) {
        validateTree(child);
      }
      return;
    }

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
    for (const artifact of node.document.outputs) {
      if (artifact.countInput) {
        usedInputs.add(artifact.countInput);
      }
      for (const arrayMapping of artifact.arrays ?? []) {
        usedInputs.add(arrayMapping.countInput);
      }
    }

    // Collect from input countInputs
    for (const input of node.document.inputs) {
      if (input.countInput) {
        usedInputs.add(input.countInput);
      }
    }

    // Find unused inputs
    for (const input of node.document.inputs) {
      if (!usedInputs.has(input.name) && !SYSTEM_INPUT_NAMES.has(input.name)) {
        const warningText = buildUnusedInputWarning(input.name);
        issues.push(
          createWarning(
            ValidationErrorCode.UNUSED_INPUT,
            warningText.message,
            {
              filePath: node.sourcePath,
              namespacePath: node.namespacePath,
              context: `input "${input.name}"`,
            },
            warningText.suggestion
          )
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

function buildUnusedInputWarning(inputName: string): {
  message: string;
  suggestion: string;
} {
  if (isCountStyleInputName(inputName)) {
    return {
      message:
        `Input "${inputName}" is declared but never referenced. ` +
        `This count-style input looks unnecessary and should be removed.`,
      suggestion:
        `Remove "${inputName}" from blueprint inputs/template, or wire it into ` +
        `inputs[].countInput, loops[].countInput, outputs[].countInput, outputs[].arrays[].countInput, or a connection.`,
    };
  }

  return {
    message: `Input "${inputName}" is declared but never referenced and appears unnecessary.`,
    suggestion: `Remove the input declaration or add a connection using it.`,
  };
}

function isCountStyleInputName(inputName: string): boolean {
  return /^NumOf[A-Z0-9_]/.test(inputName);
}

/**
 * Finds artifacts that are declared but never connected to.
 */
export function findUnusedArtifacts(
  tree: BlueprintTreeNode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function validateTree(node: BlueprintTreeNode): void {
    if (node.document.meta.kind === 'producer') {
      for (const child of node.children.values()) {
        validateTree(child);
      }
      return;
    }

    const usedArtifacts = new Set<string>();

    // Collect artifact references from edges (as 'to' targets)
    for (const edge of node.document.edges) {
      if (isLocalReference(edge.to)) {
        const { baseName } = parseReference(edge.to);
        usedArtifacts.add(baseName);
      }
    }

    // Find unused artifacts
    for (const artifact of node.document.outputs) {
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
            `Remove the artifact declaration or add a connection to it`
          )
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
export function findUnreachableProducers(
  tree: BlueprintTreeNode
): ValidationIssue[] {
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

    // Find unreachable producers
    for (const producerImport of node.document.imports) {
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
            `Add connections to "${producerImport.name}" or remove it from imports[]`
          )
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
