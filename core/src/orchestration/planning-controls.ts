import {
  isCanonicalArtifactId,
  isCanonicalProducerId,
} from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type {
  ArtifactRegenerationConfig,
  ArtefactEvent,
  Manifest,
  PlanningUserControls,
  PlanningWarning,
  ProducerDirective,
  ProducerGraph,
  ProducerRunSummary,
  ResolvedPlanningControls,
} from '../types.js';
import { computeMultipleArtifactRegenerationJobs } from '../planning/planner.js';
import { computeTopologyLayers } from '../topology/index.js';
import {
  buildProducerSchedulingSummary,
  deriveProducerFamilyId,
  normalizeProducerOverrides,
  type NormalizedProducerOverrides,
} from './producer-overrides.js';

export interface LatestArtifactSnapshot {
  latestById: Map<string, ArtefactEvent>;
  latestSuccessfulIds: Set<string>;
  latestFailedIds: Set<string>;
}

interface MergedPlanningControls {
  upToLayer?: number;
  producerDirectives?: ProducerDirective[];
  regenerateIds?: string[];
  pinIds?: string[];
}

export interface PlanningControlsResolution extends ResolvedPlanningControls {
  normalizedOverrides: NormalizedProducerOverrides;
  artifactRegenerations?: ArtifactRegenerationConfig[];
}

export function resolvePlanningControls(args: {
  producerGraph: ProducerGraph;
  baselineInputs: {
    upToLayer?: number;
    regenerateIds?: string[];
    pinIds?: string[];
  };
  userControls?: PlanningUserControls;
  latestSnapshot: LatestArtifactSnapshot;
  manifest: Manifest;
}): PlanningControlsResolution {
  const merged = mergePlanningControls(args.baselineInputs, args.userControls);
  const warnings: PlanningWarning[] = [];
  const layerByJobId = buildJobLayerMap(args.producerGraph);
  const effectiveUpToLayer = merged.upToLayer;

  const baseNormalizedOverrides = normalizeProducerOverrides({
    producerGraph: args.producerGraph,
    overrides:
      merged.producerDirectives && merged.producerDirectives.length > 0
        ? { directives: merged.producerDirectives }
        : undefined,
  });

  const directivesInScope: ProducerDirective[] = [];
  for (const directive of merged.producerDirectives ?? []) {
    if (effectiveUpToLayer === undefined) {
      directivesInScope.push(directive);
      continue;
    }
    const family = baseNormalizedOverrides.families.find(
      (item) => item.producerId === directive.producerId
    );
    if (!family) {
      continue;
    }
    const hasAnyJobInScope = family.jobIds.some((jobId) => {
      const layer = layerByJobId.get(jobId);
      return layer !== undefined && layer <= effectiveUpToLayer;
    });
    if (hasAnyJobInScope) {
      directivesInScope.push(directive);
      continue;
    }
    warnings.push({
      code: 'CONTROL_DIRECTIVE_OUT_OF_SCOPE',
      control: 'directive',
      targetId: directive.producerId,
      message:
        `Ignored producer directive for ${directive.producerId} because it is outside --up=${effectiveUpToLayer}.`,
    });
  }

  const normalizedOverrides = normalizeProducerOverrides({
    producerGraph: args.producerGraph,
    overrides:
      directivesInScope.length > 0
        ? { directives: directivesInScope }
        : undefined,
  });
  const blockedJobIds = new Set(normalizedOverrides.blockedProducerJobIds);

  const regenerationIds = normalizeCanonicalTargetIds(
    merged.regenerateIds,
    'regenerate'
  );
  const pinIds = normalizeCanonicalTargetIds(merged.pinIds, 'pin');

  const overlappingTargets = regenerationIds.filter((id) => pinIds.includes(id));
  if (overlappingTargets.length > 0) {
    throw createRuntimeError(
      RuntimeErrorCode.PLANNING_CONFLICT_REGEN_PIN,
      `Conflicting planning controls: the same target cannot be both regenerated and pinned (${overlappingTargets.join(', ')}).`,
      {
        suggestion:
          'Remove the conflicting target from either --regen or --pin.',
      }
    );
  }

  const forceResolution = resolveForcedJobIds({
    regenerationIds,
    producerGraph: args.producerGraph,
    manifest: args.manifest,
    latestById: args.latestSnapshot.latestById,
    blockedJobIds,
    effectiveUpToLayer,
    layerByJobId,
    warnings,
  });

  const pinnedArtifactIds = resolvePinnedArtifactIds({
    pinIds,
    producerGraph: args.producerGraph,
    manifest: args.manifest,
    latestSnapshot: args.latestSnapshot,
    blockedJobIds,
    layerByJobId,
    effectiveUpToLayer,
    warnings,
  });

  return {
    effectiveUpToLayer,
    blockedProducerJobIds: normalizedOverrides.blockedProducerJobIds,
    cappedProducerJobIds: normalizedOverrides.cappedProducerJobIds,
    forcedJobIds: Array.from(forceResolution.forcedJobIds),
    pinnedArtifactIds,
    producerSummaries: buildProducerSchedulingSummary({
      normalizedOverrides,
      scheduledJobIds: new Set<string>(),
    }),
    warnings,
    normalizedOverrides,
    artifactRegenerations:
      forceResolution.artifactRegenerations.length > 0
        ? forceResolution.artifactRegenerations
        : undefined,
  };
}

