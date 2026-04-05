import {
  isCanonicalArtifactId,
  isCanonicalProducerId,
} from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type {
  ProducerDirective,
  ProducerGraph,
  ProducerOverrides,
  ProducerRunSummary,
} from '../types.js';

interface ProducerFamily {
  producerId: string;
  jobIds: string[];
  maxSelectableCount: number;
  firstDimensionValues: number[];
  jobFirstIndex: Map<string, number>;
  upstreamProducerIds: string[];
}

export interface NormalizedProducerDirective {
  producerId: string;
  count: number;
  maxSelectableCount: number;
  selectedFirstDimensions: number[];
  selectedJobIds: string[];
}

export interface NormalizedProducerOverrides {
  directives: NormalizedProducerDirective[];
  blockedProducerJobIds: string[];
  cappedProducerJobIds: string[];
  families: ProducerFamily[];
}

export function parseProducerDirectiveToken(token: string): ProducerDirective {
  const value = token.trim();
  const match = value.match(/^(Producer:[^:\s]+?):(-?\d+)$/);
  if (!match) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_PRODUCER_OVERRIDE_FORMAT,
      `Invalid --producer-id/--pid value "${token}". Expected Producer:Alias:<count>.`,
      {
        context: `producerOverride=${token}`,
        suggestion:
          'Use canonical producer IDs with explicit counts, for example Producer:AudioProducer:1 or Producer:AudioProducer:0.',
      }
    );
  }

  const producerId = match[1]!;
  if (!isCanonicalProducerId(producerId) || producerId.includes('[')) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_PRODUCER_OVERRIDE_FORMAT,
      `Invalid --producer-id/--pid producer ID "${producerId}". Expected canonical Producer:Alias without index selectors.`,
      {
        context: `producerId=${producerId}`,
        suggestion:
          'Use canonical producer IDs, for example Producer:AudioProducer.',
      }
    );
  }

  const countText = match[2]!;
  const count = Number.parseInt(countText, 10);
  if (!Number.isInteger(count) || count < 0) {
    throw createRuntimeError(
      RuntimeErrorCode.PRODUCER_OVERRIDE_INVALID_COUNT,
      `Invalid --producer-id/--pid count "${countText}" for ${producerId}. Count must be an integer >= 0.`,
      {
        context: `producerId=${producerId}`,
        suggestion:
          'Use 0 to disable the producer family, or a positive integer to cap first-dimension count.',
      }
    );
  }

  return {
    producerId,
    count,
  };
}

