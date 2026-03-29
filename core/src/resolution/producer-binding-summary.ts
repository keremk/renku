import type { BlueprintTreeNode } from '../types.js';
import { isSystemInputName } from '../execution/system-inputs.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';

export type BindingSourceKind = 'input' | 'artifact';

export interface ProducerBindingEntry {
  aliasBase: string;
  explicitNumericAlias?: string;
  sourceCanonicalId: string;
  sourceKind: BindingSourceKind;
}

export interface ProducerBindingSummary {
  resolvedInputs: Record<string, unknown>;
  mappingInputBindings: Record<string, string>;
  connectedAliases: Set<string>;
  aliasSources: Map<string, Set<BindingSourceKind>>;
}

type ResolvedEndpointType = 'input' | 'producer' | 'output';

interface ResolvedEndpoint {
  type: ResolvedEndpointType;
  producer?: string;
}

export function collectProducerBindingEntries(
  root: BlueprintTreeNode,
  producerId: string
): ProducerBindingEntry[] {
  const entries: ProducerBindingEntry[] = [];

  const visitNode = (node: BlueprintTreeNode): void => {
    const inputNames = new Set(node.document.inputs.map((input) => input.name));
    const producerNames = new Set([
      ...node.document.producerImports.map(
        (producerImport) => producerImport.name
      ),
      ...node.document.producers.map((producer) => producer.name),
    ]);
    const artifactNames = new Set(
      node.document.artefacts.map((artifact) => artifact.name)
    );

    for (const edge of node.document.edges) {
      const source = resolveEndpointReference(
        edge.from,
        inputNames,
        producerNames,
        artifactNames,
        'source',
        producerId
      );
      const target = resolveEndpointReference(
        edge.to,
        inputNames,
        producerNames,
        artifactNames,
        'target',
        producerId
      );

      if (target.type !== 'producer' || !target.producer) {
        continue;
      }

      const targetAlias = parseTargetAlias(edge.to, producerId);
      if (!targetAlias) {
        continue;
      }

      const sourceKind: BindingSourceKind =
        source.type === 'input' ? 'input' : 'artifact';
      const sourceCanonicalId =
        sourceKind === 'input'
          ? formatInputCanonicalId(edge.from)
          : formatArtifactCanonicalId(edge.from);

      entries.push({
        aliasBase: targetAlias.baseAlias,
        explicitNumericAlias: targetAlias.explicitNumericAlias,
        sourceCanonicalId,
        sourceKind,
      });
    }

    for (const child of node.children.values()) {
      visitNode(child);
    }
  };

  visitNode(root);
  return entries;
}

export function buildProducerBindingSummary(args: {
  root: BlueprintTreeNode;
  producerId: string;
  inputs?: Record<string, unknown>;
}): ProducerBindingSummary {
  const entries = collectProducerBindingEntries(args.root, args.producerId);

  const resolvedInputs: Record<string, unknown> = {};
  const mappingInputBindings: Record<string, string> = {};
  const connectedAliases = new Set<string>();
  const aliasSources = new Map<string, Set<BindingSourceKind>>();
  const seenPerBaseAlias = new Map<string, number>();

  for (const entry of entries) {
    const mappedAlias = nextMappedAlias(entry.aliasBase, seenPerBaseAlias);
    mappingInputBindings[mappedAlias] = entry.sourceCanonicalId;
    connectedAliases.add(mappedAlias);
    upsertAliasSource(aliasSources, mappedAlias, entry.sourceKind);

    if (entry.explicitNumericAlias) {
      mappingInputBindings[entry.explicitNumericAlias] =
        entry.sourceCanonicalId;
      connectedAliases.add(entry.explicitNumericAlias);
      upsertAliasSource(
        aliasSources,
        entry.explicitNumericAlias,
        entry.sourceKind
      );
    }

    if (entry.sourceKind !== 'input' || !args.inputs) {
      continue;
    }

    const value = resolveInputValue(args.inputs, entry.sourceCanonicalId);
    if (value === undefined) {
      continue;
    }

    resolvedInputs[entry.sourceCanonicalId] = value;
  }

  return {
    resolvedInputs,
    mappingInputBindings,
    connectedAliases,
    aliasSources,
  };
}