export function buildResolvedProducerSummaries(args: {
  normalizedOverrides: NormalizedProducerOverrides;
  scheduledJobIds: Set<string>;
}): ProducerRunSummary[] {
  return buildProducerSchedulingSummary({
    normalizedOverrides: args.normalizedOverrides,
    scheduledJobIds: args.scheduledJobIds,
  });
}

function mergePlanningControls(
  baselineInputs: {
    upToLayer?: number;
    regenerateIds?: string[];
    pinIds?: string[];
  },
  userControls: PlanningUserControls | undefined
): MergedPlanningControls {
  return {
    upToLayer: userControls?.scope?.upToLayer ?? baselineInputs.upToLayer,
    producerDirectives: userControls?.scope?.producerDirectives,
    regenerateIds:
      userControls?.surgical?.regenerateIds ?? baselineInputs.regenerateIds,
    pinIds: userControls?.surgical?.pinIds ?? baselineInputs.pinIds,
  };
}

function normalizeCanonicalTargetIds(
  targetIds: string[] | undefined,
  control: 'regenerate' | 'pin'
): string[] {
  if (!targetIds || targetIds.length === 0) {
    return [];
  }

  const normalized: string[] = [];
  for (const rawId of targetIds) {
    const id = rawId.trim();
    if (id.length === 0) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_PIN_ID,
        `Invalid ${control} target: expected a non-empty canonical Artifact:... or Producer:... ID.`,
        {
          suggestion:
            'Use canonical IDs, for example Artifact:AudioProducer.GeneratedAudio[0] or Producer:AudioProducer.',
        }
      );
    }
    if (!isCanonicalArtifactId(id) && !isCanonicalProducerId(id)) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_PIN_ID,
        `Invalid ${control} target "${rawId}". Expected canonical Artifact:... or Producer:... ID.`,
        {
          suggestion:
            'Use canonical IDs, for example Artifact:AudioProducer.GeneratedAudio[0] or Producer:AudioProducer.',
        }
      );
    }
    normalized.push(id);
  }
  return Array.from(new Set(normalized));
}

