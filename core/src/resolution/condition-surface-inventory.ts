import type { CanonicalBlueprint } from './canonical-expander.js';
import type { ProducerGraph } from '../types.js';
import type {
  BlueprintEdgeDefinition,
  BlueprintInputDefinition,
  BlueprintTreeNode,
  EdgeConditionDefinition,
} from '../types.js';

export type ConditionSurfaceCategory =
  | 'activation-like'
  | 'optional-input'
  | 'fan-in'
  | 'output-route'
  | 'other';

export interface ConditionSurfaceInventoryItem {
  category: ConditionSurfaceCategory;
  condition: EdgeConditionDefinition;
}

export interface ImportConditionInventoryItem
  extends ConditionSurfaceInventoryItem {
  importName: string;
  namespacePath: string[];
  parentNamespacePath: string[];
  sourcePath: string;
}

export interface AuthoredConnectionConditionInventoryItem
  extends ConditionSurfaceInventoryItem {
  namespacePath: string[];
  from: BlueprintEdgeDefinition['from'];
  to: BlueprintEdgeDefinition['to'];
  conditionName?: string;
  sourcePath: string;
}

export interface PropagatedEdgeConditionInventoryItem
  extends ConditionSurfaceInventoryItem {
  from: string;
  to: string;
}

export interface ConditionalInputBindingInventoryItem
  extends ConditionSurfaceInventoryItem {
  producerId: string;
  inputName: string;
  sourceId: string;
}

export interface InputConditionInventoryItem
  extends ConditionSurfaceInventoryItem {
  producerId: string;
  inputId: string;
}

export interface FanInMemberConditionInventoryItem
  extends ConditionSurfaceInventoryItem {
  producerId: string;
  fanInInputId: string;
  memberId: string;
}

export interface OutputRouteConditionInventoryItem
  extends ConditionSurfaceInventoryItem {
  outputId: string;
  sourceId: string;
}

export interface BlueprintConditionSurfaceInventory {
  blueprintId: string;
  blueprintName: string;
  importConditions: ImportConditionInventoryItem[];
  authoredConnectionConditions: AuthoredConnectionConditionInventoryItem[];
  propagatedEdgeConditions: PropagatedEdgeConditionInventoryItem[];
  conditionalInputBindings: ConditionalInputBindingInventoryItem[];
  inputConditions: InputConditionInventoryItem[];
  fanInMemberConditions: FanInMemberConditionInventoryItem[];
  routeSelectedOutputBindings: OutputRouteConditionInventoryItem[];
  totals: {
    importConditions: number;
    authoredConnectionConditions: number;
    propagatedEdgeConditions: number;
    conditionalInputBindings: number;
    inputConditions: number;
    fanInMembersWithConditions: number;
    routeSelectedOutputBindings: number;
    routeSelectedOutputBindingsWithConditions: number;
  };
  categories: Record<ConditionSurfaceCategory, number>;
}

export function collectBlueprintConditionSurfaceInventory(args: {
  root: BlueprintTreeNode;
  canonical: CanonicalBlueprint;
  producerGraph?: ProducerGraph;
}): BlueprintConditionSurfaceInventory {
  const nodesById = new Map(
    args.canonical.nodes.map((node) => [node.id, node])
  );
  const inputDefinitions = collectInputDefinitions(args.root);
  const inputConditionCategories = collectInputConditionCategories(
    args.canonical,
    inputDefinitions
  );

  const importConditions = collectImportConditions(args.root);
  const authoredConnectionConditions = collectAuthoredConnectionConditions(
    args.root
  );
  const propagatedEdgeConditions = args.canonical.edges
    .filter((edge) => edge.conditions)
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      condition: edge.conditions!,
      category: classifyCanonicalConditionTarget(edge.to, nodesById),
    }));
  const conditionalInputBindings = collectConditionalInputBindings(
    args.canonical,
    nodesById,
    inputDefinitions
  );
  const inputConditions = collectInputConditions(
    args.producerGraph,
    inputConditionCategories
  );
  const fanInMemberConditions = collectFanInMemberConditions(
    args.producerGraph
  );
  const routeSelectedOutputBindings = args.canonical.outputSourceBindings
    .filter((binding) => binding.conditions)
    .map((binding) => ({
      outputId: binding.outputId,
      sourceId: binding.sourceId,
      condition: binding.conditions!,
      category: 'output-route' as const,
    }));

  const categories = countCategories([
    ...importConditions,
    ...authoredConnectionConditions,
    ...propagatedEdgeConditions,
    ...conditionalInputBindings,
    ...inputConditions,
    ...fanInMemberConditions,
    ...routeSelectedOutputBindings,
  ]);

  return {
    blueprintId: args.root.document.meta.id,
    blueprintName: args.root.document.meta.name,
    importConditions,
    authoredConnectionConditions,
    propagatedEdgeConditions,
    conditionalInputBindings,
    inputConditions,
    fanInMemberConditions,
    routeSelectedOutputBindings,
    totals: {
      importConditions: importConditions.length,
      authoredConnectionConditions: authoredConnectionConditions.length,
      propagatedEdgeConditions: propagatedEdgeConditions.length,
      conditionalInputBindings: conditionalInputBindings.length,
      inputConditions: inputConditions.length,
      fanInMembersWithConditions: fanInMemberConditions.length,
      routeSelectedOutputBindings: args.canonical.outputSourceBindings.length,
      routeSelectedOutputBindingsWithConditions:
        routeSelectedOutputBindings.length,
    },
    categories,
  };
}

