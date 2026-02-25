/**
 * Utility functions for working with artifact IDs and producer grouping.
 */

import type { ArtifactInfo } from '@/types/builds';
import type { BlueprintGraphData } from '@/types/blueprint-graph';

/**
 * Extract producer name from canonical artifact ID.
 * Artifact ID format: "Artifact:ProducerName.OutputName[index]"
 *
 * @example "Artifact:ScriptProducer.NarrationScript[0]" → "ScriptProducer"
 * @example "Artifact:CharacterImageProducer.GeneratedImage[1]" → "CharacterImageProducer"
 */
export function extractProducerFromArtifactId(
  artifactId: string
): string | null {
  const match = artifactId.match(/^Artifact:([^.]+)\./);
  return match ? match[1] : null;
}

/**
 * Shorten artifact canonical ID for display.
 * Rule: Strip 'Artifact:' prefix and producer name (first segment), show remaining path.
 *
 * @example "Artifact:EduScriptProducer.VideoScript.Characters[0].CharacterImagePrompt"
 *        → "VideoScript.Characters[0].CharacterImagePrompt"
 * @example "Artifact:CharacterImageProducer.GeneratedImage[1]"
 *        → "GeneratedImage[1]"
 * @example "Artifact:DocProducer.Script"
 *        → "Script"
 */
export function shortenArtifactDisplayName(artifactId: string): string {
  // Remove the "Artifact:" prefix
  const withoutPrefix = artifactId.replace(/^Artifact:/, '');

  // Split by the first dot to separate producer name from the rest
  const firstDotIndex = withoutPrefix.indexOf('.');
  if (firstDotIndex === -1) {
    // No dot found, return as-is (shouldn't happen with valid IDs)
    return withoutPrefix;
  }

  // Return everything after the first dot
  return withoutPrefix.slice(firstDotIndex + 1);
}

/**
 * Group artifacts by producer name.
 * Artifacts without a recognizable producer are grouped under "[Unknown]".
 */
export function groupArtifactsByProducer(
  artifacts: ArtifactInfo[]
): Map<string, ArtifactInfo[]> {
  const groups = new Map<string, ArtifactInfo[]>();

  for (const artifact of artifacts) {
    const producer = extractProducerFromArtifactId(artifact.id) ?? '[Unknown]';
    const existing = groups.get(producer) ?? [];
    existing.push(artifact);
    groups.set(producer, existing);
  }

  return groups;
}

// ============================================================================
// Sub-grouping: classify and group artifacts within a producer section
// ============================================================================

export type SubGroupType = 'top-level' | 'primitive-array' | 'object-array';

export interface ArtifactSubGroup {
  /** Classification of this sub-group */
  type: SubGroupType;
  /** Display label: null for top-level, array name for primitive-array, "Scenes #1" for object-array */
  label: string | null;
  /** Sort key for ordering sub-groups */
  sortKey: string;
  /** Artifacts in this sub-group */
  artifacts: ArtifactInfo[];
  /** Array name for primitive-array / object-array groups (e.g., "Scenes", "CharacterImagePrompts") */
  arrayName?: string;
  /** 0-based index for object-array groups */
  index?: number;
}

/**
 * Bracket pattern that matches `[0]`, `[clip=0]`, `[segment=1]`, etc.
 * Captures the numeric index from either format.
 */
const BRACKET_RE = /\[(?:\w+=)?(\d+)\]/;

/**
 * Classify a single display path into a sub-group key.
 *
 * Given a display path (from shortenArtifactDisplayName), split by '.' segments
 * and find the first segment containing '[...]':
 *
 * 1. No bracket segment → top-level
 * 2. Bracket segment IS the last segment → primitive-array
 * 3. Bracket segment has more after it → object-array
 */
