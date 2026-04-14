import {
  collectLeafProducerReferences,
  type ExtractedModelSelection,
  type SerializableModelSelection,
  type BlueprintTreeNode,
} from '@gorenku/core';

type ModelSelectionLike =
  | SerializableModelSelection
  | ExtractedModelSelection;

interface NestedSelectionPatch {
  config: Record<string, unknown>;
  authoredEntries: string[];
}

export function normalizeNestedModelSelections<T extends ModelSelectionLike>(
  blueprintTree: BlueprintTreeNode,
  models: T[],
  sourceLabel: string
): T[] {
  const producerAliases = collectLeafProducerReferences(blueprintTree).map(
    (reference) => reference.authoredProducerId
  );
  const producerAliasSet = new Set(producerAliases);
  const selections = new Map<string, T>();
  const nestedPatches = new Map<string, NestedSelectionPatch>();

  for (const selection of models) {
    if (producerAliasSet.has(selection.producerId)) {
      selections.set(selection.producerId, selection);
      continue;
    }

    const nestedTarget = resolveNestedModelSelectionTarget(
      producerAliases,
      selection.producerId
    );
    if (!nestedTarget) {
      throw new Error(
        `Refusing to use unknown producer "${selection.producerId}" from ${sourceLabel}.`
      );
    }

    const patch = nestedPatches.get(nestedTarget.producerAlias) ?? {
      config: {},
      authoredEntries: [],
    };
    const nestedConfig = mergeConfigRecords(
      { provider: selection.provider, model: selection.model },
      selection.config ?? {}
    );
    assignNestedConfig(patch.config, nestedTarget.nestedPath, nestedConfig);
    patch.authoredEntries.push(selection.producerId);
    nestedPatches.set(nestedTarget.producerAlias, patch);
  }

  for (const [producerAlias, patch] of nestedPatches) {
    const existing = selections.get(producerAlias);
    if (!existing) {
      const authored = patch.authoredEntries[0] ?? `${producerAlias}.<nested>`;
      throw new Error(
        `Nested model selection "${authored}" requires parent producer "${producerAlias}" in models selection.`
      );
    }

    const mergedConfig = mergeConfigRecords(existing.config ?? {}, patch.config);
    selections.set(producerAlias, {
      ...existing,
      config: Object.keys(mergedConfig).length > 0 ? mergedConfig : undefined,
    });
  }

  return Array.from(selections.values());
}

function resolveNestedModelSelectionTarget(
  producerAliases: string[],
  authoredProducerId: string
): { producerAlias: string; nestedPath: string } | null {
  let bestMatch: { producerAlias: string; nestedPath: string } | null = null;

  for (const producerAlias of producerAliases) {
    const prefix = `${producerAlias}.`;
    if (!authoredProducerId.startsWith(prefix)) {
      continue;
    }

    const nestedPath = authoredProducerId.slice(prefix.length);
    if (nestedPath.length === 0) {
      continue;
    }

    if (!bestMatch || producerAlias.length > bestMatch.producerAlias.length) {
      bestMatch = { producerAlias, nestedPath };
    }
  }

  return bestMatch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeConfigRecords(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, patchValue] of Object.entries(patch)) {
    const current = merged[key];
    if (isRecord(current) && isRecord(patchValue)) {
      merged[key] = mergeConfigRecords(current, patchValue);
      continue;
    }
    merged[key] = patchValue;
  }

  return merged;
}

function assignNestedConfig(
  target: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const segments = path.split('.').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return;
  }

  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    const existing = current[segment];
    if (!isRecord(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  current[segments[segments.length - 1]!] = value;
}