function collectImportConditions(
  root: BlueprintTreeNode
): ImportConditionInventoryItem[] {
  const items: ImportConditionInventoryItem[] = [];

  function visit(parent: BlueprintTreeNode): void {
    for (const [importName, child] of parent.children.entries()) {
      if (child.importConditions) {
        items.push({
          importName,
          namespacePath: child.namespacePath,
          parentNamespacePath: parent.namespacePath,
          sourcePath: child.sourcePath,
          condition: child.importConditions,
          category: 'activation-like',
        });
      }
      visit(child);
    }
  }

  visit(root);
  return items;
}

function collectAuthoredConnectionConditions(
  root: BlueprintTreeNode
): AuthoredConnectionConditionInventoryItem[] {
  const items: AuthoredConnectionConditionInventoryItem[] = [];

  function visit(node: BlueprintTreeNode): void {
    for (const edge of node.document.edges) {
      if (!edge.conditions) {
        continue;
      }
      items.push({
        namespacePath: node.namespacePath,
        from: edge.from,
        to: edge.to,
        conditionName: edge.if,
        sourcePath: node.sourcePath,
        condition: edge.conditions,
        category: 'activation-like',
      });
    }

    for (const child of node.children.values()) {
      visit(child);
    }
  }

  visit(root);
  return items;
}

function collectConditionalInputBindings(
  canonical: CanonicalBlueprint,
  nodesById: Map<string, CanonicalBlueprint['nodes'][number]>,
  inputDefinitions: Map<string, BlueprintInputDefinition>
): ConditionalInputBindingInventoryItem[] {
  const items: ConditionalInputBindingInventoryItem[] = [];

  for (const [producerId, bindings] of Object.entries(
    canonical.conditionalInputBindings
  )) {
    const producerNode = nodesById.get(producerId);
    if (!producerNode || producerNode.type !== 'Producer') {
      throw new Error(
        `Conditional input binding references unknown producer "${producerId}".`
      );
    }

    for (const [inputName, candidates] of Object.entries(bindings)) {
      const inputDefinition = findProducerInputDefinition(
        inputDefinitions,
        producerNode,
        inputName
      );
      for (const candidate of candidates) {
        items.push({
          producerId,
          inputName,
          sourceId: candidate.sourceId,
          condition: candidate.condition,
          category: classifyInputDefinition(inputDefinition),
        });
      }
    }
  }

  return items;
}

function collectInputConditions(
  producerGraph: ProducerGraph | undefined,
  inputConditionCategories: Map<string, ConditionSurfaceCategory>
): InputConditionInventoryItem[] {
  if (!producerGraph) {
    return [];
  }

  const items: InputConditionInventoryItem[] = [];

  for (const node of producerGraph.nodes) {
    for (const [inputId, conditionInfo] of Object.entries(
      node.context?.inputConditions ?? {}
    )) {
      const category = isConditionedFanInMember(node, inputId)
        ? 'fan-in'
        : inputConditionCategories.get(
            inputConditionKey(node.jobId, inputId)
          ) ?? 'other';
      items.push({
        producerId: node.jobId,
        inputId,
        condition: conditionInfo.condition,
        category,
      });
    }
  }

  return items;
}

function isConditionedFanInMember(
  node: ProducerGraph['nodes'][number],
  inputId: string
): boolean {
  return Object.values(node.context?.fanIn ?? {}).some((descriptor) =>
    descriptor.members.some((member) => member.id === inputId)
  );
}

function collectFanInMemberConditions(
  producerGraph: ProducerGraph | undefined
): FanInMemberConditionInventoryItem[] {
  if (!producerGraph) {
    return [];
  }

  const items: FanInMemberConditionInventoryItem[] = [];

  for (const node of producerGraph.nodes) {
    const inputConditions = node.context?.inputConditions ?? {};
    for (const [fanInInputId, descriptor] of Object.entries(
      node.context?.fanIn ?? {}
    )) {
      for (const member of descriptor.members) {
        const conditionInfo = inputConditions[member.id];
        if (!conditionInfo) {
          continue;
        }
        items.push({
          producerId: node.jobId,
          fanInInputId,
          memberId: member.id,
          condition: conditionInfo.condition,
          category: 'fan-in',
        });
      }
    }
  }

  return items;
}

