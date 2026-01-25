/**
 * Utility functions for working with artifact IDs and producer grouping.
 */

import type { ArtifactInfo } from "@/types/builds";
import type { BlueprintGraphData } from "@/types/blueprint-graph";

/**
 * Extract producer name from canonical artifact ID.
 * Artifact ID format: "Artifact:ProducerName.OutputName[index]"
 *
 * @example "Artifact:ScriptProducer.NarrationScript[0]" → "ScriptProducer"
 * @example "Artifact:CharacterImageProducer.GeneratedImage[1]" → "CharacterImageProducer"
 */
export function extractProducerFromArtifactId(artifactId: string): string | null {
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
  const withoutPrefix = artifactId.replace(/^Artifact:/, "");

  // Split by the first dot to separate producer name from the rest
  const firstDotIndex = withoutPrefix.indexOf(".");
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
    const producer = extractProducerFromArtifactId(artifact.id) ?? "[Unknown]";
    const existing = groups.get(producer) ?? [];
    existing.push(artifact);
    groups.set(producer, existing);
  }

  return groups;
}

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
    if (node.type === "producer") {
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
