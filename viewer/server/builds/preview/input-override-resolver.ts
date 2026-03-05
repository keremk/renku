import type { ProducerGraph } from '@gorenku/core';

export interface ResolvedInputOverrideTarget {
  inputName: string;
  canonicalId: string;
  value: string;
}

export function resolveInputOverrideTargets(args: {
  sourceJobId: string;
  producerGraph: ProducerGraph;
  inputOverrides: Record<string, string>;
}): ResolvedInputOverrideTarget[] {
  const { sourceJobId, producerGraph, inputOverrides } = args;

  const sourceNode = producerGraph.nodes.find(
    (node) => node.jobId === sourceJobId
  );
  if (!sourceNode) {
    throw new Error(
      `Cannot apply rerun input overrides because source producer job ${sourceJobId} was not found in the producer graph.`
    );
  }

  const inputBindings = sourceNode.context?.inputBindings;
  if (!inputBindings) {
    throw new Error(
      `Cannot apply rerun input overrides because producer ${sourceJobId} has no input bindings.`
    );
  }

  const mappedAliases = sourceNode.context?.sdkMapping
    ? new Set(Object.keys(sourceNode.context.sdkMapping))
    : null;

  return Object.entries(inputOverrides)
    .filter(([inputName]) => {
      if (!mappedAliases || mappedAliases.size === 0) {
        return true;
      }
      return mappedAliases.has(inputName);
    })
    .map(([inputName, value]) => {
      const canonicalId = inputBindings[inputName];
      if (!canonicalId) {
        throw new Error(
          `Cannot apply input override "${inputName}" for ${sourceJobId}: binding is missing. Available bindings: ${Object.keys(inputBindings).join(', ')}`
        );
      }

      return {
        inputName,
        canonicalId,
        value,
      };
    });
}
