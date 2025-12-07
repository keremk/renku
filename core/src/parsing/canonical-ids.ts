import type { BlueprintInputDefinition, BlueprintTreeNode } from '../types.js';

/**
 * Canonical ID helpers live in parsing because parsing is the only stage
 * allowed to mint new canonical identifiers. Other stages should consume
 * IDs produced here rather than inventing their own.
 */
function formatCanonicalId(kind: 'Input' | 'Artifact' | 'Producer', segments: string[]): string {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('Canonical id segments must be a non-empty array.');
  }
  return `${kind}:${segments.join('.')}`;
}

export function formatCanonicalProducerName(namespacePath: string[], producerAlias: string): string {
  return namespacePath.length > 0 ? namespacePath.join('.') : producerAlias;
}

export function formatCanonicalProducerId(namespacePath: string[], producerAlias: string): string {
  return formatCanonicalId('Producer', formatCanonicalProducerName(namespacePath, producerAlias).split('.'));
}

export function formatCanonicalInputId(namespacePath: string[], name: string): string {
  return formatCanonicalId('Input', joinSegments(namespacePath, name));
}

export function formatCanonicalArtifactId(namespacePath: string[], name: string): string {
  return formatCanonicalId('Artifact', joinSegments(namespacePath, name));
}

export function isCanonicalInputId(value: string): boolean {
  return typeof value === 'string' && value.startsWith('Input:');
}

export function isCanonicalArtifactId(value: string): boolean {
  return typeof value === 'string' && value.startsWith('Artifact:');
}

export interface CanonicalInputEntry {
  canonicalId: string;
  name: string;
  namespacePath: string[];
  definition: BlueprintInputDefinition;
}

export function collectCanonicalInputs(tree: BlueprintTreeNode): CanonicalInputEntry[] {
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

export interface InputIdResolver {
  // eslint-disable-next-line no-unused-vars
  resolve(key: string): string;
  entries: CanonicalInputEntry[];
}

export function createInputIdResolver(
  tree: BlueprintTreeNode,
  extraEntries: CanonicalInputEntry[] = [],
): InputIdResolver {
  const entries = [...collectCanonicalInputs(tree), ...extraEntries];
  const canonicalIds = new Set(entries.map((entry) => entry.canonicalId));
  const qualifiedToCanonical = new Map<string, string>();

  for (const entry of entries) {
    const qualifiedSegments = joinSegments(entry.namespacePath, entry.name).join('.');
    qualifiedToCanonical.set(qualifiedSegments, entry.canonicalId);
  }

  const resolve = (key: string): string => {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new Error('Input keys must be non-empty strings.');
    }
    const trimmed = key.trim();
    if (isCanonicalInputId(trimmed)) {
      if (!canonicalIds.has(trimmed)) {
        throw new Error(`Unknown canonical input id "${trimmed}".`);
      }
      return trimmed;
    }
    const qualified = qualifiedToCanonical.get(trimmed);
    if (qualified) {
      return qualified;
    }
    throw new Error(`Unknown input "${trimmed}".`);
  };

  return { resolve, entries };
}

export function formatProducerScopedInputId(
  namespacePath: string[],
  producerName: string,
  key: string,
): string {
  const producerSegments = formatCanonicalProducerName(namespacePath, producerName).split('.');
  return formatCanonicalId('Input', [...producerSegments, key]);
}

export function parseQualifiedProducerName(name: string): { namespacePath: string[]; producerName: string } {
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
