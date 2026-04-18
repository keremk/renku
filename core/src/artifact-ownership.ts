import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';
import type {
  ArtifactEvent,
  BuildState,
  BuildStateArtifactEntry,
  ProducerGraph,
} from './types.js';

export interface ArtifactOwnership {
  producerJobId: string;
  producerId: string;
}

export function buildArtifactOwnershipIndex(
  producerGraph: ProducerGraph
): Map<string, ArtifactOwnership> {
  const ownershipByArtifactId = new Map<string, ArtifactOwnership>();

  for (const node of producerGraph.nodes) {
    const producerId = node.context?.producerId;
    if (!producerId) {
      throw createRuntimeError(
        RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
        `Producer job ${node.jobId} is missing its canonical producerId.`,
        {
          context: `jobId=${node.jobId}`,
          suggestion:
            'Ensure the producer graph includes canonical producer ownership for every scheduled job.',
        }
      );
    }

    for (const artifactId of node.produces) {
      const nextOwnership: ArtifactOwnership = {
        producerJobId: node.jobId,
        producerId,
      };
      const existing = ownershipByArtifactId.get(artifactId);
      if (
        existing &&
        (existing.producerJobId !== nextOwnership.producerJobId ||
          existing.producerId !== nextOwnership.producerId)
      ) {
        throw createRuntimeError(
          RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
          `Artifact ${artifactId} has conflicting ownership in the current producer graph.`,
          {
            context: `artifactId=${artifactId}`,
            suggestion:
              'Fix the blueprint/job graph so each artifact resolves to exactly one canonical producer ownership pair.',
          }
        );
      }
      ownershipByArtifactId.set(artifactId, nextOwnership);
    }
  }

  return ownershipByArtifactId;
}

export function resolveArtifactOwnershipFromEvent(args: {
  artifactId: string;
  event: Pick<ArtifactEvent, 'producerJobId' | 'producerId'>;
  context: string;
}): ArtifactOwnership {
  return requireArtifactOwnership({
    artifactId: args.artifactId,
    producerJobId: args.event.producerJobId,
    producerId: args.event.producerId,
    context: args.context,
  });
}

export function resolveArtifactOwnershipFromBuildStateEntry(args: {
  artifactId: string;
  entry: Pick<BuildStateArtifactEntry, 'producerJobId' | 'producerId'>;
  context: string;
}): ArtifactOwnership {
  return requireArtifactOwnership({
    artifactId: args.artifactId,
    producerJobId: args.entry.producerJobId,
    producerId: args.entry.producerId,
    context: args.context,
  });
}

export function resolveArtifactOwnershipFromGraph(args: {
  artifactId: string;
  ownershipByArtifactId: Map<string, ArtifactOwnership>;
  context: string;
}): ArtifactOwnership {
  const ownership = args.ownershipByArtifactId.get(args.artifactId);
  if (!ownership) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
      `Artifact ${args.artifactId} is missing explicit ownership in the current producer graph.`,
      {
        context: args.context,
        suggestion:
          'Bind the artifact to a declared producer output instead of inferring ownership later.',
      }
    );
  }
  return ownership;
}

export function resolveArtifactOwnershipFromState(args: {
  artifactId: string;
  buildState?: BuildState;
  latestById?: Map<string, ArtifactEvent>;
  context: string;
}): ArtifactOwnership {
  const entry = args.buildState?.artifacts[args.artifactId];
  if (entry) {
    return resolveArtifactOwnershipFromBuildStateEntry({
      artifactId: args.artifactId,
      entry,
      context: args.context,
    });
  }

  const latestEvent = args.latestById?.get(args.artifactId);
  if (latestEvent) {
    return resolveArtifactOwnershipFromEvent({
      artifactId: args.artifactId,
      event: latestEvent,
      context: args.context,
    });
  }

  throw createRuntimeError(
    RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
    `Artifact ${args.artifactId} has no explicit ownership in build state or event history.`,
    {
      context: args.context,
      suggestion:
        'Repair the artifact history or current build state before editing, restoring, or overriding this artifact.',
    }
  );
}

export function requireArtifactOwnership(args: {
  artifactId: string;
  producerJobId?: string;
  producerId?: string;
  context: string;
}): ArtifactOwnership {
  if (!args.producerJobId) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
      `Artifact ${args.artifactId} is missing producerJobId ownership.`,
      {
        context: args.context,
        suggestion:
          'Persist the exact producer job instance for every artifact event instead of writing partial ownership.',
      }
    );
  }

  if (!args.producerId) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
      `Artifact ${args.artifactId} is missing producerId ownership.`,
      {
        context: args.context,
        suggestion:
          'Persist the canonical producer node ID for every artifact event instead of inferring it later.',
      }
    );
  }

  return {
    producerJobId: args.producerJobId,
    producerId: args.producerId,
  };
}
