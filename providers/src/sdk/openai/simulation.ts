import type { JSONSchema7 } from 'ai';
import { parseArtefactIdentifier } from './artefacts.js';
import type { ProviderJobContext } from '../../types.js';
import type { OpenAiLlmConfig, OpenAiResponseFormat } from './config.js';
import type { GenerationResult } from './generation.js';

export interface SimulationSizeHints {
  arrayLengths?: Record<string, number[]>;
}

interface SimulationOptions {
  request: ProviderJobContext;
  config: OpenAiLlmConfig;
  sizeHints?: SimulationSizeHints;
}

export function simulateOpenAiGeneration(options: SimulationOptions): GenerationResult {
  const { request, config } = options;
  const responseMeta = {
    id: `simulated-openai-${request.jobId}`,
    model: request.model,
    createdAt: new Date().toISOString(),
  } satisfies Record<string, unknown>;

  const responseFormat = config.responseFormat as OpenAiResponseFormat | undefined;
  if (responseFormat?.type === 'json_schema') {
    if (!responseFormat.schema) {
      throw new Error('Simulation requires a JSON schema for json_schema response format.');
    }
    const sizeHints: SimulationSizeHints = {
      arrayLengths: deriveArrayLengthsFromProduces(request),
    };
    const data = generateFromSchema(responseFormat.schema as JSONSchema7, {
      sizeHints,
    }) as Record<string, unknown>;
    return {
      data,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      warnings: [],
      response: responseMeta,
    };
  }

  const text = `[Simulated ${request.jobId}]`;
  return {
    data: text,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warnings: [],
    response: responseMeta,
  };
}

interface GeneratorContext {
  sizeHints?: SimulationSizeHints;
}

function generateFromSchema(
  schema: JSONSchema7,
  context: GeneratorContext,
  propertyName?: string,
  activeLengths?: number[],
): unknown {
  const resolvedType = resolveType(schema);

  if (resolvedType === 'object' || (schema.properties && !resolvedType)) {
    const obj: Record<string, unknown> = {};
    const properties = schema.properties ?? {};
    for (const [key, value] of Object.entries(properties)) {
      const lengths = context.sizeHints?.arrayLengths?.[key];
      obj[key] = generateFromSchema(value as JSONSchema7, context, key, lengths);
    }
    return obj;
  }

  if (resolvedType === 'array' || schema.items) {
    const length = resolveArrayLength(propertyName, activeLengths);
    const itemSchema = (schema.items as JSONSchema7) ?? {};
    const nextLengths = activeLengths && activeLengths.length > 1 ? activeLengths.slice(1) : [];
    return Array.from({ length }, (_, index) => {
      const itemName = propertyName ? `${propertyName} segment ${index + 1}` : `item_${index}`;
      return generateFromSchema(itemSchema, context, itemName, nextLengths.length > 0 ? nextLengths : undefined);
    });
  }

  if (resolvedType === 'number' || resolvedType === 'integer') {
    return 1;
  }

  if (resolvedType === 'boolean') {
    return true;
  }

  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }

  return `Simulated ${propertyName ?? 'value'}`;
}

function resolveType(schema: JSONSchema7): JSONSchema7['type'] | undefined {
  if (!schema.type) {
    return undefined;
  }
  return Array.isArray(schema.type) ? schema.type[0] : schema.type;
}

function resolveArrayLength(
  propertyName: string | undefined,
  lengths: number[] | undefined,
): number {
  if (lengths && lengths.length > 0 && Number.isFinite(lengths[0])) {
    return Math.max(0, Math.floor(lengths[0]!));
  }
  throw new Error(
    `Simulation missing array length for field "${propertyName ?? 'root'}". Provide loop-derived ordinals or explicit hints.`,
  );
}

function deriveArrayLengthsFromProduces(request: ProviderJobContext): Record<string, number[]> {
  const lengths = new Map<string, number[]>();
  const namespaceOrdinalDepth = countBracketSegments(request.jobId);

  for (const artefactId of request.produces) {
    const parsed = parseArtefactIdentifier(artefactId);
    if (!parsed) {
      continue;
    }
    const fieldName = parsed.baseName;
    const ordinals = normalizeOrdinals(parsed, namespaceOrdinalDepth);
    if (!ordinals || ordinals.length === 0) {
      continue;
    }
    const existing = lengths.get(fieldName) ?? [];
    for (let i = 0; i < ordinals.length; i += 1) {
      const needed = ordinals[i]! + 1;
      if (existing[i] === undefined || existing[i]! < needed) {
        existing[i] = needed;
      }
    }
    lengths.set(fieldName, existing);
  }

  return Object.fromEntries(lengths.entries());
}

function normalizeOrdinals(
  parsed: ReturnType<typeof parseArtefactIdentifier>,
  namespaceOrdinalDepth: number,
): number[] | undefined {
  const ordinals: number[] = [];
  if (parsed?.ordinal && parsed.ordinal.length > 0) {
    ordinals.push(...parsed.ordinal);
  } else if (parsed?.index?.segment !== undefined) {
    ordinals.push(parsed.index.segment);
  }
  if (ordinals.length === 0) {
    return undefined;
  }
  if (namespaceOrdinalDepth <= 0) {
    return ordinals;
  }
  if (namespaceOrdinalDepth >= ordinals.length) {
    return [];
  }
  return ordinals.slice(namespaceOrdinalDepth);
}

function countBracketSegments(identifier: string): number {
  const matches = identifier.match(/\[[^\]]+\]/g);
  return matches ? matches.length : 0;
}
