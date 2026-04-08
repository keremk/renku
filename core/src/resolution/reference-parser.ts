import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';

export interface ParsedGraphReferenceSegment {
  name: string;
  dimensions: string[];
}

export interface ParsedGraphReference {
  namespaceSegments: ParsedGraphReferenceSegment[];
  node: ParsedGraphReferenceSegment;
}

export function parseGraphReference(reference: string): ParsedGraphReference {
  if (typeof reference !== 'string' || reference.trim().length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_REFERENCE,
      `Invalid reference: "${reference}"`
    );
  }

  const parts = reference.split('.');
  const segments = parts.map(parseGraphReferenceSegment);
  const node = segments.pop();
  if (!node) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_REFERENCE,
      `Malformed reference: "${reference}"`
    );
  }

  return {
    namespaceSegments: segments,
    node,
  };
}

export function parseGraphReferenceSegment(
  segment: string
): ParsedGraphReferenceSegment {
  const dimensions: string[] = [];
  const nameMatch = segment.match(/^[^[]+/);
  const name = nameMatch ? nameMatch[0] : '';
  if (!name) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_REFERENCE,
      `Invalid segment "${segment}"`
    );
  }

  const dimensionMatches = segment.slice(name.length).match(/\[[^\]]*]/g) ?? [];
  for (const match of dimensionMatches) {
    const symbol = match.slice(1, -1).trim();
    if (!symbol) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_DIMENSION_SELECTOR,
        `Invalid dimension in "${segment}"`
      );
    }
    dimensions.push(symbol);
  }

  return { name, dimensions };
}

export function formatParsedGraphReferenceSegment(
  segment: ParsedGraphReferenceSegment
): string {
  if (segment.dimensions.length === 0) {
    return segment.name;
  }
  return `${segment.name}${segment.dimensions.map((dimension) => `[${dimension}]`).join('')}`;
}