export function normalizeProducerOverrides(args: {
  producerGraph: ProducerGraph;
  overrides?: ProducerOverrides;
}): NormalizedProducerOverrides {
  const families = buildProducerFamilies(args.producerGraph);
  const familyById = new Map(
    families.map((family) => [family.producerId, family])
  );
  const directivesInput = args.overrides?.directives ?? [];

  const seenProducerIds = new Set<string>();
  const directives: NormalizedProducerDirective[] = [];

  for (const directive of directivesInput) {
    if (!isCanonicalProducerId(directive.producerId)) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_PRODUCER_OVERRIDE_FORMAT,
        `Invalid producer directive ID "${directive.producerId}". Expected canonical Producer:... ID.`,
        {
          context: `producerId=${directive.producerId}`,
          suggestion:
            'Use canonical producer IDs, for example Producer:AudioProducer.',
        }
      );
    }

    if (directive.producerId.includes('[')) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_PRODUCER_OVERRIDE_FORMAT,
        `Producer directive ID "${directive.producerId}" must target a producer family, not an indexed job ID.`,
        {
          context: `producerId=${directive.producerId}`,
          suggestion:
            'Use canonical producer family IDs, for example Producer:AudioProducer.',
        }
      );
    }

    if (seenProducerIds.has(directive.producerId)) {
      throw createRuntimeError(
        RuntimeErrorCode.DUPLICATE_PRODUCER_OVERRIDE,
        `Duplicate producer directive for "${directive.producerId}".`,
        {
          context: `producerId=${directive.producerId}`,
          suggestion:
            'Specify each producer directive only once per plan request.',
        }
      );
    }
    seenProducerIds.add(directive.producerId);

    const family = familyById.get(directive.producerId);
    if (!family) {
      throw createRuntimeError(
        RuntimeErrorCode.UNKNOWN_PRODUCER_OVERRIDE_TARGET,
        `Producer directive target "${directive.producerId}" was not found in the current producer graph.`,
        {
          context: `producerId=${directive.producerId}`,
          suggestion:
            'Check the canonical producer ID against the current blueprint graph.',
        }
      );
    }

    if (!Number.isInteger(directive.count)) {
      throw createRuntimeError(
        RuntimeErrorCode.PRODUCER_OVERRIDE_INVALID_COUNT,
        `Producer directive count for "${directive.producerId}" must be an integer.`,
        {
          context: `producerId=${directive.producerId}`,
          suggestion:
            `Use an integer count between 0 and ${family.maxSelectableCount}.`,
        }
      );
    }

    if (directive.count < 0 || directive.count > family.maxSelectableCount) {
      throw createRuntimeError(
        RuntimeErrorCode.PRODUCER_OVERRIDE_INVALID_COUNT,
        `Producer directive count for "${directive.producerId}" must be between 0 and ${family.maxSelectableCount}.`,
        {
          context: `producerId=${directive.producerId}`,
          suggestion:
            `Use 0 to disable, or a value between 1 and ${family.maxSelectableCount} to cap scheduling.`,
        }
      );
    }

    const selectedFirstDimensions =
      directive.count === 0
        ? []
        : family.firstDimensionValues.slice(0, directive.count);
    const selectedDimensionSet = new Set(selectedFirstDimensions);
    const selectedJobIds =
      directive.count === 0
        ? []
        : family.jobIds.filter((jobId) =>
            selectedDimensionSet.has(family.jobFirstIndex.get(jobId) ?? 0)
          );

    directives.push({
      producerId: directive.producerId,
      count: directive.count,
      maxSelectableCount: family.maxSelectableCount,
      selectedFirstDimensions,
      selectedJobIds,
    });
  }

  const blockedProducerJobIdsSet = new Set<string>();
  const cappedProducerJobIdsSet = new Set<string>();

  for (const directive of directives) {
    const family = familyById.get(directive.producerId);
    if (!family) {
      continue;
    }

    if (directive.count === 0) {
      for (const jobId of family.jobIds) {
        blockedProducerJobIdsSet.add(jobId);
      }
      continue;
    }

    if (directive.count >= family.maxSelectableCount) {
      continue;
    }

    const selectedJobSet = new Set(directive.selectedJobIds);
    for (const jobId of family.jobIds) {
      if (selectedJobSet.has(jobId)) {
        continue;
      }
      blockedProducerJobIdsSet.add(jobId);
      cappedProducerJobIdsSet.add(jobId);
    }
  }

  return {
    directives,
    blockedProducerJobIds: Array.from(blockedProducerJobIdsSet),
    cappedProducerJobIds: Array.from(cappedProducerJobIdsSet),
    families,
  };
}

export function buildProducerSchedulingSummary(args: {
  normalizedOverrides: NormalizedProducerOverrides;
  scheduledJobIds: Set<string>;
}): ProducerRunSummary[] {
  const overrideByProducer = new Map(
    args.normalizedOverrides.directives.map((directive) => [
      directive.producerId,
      directive,
    ])
  );

  return args.normalizedOverrides.families
    .map((family) => {
      const directive = overrideByProducer.get(family.producerId);
      const scheduledFamilyJobs = family.jobIds.filter((jobId) =>
        args.scheduledJobIds.has(jobId)
      );
      const scheduledCount = uniqueCount(
        scheduledFamilyJobs.map((jobId) => family.jobFirstIndex.get(jobId) ?? 0)
      );

      const mode =
        directive === undefined
          ? 'inherit'
          : directive.count === 0
            ? 'disabled'
            : 'capped';
      const effectiveCountLimit =
        directive === undefined ? null : directive.count;

      return {
        producerId: family.producerId,
        mode,
        maxSelectableCount: family.maxSelectableCount,
        effectiveCountLimit,
        scheduledCount,
        scheduledJobCount: scheduledFamilyJobs.length,
        upstreamProducerIds: family.upstreamProducerIds,
        warnings: [],
        ...(directive
          ? {
              appliedDirective: {
                count: directive.count,
              },
            }
          : {}),
      } satisfies ProducerRunSummary;
    })
    .sort((a, b) => a.producerId.localeCompare(b.producerId));
}

