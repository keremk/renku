import {
  collectConditionArtifactIds,
  evaluateCondition,
} from '../condition-evaluator.js';
import { isCanonicalArtifactId } from '../parsing/canonical-ids.js';
import type { EdgeConditionDefinition } from '../types.js';

export interface ConditionedOutputBinding {
  sourceId: string;
  conditions?: EdgeConditionDefinition;
  indices?: Record<string, number>;
}

export interface OutputPublicationContext {
  resolvedArtifacts: Record<string, unknown>;
  resolvedInputs?: Record<string, unknown>;
  hasProducedStoryState?: boolean;
}

export function filterActiveOutputBindings<T extends ConditionedOutputBinding>(
  bindings: T[],
  context: OutputPublicationContext,
): T[] {
  return bindings.filter((binding) => isOutputBindingActive(binding, context));
}

export function collectPublishedArtifactIds(
  bindings: ConditionedOutputBinding[],
  context: OutputPublicationContext,
): Set<string> {
  const published = new Set<string>();

  for (const binding of bindings) {
    if (!isCanonicalArtifactId(binding.sourceId)) {
      continue;
    }
    if (isOutputBindingActive(binding, context)) {
      published.add(binding.sourceId);
    }
  }

  return published;
}

export function collectOutputBindingConditionArtifactIds(
  bindings: ConditionedOutputBinding[],
): string[] {
  const artifactIds = new Set<string>();

  for (const binding of bindings) {
    if (!binding.conditions) {
      continue;
    }
    for (const artifactId of collectConditionArtifactIds(
      binding.conditions,
      binding.indices ?? {},
    )) {
      artifactIds.add(artifactId);
    }
  }

  return Array.from(artifactIds);
}

export function isOutputBindingActive(
  binding: ConditionedOutputBinding,
  context: OutputPublicationContext,
): boolean {
  if (!binding.conditions) {
    return true;
  }

  const result = evaluateCondition(binding.conditions, binding.indices ?? {}, {
    resolvedArtifacts: context.resolvedArtifacts,
    resolvedInputs: context.resolvedInputs,
  });
  if (result.satisfied) {
    return true;
  }

  if (
    context.hasProducedStoryState &&
    typeof result.reason === 'string' &&
    result.reason.startsWith('Artifact not found')
  ) {
    return true;
  }

  return false;
}
