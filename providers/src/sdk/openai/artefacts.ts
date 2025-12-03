import { Buffer } from 'node:buffer';
import type { ProducedArtefact } from '@renku/core';

type JsonObject = Record<string, unknown>;

export interface ParsedArtefactIdentifier {
  kind: string;
  index?: Record<string, number>;
  ordinal?: number[];
}

/**
 * Builds artifacts from OpenAI response using canonical mapping.
 * Convention: JSON field names **must** match the canonical artefact kind
 * (PascalCase, without namespace). No heuristics or fallbacks.
 *
 * @example
 * JSON response: { MovieTitle: "...", NarrationScript: ["seg1", "seg2", "seg3"] }
 * Produces:
 *   - "Artifact:MovieTitle" → MovieTitle
 *   - "Artifact:NarrationScript[segment=0]" → NarrationScript[0]
 *   - "Artifact:NarrationScript[segment=1]" → NarrationScript[1]
 *   - "Artifact:NarrationScript[segment=2]" → NarrationScript[2]
 */
export interface BuildArtefactOptions {
  producerId?: string;
  namespaceOrdinalDepth?: number;
}

interface ArtefactExtractionContext {
  skipNamespaceOrdinals: number;
}

export function buildArtefactsFromResponse(
  response: JsonObject | string,
  produces: string[],
  options: BuildArtefactOptions = {},
): ProducedArtefact[] {
  const artefacts: ProducedArtefact[] = [];
  const jsonResponse = typeof response === 'string' ? response : response;
  const context: ArtefactExtractionContext = {
    skipNamespaceOrdinals: resolveNamespaceOrdinalDepth(options),
  };

  for (const artefactId of produces) {
    const artefact = buildSingleArtefact(jsonResponse, artefactId, context);
    artefacts.push(artefact);
  }

  return artefacts;
}

function buildSingleArtefact(
  response: JsonObject | string,
  artefactId: string,
  context: ArtefactExtractionContext,
): ProducedArtefact {
  const diagnostics: Record<string, unknown> = {};

  // For text responses, return the whole text
  if (typeof response === 'string') {
    return {
      artefactId,
      status: 'succeeded',
      blob: {
        data: response,
        mimeType: 'text/plain',
      },
      diagnostics: { responseType: 'text' },
    };
  }

  // For JSON responses, use implicit mapping
  const parsed = parseArtefactIdentifier(artefactId);
  if (!parsed) {
    return {
      artefactId,
      status: 'failed',
      diagnostics: { reason: 'invalid_artefact_id', artefactId },
    };
  }

  // Field names must match the canonical kind (without namespace)
  const kindBase = parsed.kind.includes('.')
    ? parsed.kind.slice(parsed.kind.lastIndexOf('.') + 1)
    : parsed.kind;
  const fieldName = kindBase;
  diagnostics.field = fieldName;
  diagnostics.kind = parsed.kind;

  // Extract field value from JSON
  const fieldValue = response[fieldName];
  if (fieldValue === undefined) {
    return {
      artefactId,
      status: 'failed',
      diagnostics: { ...diagnostics, reason: 'missing_field', field: fieldName },
    };
  }

  let value: unknown = fieldValue;

  const effectiveOrdinal = trimNamespaceOrdinals(parsed.ordinal, context);

  if (effectiveOrdinal && effectiveOrdinal.length > 0) {
    value = selectByOrdinal(fieldValue, effectiveOrdinal, diagnostics);
    if (value === undefined) {
      return {
        artefactId,
        status: 'failed',
        diagnostics,
      };
    }
  } else if (parsed.index?.segment !== undefined) {
    value = selectArrayElement(fieldValue, parsed.index.segment, diagnostics);
    if (value === undefined) {
      return {
        artefactId,
        status: 'failed',
        diagnostics,
      };
    }
  }

  // Materialize value to string
  const materialized = materializeValue(value);
  if (!materialized.success) {
    return {
      artefactId,
      status: 'failed',
      diagnostics: { ...diagnostics, reason: 'materialization_failed', error: materialized.error },
    };
  }

  return {
    artefactId,
    status: 'succeeded',
    blob: {
      data: materialized.text ?? '',
      mimeType: 'text/plain',
    },
    diagnostics,
  };
}

/**
 * Parses artifact identifier into kind and index components.
 *
 * @example
 * "Artifact:MovieTitle" → { kind: "MovieTitle", index: undefined }
 * "Artifact:NarrationScript[segment=2]" → { kind: "NarrationScript", index: { segment: 2 } }
 * "Artifact:SegmentImage[segment=1&image=3]" → { kind: "SegmentImage", index: { segment: 1, image: 3 } }
 */
