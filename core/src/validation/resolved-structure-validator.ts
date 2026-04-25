import type {
  CanonicalBlueprint,
  CanonicalNodeInstance,
} from '../resolution/canonical-expander.js';
import type {
  BlueprintGraph,
  BlueprintGraphEdge,
  BlueprintGraphNode,
} from '../resolution/canonical-graph.js';
import {
  type BlueprintInputDefinition,
  type BlueprintTreeNode,
  type EdgeConditionDefinition,
  type ResolvedOutputRoute,
  type ResolvedScalarBinding,
  SYSTEM_INPUTS,
} from '../types.js';
import {
  type ValidationIssue,
  ValidationErrorCode,
  createError,
} from './types.js';

const SYSTEM_INPUT_NAMES = new Set<string>(Object.values(SYSTEM_INPUTS));

export interface ResolvedStructureValidationOptions {
  strict: boolean;
}

interface ConditionalRequiredInputEdge {
  producer: BlueprintGraphNode;
  input: BlueprintInputDefinition;
  edge: BlueprintGraphEdge;
}

interface AuthoredConditionalRequiredInputEdge {
  producerName: string;
  input: BlueprintInputDefinition;
  edge: {
    from: string;
    to: string;
    conditions: EdgeConditionDefinition;
  };
  activationCondition?: EdgeConditionDefinition;
  node: BlueprintTreeNode;
}

export function validateAuthoredConditionSemantics(
  root: BlueprintTreeNode,
  options: ResolvedStructureValidationOptions
): ValidationIssue[] {
  if (!options.strict) {
    return [];
  }

  const conditionalRequiredEdges: AuthoredConditionalRequiredInputEdge[] = [];

  function visit(node: BlueprintTreeNode): void {
    for (const edge of node.document.edges) {
      if (!edge.conditions) {
        continue;
      }

      const target = resolveAuthoredProducerInput(node, edge.to);
      if (
        !target ||
        target.input.required === false ||
        target.input.fanIn === true
      ) {
        continue;
      }
      if (!isScalarInputDefinition(target.input)) {
        continue;
      }

      conditionalRequiredEdges.push({
        producerName: target.producerName,
        input: target.input,
        edge: {
          from: edge.from,
          to: edge.to,
          conditions: edge.conditions,
        },
        activationCondition: target.activationCondition,
        node,
      });
    }

    for (const child of node.children.values()) {
      visit(child);
    }
  }

  visit(root);

  return [
    ...validateAuthoredConditionalInputTargets(conditionalRequiredEdges),
    ...validateAuthoredConditionalRequiredInputSources(
      conditionalRequiredEdges
    ),
  ];
}

