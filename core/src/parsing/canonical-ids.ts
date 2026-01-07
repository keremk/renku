import type { BlueprintInputDefinition, BlueprintTreeNode } from '../types.js';
import { SYSTEM_INPUTS } from '../types.js';

/**
 * Canonical ID helpers live in parsing because parsing is the only stage
 * allowed to mint new canonical identifiers. Other stages should consume
 * IDs produced here rather than inventing their own.
 *
 * Canonical ID Format:
 *   Type:path.to.name[index0][index1]...
 *
 * Where:
 *   - Type is one of: Input, Artifact, Producer
 *   - path.to.name is the producer alias path plus the item name
 *   - [indexN] are optional dimension indices (only present after expansion)
 *
 * Examples:
 *   - Input:Topic (root-level input named "Topic")
 *   - Input:ScriptProducer.InquiryPrompt (input scoped to ScriptProducer)
 *   - Producer:ScriptProducer (producer with alias ScriptProducer)
 *   - Artifact:SegmentImage[0][1] (expanded artifact with dimension indices)
 */

export type CanonicalIdType = 'Input' | 'Artifact' | 'Producer';

// -----------------------------------------------------------------------------
// Validators
// -----------------------------------------------------------------------------

/**
 * Returns true if value is a canonical Input ID (starts with "Input:").
 */
export function isCanonicalInputId(value: string): boolean {
  return typeof value === 'string' && value.startsWith('Input:');
}

/**
 * Returns true if value is a canonical Artifact ID (starts with "Artifact:").
 */
export function isCanonicalArtifactId(value: string): boolean {
  return typeof value === 'string' && value.startsWith('Artifact:');
}

/**
 * Returns true if value is a canonical Producer ID (starts with "Producer:").
 */
export function isCanonicalProducerId(value: string): boolean {
  return typeof value === 'string' && value.startsWith('Producer:');
}

/**
 * Returns true if value is any canonical ID (Input, Artifact, or Producer).
 */
export function isCanonicalId(value: string): boolean {
  return (
    isCanonicalInputId(value) ||
    isCanonicalArtifactId(value) ||
    isCanonicalProducerId(value)
  );
}

/**
 * Returns the type of a canonical ID, or null if not a valid canonical ID.
 */
export function getCanonicalIdType(value: string): CanonicalIdType | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (value.startsWith('Input:')) {
    return 'Input';
  }
  if (value.startsWith('Artifact:')) {
    return 'Artifact';
  }
  if (value.startsWith('Producer:')) {
    return 'Producer';
  }
  return null;
}

// -----------------------------------------------------------------------------
// Parsers
// -----------------------------------------------------------------------------

export interface ParsedCanonicalId {
  type: CanonicalIdType;
  path: string[];
  name: string;
}

export interface ParsedCanonicalArtifactId extends ParsedCanonicalId {
  type: 'Artifact';
  indices: number[];
}

/**
 * Parses a canonical Input ID into its components.
 * Throws if the ID is not a valid canonical Input ID.
 *
 * @example
 * parseCanonicalInputId('Input:Topic') // { type: 'Input', path: [], name: 'Topic' }
 * parseCanonicalInputId('Input:ScriptProducer.Prompt') // { type: 'Input', path: ['ScriptProducer'], name: 'Prompt' }
 */
export function parseCanonicalInputId(id: string): ParsedCanonicalId {
  assertCanonicalInputId(id);
  const body = id.slice('Input:'.length);
  return parseIdBody('Input', body);
}

/**
 * Parses a canonical Producer ID into its components.
 * Throws if the ID is not a valid canonical Producer ID.
 *
 * @example
 * parseCanonicalProducerId('Producer:ScriptProducer') // { type: 'Producer', path: [], name: 'ScriptProducer' }
 */
export function parseCanonicalProducerId(id: string): ParsedCanonicalId {
  assertCanonicalProducerId(id);
  const body = id.slice('Producer:'.length);
  return parseIdBody('Producer', body);
}

/**
 * Parses a canonical Artifact ID into its components, including dimension indices.
 * Throws if the ID is not a valid canonical Artifact ID.
 *
 * @example
 * parseCanonicalArtifactId('Artifact:Image') // { type: 'Artifact', path: [], name: 'Image', indices: [] }
 * parseCanonicalArtifactId('Artifact:SegmentImage[0][1]') // { type: 'Artifact', path: [], name: 'SegmentImage', indices: [0, 1] }
 */
