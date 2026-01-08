import { isCanonicalArtifactId, isCanonicalInputId } from './canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';
import type { JobDescriptor, ProducerJobContext } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractResolvedInputs(context?: ProducerJobContext): Record<string, unknown> {
  if (!context || !context.extras) {
    return {};
  }
  const extras = context.extras;
  if (isRecord(extras.resolvedInputs)) {
    return extras.resolvedInputs as Record<string, unknown>;
  }
  return {};
}

export interface PreparedJobContext {
  resolvedInputs: Record<string, unknown>;
  context?: ProducerJobContext;
}

export function prepareJobContext(
  job: JobDescriptor,
  baseInputs: Record<string, unknown>,
): PreparedJobContext {
  const resolvedInputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(baseInputs)) {
    if (!isCanonicalInputId(key) && !isCanonicalArtifactId(key)) {
      throw createRuntimeError(
        RuntimeErrorCode.NON_CANONICAL_INPUT_ID,
        `Resolved inputs must use canonical ids. Found "${key}".`,
        { context: key },
      );
    }
    resolvedInputs[key] = value;
  }
  const jobResolved = extractResolvedInputs(job.context);
  for (const [key, value] of Object.entries(jobResolved)) {
    if (!isCanonicalInputId(key) && !isCanonicalArtifactId(key)) {
      continue;
    }
    resolvedInputs[key] = value;
  }
  const bindings = job.context?.inputBindings;
  if (bindings) {
    for (const [alias, canonicalId] of Object.entries(bindings)) {
      if (!isCanonicalInputId(canonicalId) && !isCanonicalArtifactId(canonicalId)) {
        throw createRuntimeError(
          RuntimeErrorCode.INVALID_INPUT_BINDING,
          `Input binding target must be canonical. Found "${canonicalId}" for alias "${alias}".`,
          { context: `${alias}: ${canonicalId}` },
        );
      }
    }
  }

  return {
    resolvedInputs,
    context: job.context,
  };
}