function classifyDisplayPath(displayPath: string): {
  type: SubGroupType;
  arrayName: string;
  index: number;
} {
  // Split into dot-separated segments, but keep brackets with their segment.
  // E.g., "Storyboard.Scenes[0].NarrationScript" → ["Storyboard", "Scenes[0]", "NarrationScript"]
  // E.g., "SegmentImage[segment=0][image=0]" → ["SegmentImage[segment=0][image=0]"]
  const segments = displayPath.split('.');

  // Find first segment containing a bracket
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const bracketMatch = seg.match(BRACKET_RE);
    if (!bracketMatch) continue;

    const index = parseInt(bracketMatch[1], 10);
    // Extract array name = everything before the first '['
    const bracketPos = seg.indexOf('[');
    const arrayName = seg.slice(0, bracketPos);

    // Check if this bracket segment has a second bracket (nested like [segment=0][image=0])
    // In that case, the first bracket forms the group key
    const afterFirstBracket = seg.slice(seg.indexOf(']') + 1);
    const hasMoreBrackets = afterFirstBracket.includes('[');

    if (i < segments.length - 1 || hasMoreBrackets) {
      // Object array: bracket segment has more segments or nested brackets after it
      return { type: 'object-array', arrayName, index };
    }

    // Primitive array: bracket segment is the last segment with no further nesting
    return { type: 'primitive-array', arrayName, index };
  }

  // No brackets found → top-level
  return { type: 'top-level', arrayName: '', index: 0 };
}

/**
 * Classify and group artifacts within a single producer section.
 *
 * Returns sub-groups in this order:
 * 1. Top-level artifacts (no header)
 * 2. Primitive array groups (alphabetical by array name)
 * 3. Object array groups (by array name, then by index)
 */
export function classifyAndGroupArtifacts(
  artifacts: ArtifactInfo[]
): ArtifactSubGroup[] {
  const topLevel: ArtifactInfo[] = [];
  // Map of arrayName → ArtifactInfo[] (for primitive arrays)
  const primitiveArrays = new Map<string, ArtifactInfo[]>();
  // Map of "arrayName:index" → ArtifactInfo[] (for object arrays)
  const objectArrays = new Map<
    string,
    { arrayName: string; index: number; artifacts: ArtifactInfo[] }
  >();

  for (const artifact of artifacts) {
    const displayPath = shortenArtifactDisplayName(artifact.id);
    const { type, arrayName, index } = classifyDisplayPath(displayPath);

    if (type === 'top-level') {
      topLevel.push(artifact);
    } else if (type === 'primitive-array') {
      const existing = primitiveArrays.get(arrayName) ?? [];
      existing.push(artifact);
      primitiveArrays.set(arrayName, existing);
    } else {
      const key = `${arrayName}:${index}`;
      const existing = objectArrays.get(key);
      if (existing) {
        existing.artifacts.push(artifact);
      } else {
        objectArrays.set(key, { arrayName, index, artifacts: [artifact] });
      }
    }
  }

  const result: ArtifactSubGroup[] = [];

  // 1. Top-level (no header)
  if (topLevel.length > 0) {
    result.push({
      type: 'top-level',
      label: null,
      sortKey: '0',
      artifacts: topLevel,
    });
  }

  // 2. Primitive arrays (sorted alphabetically by array name)
  const sortedPrimitiveNames = Array.from(primitiveArrays.keys()).sort();
  for (const name of sortedPrimitiveNames) {
    result.push({
      type: 'primitive-array',
      label: name,
      sortKey: `1:${name}`,
      artifacts: primitiveArrays.get(name)!,
      arrayName: name,
    });
  }

  // 3. Object arrays (sorted by array name, then by index)
  const sortedObjectEntries = Array.from(objectArrays.values()).sort((a, b) => {
    const nameCmp = a.arrayName.localeCompare(b.arrayName);
    if (nameCmp !== 0) return nameCmp;
    return a.index - b.index;
  });
  for (const entry of sortedObjectEntries) {
    result.push({
      type: 'object-array',
      label: `${entry.arrayName} #${entry.index + 1}`,
      sortKey: `2:${entry.arrayName}:${String(entry.index).padStart(6, '0')}`,
      artifacts: entry.artifacts,
      arrayName: entry.arrayName,
      index: entry.index,
    });
  }

  return result;
}

// ============================================================================
// Smart label: context-aware display labels for artifacts
// ============================================================================

/**
 * Compute a context-aware display label for an artifact.
 *
 * - No subGroup context → leaf name only (e.g., "Title", "MusicPrompt")
 * - primitive-array → "#N" (1-based index from bracket)
 * - object-array → leaf name, stripping the group prefix.
 *   For nested arrays within object-array (e.g., CharacterPresent[1]) → "CharacterPresent #2"
 */