export function parseCanonicalArtifactId(
  id: string
): ParsedCanonicalArtifactId {
  assertCanonicalArtifactId(id);
  const body = id.slice('Artifact:'.length);

  // Extract indices from the end: [0][1][2]...
  const indices: number[] = [];
  const indexMatches = body.match(/\[\d+\]/g);
  if (indexMatches) {
    for (const match of indexMatches) {
      const num = parseInt(match.slice(1, -1), 10);
      indices.push(num);
    }
  }

  // Remove indices to get the path
  const pathPart = body.replace(/\[\d+\]/g, '');
  const parsed = parseIdBody('Artifact', pathPart);

  return {
    ...parsed,
    type: 'Artifact',
    indices,
  };
}

function parseIdBody(type: CanonicalIdType, body: string): ParsedCanonicalId {
  const segments = body.split('.').filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error(`Invalid canonical ${type} ID: empty body.`);
  }
  const name = segments[segments.length - 1]!;
  const path = segments.slice(0, -1);
  return { type, path, name };
}

// -----------------------------------------------------------------------------
// Assertions
// -----------------------------------------------------------------------------

/**
 * Throws if value is not a valid canonical Input ID.
 */
export function assertCanonicalInputId(value: string): void {
  if (!isCanonicalInputId(value)) {
    throw new Error(`Expected canonical Input ID (Input:...), got "${value}".`);
  }
  const body = value.slice('Input:'.length);
  if (body.length === 0 || body === '.') {
    throw new Error(`Invalid canonical Input ID: "${value}" has empty body.`);
  }
}

/**
 * Throws if value is not a valid canonical Artifact ID.
 */
export function assertCanonicalArtifactId(value: string): void {
  if (!isCanonicalArtifactId(value)) {
    throw new Error(
      `Expected canonical Artifact ID (Artifact:...), got "${value}".`
    );
  }
  const body = value.slice('Artifact:'.length);
  // Remove indices for validation
  const pathPart = body.replace(/\[\d+\]/g, '');
  if (pathPart.length === 0 || pathPart === '.') {
    throw new Error(
      `Invalid canonical Artifact ID: "${value}" has empty body.`
    );
  }
}

/**
 * Throws if value is not a valid canonical Producer ID.
 */
export function assertCanonicalProducerId(value: string): void {
  if (!isCanonicalProducerId(value)) {
    throw new Error(
      `Expected canonical Producer ID (Producer:...), got "${value}".`
    );
  }
  const body = value.slice('Producer:'.length);
  if (body.length === 0 || body === '.') {
    throw new Error(
      `Invalid canonical Producer ID: "${value}" has empty body.`
    );
  }
}

/**
 * Throws if value is not a valid canonical ID of any type.
 */
export function assertCanonicalId(value: string): void {
  if (!isCanonicalId(value)) {
    throw new Error(
      `Expected canonical ID (Input:..., Artifact:..., or Producer:...), got "${value}".`
    );
  }
}

// -----------------------------------------------------------------------------
// Formatters
// -----------------------------------------------------------------------------

function formatCanonicalId(kind: CanonicalIdType, segments: string[]): string {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('Canonical id segments must be a non-empty array.');
  }
  return `${kind}:${segments.join('.')}`;
}

/**
 * Formats the producer alias - the reference name used to identify a producer
 * in blueprint connections and inputs.
 *
 * This is NOT a canonical ID - it's the alias/reference portion used within canonical IDs.
 *
 * When aliasPath is non-empty, it IS the identifier (the import alias takes precedence).
 * When aliasPath is empty, the producerName is used directly.
 *
 * @example
 * // Simple producer (no import alias)
 * formatProducerAlias([], 'ScriptProducer')
 * // Returns: 'ScriptProducer'
 *
 * @example
 * // Imported producer: producers: [{ name: MyScript, path: ./script.yaml }]
 * formatProducerAlias(['MyScript'], 'InternalName')
 * // Returns: 'MyScript' (alias takes precedence)
 *
 * @example
 * // Nested namespace (future blueprint imports)
 * formatProducerAlias(['Namespace', 'Sub'], 'Name')
 * // Returns: 'Namespace.Sub'
 */
