import type { JSONSchema7 } from 'ai';
import type { ProviderJobContext, ConditionHints } from '../../types.js';
import type { OpenAiLlmConfig, OpenAiResponseFormat } from './config.js';
import { normalizeJsonSchema } from './config.js';
import type { GenerationResult } from './generation.js';

export interface SimulationSizeHints {
  arrayLengths?: Record<string, number[]>;
  /** Hints for condition-aware value generation */
  conditionHints?: ConditionHints;
}

interface SimulationOptions {
  request: ProviderJobContext;
  config: OpenAiLlmConfig;
  sizeHints?: SimulationSizeHints;
}

export function simulateOpenAiGeneration(
  options: SimulationOptions
): GenerationResult {
  const { request, config, sizeHints: externalHints } = options;
  const responseMeta = {
    id: `simulated-openai-${request.jobId}`,
    model: request.model,
    createdAt: new Date().toISOString(),
  } satisfies Record<string, unknown>;

  const responseFormat = config.responseFormat as
    | OpenAiResponseFormat
    | undefined;
  if (responseFormat?.type === 'json_schema') {
    if (!responseFormat.schema) {
      throw new Error(
        'Simulation requires a JSON schema for json_schema response format.'
      );
    }
    const scopedConditionHints = scopeConditionHintsToRequest(
      request,
      externalHints?.conditionHints
    );

    // Merge external hints with derived hints (external takes precedence)
    const derivedLengths = deriveArrayLengthsFromProduces(request);
    const sizeHints: SimulationSizeHints = {
      arrayLengths: { ...derivedLengths, ...externalHints?.arrayLengths },
      conditionHints: scopedConditionHints,
    };
    // Normalize schema to unwrap nested schema structure (e.g., { name, strict, schema: {...} })
    const normalizedSchema = normalizeJsonSchema(
      responseFormat.schema as JSONSchema7
    );
    const data = generateFromSchema(normalizedSchema, {
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
  /** Current path through the schema (for matching varying field hints) */
  currentPath?: string[];
  /** Current array indices by property name (for cycling values) */
  arrayIndices?: Record<string, number>;
}

function scopeConditionHintsToRequest(
  request: ProviderJobContext,
  hints: ConditionHints | undefined
): ConditionHints | undefined {
  if (!hints || hints.varyingFields.length === 0) {
    return hints;
  }

  const producedArtifactPaths = extractProducedArtifactPaths(request.produces);
  const hintedArtifactPaths = new Set<string>();

  for (const hint of hints.varyingFields) {
    if (!hint.artifactId || typeof hint.artifactId !== 'string') {
      throw new Error(
        'Simulation condition hint is missing canonical artifactId.'
      );
    }
    const artifactPath = extractHintArtifactPath(hint.artifactId);
    if (!artifactPath) {
      throw new Error(
        `Simulation condition hint has invalid canonical artifactId: ${hint.artifactId}`
      );
    }
    hintedArtifactPaths.add(artifactPath);
  }

  const matchingArtifactPaths = Array.from(hintedArtifactPaths).filter((path) =>
    producedArtifactPaths.has(path)
  );

  if (matchingArtifactPaths.length === 0) {
    return { ...hints, varyingFields: [] };
  }

  if (matchingArtifactPaths.length > 1) {
    throw new Error(
      `Simulation condition hints are ambiguous for job "${request.jobId}". Matching artifact paths: ${matchingArtifactPaths.join(', ')}`
    );
  }

  const targetArtifactPath = matchingArtifactPaths[0]!;
  return {
    ...hints,
    varyingFields: hints.varyingFields.filter(
      (hint) => extractHintArtifactPath(hint.artifactId) === targetArtifactPath
    ),
  };
}

function extractProducedArtifactPaths(produces: string[]): Set<string> {
  const artifactPaths = new Set<string>();
  for (const artifactId of produces) {
    const artifactPath = extractArtifactPath(artifactId);
    if (artifactPath) {
      artifactPaths.add(artifactPath);
    }
  }
  return artifactPaths;
}

function extractArtifactPath(artifactId: string): string | undefined {
  if (!artifactId.startsWith('Artifact:')) {
    return undefined;
  }
  const body = artifactId.slice('Artifact:'.length);
  const segments = splitPathWithBrackets(body);
  const propertySegments = segments.filter(
    (segment) => !segment.startsWith('[')
  );
  if (propertySegments.length < 2) {
    return undefined;
  }
  return `${propertySegments[0]}.${propertySegments[1]}`;
}

function extractHintArtifactPath(artifactId: string): string | undefined {
  return extractArtifactPath(artifactId);
}

function extractHintFieldPath(artifactId: string): string {
  if (!artifactId.startsWith('Artifact:')) {
    throw new Error(
      `Simulation condition hint requires canonical artifactId with Artifact: prefix. Received: ${artifactId}`
    );
  }

  const body = artifactId.slice('Artifact:'.length);
  const segments = splitPathWithBrackets(body);
  if (segments.length < 2) {
    throw new Error(
      `Simulation condition hint artifactId must include producer and artifact names. Received: ${artifactId}`
    );
  }

  const fieldSegments = segments.slice(2);
  if (fieldSegments.length === 0) {
    return '';
  }
  let fieldPath = '';
  for (const segment of fieldSegments) {
    if (segment.startsWith('[')) {
      fieldPath += segment;
      continue;
    }
    if (fieldPath.length > 0) {
      fieldPath += '.';
    }
    fieldPath += segment;
  }

  return fieldPath;
}

function splitPathWithBrackets(path: string): string[] {
  const segments: string[] = [];
  let current = '';

  for (let i = 0; i < path.length; i++) {
    const char = path[i];
    if (char === '.') {
      if (current) {
        segments.push(current);
        current = '';
      }
    } else if (char === '[') {
      if (current) {
        segments.push(current);
        current = '';
      }
      let bracketContent = '[';
      i++;
      while (i < path.length && path[i] !== ']') {
        bracketContent += path[i];
        i++;
      }
      bracketContent += ']';
      segments.push(bracketContent);
    } else {
      current += char;
    }
  }

  if (current) {
    segments.push(current);
  }
  return segments;
}

function generateFromSchema(
  schema: JSONSchema7,
  context: GeneratorContext,
  propertyName?: string,
  activeLengths?: number[]
): unknown {
  const resolvedType = resolveType(schema);
  const currentPath = context.currentPath ?? [];
  const pathWithProperty = propertyName
    ? [...currentPath, propertyName]
    : currentPath;

  if (resolvedType === 'object' || (schema.properties && !resolvedType)) {
    const obj: Record<string, unknown> = {};
    const properties = schema.properties ?? {};
    for (const [key, value] of Object.entries(properties)) {
      const lengths = context.sizeHints?.arrayLengths?.[key];
      obj[key] = generateFromSchema(
        value as JSONSchema7,
        { ...context, currentPath: pathWithProperty },
        key,
        lengths
      );
    }
    return obj;
  }

  if (resolvedType === 'array' || schema.items) {
    const length = resolveArrayLength(propertyName, activeLengths);
    const itemSchema = (schema.items as JSONSchema7) ?? {};
    const nextLengths =
      activeLengths && activeLengths.length > 1 ? activeLengths.slice(1) : [];
    return Array.from({ length }, (_, index) => {
      const itemName = propertyName
        ? `${propertyName} segment ${index + 1}`
        : `item_${index}`;
      // Track the array index for this property (used for cycling values)
      const newIndices = {
        ...(context.arrayIndices ?? {}),
        [propertyName ?? 'root']: index,
      };
      return generateFromSchema(
        itemSchema,
        { ...context, currentPath: pathWithProperty, arrayIndices: newIndices },
        itemName,
        nextLengths.length > 0 ? nextLengths : undefined
      );
    });
  }

  if (resolvedType === 'number' || resolvedType === 'integer') {
    // Check for varying field hint
    const varyingValue = getVaryingValue(pathWithProperty, context);
    if (typeof varyingValue === 'number') {
      return varyingValue;
    }
    return 1;
  }

  if (resolvedType === 'boolean') {
    // Check for varying field hint first
    const varyingValue = getVaryingValue(pathWithProperty, context);
    if (typeof varyingValue === 'boolean') {
      return varyingValue;
    }
    // Use alternating pattern for booleans in alternating mode
    if (isAlternatingMode(context)) {
      const index = getEffectiveArrayIndex(context);
      return index % 2 === 0;
    }
    return true;
  }

  if (schema.enum && schema.enum.length > 0) {
    // Check for varying field hint first
    const varyingValue = getVaryingValue(pathWithProperty, context);
    if (
      varyingValue !== undefined &&
      schema.enum.some((e) => e === varyingValue)
    ) {
      return varyingValue;
    }
    // Use cycling pattern for enums in alternating mode
    if (isAlternatingMode(context) && schema.enum.length > 1) {
      const index = getEffectiveArrayIndex(context);
      return schema.enum[index % schema.enum.length];
    }
    return schema.enum[0];
  }

  return `Simulated ${propertyName ?? 'value'}`;
}

/**
 * Checks if condition hints are in alternating mode.
 */
function isAlternatingMode(context: GeneratorContext): boolean {
  return context.sizeHints?.conditionHints?.mode === 'alternating';
}

/**
 * Gets the effective array index for cycling values.
 * Uses the deepest array index in the current context.
 */
function getEffectiveArrayIndex(context: GeneratorContext): number {
  const indices = context.arrayIndices ?? {};
  const values = Object.values(indices);
  if (values.length === 0) {
    return 0;
  }
  // Use the most recent (deepest) array index
  return values[values.length - 1] ?? 0;
}

/**
 * Gets a varying value from condition hints if the current path matches.
 */
function getVaryingValue(path: string[], context: GeneratorContext): unknown {
  const hints = context.sizeHints?.conditionHints;
  if (!hints || hints.varyingFields.length === 0) {
    return undefined;
  }

  // Build the path string for matching
  const pathStr = path.join('.');

  for (const hint of hints.varyingFields) {
    const hintPath = extractHintFieldPath(hint.artifactId);
    if (matchesVaryingPath(pathStr, hintPath)) {
      const index = resolveHintCycleIndex(hint, context);

      // Cycle through the hint values
      if (hint.values.length > 0) {
        return hint.values[index % hint.values.length];
      }
    }
  }

  return undefined;
}

function resolveHintCycleIndex(
  hint: { artifactId: string; dimension?: string },
  context: GeneratorContext
): number {
  const arrayIndices = context.arrayIndices ?? {};

  if (hint.dimension) {
    const directIndex = arrayIndices[hint.dimension];
    if (typeof directIndex === 'number') {
      return directIndex;
    }
  }

  const hintPath = extractHintFieldPath(hint.artifactId);
  const hintDimensionBindings = extractHintDimensionBindings(hintPath)
    .map((binding) => ({
      ...binding,
      index: arrayIndices[binding.propertyName],
    }))
    .filter(
      (
        binding
      ): binding is {
        dimension: string;
        propertyName: string;
        index: number;
      } => typeof binding.index === 'number'
    );

  if (hint.dimension) {
    const requestedDimensionBinding = hintDimensionBindings.find(
      (binding) => binding.dimension === hint.dimension
    );
    if (requestedDimensionBinding) {
      if (hintDimensionBindings.length === 1) {
        return requestedDimensionBinding.index;
      }
      return combineHintIndices(
        hintDimensionBindings.map((binding) => binding.index)
      );
    }
  }

  if (hintDimensionBindings.length === 1) {
    return hintDimensionBindings[0]!.index;
  }
  if (hintDimensionBindings.length > 1) {
    return combineHintIndices(
      hintDimensionBindings.map((binding) => binding.index)
    );
  }

  return getEffectiveArrayIndex(context);
}

function extractHintDimensionBindings(path: string): Array<{
  dimension: string;
  propertyName: string;
}> {
  const segments = splitPathWithBrackets(path);
  const bindings: Array<{ dimension: string; propertyName: string }> = [];

  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const match = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(segment);
    if (!match) {
      continue;
    }
    const propertyName = segments[index - 1]!;
    if (propertyName.startsWith('[')) {
      continue;
    }
    bindings.push({
      dimension: match[1]!,
      propertyName,
    });
  }

  return bindings;
}

function combineHintIndices(indices: number[]): number {
  let combined = 0;
  for (const index of indices) {
    combined = combined * 31 + index;
  }
  return Math.abs(combined);
}

/**
 * Checks if a schema path matches a varying field hint path.
 * The hint path may contain dimension placeholders like "[segment]".
 */
function matchesVaryingPath(schemaPath: string, hintPath: string): boolean {
  const normalizedSchema = normalizePathForHintComparison(schemaPath);
  const normalizedHint = normalizePathForHintComparison(hintPath);

  if (normalizedHint.length === 0) {
    return normalizedSchema.length === 0;
  }

  if (!normalizedSchema) {
    return false;
  }

  return (
    normalizedSchema === normalizedHint ||
    normalizedSchema.endsWith(`.${normalizedHint}`)
  );
}

function normalizePathForHintComparison(path: string): string {
  const segments = splitPathWithBrackets(path);
  const normalizedSegments: string[] = [];

  for (const segment of segments) {
    if (/^\[[A-Za-z_][A-Za-z0-9_]*\]$/.test(segment)) {
      continue;
    }

    const cleaned = segment.replace(/\s+segment\s+\d+/g, '').trim();
    if (!cleaned) {
      continue;
    }

    if (normalizedSegments[normalizedSegments.length - 1] === cleaned) {
      continue;
    }

    normalizedSegments.push(cleaned);
  }

  return normalizedSegments.join('.');
}

function resolveType(schema: JSONSchema7): JSONSchema7['type'] | undefined {
  if (!schema.type) {
    return undefined;
  }
  return Array.isArray(schema.type) ? schema.type[0] : schema.type;
}

function resolveArrayLength(
  propertyName: string | undefined,
  lengths: number[] | undefined
): number {
  if (lengths && lengths.length > 0 && Number.isFinite(lengths[0])) {
    return Math.max(0, Math.floor(lengths[0]!));
  }
  throw new Error(
    `Simulation missing array length for field "${propertyName ?? 'root'}". Provide loop-derived ordinals or explicit hints.`
  );
}

function deriveArrayLengthsFromProduces(
  request: ProviderJobContext
): Record<string, number[]> {
  const lengths = new Map<string, number[]>();
  const namespaceOrdinalDepth = countBracketSegments(request.jobId);

  for (const artefactId of request.produces) {
    // Extract array fields with their ordinals from the artifact path
    // For "Artifact:DocProducer.VideoScript.Segments[0].UseNarrationAudio"
    // we need to associate ordinal [0] with field "Segments", not "UseNarrationAudio"
    const arrayFields = extractArrayFieldsFromPath(
      artefactId,
      namespaceOrdinalDepth
    );

    for (const { fieldName, ordinals } of arrayFields) {
      const existing = lengths.get(fieldName) ?? [];

      // Update each dimension's max length
      for (let i = 0; i < ordinals.length; i++) {
        const needed = ordinals[i]! + 1;
        if (existing[i] === undefined || existing[i]! < needed) {
          existing[i] = needed;
        }
      }

      lengths.set(fieldName, existing);
    }
  }

  return Object.fromEntries(lengths.entries());
}

/**
 * Extracts array field names with their ordinals from an artifact path.
 * For decomposed JSON artifacts, the bracket follows the array field name.
 * Handles multi-dimensional arrays like ImagePrompt[0][0] by associating
 * all consecutive brackets with the preceding field name, then skipping
 * namespace ordinals from the front.
 *
 * @example
 * "Artifact:DocProducer.VideoScript.Segments[0].UseNarrationAudio" (skipOrdinalCount=0)
 * → [{ fieldName: "Segments", ordinals: [0] }]
 *
 * "Artifact:Producer.Items[0].SubItems[1].Value" (skipOrdinalCount=0)
 * → [{ fieldName: "Items", ordinals: [0] }, { fieldName: "SubItems", ordinals: [1] }]
 *
 * "Artifact:ImagePromptProducer.ImagePrompt[0][1]" (skipOrdinalCount=1)
 * → [{ fieldName: "ImagePrompt", ordinals: [1] }] (first ordinal [0] skipped as namespace)
 */
function extractArrayFieldsFromPath(
  artefactId: string,
  skipOrdinalCount: number
): Array<{ fieldName: string; ordinals: number[] }> {
  if (!artefactId.startsWith('Artifact:')) {
    return [];
  }

  const path = artefactId.slice('Artifact:'.length);
  const results: Array<{ fieldName: string; ordinals: number[] }> = [];

  // Find all field[ordinal] patterns, including consecutive brackets
  // Pattern: word characters followed by one or more bracket groups
  const regex = /(\w+)((?:\[\d+\])+)/g;
  let match;
  let remainingSkip = skipOrdinalCount;

  while ((match = regex.exec(path)) !== null) {
    const fieldName = match[1]!;
    const bracketsPart = match[2]!;

    // Extract all ordinals from consecutive brackets
    const bracketRegex = /\[(\d+)\]/g;
    const ordinals: number[] = [];
    let bracketMatch;
    while ((bracketMatch = bracketRegex.exec(bracketsPart)) !== null) {
      ordinals.push(parseInt(bracketMatch[1]!, 10));
    }

    // Skip namespace ordinals from the front of this field's ordinals
    // E.g., for ImagePrompt[0][1] with skipOrdinalCount=1, skip the [0]
    if (remainingSkip > 0 && ordinals.length > 0) {
      const toSkip = Math.min(remainingSkip, ordinals.length);
      ordinals.splice(0, toSkip);
      remainingSkip -= toSkip;
    }

    // Only include this field if it still has ordinals after skipping
    if (ordinals.length > 0) {
      results.push({ fieldName, ordinals });
    }
  }

  return results;
}

function countBracketSegments(identifier: string): number {
  const matches = identifier.match(/\[[^\]]+\]/g);
  return matches ? matches.length : 0;
}