function resolveEndpointReference(
  reference: string,
  inputNames: Set<string>,
  producerNames: Set<string>,
  artifactNames: Set<string>,
  endpointRole: 'source' | 'target',
  producerId: string
): ResolvedEndpoint {
  const parts = reference.split('.');

  if (parts.length === 1) {
    const rawName = parts[0] ?? '';
    const normalizedName = stripAllSelectors(rawName);

    if (inputNames.has(normalizedName) || isSystemInputName(normalizedName)) {
      return { type: 'input' };
    }

    if (producerNames.has(normalizedName)) {
      return { type: 'producer', producer: rawName };
    }

    if (artifactNames.has(normalizedName)) {
      return { type: 'output' };
    }

    throw createRuntimeError(
      RuntimeErrorCode.INVALID_REFERENCE,
      `Unable to resolve ${endpointRole} endpoint "${reference}" while collecting producer bindings for "${producerId}".`
    );
  }

  const first = parts[0] ?? '';
  if (first === 'Input') {
    return { type: 'input' };
  }
  if (first === 'Output' || first === 'Artifact') {
    return { type: 'output' };
  }

  const normalizedFirst = stripAllSelectors(first);
  if (producerNames.has(normalizedFirst)) {
    return { type: 'producer', producer: first };
  }

  if (inputNames.has(normalizedFirst) || isSystemInputName(normalizedFirst)) {
    return { type: 'input' };
  }

  if (artifactNames.has(normalizedFirst)) {
    return { type: 'output' };
  }

  throw createRuntimeError(
    RuntimeErrorCode.INVALID_REFERENCE,
    `Unable to resolve ${endpointRole} endpoint "${reference}" while collecting producer bindings for "${producerId}".`
  );
}

function parseTargetAlias(
  targetRef: string,
  producerId: string
): { baseAlias: string; explicitNumericAlias?: string } | null {
  const parts = targetRef.split('.');
  if (parts.length < 2) {
    return null;
  }

  const producerSegment = parts[0] ?? '';
  const producerBase = stripAllSelectors(producerSegment);
  if (producerBase !== producerId) {
    return null;
  }

  const aliasSegment = parts[1] ?? '';
  const baseAlias = stripAllSelectors(aliasSegment);
  if (!baseAlias) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_INPUT_BINDING,
      `Invalid producer binding target for ${producerId}: ${targetRef}`
    );
  }

  const selectorSuffix = aliasSegment.match(/(\[[^\]]+])+$/)?.[0];
  if (!selectorSuffix) {
    return { baseAlias };
  }

  if (!/^(\[\d+])+$/.test(selectorSuffix)) {
    return { baseAlias };
  }

  return {
    baseAlias,
    explicitNumericAlias: `${baseAlias}${selectorSuffix}`,
  };
}

function stripAllSelectors(value: string): string {
  return value.replace(/(\[[^\]]+])+$/, '');
}

function nextMappedAlias(
  aliasBase: string,
  seenPerBaseAlias: Map<string, number>
): string {
  const seen = seenPerBaseAlias.get(aliasBase) ?? 0;
  seenPerBaseAlias.set(aliasBase, seen + 1);
  if (seen === 0) {
    return aliasBase;
  }
  return `${aliasBase}[${seen}]`;
}

function upsertAliasSource(
  aliasSources: Map<string, Set<BindingSourceKind>>,
  alias: string,
  sourceKind: BindingSourceKind
): void {
  const existing = aliasSources.get(alias);
  if (existing) {
    existing.add(sourceKind);
    return;
  }
  aliasSources.set(alias, new Set([sourceKind]));
}

function resolveInputValue(
  inputs: Record<string, unknown>,
  sourceCanonicalId: string
): unknown {
  if (sourceCanonicalId in inputs) {
    return inputs[sourceCanonicalId];
  }

  const inputName = sourceCanonicalId.startsWith('Input:')
    ? sourceCanonicalId.slice('Input:'.length)
    : sourceCanonicalId;

  if (inputName in inputs) {
    return inputs[inputName];
  }

  return undefined;
}

function formatInputCanonicalId(sourceRef: string): string {
  if (sourceRef.startsWith('Input:')) {
    return sourceRef;
  }
  const normalized = sourceRef.replace(/^Input\./, '');
  return `Input:${normalized}`;
}

function formatArtifactCanonicalId(sourceRef: string): string {
  if (sourceRef.startsWith('Artifact:')) {
    return sourceRef;
  }

  const normalized = sourceRef.replace(/^Output\./, '');
  return `Artifact:${normalized}`;
}