export function formatProducerAlias(
  aliasPath: string[],
  producerName: string
): string {
  return aliasPath.length > 0 ? aliasPath.join('.') : producerName;
}

/**
 * @deprecated Use formatProducerAlias instead. This alias exists for backwards compatibility.
 */
export const formatCanonicalProducerName = formatProducerAlias;

/**
 * @deprecated Use formatProducerAlias instead. This alias exists for backwards compatibility.
 */
export const formatProducerPath = formatProducerAlias;

/**
 * Formats a canonical Producer ID.
 *
 * @example
 * formatCanonicalProducerId([], 'ScriptProducer') // 'Producer:ScriptProducer'
 * formatCanonicalProducerId(['ScriptProducer'], 'InternalName') // 'Producer:ScriptProducer'
 */
export function formatCanonicalProducerId(
  aliasPath: string[],
  producerName: string
): string {
  return formatCanonicalId(
    'Producer',
    formatProducerAlias(aliasPath, producerName).split('.')
  );
}

/**
 * Formats a canonical Input ID.
 *
 * @example
 * formatCanonicalInputId([], 'Topic') // 'Input:Topic'
 * formatCanonicalInputId(['ScriptProducer'], 'Prompt') // 'Input:ScriptProducer.Prompt'
 */
export function formatCanonicalInputId(
  aliasPath: string[],
  name: string
): string {
  return formatCanonicalId('Input', joinSegments(aliasPath, name));
}

/**
 * Formats a canonical Artifact ID.
 *
 * @example
 * formatCanonicalArtifactId([], 'Image') // 'Artifact:Image'
 * formatCanonicalArtifactId(['ScriptProducer'], 'Script') // 'Artifact:ScriptProducer.Script'
 */
export function formatCanonicalArtifactId(
  aliasPath: string[],
  name: string
): string {
  return formatCanonicalId('Artifact', joinSegments(aliasPath, name));
}

export interface CanonicalInputEntry {
  canonicalId: string;
  name: string;
  namespacePath: string[];
  definition: BlueprintInputDefinition;
}

export function collectCanonicalInputs(
  tree: BlueprintTreeNode
): CanonicalInputEntry[] {
  const entries: CanonicalInputEntry[] = [];
  const namespace = tree.namespacePath;
  for (const input of tree.document.inputs) {
    entries.push({
      canonicalId: formatCanonicalInputId(namespace, input.name),
      name: input.name,
      namespacePath: namespace,
      definition: input,
    });
  }
  for (const child of tree.children.values()) {
    entries.push(...collectCanonicalInputs(child));
  }
  return entries;
}

/**
 * Set of system input names that are automatically recognized.
 * These don't need to be declared in blueprint YAML.
 */
const SYSTEM_INPUT_NAMES: Set<string> = new Set(Object.values(SYSTEM_INPUTS));

/**
 * Returns true if the given name is a recognized system input.
 */
export function isSystemInput(name: string): boolean {
  return SYSTEM_INPUT_NAMES.has(name);
}

export interface InputIdResolver {
  /**
   * Validates that a canonical input ID exists.
   * ONLY accepts canonical IDs (Input:...). Throws if not canonical or unknown.
   * Use `toCanonical()` first if you need to convert from a qualified name.
   */
  // eslint-disable-next-line no-unused-vars
  resolve(canonicalId: string): string;

  /**
   * Converts a key to its canonical form.
   * Accepts both canonical IDs (returns as-is after validation) and qualified names.
   * Throws if the key doesn't match any known input.
   */
  // eslint-disable-next-line no-unused-vars
  toCanonical(key: string): string;

  /**
   * Checks if a canonical ID exists in the resolver.
   */
  // eslint-disable-next-line no-unused-vars
  has(canonicalId: string): boolean;

  /**
   * All canonical input entries known to this resolver.
   */
  entries: CanonicalInputEntry[];
}