function resolveForcedJobIds(args: {
  regenerationIds: string[];
  producerGraph: ProducerGraph;
  manifest: Manifest;
  latestById: Map<string, ArtefactEvent>;
  blockedJobIds: Set<string>;
  effectiveUpToLayer?: number;
  layerByJobId: Map<string, number>;
  warnings: PlanningWarning[];
}): {
  forcedJobIds: Set<string>;
  artifactRegenerations: ArtifactRegenerationConfig[];
} {
  if (args.regenerationIds.length === 0) {
    return {
      forcedJobIds: new Set<string>(),
      artifactRegenerations: [],
    };
  }

  const sourceJobIds = new Set<string>();
  const artifactRegenerations: ArtifactRegenerationConfig[] = [];

  for (const targetId of args.regenerationIds) {
    if (isCanonicalArtifactId(targetId)) {
      const regeneration = resolveArtifactToJob(
        targetId,
        args.manifest,
        args.producerGraph,
        args.latestById
      );
      if (
        isJobOutOfScope({
          jobId: regeneration.sourceJobId,
          blockedJobIds: args.blockedJobIds,
          effectiveUpToLayer: args.effectiveUpToLayer,
          layerByJobId: args.layerByJobId,
        })
      ) {
        args.warnings.push({
          code: 'CONTROL_REGEN_OUT_OF_SCOPE',
          control: 'regen',
          targetId,
          message:
            `Ignored regenerate target ${targetId} because its source producer is outside active scope.`,
        });
        continue;
      }
      sourceJobIds.add(regeneration.sourceJobId);
      artifactRegenerations.push(regeneration);
      continue;
    }

    const familyJobIds = resolveProducerIdsToJobs([targetId], args.producerGraph);
    const inScopeFamilyJobIds = familyJobIds.filter(
      (jobId) =>
        !isJobOutOfScope({
          jobId,
          blockedJobIds: args.blockedJobIds,
          effectiveUpToLayer: args.effectiveUpToLayer,
          layerByJobId: args.layerByJobId,
        })
    );
    if (inScopeFamilyJobIds.length === 0) {
      args.warnings.push({
        code: 'CONTROL_REGEN_OUT_OF_SCOPE',
        control: 'regen',
        targetId,
        message:
          `Ignored regenerate target ${targetId} because it is outside active scope.`,
      });
      continue;
    }
    for (const jobId of inScopeFamilyJobIds) {
      sourceJobIds.add(jobId);
    }
  }

  if (sourceJobIds.size === 0) {
    return {
      forcedJobIds: new Set<string>(),
      artifactRegenerations: [],
    };
  }

  const forcedJobs = computeMultipleArtifactRegenerationJobs(
    Array.from(sourceJobIds),
    args.producerGraph
  );

  for (const jobId of Array.from(forcedJobs)) {
    if (
      isJobOutOfScope({
        jobId,
        blockedJobIds: args.blockedJobIds,
        effectiveUpToLayer: args.effectiveUpToLayer,
        layerByJobId: args.layerByJobId,
      })
    ) {
      forcedJobs.delete(jobId);
    }
  }

  return {
    forcedJobIds: forcedJobs,
    artifactRegenerations,
  };
}