function collectInputConditionCategories(
  canonical: CanonicalBlueprint,
  inputDefinitions: Map<string, BlueprintInputDefinition>
): Map<string, ConditionSurfaceCategory> {
  const categories = new Map<string, ConditionSurfaceCategory>();
  const nodesById = new Map(canonical.nodes.map((node) => [node.id, node]));

  for (const [producerId, bindings] of Object.entries(
    canonical.inputBindings
  )) {
    const producerNode = nodesById.get(producerId);
    if (!producerNode || producerNode.type !== 'Producer') {
      continue;
    }

    for (const [inputName, sourceId] of Object.entries(bindings)) {
      const inputDefinition = findProducerInputDefinition(
        inputDefinitions,
        producerNode,
        inputName
      );
      categories.set(
        inputConditionKey(producerId, sourceId),
        classifyInputDefinition(inputDefinition)
      );
    }
  }

  for (const [producerId, bindings] of Object.entries(
    canonical.conditionalInputBindings
  )) {
    const producerNode = nodesById.get(producerId);
    if (!producerNode || producerNode.type !== 'Producer') {
      continue;
    }

    for (const [inputName, candidates] of Object.entries(bindings)) {
      const inputDefinition = findProducerInputDefinition(
        inputDefinitions,
        producerNode,
        inputName
      );
      for (const candidate of candidates) {
        categories.set(
          inputConditionKey(producerId, candidate.sourceId),
          classifyInputDefinition(inputDefinition)
        );
      }
    }
  }

  for (const edge of canonical.edges) {
    if (!edge.conditions) {
      continue;
    }

    const target = nodesById.get(edge.to);
    if (!target) {
      continue;
    }

    if (target.type === 'Producer') {
      const key = inputConditionKey(target.id, edge.from);
      if (!categories.has(key)) {
        categories.set(
          key,
          'activation-like'
        );
      }
      continue;
    }

    if (target.type !== 'Input') {
      continue;
    }

    const producerNode = findInputOwnerProducer(canonical, target);
    if (!producerNode) {
      continue;
    }

    const key = inputConditionKey(producerNode.id, edge.from);
    if (!categories.has(key)) {
      categories.set(
        key,
        classifyInputNode(target)
      );
    }
  }

  return categories;
}

function classifyCanonicalConditionTarget(
  targetId: string,
  nodesById: Map<string, CanonicalBlueprint['nodes'][number]>
): ConditionSurfaceCategory {
  const target = nodesById.get(targetId);

  if (!target) {
    return 'other';
  }

  if (target.type === 'Input') {
    return classifyInputNode(target);
  }

  if (target.type === 'Producer') {
    return 'activation-like';
  }

  return 'other';
}

function classifyInputNode(
  node: CanonicalBlueprint['nodes'][number]
): ConditionSurfaceCategory {
  if (node.type !== 'Input') {
    return 'other';
  }

  if (node.input?.fanIn) {
    return 'fan-in';
  }

  if (node.input?.required === false) {
    return 'optional-input';
  }

  return 'activation-like';
}

function classifyInputDefinition(
  input: BlueprintInputDefinition | undefined
): ConditionSurfaceCategory {
  if (!input) {
    return 'other';
  }

  if (input.fanIn) {
    return 'fan-in';
  }

  if (input.required === false) {
    return 'optional-input';
  }

  return 'activation-like';
}

function findProducerInputDefinition(
  inputDefinitions: Map<string, BlueprintInputDefinition>,
  producerNode: CanonicalBlueprint['nodes'][number],
  inputName: string
): BlueprintInputDefinition | undefined {
  return inputDefinitions.get(
    treeInputKey(producerNode.namespacePath, inputName)
  );
}

function findInputOwnerProducer(
  canonical: CanonicalBlueprint,
  inputNode: CanonicalBlueprint['nodes'][number]
): CanonicalBlueprint['nodes'][number] | undefined {
  return canonical.nodes.find(
    (node) =>
      node.type === 'Producer' &&
      arraysEqual([...node.namespacePath, node.name], inputNode.namespacePath) &&
      shallowEqualRecords(node.indices, inputNode.indices)
  );
}

function countCategories(
  items: Array<{ category: ConditionSurfaceCategory }>
): Record<ConditionSurfaceCategory, number> {
  const counts: Record<ConditionSurfaceCategory, number> = {
    'activation-like': 0,
    'optional-input': 0,
    'fan-in': 0,
    'output-route': 0,
    other: 0,
  };

  for (const item of items) {
    counts[item.category] += 1;
  }

  return counts;
}

function inputConditionKey(producerId: string, inputId: string): string {
  return JSON.stringify({ producerId, inputId });
}

function collectInputDefinitions(
  root: BlueprintTreeNode
): Map<string, BlueprintInputDefinition> {
  const inputs = new Map<string, BlueprintInputDefinition>();

  function visit(node: BlueprintTreeNode): void {
    for (const input of node.document.inputs) {
      inputs.set(treeInputKey(node.namespacePath, input.name), input);
    }

    for (const child of node.children.values()) {
      visit(child);
    }
  }

  visit(root);
  return inputs;
}

function treeInputKey(namespacePath: string[], inputName: string): string {
  return JSON.stringify({ namespacePath, inputName });
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function shallowEqualRecords(
  left: Record<string, number>,
  right: Record<string, number>
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
}