export function deriveProducerFamilyId(jobId: string): string {
  if (!isCanonicalProducerId(jobId)) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_PRODUCER_OVERRIDE_FORMAT,
      `Expected canonical producer job ID (Producer:...), received "${jobId}".`,
      {
        context: `jobId=${jobId}`,
      }
    );
  }

  const body = jobId.slice('Producer:'.length);
  return `Producer:${body.replace(/\[\d+\]/g, '')}`;
}

function uniqueCount(values: number[]): number {
  return new Set(values).size;
}

function buildProducerFamilies(producerGraph: ProducerGraph): ProducerFamily[] {
  const familyBuilders = new Map<
    string,
    {
      jobIds: string[];
      firstDimensionValues: Set<number>;
      jobFirstIndex: Map<string, number>;
      upstreamProducerIds: Set<string>;
    }
  >();

  const artifactProducer = new Map<string, string>();
  for (const node of producerGraph.nodes) {
    for (const artifactId of node.produces) {
      if (isCanonicalArtifactId(artifactId)) {
        artifactProducer.set(artifactId, node.jobId);
      }
    }
  }

  const nodeById = new Map(producerGraph.nodes.map((node) => [node.jobId, node]));

  for (const node of producerGraph.nodes) {
    const producerId = deriveProducerFamilyId(node.jobId);
    const firstIndex = extractFirstIndex(node.jobId);

    let builder = familyBuilders.get(producerId);
    if (!builder) {
      builder = {
        jobIds: [],
        firstDimensionValues: new Set<number>(),
        jobFirstIndex: new Map<string, number>(),
        upstreamProducerIds: new Set<string>(),
      };
      familyBuilders.set(producerId, builder);
    }

    builder.jobIds.push(node.jobId);
    builder.firstDimensionValues.add(firstIndex);
    builder.jobFirstIndex.set(node.jobId, firstIndex);

    const upstreamArtifactInputs = collectArtifactInputs(node);
    for (const artifactId of upstreamArtifactInputs) {
      const upstreamJobId = artifactProducer.get(artifactId);
      if (!upstreamJobId) {
        continue;
      }
      const upstreamProducerId = deriveProducerFamilyId(upstreamJobId);
      if (upstreamProducerId !== producerId) {
        builder.upstreamProducerIds.add(upstreamProducerId);
      }
    }
  }

  const families: ProducerFamily[] = [];
  for (const [producerId, builder] of familyBuilders) {
    const jobIds = builder.jobIds
      .filter((jobId) => nodeById.has(jobId))
      .sort(compareProducerJobIds);
    const firstDimensionValues = Array.from(builder.firstDimensionValues).sort(
      (a, b) => a - b
    );
    const maxSelectableCount = Math.max(1, firstDimensionValues.length);

    families.push({
      producerId,
      jobIds,
      maxSelectableCount,
      firstDimensionValues,
      jobFirstIndex: builder.jobFirstIndex,
      upstreamProducerIds: Array.from(builder.upstreamProducerIds).sort(),
    });
  }

  return families.sort((a, b) => a.producerId.localeCompare(b.producerId));
}

function collectArtifactInputs(node: ProducerGraph['nodes'][number]): string[] {
  const artifactInputs = new Set<string>();
  for (const inputId of node.inputs) {
    if (isCanonicalArtifactId(inputId)) {
      artifactInputs.add(inputId);
    }
  }

  const fanIn = node.context?.fanIn;
  if (fanIn) {
    for (const spec of Object.values(fanIn)) {
      for (const member of spec.members) {
        if (isCanonicalArtifactId(member.id)) {
          artifactInputs.add(member.id);
        }
      }
    }
  }

  return Array.from(artifactInputs);
}

function compareProducerJobIds(a: string, b: string): number {
  const indicesA = extractAllIndices(a);
  const indicesB = extractAllIndices(b);
  const maxLength = Math.max(indicesA.length, indicesB.length);

  for (let index = 0; index < maxLength; index += 1) {
    const valueA = indicesA[index] ?? -1;
    const valueB = indicesB[index] ?? -1;
    if (valueA !== valueB) {
      return valueA - valueB;
    }
  }

  return a.localeCompare(b);
}

function extractFirstIndex(jobId: string): number {
  const indices = extractAllIndices(jobId);
  return indices[0] ?? 0;
}

function extractAllIndices(jobId: string): number[] {
  const matches = Array.from(jobId.matchAll(/\[(\d+)\]/g));
  return matches.map((match) => Number.parseInt(match[1]!, 10));
}
