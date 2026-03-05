import type {
  ArtefactEvent,
  ExecutionPlan,
  JobResult,
  SurgicalRegenerationScope,
} from '../types.js';

export const DEFAULT_SURGICAL_REGENERATION_SCOPE: SurgicalRegenerationScope =
  'lineage-plus-dirty';

export function normalizeSurgicalRegenerationScope(
  scope: SurgicalRegenerationScope | undefined
): SurgicalRegenerationScope {
  if (scope === undefined) {
    return DEFAULT_SURGICAL_REGENERATION_SCOPE;
  }
  if (scope !== 'lineage-plus-dirty' && scope !== 'lineage-strict') {
    throw new Error(`Unsupported surgical regeneration scope: ${scope}.`);
  }
  return scope;
}

export function findSurgicalTargetLayer(
  plan: ExecutionPlan,
  targetArtifactId: string
): number {
  const matchingLayers: number[] = [];

  for (let layerIndex = 0; layerIndex < plan.layers.length; layerIndex += 1) {
    const layer = plan.layers[layerIndex] ?? [];
    if (layer.some((job) => job.produces.includes(targetArtifactId))) {
      matchingLayers.push(layerIndex);
    }
  }

  if (matchingLayers.length === 0) {
    throw new Error(
      `Surgical plan does not include a producer job for artifact ${targetArtifactId}.`
    );
  }
  if (matchingLayers.length > 1) {
    throw new Error(
      `Surgical plan contains multiple producer layers for artifact ${targetArtifactId}.`
    );
  }

  return matchingLayers[0]!;
}

export function sliceExecutionPlanThroughLayer(
  plan: ExecutionPlan,
  maxInclusiveLayer: number
): ExecutionPlan {
  if (!Number.isInteger(maxInclusiveLayer) || maxInclusiveLayer < 0) {
    throw new Error(
      `Execution plan layer index must be a non-negative integer, got ${maxInclusiveLayer}.`
    );
  }

  return {
    ...plan,
    layers: plan.layers.map((layer, layerIndex) =>
      layerIndex <= maxInclusiveLayer ? layer : []
    ),
  };
}

export function findLatestSucceededArtifactEvent(
  jobs: JobResult[],
  artifactId: string
): ArtefactEvent | null {
  for (let jobIndex = jobs.length - 1; jobIndex >= 0; jobIndex -= 1) {
    const artefacts = jobs[jobIndex]?.artefacts ?? [];
    for (
      let artefactIndex = artefacts.length - 1;
      artefactIndex >= 0;
      artefactIndex -= 1
    ) {
      const event = artefacts[artefactIndex];
      if (event.artefactId === artifactId && event.status === 'succeeded') {
        return event;
      }
    }
  }
  return null;
}
