import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import { extractDimensionLabel } from '../resolution/dimension-plan.js';
import type {
  PlanningClipScopeControls,
  PlanningWarning,
  ProducerGraph,
} from '../types.js';

export interface ClipScopeResolution {
  selectedJobIds: Set<string>;
  upstreamJobIds: Set<string>;
  scopedJobIds: Set<string>;
  blockedJobIds: Set<string>;
  selectedIndices: number[];
  warnings: PlanningWarning[];
}

export function resolveClipScope(args: {
  producerGraph: ProducerGraph;
  scope: PlanningClipScopeControls;
}): ClipScopeResolution {
  validateClipScope(args.scope);

  const selectedIndices = resolveSelectedIndices(args.scope);
  const selectedIndexSet = new Set(selectedIndices);
  const selectedJobIds = new Set<string>();
  const availableIndices = new Set<number>();

  for (const node of args.producerGraph.nodes) {
    const clipIndex = getDimensionIndexByLabel(
      node.context?.indices,
      args.scope.dimension
    );
    if (clipIndex === undefined) {
      continue;
    }
    availableIndices.add(clipIndex);
    if (selectedIndexSet.has(clipIndex)) {
      selectedJobIds.add(node.jobId);
    }
  }

  validateSelectedIndicesExist({
    dimension: args.scope.dimension,
    selectedIndices,
    availableIndices,
  });

  const upstreamByJobId = buildUpstreamAdjacency(args.producerGraph);
  const upstreamJobIds = collectUpstreamJobs(selectedJobIds, upstreamByJobId);
  const scopedJobIds = new Set([...selectedJobIds, ...upstreamJobIds]);
  const blockedJobIds = new Set<string>();

  for (const node of args.producerGraph.nodes) {
    if (!scopedJobIds.has(node.jobId)) {
      blockedJobIds.add(node.jobId);
    }
  }

  return {
    selectedJobIds,
    upstreamJobIds,
    scopedJobIds,
    blockedJobIds,
    selectedIndices,
    warnings: [],
  };
}

function getDimensionIndexByLabel(
  indices: Record<string, number> | undefined,
  dimension: string
): number | undefined {
  if (!indices) {
    return undefined;
  }

  const matches = Object.entries(indices).filter(
    ([symbol]) => extractDimensionLabel(symbol) === dimension
  );
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length > 1) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_CLIP_SCOPE,
      `Invalid clip scope: job has multiple "${dimension}" dimensions.`,
      {
        suggestion:
          'Use a blueprint with a single clip loop axis per producer job.',
      }
    );
  }

  return matches[0]![1];
}

function validateSelectedIndicesExist(args: {
  dimension: string;
  selectedIndices: number[];
  availableIndices: Set<number>;
}): void {
  if (args.availableIndices.size === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_CLIP_SCOPE,
      `Invalid clip scope: dimension "${args.dimension}" does not exist in the producer graph.`,
      {
        suggestion:
          'Pass the exact loop dimension declared by the blueprint, or remove the clip scope.',
      }
    );
  }

  const missingIndices = args.selectedIndices.filter(
    (index) => !args.availableIndices.has(index)
  );
  if (missingIndices.length === 0) {
    return;
  }

  const available = Array.from(args.availableIndices).sort((a, b) => a - b);
  throw createRuntimeError(
    RuntimeErrorCode.INVALID_CLIP_SCOPE,
    `Invalid clip scope: dimension "${args.dimension}" does not contain selected index ${formatIndexList(
      missingIndices
    )}. Available indices: ${formatIndexList(available)}.`,
    {
      suggestion:
        'Select clip indices that exist in the structured producer graph.',
    }
  );
}

function formatIndexList(indices: number[]): string {
  return indices.join(', ');
}

function validateClipScope(scope: PlanningClipScopeControls): void {
  if (scope.dimension.trim().length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_CLIP_SCOPE,
      'Invalid clip scope: expected a non-empty loop dimension.',
      {
        suggestion:
          'Pass the explicit structured loop dimension used by the blueprint, for example "clip".',
      }
    );
  }

  if (scope.indices.length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_CLIP_SCOPE,
      'Invalid clip scope: expected at least one zero-based clip index.',
      {
        suggestion:
          'Pass one or more zero-based clip indices, for example [0] for the first clip.',
      }
    );
  }

  for (const index of scope.indices) {
    if (!Number.isInteger(index) || index < 0) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_CLIP_SCOPE,
        `Invalid clip scope index "${index}". Clip indices must be non-negative integers.`,
        {
          suggestion:
            'Convert user-facing clip numbers to zero-based indices before calling core planning.',
        }
      );
    }
  }

  if (scope.mode !== 'only' && scope.mode !== 'through') {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_CLIP_SCOPE,
      `Invalid clip scope mode "${scope.mode}". Expected "only" or "through".`,
      {
        suggestion:
          'Use mode "only" for exact clip selection, or "through" for clips from 0 through the selected maximum.',
      }
    );
  }

  if (scope.includeUpstream !== true) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_CLIP_SCOPE,
      'Invalid clip scope: includeUpstream must be true.',
      {
        suggestion:
          'The first clip-scope implementation always includes required upstream producers.',
      }
    );
  }

  if (scope.assetKinds !== undefined) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_CLIP_SCOPE,
      'Invalid clip scope: assetKinds filtering is not supported yet.',
      {
        suggestion:
          'Remove assetKinds until producers and artifacts expose explicit classification metadata.',
      }
    );
  }
}

function resolveSelectedIndices(scope: PlanningClipScopeControls): number[] {
  if (scope.mode === 'only') {
    return Array.from(new Set(scope.indices)).sort((a, b) => a - b);
  }

  const maxIndex = Math.max(...scope.indices);
  return Array.from({ length: maxIndex + 1 }, (_value, index) => index);
}

function buildUpstreamAdjacency(
  producerGraph: ProducerGraph
): Map<string, string[]> {
  const upstreamByJobId = new Map<string, string[]>();

  for (const node of producerGraph.nodes) {
    upstreamByJobId.set(node.jobId, []);
  }

  for (const edge of producerGraph.edges) {
    const upstream = upstreamByJobId.get(edge.to);
    if (!upstream) {
      continue;
    }
    upstream.push(edge.from);
  }

  return upstreamByJobId;
}

function collectUpstreamJobs(
  selectedJobIds: Set<string>,
  upstreamByJobId: Map<string, string[]>
): Set<string> {
  const upstreamJobIds = new Set<string>();
  const pending = Array.from(selectedJobIds);

  while (pending.length > 0) {
    const jobId = pending.pop()!;
    for (const upstreamJobId of upstreamByJobId.get(jobId) ?? []) {
      if (selectedJobIds.has(upstreamJobId) || upstreamJobIds.has(upstreamJobId)) {
        continue;
      }
      upstreamJobIds.add(upstreamJobId);
      pending.push(upstreamJobId);
    }
  }

  return upstreamJobIds;
}