export function validatePreparedGraphConditionSemantics(
  root: BlueprintTreeNode,
  graph: BlueprintGraph,
  options: ResolvedStructureValidationOptions
): ValidationIssue[] {
  if (!options.strict) {
    return [];
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const conditionalRequiredEdges = collectConditionalRequiredInputEdges(
    graph,
    nodeById
  );

  return [
    ...validatePreparedConditionalInputTargets(root, conditionalRequiredEdges),
    ...validatePreparedConditionalRequiredInputSources(
      root,
      conditionalRequiredEdges
    ),
  ];
}

function validateAuthoredConditionalInputTargets(
  conditionalRequiredEdges: AuthoredConditionalRequiredInputEdge[]
): ValidationIssue[] {
  return conditionalRequiredEdges.map(({ producerName, input, edge, node }) =>
    createError(
      ValidationErrorCode.EDGE_CONDITION_TARGET_NOT_OPTIONAL_OR_FANIN,
      `Authored edge condition targets required input "${producerName}.${input.name}".`,
      {
        filePath: node.sourcePath,
        namespacePath: node.namespacePath,
        context: `connection from "${edge.from}" to "${edge.to}"`,
      },
      `Edge conditions are only valid for optional scalar inputs or fan-in members. Move this condition to producer/import activation, or mark "${input.name}" optional if absence is valid.`
    )
  );
}

function validateAuthoredConditionalRequiredInputSources(
  conditionalRequiredEdges: AuthoredConditionalRequiredInputEdge[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const edgesByProducerInput = new Map<
    string,
    AuthoredConditionalRequiredInputEdge[]
  >();

  for (const entry of conditionalRequiredEdges) {
    const key = `${entry.node.namespacePath.join('.')}\u0000${entry.producerName}\u0000${entry.input.name}`;
    const entries = edgesByProducerInput.get(key) ?? [];
    entries.push(entry);
    edgesByProducerInput.set(key, entries);
  }

  for (const entries of edgesByProducerInput.values()) {
    const first = entries[0]!;
    const label = `${first.producerName}.${first.input.name}`;

    if (entries.length > 1) {
      issues.push(
        createError(
          ValidationErrorCode.REQUIRED_INPUT_MULTIPLE_CONDITIONAL_SOURCES,
          `Required input "${label}" has ${entries.length} authored conditional scalar sources.`,
          {
            filePath: first.node.sourcePath,
            namespacePath: first.node.namespacePath,
            context: `producer input "${label}"`,
          },
          `Move branch selection to producer/import activation and resolve "${first.input.name}" to exactly one scalar source in each active branch.`
        )
      );
      continue;
    }

    if (!first.activationCondition) {
      issues.push(
        createError(
          ValidationErrorCode.MISSING_PRODUCER_ACTIVATION_FOR_CONDITIONAL_INPUTS,
          `Required input "${label}" has an authored edge condition, but producer "${first.producerName}" has no declared activation condition.`,
          {
            filePath: first.node.sourcePath,
            namespacePath: first.node.namespacePath,
            context: `connection from "${first.edge.from}" to "${first.edge.to}"`,
          },
          `Move the condition from the required input edge to the import or producer activation for "${first.producerName}".`
        )
      );
      continue;
    }

    issues.push(
      createError(
        ValidationErrorCode.REQUIRED_INPUT_CONDITION_UNSUPPORTED,
        `Required input "${label}" has an authored edge condition.`,
        {
          filePath: first.node.sourcePath,
          namespacePath: first.node.namespacePath,
          context: `connection from "${first.edge.from}" to "${first.edge.to}"`,
        },
        conditionsEqual(first.edge.conditions, first.activationCondition)
          ? `This condition duplicates the producer activation. Remove it from the required input edge and keep it on the producer/import activation.`
          : `Required inputs must be unconditional once the producer is active. Move branch selection to producer/import activation, then bind "${first.input.name}" once in each active branch.`
      )
    );
  }

  return issues;
}

function resolveAuthoredProducerInput(
  node: BlueprintTreeNode,
  reference: string
):
  | {
      producerName: string;
      input: BlueprintInputDefinition;
      activationCondition?: EdgeConditionDefinition;
    }
  | undefined {
  const segments = reference.split('.');
  if (segments.length < 2) {
    return undefined;
  }

  const producerName = stripDimensions(segments[0]!);
  const child = node.children.get(producerName);
  if (!child) {
    return undefined;
  }

  const inputName = stripDimensions(segments[1]!);
  const input = child.document.inputs.find(
    (candidate) => candidate.name === inputName
  );
  if (!input) {
    return undefined;
  }

  const producerImport = node.document.imports.find(
    (entry) => entry.name === producerName
  );

  return {
    producerName,
    input,
    ...(producerImport?.conditions
      ? { activationCondition: producerImport.conditions }
      : {}),
  };
}

export function validateResolvedStructureConditions(
  root: BlueprintTreeNode,
  canonical: CanonicalBlueprint,
  options: ResolvedStructureValidationOptions
): ValidationIssue[] {
  if (!options.strict) {
    return [];
  }

  const nodeById = new Map(canonical.nodes.map((node) => [node.id, node]));
  const inputNodesByProducerId = mapInputNodesByProducer(canonical.nodes);
  const scalarBindingsByProducerId = canonical.resolvedScalarBindings;

  return [
    ...validateResolvedRequiredScalarInputs({
      root,
      canonical,
      inputNodesByProducerId,
      scalarBindingsByProducerId,
    }),
    ...validateResolvedScalarEdgeConditions({
      root,
      canonical,
      inputNodesByProducerId,
      scalarBindingsByProducerId,
    }),
    ...validateResolvedFanInEdgeConditions(root, canonical, nodeById),
    ...validateResolvedOutputRoutes(root, canonical.resolvedOutputRoutes),
  ];
}

function collectConditionalRequiredInputEdges(
  graph: BlueprintGraph,
  nodeById: Map<string, BlueprintGraphNode>
): ConditionalRequiredInputEdge[] {
  const edges: ConditionalRequiredInputEdge[] = [];

  for (const edge of graph.edges) {
    if (!edge.authoredEdgeConditions) {
      continue;
    }

    const target = nodeById.get(edge.to.nodeId);
    if (target?.type !== 'InputSource' || !target.input) {
      continue;
    }
    if (target.input.required === false || target.input.fanIn === true) {
      continue;
    }
    if (!isScalarInputDefinition(target.input)) {
      continue;
    }

    const producer = findGraphProducerForInput(graph.nodes, target);
    if (!producer) {
      continue;
    }

    edges.push({
      producer,
      input: target.input,
      edge,
    });
  }

  return edges;
}

function validatePreparedConditionalInputTargets(
  root: BlueprintTreeNode,
  conditionalRequiredEdges: ConditionalRequiredInputEdge[]
): ValidationIssue[] {
  return conditionalRequiredEdges.map(({ producer, input, edge }) =>
    createError(
      ValidationErrorCode.EDGE_CONDITION_TARGET_NOT_OPTIONAL_OR_FANIN,
      `Authored edge condition targets required input "${formatGraphProducerInputLabel(producer, input)}".`,
      {
        filePath: root.sourcePath,
        namespacePath: producer.namespacePath,
        context: `prepared graph edge "${edge.from.nodeId}" -> "${edge.to.nodeId}"`,
      },
      `Edge conditions are only valid for optional scalar inputs or fan-in members. Move this condition to producer/import activation, or mark "${input.name}" optional if absence is valid.`
    )
  );
}

function validatePreparedConditionalRequiredInputSources(
  root: BlueprintTreeNode,
  conditionalRequiredEdges: ConditionalRequiredInputEdge[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const edgesByProducerInput = new Map<
    string,
    ConditionalRequiredInputEdge[]
  >();

  for (const entry of conditionalRequiredEdges) {
    const key = `${entry.producer.id}\u0000${entry.input.name}`;
    const entries = edgesByProducerInput.get(key) ?? [];
    entries.push(entry);
    edgesByProducerInput.set(key, entries);
  }

  for (const entries of edgesByProducerInput.values()) {
    const first = entries[0]!;
    if (entries.length > 1) {
      issues.push(
        createError(
          ValidationErrorCode.REQUIRED_INPUT_MULTIPLE_CONDITIONAL_SOURCES,
          `Required input "${formatGraphProducerInputLabel(first.producer, first.input)}" has ${entries.length} authored conditional scalar sources.`,
          {
            filePath: root.sourcePath,
            namespacePath: first.producer.namespacePath,
            context: `producer input "${formatGraphProducerInputLabel(first.producer, first.input)}"`,
          },
          `Move branch selection to producer/import activation and resolve "${first.input.name}" to exactly one scalar source in each active branch.`
        )
      );
      continue;
    }

    const activationCondition = first.producer.activation?.condition;
    if (!activationCondition) {
      issues.push(
        createError(
          ValidationErrorCode.MISSING_PRODUCER_ACTIVATION_FOR_CONDITIONAL_INPUTS,
          `Required input "${formatGraphProducerInputLabel(first.producer, first.input)}" has an authored edge condition, but producer "${formatGraphProducerLabel(first.producer)}" has no resolved activation condition.`,
          {
            filePath: root.sourcePath,
            namespacePath: first.producer.namespacePath,
            context: `prepared graph edge "${first.edge.from.nodeId}" -> "${first.edge.to.nodeId}"`,
          },
          `Move the condition from the required input edge to the import or producer activation for "${formatGraphProducerLabel(first.producer)}".`
        )
      );
      continue;
    }

    issues.push(
      createError(
        ValidationErrorCode.REQUIRED_INPUT_CONDITION_UNSUPPORTED,
        `Required input "${formatGraphProducerInputLabel(first.producer, first.input)}" has an authored edge condition.`,
        {
          filePath: root.sourcePath,
          namespacePath: first.producer.namespacePath,
          context: `prepared graph edge "${first.edge.from.nodeId}" -> "${first.edge.to.nodeId}"`,
        },
        conditionsEqual(first.edge.authoredEdgeConditions!, activationCondition)
          ? `This condition duplicates the producer activation. Remove it from the required input edge and keep it on the producer/import activation.`
          : `Required inputs must be unconditional once the producer is active. Move branch selection to producer/import activation, then bind "${first.input.name}" once in each active branch.`
      )
    );
  }

  return issues;
}

function validateResolvedRequiredScalarInputs(args: {
  root: BlueprintTreeNode;
  canonical: CanonicalBlueprint;
  inputNodesByProducerId: Map<string, CanonicalNodeInstance[]>;
  scalarBindingsByProducerId: Record<string, ResolvedScalarBinding[]>;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const producer of args.canonical.nodes) {
    if (producer.type !== 'Producer') {
      continue;
    }

    const inputNodes = args.inputNodesByProducerId.get(producer.id) ?? [];
    const bindings = args.scalarBindingsByProducerId[producer.id] ?? [];

    for (const inputNode of inputNodes) {
      if (!isRequiredScalarInput(inputNode)) {
        continue;
      }

      const input = inputNode.input!;
      const inputBindings = bindings.filter(
        (binding) => binding.inputId === input.name
      );
      const conditionalBindings = inputBindings.filter(
        (binding) => binding.optionalCondition
      );

      if (conditionalBindings.length > 1) {
        issues.push(
          createError(
            ValidationErrorCode.REQUIRED_INPUT_MULTIPLE_CONDITIONAL_SOURCES,
            `Required input "${formatProducerInputLabel(producer, input)}" has ${conditionalBindings.length} conditional scalar sources.`,
            {
              filePath: args.root.sourcePath,
              namespacePath: producer.namespacePath,
              context: `producer input "${formatProducerInputLabel(producer, input)}"`,
            },
            `Move the branch condition to producer/import activation and resolve "${input.name}" to exactly one scalar source in each active branch.`
          )
        );
        continue;
      }

      if (inputBindings.length !== 1) {
        issues.push(
          createError(
            ValidationErrorCode.REQUIRED_INPUT_CONDITION_INCOHERENT,
            `Required input "${formatProducerInputLabel(producer, input)}" resolves to ${inputBindings.length} scalar sources.`,
            {
              filePath: args.root.sourcePath,
              namespacePath: producer.namespacePath,
              context: `producer input "${formatProducerInputLabel(producer, input)}"`,
            },
            `Bind "${input.name}" to exactly one source for this producer instance. Use producer/import activation for branch selection instead of conditional required-input edges.`
          )
        );
        continue;
      }

      const [binding] = inputBindings;
      if (!binding.optionalCondition) {
        continue;
      }

      const activation =
        args.canonical.resolvedProducerActivations[producer.id];
      if (!activation?.condition) {
        issues.push(
          createError(
            ValidationErrorCode.MISSING_PRODUCER_ACTIVATION_FOR_CONDITIONAL_INPUTS,
            `Required input "${formatProducerInputLabel(producer, input)}" depends on a conditional binding, but producer "${formatProducerLabel(producer)}" has no resolved activation condition.`,
            {
              filePath: args.root.sourcePath,
              namespacePath: producer.namespacePath,
              context: `resolved binding "${binding.sourceId}" -> "${formatProducerInputLabel(producer, input)}"`,
            },
            `Move the condition from the required input edge to the import or producer activation for "${formatProducerLabel(producer)}".`
          )
        );
        continue;
      }

      issues.push(
        createError(
          ValidationErrorCode.REQUIRED_INPUT_CONDITION_UNSUPPORTED,
          `Required input "${formatProducerInputLabel(producer, input)}" depends on a conditional scalar binding.`,
          {
            filePath: args.root.sourcePath,
            namespacePath: producer.namespacePath,
            context: `resolved binding "${binding.sourceId}" -> "${formatProducerInputLabel(producer, input)}"`,
          },
          conditionsEqual(
            binding.optionalCondition.condition,
            activation.condition
          )
            ? `This condition duplicates the producer activation. Remove it from the required input edge and keep it on the producer/import activation.`
            : `Required inputs must be unconditional once the producer is active. Move branch selection to producer/import activation, then bind "${input.name}" once in each active branch.`
        )
      );
    }
  }

  return issues;
}

function validateResolvedScalarEdgeConditions(args: {
  root: BlueprintTreeNode;
  canonical: CanonicalBlueprint;
  inputNodesByProducerId: Map<string, CanonicalNodeInstance[]>;
  scalarBindingsByProducerId: Record<string, ResolvedScalarBinding[]>;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const producer of args.canonical.nodes) {
    if (producer.type !== 'Producer') {
      continue;
    }

    const inputDefinitions = new Map(
      (args.inputNodesByProducerId.get(producer.id) ?? [])
        .filter((inputNode) => inputNode.input)
        .map((inputNode) => [inputNode.input!.name, inputNode.input!])
    );
    const bindings = args.scalarBindingsByProducerId[producer.id] ?? [];

    for (const binding of bindings) {
      if (!binding.optionalCondition) {
        continue;
      }

      const input = inputDefinitions.get(binding.inputId);
      if (!input || input.required === false || input.fanIn === true) {
        continue;
      }

      issues.push(
        createError(
          ValidationErrorCode.EDGE_CONDITION_TARGET_NOT_OPTIONAL_OR_FANIN,
          `Conditional scalar binding "${binding.sourceId}" targets required input "${formatProducerInputLabel(producer, input)}".`,
          {
            filePath: args.root.sourcePath,
            namespacePath: producer.namespacePath,
            context: `resolved binding "${binding.sourceId}" -> "${formatProducerInputLabel(producer, input)}"`,
          },
          `Edge conditions are only valid for optional scalar inputs or fan-in members. Move this condition to producer/import activation, or mark "${input.name}" optional if absence is valid.`
        )
      );
    }
  }

  return issues;
}

function validateResolvedFanInEdgeConditions(
  root: BlueprintTreeNode,
  canonical: CanonicalBlueprint,
  nodeById: Map<string, CanonicalNodeInstance>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [inputId, descriptor] of Object.entries(
    canonical.resolvedFanInDescriptors
  )) {
    const inputNode = nodeById.get(inputId);
    if (!descriptor.members.some((member) => member.condition)) {
      continue;
    }
    if (inputNode?.input?.fanIn === true) {
      continue;
    }

    issues.push(
      createError(
        ValidationErrorCode.EDGE_CONDITION_TARGET_NOT_OPTIONAL_OR_FANIN,
        `Conditional fan-in members target "${inputId}", but that input is not declared with fanIn: true.`,
        {
          filePath: root.sourcePath,
          namespacePath: inputNode?.namespacePath ?? root.namespacePath,
          context: `fan-in input "${inputId}"`,
        },
        'Declare the target input with `fanIn: true`, or remove the member-level edge condition.'
      )
    );
  }

  return issues;
}

function validateResolvedOutputRoutes(
  root: BlueprintTreeNode,
  routes: ResolvedOutputRoute[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const routesByOutputId = new Map<string, ResolvedOutputRoute[]>();

  for (const route of routes) {
    const outputRoutes = routesByOutputId.get(route.outputId) ?? [];
    outputRoutes.push(route);
    routesByOutputId.set(route.outputId, outputRoutes);
  }

  for (const [outputId, outputRoutes] of routesByOutputId) {
    if (
      outputRoutes.length <= 1 ||
      outputRoutes.every((route) => route.condition)
    ) {
      continue;
    }

    issues.push(
      createError(
        ValidationErrorCode.SEMANTIC_VALIDATION_RULE_FAILED,
        `Public output "${outputId}" has ${outputRoutes.length} resolved source routes, but at least one route is missing an explicit condition.`,
        {
          filePath: root.sourcePath,
          namespacePath: root.namespacePath,
          context: `output route "${outputId}"`,
        },
        'Add an explicit route condition to every source feeding this multi-source public output.'
      )
    );
  }

  return issues;
}

function mapInputNodesByProducer(
  nodes: CanonicalNodeInstance[]
): Map<string, CanonicalNodeInstance[]> {
  const producers = nodes.filter((node) => node.type === 'Producer');
  const map = new Map<string, CanonicalNodeInstance[]>();

  for (const producer of producers) {
    const inputNodes = nodes.filter(
      (node) =>
        node.type === 'Input' &&
        inputBelongsToProducerNamespace(node.namespacePath, producer) &&
        indicesAreCompatible(producer, node)
    );
    map.set(producer.id, inputNodes);
  }

  return map;
}

function isRequiredScalarInput(node: CanonicalNodeInstance): boolean {
  const input = node.input;
  if (!input || SYSTEM_INPUT_NAMES.has(input.name)) {
    return false;
  }
  return (
    input.required === true &&
    input.fanIn !== true &&
    input.type !== 'array' &&
    input.type !== 'multiDimArray'
  );
}

function isScalarInputDefinition(input: BlueprintInputDefinition): boolean {
  return input.type !== 'array' && input.type !== 'multiDimArray';
}

function findGraphProducerForInput(
  nodes: BlueprintGraphNode[],
  inputNode: BlueprintGraphNode
): BlueprintGraphNode | undefined {
  return nodes.find(
    (node) =>
      node.type === 'Producer' &&
      inputBelongsToProducerNamespace(inputNode.namespacePath, node)
  );
}

function inputBelongsToProducerNamespace(
  inputNamespacePath: string[],
  producer: Pick<
    BlueprintGraphNode | CanonicalNodeInstance,
    'namespacePath' | 'name'
  >
): boolean {
  return (
    arraysEqual(inputNamespacePath, producer.namespacePath) ||
    arraysEqual(inputNamespacePath, [...producer.namespacePath, producer.name])
  );
}

function indicesAreCompatible(
  producer: CanonicalNodeInstance,
  input: CanonicalNodeInstance
): boolean {
  for (const [symbol, value] of Object.entries(producer.indices)) {
    if (
      input.indices[symbol] !== undefined &&
      input.indices[symbol] !== value
    ) {
      return false;
    }
  }
  return true;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function stripDimensions(segment: string): string {
  return segment.replace(/\[[^\]]*\]/g, '');
}

function formatProducerLabel(producer: CanonicalNodeInstance): string {
  if (
    producer.namespacePath[producer.namespacePath.length - 1] === producer.name
  ) {
    return producer.namespacePath.join('.');
  }
  return [...producer.namespacePath, producer.name].join('.');
}

function formatProducerInputLabel(
  producer: CanonicalNodeInstance,
  input: BlueprintInputDefinition
): string {
  return `${formatProducerLabel(producer)}.${input.name}`;
}

function formatGraphProducerLabel(producer: BlueprintGraphNode): string {
  if (
    producer.namespacePath[producer.namespacePath.length - 1] === producer.name
  ) {
    return producer.namespacePath.join('.');
  }
  return [...producer.namespacePath, producer.name].join('.');
}

function formatGraphProducerInputLabel(
  producer: BlueprintGraphNode,
  input: BlueprintInputDefinition
): string {
  return `${formatGraphProducerLabel(producer)}.${input.name}`;
}

function conditionsEqual(
  left: EdgeConditionDefinition,
  right: EdgeConditionDefinition
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