function resolvePinnedArtifactIds(args: {
  pinIds: string[];
  producerGraph: ProducerGraph;
  manifest: Manifest;
  latestSnapshot: LatestArtifactSnapshot;
  blockedJobIds: Set<string>;
  layerByJobId: Map<string, number>;
  effectiveUpToLayer?: number;
  warnings: PlanningWarning[];
}): string[] {
  if (args.pinIds.length === 0) {
    return [];
  }

  const artifactPins = new Set<string>();
  const producerPins = new Set<string>();

  for (const id of args.pinIds) {
    if (isCanonicalArtifactId(id)) {
      artifactPins.add(id);
      continue;
    }
    producerPins.add(id);
  }

  const nodeByJobId = new Map(
    args.producerGraph.nodes.map((node) => [node.jobId, node])
  );

  for (const producerId of producerPins) {
    const familyJobIds = args.producerGraph.nodes
      .map((node) => node.jobId)
      .filter((jobId) => deriveProducerFamilyId(jobId) === producerId);

    if (familyJobIds.length === 0) {
      throw createRuntimeError(
        RuntimeErrorCode.PIN_PRODUCER_NOT_FOUND,
        `Pinned producer "${producerId}" was not found in the current producer graph.`,
        {
          context: `producerId=${producerId}`,
          suggestion:
            'Check the producer canonical ID against the current blueprint graph.',
        }
      );
    }

    const producedArtifacts = familyJobIds.flatMap((jobId) => {
      const node = nodeByJobId.get(jobId);
      if (!node) {
        return [];
      }
      return node.produces.filter((artifactId) => isCanonicalArtifactId(artifactId));
    });

    if (producedArtifacts.length === 0) {
      throw createRuntimeError(
        RuntimeErrorCode.PIN_TARGET_NOT_REUSABLE,
        `Pinned producer "${producerId}" does not produce reusable canonical artifacts.`,
        {
          context: `producerId=${producerId}`,
          suggestion:
            'Pin canonical artifact IDs produced by this run, or pin a producer that emits canonical artifacts.',
        }
      );
    }

    for (const artifactId of producedArtifacts) {
      artifactPins.add(artifactId);
    }
  }

  const producerJobsByArtifact = buildProducerJobsByArtifact(args.producerGraph);
  const inScopePins: string[] = [];
  for (const artifactId of artifactPins) {
    const producerJobs = producerJobsByArtifact.get(artifactId) ?? [];
    if (producerJobs.length === 0) {
      args.warnings.push({
        code: 'CONTROL_PIN_OUT_OF_SCOPE',
        control: 'pin',
        targetId: artifactId,
        message:
          `Ignored pin target ${artifactId} because it is not produced by the current blueprint graph.`,
      });
      continue;
    }

    const hasInScopeProducer = producerJobs.some(
      (jobId) =>
        !isJobOutOfScope({
          jobId,
          blockedJobIds: args.blockedJobIds,
          effectiveUpToLayer: args.effectiveUpToLayer,
          layerByJobId: args.layerByJobId,
        })
    );
    if (!hasInScopeProducer) {
      args.warnings.push({
        code: 'CONTROL_PIN_OUT_OF_SCOPE',
        control: 'pin',
        targetId: artifactId,
        message:
          `Ignored pin target ${artifactId} because it is outside active scope.`,
      });
      continue;
    }

    inScopePins.push(artifactId);
  }

  if (inScopePins.length === 0) {
    return [];
  }

  const hasSucceededManifestArtifacts = Object.values(
    args.manifest.artefacts
  ).some((entry) => entry.status === 'succeeded');
  const hasPriorReusableArtifacts =
    hasSucceededManifestArtifacts || args.latestSnapshot.latestSuccessfulIds.size > 0;

  if (!hasPriorReusableArtifacts) {
    throw createRuntimeError(
      RuntimeErrorCode.PIN_REQUIRES_EXISTING_MOVIE,
      'Pinning requires an existing movie with reusable outputs. Use --last or --movie-id/--id after a successful run.',
      {
        suggestion:
          'Run the first generation without pin controls, then pin artifacts/producers on subsequent runs.',
      }
    );
  }

  validatePinnedTargetsReusable(inScopePins, args.manifest, args.latestSnapshot);
  return inScopePins;
}

function isJobOutOfScope(args: {
  jobId: string;
  blockedJobIds: Set<string>;
  effectiveUpToLayer?: number;
  layerByJobId: Map<string, number>;
}): boolean {
  if (args.blockedJobIds.has(args.jobId)) {
    return true;
  }
  if (args.effectiveUpToLayer === undefined) {
    return false;
  }
  const layer = args.layerByJobId.get(args.jobId);
  return layer !== undefined && layer > args.effectiveUpToLayer;
}

function buildProducerJobsByArtifact(
  producerGraph: ProducerGraph
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of producerGraph.nodes) {
    for (const artifactId of node.produces) {
      if (!isCanonicalArtifactId(artifactId)) {
        continue;
      }
      const existing = map.get(artifactId);
      if (existing) {
        existing.push(node.jobId);
      } else {
        map.set(artifactId, [node.jobId]);
      }
    }
  }
  return map;
}