export function getArtifactLabel(
  artifactId: string,
  subGroup?: ArtifactSubGroup
): string {
  const displayPath = shortenArtifactDisplayName(artifactId);

  if (!subGroup || subGroup.type === 'top-level') {
    // Return the leaf name: everything after the last dot that isn't inside brackets
    return getLeafName(displayPath);
  }

  if (subGroup.type === 'primitive-array') {
    // Extract the index from the bracket at the end of the display path
    const match = displayPath.match(/\[(?:\w+=)?(\d+)\]$/);
    if (match) {
      return `#${parseInt(match[1], 10) + 1}`;
    }
    return getLeafName(displayPath);
  }

  // object-array: strip the group prefix (arrayName[index].) and show leaf
  // First, find the group bracket segment and take everything after it
  const segments = displayPath.split('.');
  let afterGroupPrefix = '';
  let foundGroup = false;
  let groupSegment = '';

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!foundGroup && BRACKET_RE.test(seg)) {
      // This is the group bracket segment; everything after is the leaf path
      foundGroup = true;
      groupSegment = seg;
      afterGroupPrefix = segments.slice(i + 1).join('.');
      break;
    }
  }

  if (!foundGroup) {
    return getLeafName(displayPath);
  }

  // Format 1 nested dimensions can be in the same segment:
  // SegmentImage[segment=0][image=1]
  if (!afterGroupPrefix) {
    const bracketMatches = Array.from(
      groupSegment.matchAll(/\[(?:(\w+)=)?(\d+)\]/g)
    );

    // First bracket is the object-array group key itself.
    // Use the next bracket to label siblings within that group.
    if (bracketMatches.length >= 2) {
      const dimensionName = bracketMatches[1][1];
      const index = parseInt(bracketMatches[1][2], 10) + 1;
      if (dimensionName) {
        return `${dimensionName} #${index}`;
      }
      return `#${index}`;
    }

    return getLeafName(displayPath);
  }

  // Check if the remaining path itself has brackets (nested array within object-array)
  const nestedMatch = afterGroupPrefix.match(/^([^[]+)\[(?:\w+=)?(\d+)\]$/);
  if (nestedMatch) {
    return `${nestedMatch[1]} #${parseInt(nestedMatch[2], 10) + 1}`;
  }

  // Simple leaf: "NarrationScript", "SceneImagePrompt"
  return getLeafName(afterGroupPrefix);
}

/** Extract the final segment of a dot-path, stripping any bracket suffix. */
function getLeafName(displayPath: string): string {
  const segments = displayPath.split('.');
  const last = segments[segments.length - 1];
  // Strip bracket suffix for display (e.g., "CharacterImagePrompts[0]" → "CharacterImagePrompts")
  const bracketPos = last.indexOf('[');
  return bracketPos >= 0 ? last.slice(0, bracketPos) : last;
}

// ============================================================================
// Blob URL helper
// ============================================================================

/**
 * Build a viewer-api blob URL for an artifact hash.
 */
export function getBlobUrl(
  blueprintFolder: string,
  movieId: string,
  hash: string
): string {
  if (!blueprintFolder || !movieId || !hash) {
    const missing: string[] = [];
    if (!blueprintFolder) missing.push('blueprintFolder');
    if (!movieId) missing.push('movieId');
    if (!hash) missing.push('hash');
    throw new Error(
      `[getBlobUrl] Missing required parameters: ${missing.join(', ')}`
    );
  }
  const params = new URLSearchParams({
    folder: blueprintFolder,
    movieId,
    hash,
  });
  return `/viewer-api/blueprints/blob?${params.toString()}`;
}

// ============================================================================
// Topological sorting
// ============================================================================

/**
 * Sort producer names in topological order using graph data.
 * Producers that appear earlier in the execution flow come first.
 * If no graph data is provided, returns the original order.
 *
 * Uses the graph's nodes array order as a proxy for topological order,
 * since nodes are typically already ordered by layer/dependency.
 */
export function sortProducersByTopology(
  producerNames: string[],
  graphData?: BlueprintGraphData
): string[] {
  if (!graphData) {
    return producerNames;
  }

  // Build a map of producer name -> index in graph nodes
  const nodeOrderMap = new Map<string, number>();
  graphData.nodes.forEach((node, index) => {
    if (node.type === 'producer') {
      nodeOrderMap.set(node.label, index);
    }
  });

  // Sort producers by their order in the graph
  // Producers not in the graph go to the end
  return [...producerNames].sort((a, b) => {
    const indexA = nodeOrderMap.get(a) ?? Number.MAX_SAFE_INTEGER;
    const indexB = nodeOrderMap.get(b) ?? Number.MAX_SAFE_INTEGER;
    return indexA - indexB;
  });
}