export function createInputIdResolver(
  tree: BlueprintTreeNode,
  extraEntries: CanonicalInputEntry[] = []
): InputIdResolver {
  const entries = [...collectCanonicalInputs(tree), ...extraEntries];
  const canonicalIds = new Set(entries.map((entry) => entry.canonicalId));
  const qualifiedToCanonical = new Map<string, string>();

  for (const entry of entries) {
    const qualifiedSegments = joinSegments(
      entry.namespacePath,
      entry.name
    ).join('.');
    qualifiedToCanonical.set(qualifiedSegments, entry.canonicalId);
  }

  /**
   * Strict resolution - ONLY accepts canonical IDs.
   */
  const resolve = (canonicalId: string): string => {
    if (typeof canonicalId !== 'string' || canonicalId.trim().length === 0) {
      throw new Error('Input keys must be non-empty strings.');
    }
    const trimmed = canonicalId.trim();
    if (!isCanonicalInputId(trimmed)) {
      throw new Error(
        `Expected canonical Input ID (Input:...), got "${trimmed}". ` +
          `Use resolver.toCanonical() to convert qualified names.`
      );
    }
    if (!canonicalIds.has(trimmed)) {
      throw new Error(`Unknown canonical input id "${trimmed}".`);
    }
    return trimmed;
  };

  /**
   * Converts a key (canonical or qualified) to canonical form.
   * Also accepts artifact paths for decomposed artifact overrides.
   */
  const toCanonical = (key: string): string => {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new Error('Input keys must be non-empty strings.');
    }
    const trimmed = key.trim();

    // If already canonical input, validate and return
    if (isCanonicalInputId(trimmed)) {
      if (!canonicalIds.has(trimmed)) {
        throw new Error(`Unknown canonical input id "${trimmed}".`);
      }
      return trimmed;
    }

    // If already canonical artifact, return as-is (for artifact overrides)
    if (isCanonicalArtifactId(trimmed)) {
      return trimmed;
    }

    // Try to convert from qualified name (inputs)
    const qualified = qualifiedToCanonical.get(trimmed);
    if (qualified) {
      return qualified;
    }

    // Check if it looks like a decomposed artifact path (contains dots and brackets with numbers)
    // e.g., "DocProducer.VideoScript.Segments[0].ImagePrompts[0]"
    if (looksLikeDecomposedArtifactPath(trimmed)) {
      // Convert to canonical artifact ID format
      return `Artifact:${trimmed}`;
    }

    // Check if it's a system input (Duration, NumOfSegments, SegmentDuration, etc.)
    // System inputs are automatically recognized without explicit declaration in blueprint YAML
    if (isSystemInput(trimmed)) {
      return `Input:${trimmed}`;
    }

    throw new Error(
      `Unknown input "${trimmed}". Expected a canonical ID (Input:...) or a known qualified name.`
    );
  };

  const has = (canonicalId: string): boolean => {
    return canonicalIds.has(canonicalId);
  };

  return { resolve, toCanonical, has, entries };
}

export function formatProducerScopedInputId(
  namespacePath: string[],
  producerName: string,
  key: string
): string {
  const producerSegments = formatProducerAlias(
    namespacePath,
    producerName
  ).split('.');
  return formatCanonicalId('Input', [...producerSegments, key]);
}

export function parseQualifiedProducerName(name: string): {
  namespacePath: string[];
  producerName: string;
} {
  const segments = name.split('.').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new Error('Producer name must be non-empty.');
  }
  const producerName = segments[segments.length - 1]!;
  const namespacePath = segments.slice(0, -1);
  return { namespacePath, producerName };
}

function joinSegments(namespacePath: string[], ...rest: string[]): string[] {
  return [...namespacePath, ...rest].filter((segment) => segment.length > 0);
}

/**
 * Returns true if the path looks like a decomposed artifact path.
 * These paths contain dots (for namespace/field navigation) and numeric array indices.
 * Examples:
 *   - "DocProducer.VideoScript.Segments[0].ImagePrompts[0]" → true
 *   - "Segments[0].Script" → true
 *   - "SimpleInput" → false
 *   - "Producer.Input" → false (no numeric indices)
 */
export function looksLikeDecomposedArtifactPath(path: string): boolean {
  // Must contain at least one numeric array index like [0], [1], etc.
  return /\[\d+\]/.test(path);
}