function validatePinnedTargetsReusable(
  pinnedArtifactIds: string[],
  manifest: Manifest,
  latestSnapshot: LatestArtifactSnapshot
): void {
  const invalid: string[] = [];

  for (const artifactId of pinnedArtifactIds) {
    if (latestSnapshot.latestFailedIds.has(artifactId)) {
      invalid.push(`${artifactId} (latest attempt failed)`);
      continue;
    }
    if (latestSnapshot.latestSuccessfulIds.has(artifactId)) {
      continue;
    }
    const manifestEntry = manifest.artefacts[artifactId];
    if (manifestEntry?.status === 'succeeded') {
      continue;
    }
    invalid.push(`${artifactId} (no reusable successful artifact found)`);
  }

  if (invalid.length > 0) {
    throw createRuntimeError(
      RuntimeErrorCode.PIN_TARGET_NOT_REUSABLE,
      `Pinned artifact(s) are not reusable: ${invalid.join('; ')}`,
      {
        suggestion: 'Unpin these IDs or regenerate them before pinning.',
      }
    );
  }
}

function buildJobLayerMap(producerGraph: ProducerGraph): Map<string, number> {
  const nodes = producerGraph.nodes.map((node) => ({ id: node.jobId }));
  const edges = producerGraph.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
  }));
  const { layerAssignments } = computeTopologyLayers(nodes, edges);
  return layerAssignments;
}

function resolveProducerIdsToJobs(
  producerIds: string[],
  producerGraph: ProducerGraph
): string[] {
  const jobIds: string[] = [];
  const graphJobIds = producerGraph.nodes.map((node) => node.jobId);
  const seenFamilies = new Set<string>();

  for (const producerId of producerIds) {
    if (!isCanonicalProducerId(producerId) || producerId.includes('[')) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_PRODUCER_OVERRIDE_FORMAT,
        `Invalid producer regenerate target "${producerId}". Expected canonical Producer:Alias.`,
        {
          context: `producerId=${producerId}`,
          suggestion:
            'Use canonical producer IDs, for example Producer:AudioProducer.',
        }
      );
    }

    if (seenFamilies.has(producerId)) {
      continue;
    }
    seenFamilies.add(producerId);

    const familyJobIds = graphJobIds.filter(
      (jobId) => deriveProducerFamilyId(jobId) === producerId
    );
    if (familyJobIds.length === 0) {
      throw createRuntimeError(
        RuntimeErrorCode.UNKNOWN_PRODUCER_OVERRIDE_TARGET,
        `Producer regenerate target "${producerId}" was not found in the current producer graph.`,
        {
          context: `producerId=${producerId}`,
          suggestion:
            'Check the canonical producer ID against the current blueprint graph.',
        }
      );
    }
    jobIds.push(...familyJobIds);
  }

  return jobIds;
}

export function resolveArtifactsToJobs(
  artifactIds: string[],
  manifest: Manifest,
  producerGraph: { nodes: Array<{ jobId: string }> },
  latestById?: Map<string, ArtefactEvent>
): ArtifactRegenerationConfig[] {
  return artifactIds.map((id) =>
    resolveArtifactToJob(id, manifest, producerGraph, latestById)
  );
}

export function resolveArtifactToJob(
  artifactId: string,
  manifest: Manifest,
  producerGraph: { nodes: Array<{ jobId: string }> },
  latestById?: Map<string, ArtefactEvent>
): ArtifactRegenerationConfig {
  const entry = manifest.artefacts[artifactId];
  const latestEvent = latestById?.get(artifactId);
  const sourceJobId = entry?.producedBy ?? latestEvent?.producedBy;

  if (!sourceJobId) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_NOT_IN_MANIFEST,
      `Artifact "${artifactId}" not found in manifest or event log. The artifact may not have been generated yet, or the ID may be incorrect.`,
      { context: `artifactId=${artifactId}` }
    );
  }

  const jobExists = producerGraph.nodes.some((node) => node.jobId === sourceJobId);
  if (!jobExists) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_JOB_NOT_FOUND,
      `Job "${sourceJobId}" that produced artifact "${artifactId}" not found in producer graph. The blueprint structure may have changed since the artifact was generated.`,
      { context: `artifactId=${artifactId}, sourceJobId=${sourceJobId}` }
    );
  }

  return {
    targetArtifactId: artifactId,
    sourceJobId,
  };
}