export function parseArtefactIdentifier(identifier: string): ParsedArtefactIdentifier | null {
  if (!identifier.startsWith('Artifact:')) {
    return null;
  }

  const remainder = identifier.slice('Artifact:'.length);
  const [kindPart, ...dimensionParts] = remainder.split('[');
  const kind = kindPart.trim();

  if (!kind) {
    return null;
  }

  const index: Record<string, number> = {};
  const ordinal: number[] = [];
  for (const part of dimensionParts) {
    const cleaned = part.replace(/\]$/, '');
    const pairs = cleaned.split('&');

    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key && value !== undefined) {
        const parsedValue = Number(value.trim());
        if (!Number.isNaN(parsedValue) && Number.isInteger(parsedValue)) {
          index[key.trim()] = parsedValue;
        }
      } else if (key) {
        const parsedValue = Number(key.trim());
        if (!Number.isNaN(parsedValue) && Number.isInteger(parsedValue)) {
          ordinal.push(parsedValue);
        }
      }
    }
  }

  return {
    kind,
    index: Object.keys(index).length > 0 ? index : undefined,
    ordinal: ordinal.length > 0 ? ordinal : undefined,
  };
}

function trimNamespaceOrdinals(
  ordinal: number[] | undefined,
  context: ArtefactExtractionContext,
): number[] | undefined {
  if (!ordinal || ordinal.length === 0) {
    return ordinal;
  }
  const skip = context.skipNamespaceOrdinals;
  if (skip <= 0) {
    return ordinal;
  }
  if (skip >= ordinal.length) {
    return [];
  }
  return ordinal.slice(skip);
}

function resolveNamespaceOrdinalDepth(options: BuildArtefactOptions): number {
  if (typeof options.namespaceOrdinalDepth === 'number' && options.namespaceOrdinalDepth >= 0) {
    return options.namespaceOrdinalDepth;
  }
  if (options.producerId) {
    return countBracketSegments(options.producerId);
  }
  return 0;
}

function countBracketSegments(identifier: string): number {
  const matches = identifier.match(/\[[^\]]+\]/g);
  return matches ? matches.length : 0;
}

function selectArrayElement(
  fieldValue: unknown,
  elementIndex: number,
  diagnostics: Record<string, unknown>,
): unknown {
  if (!Array.isArray(fieldValue)) {
    diagnostics.reason = 'expected_array';
    diagnostics.actualType = typeof fieldValue;
    return undefined;
  }
  const value = fieldValue[elementIndex];
  if (value === undefined) {
    diagnostics.reason = 'segment_out_of_bounds';
    diagnostics.segmentIndex = elementIndex;
    diagnostics.arrayLength = fieldValue.length;
    return undefined;
  }
  diagnostics.segmentIndex = elementIndex;
  return value;
}

function selectByOrdinal(
  fieldValue: unknown,
  ordinal: number[],
  diagnostics: Record<string, unknown>,
): unknown {
  let current: unknown = fieldValue;
  for (const [depth, index] of ordinal.entries()) {
    if (!Array.isArray(current)) {
      diagnostics.reason = 'expected_array';
      diagnostics.depth = depth;
      diagnostics.actualType = typeof current;
      return undefined;
    }
    const arr = current as unknown[];
    current = arr[index];
    if (current === undefined) {
      diagnostics.reason = 'segment_out_of_bounds';
      diagnostics.depth = depth;
      diagnostics.segmentIndex = index;
      diagnostics.arrayLength = arr.length;
      return undefined;
    }
  }
  diagnostics.ordinal = ordinal;
  return current;
}

/**
 * Materializes a value to string and optionally buffer format.
 */
function materializeValue(value: unknown): {
  success: boolean;
  text?: string;
  buffer?: Uint8Array | string;
  error?: string;
} {
  if (value === null || value === undefined) {
    return { success: false, error: 'Value is undefined or null.' };
  }

  // String value
  if (typeof value === 'string') {
    return { success: true, text: value, buffer: value };
  }

  // Binary data
  if (value instanceof Uint8Array) {
    return { success: true, text: Buffer.from(value).toString('utf8'), buffer: value };
  }

  // Array - join items with newlines
  if (Array.isArray(value)) {
    const text = value.map((item) => (item === null || item === undefined ? '' : String(item))).join('\n');
    return { success: true, text, buffer: text };
  }

  // Object or other - serialize to JSON
  try {
    const text = JSON.stringify(value, null, 2);
    return { success: true, text, buffer: text };
  } catch {
    return { success: false, error: 'Unable to serialize value to JSON.' };
  }
}
